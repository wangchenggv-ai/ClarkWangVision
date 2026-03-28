/**
 * 导入真实 SKU 前100名到飞书
 *
 * 1. 从历史订单提取 Top100 SKU（按销量排序）
 * 2. 清空飞书现有模拟数据
 * 3. 写入真实 SKU 主数据、库存、预测均值
 *
 * 用法: node import_real_skus.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  blank_inventory: "tbladv6bQTXlNOlM",
  forecast: "tblFLAHOXLSgWS6Q",
  production: "tbltSntfaR9KCI7B",
  order: "tblk9Ch4gk2uQ1zG",
};

let TOKEN = "";

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (res.code !== 0) break;
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

async function deleteAllRecords(tableId) {
  const records = await listRecords(tableId);
  if (records.length === 0) return 0;
  // Batch delete (max 500 per request)
  for (let i = 0; i < records.length; i += 500) {
    const ids = records.slice(i, i + 500).map((r) => r.record_id);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
      records: ids,
    });
  }
  return records.length;
}

async function batchCreate(tableId, recordsList) {
  const results = [];
  for (let i = 0; i < recordsList.length; i += 100) {
    const batch = recordsList.slice(i, i + 100).map((fields) => ({ fields }));
    const res = await api(
      "POST",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`,
      { records: batch }
    );
    if (res.code !== 0) console.error("  batch_create error:", res.msg);
    else results.push(...(res.data?.records || []));
  }
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Data normalization ───

function normNum(v) {
  const s = String(v || "").trim().replace(/DS$/i, "");
  if (!s || s === "-" || s === "+0.00" || s === "-0.00" || s === "0") return 0;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 4) / 4;
}

function normModel(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (s.includes("ultra") && s.includes("\u53CC\u6548")) return "Ultra\u53CC\u6548";
  if (s.includes("uitra") && s.includes("\u53CC\u6548")) return "Ultra\u53CC\u6548";
  if (s === "ultra" || s === "ultra\u7248" || s === "uitra" || s === "urtal") return "Ultra";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Cultra") || s.includes("\u65F6\u7A7A\u4E4B\u773Cutra") || s.includes("\u65F6\u7A7A\u4E4B\u773Cu1tra")) return "Ultra";
  if (s.includes("\u9AD8\u89C6\u661Fultra") || s.includes("\u9AD8\u89C6\u661Fuitra")) return "Ultra";
  if (s === "ab\u7248" || s.includes("\u65F6\u7A7A\u4E4B\u773Eab") || (s.includes("ab") && s.includes("\u7248"))) return "AB\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("ab")) return "AB\u7248";
  if (s === "a\u7248" || s === "a") return "A\u7248";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Ea") && !s.includes("ab") && !s.includes("max")) return "A\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("a\u7248")) return "A\u7248";
  if (s === "b\u7248" || s === "b") return "B\u7248";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Eb") && !s.includes("ab")) return "B\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("b\u7248")) return "B\u7248";
  if (s.includes("max")) return "Max";
  if (s.includes("pro")) return "PRO";
  if (s === "d8") return "D8";
  if (s.includes("\u5C0F\u65CB\u98CE")) return "\u5C0F\u65CB\u98CE";
  if (s === "sp1") return "SP1";
  return null;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{5}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000);
    const iso = d.toISOString().slice(0, 10);
    if (iso < "2024-01" || iso > "2026-12") return null;
    return iso;
  }
  let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && m[1] >= "2024" && m[1] <= "2026") return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{0,2})/);
  if (m && m[1] >= "2024" && m[1] <= "2026") return m[1] + "-" + m[2].padStart(2, "0") + "-" + (m[3] || "15").padStart(2, "0");
  m = s.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (m) { const yr = "20" + m[1]; if (yr >= "2024" && yr <= "2026") return yr + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0"); }
  m = s.match(/^(\d{4})-(\d{1,2})-$/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";
  m = s.match(/^(\d{2})\u5E74(\d{1,2})\u6708/);
  if (m) return "20" + m[1] + "-" + m[2].padStart(2, "0") + "-15";
  m = s.match(/^(\d{4})\/(\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";
  m = s.match(/^(\d{4})\.(\d{1,2})[\/\-]/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";
  return null;
}

function getISOWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function buildSKUId(model, sph, cyl) {
  let name = model;
  if (sph !== 0 || (cyl && cyl !== 0)) {
    name += " " + (sph >= 0 ? "+" : "") + sph.toFixed(2);
    if (cyl && cyl !== 0) name += "/" + (cyl >= 0 ? "+" : "") + cyl.toFixed(2);
  }
  return name;
}

// ─── Main ───

async function main() {
  console.log("=== \u5BFC\u5165\u771F\u5B9E SKU Top100 ===\n");

  // 1. Read & parse Excel
  console.log("1\uFE0F\u20E3  \u8BFB\u53D6\u5386\u53F2\u8BA2\u5355 ...");
  const wb = XLSX.readFile("C:/Users/wangc/Downloads/order/\u5408\u5E76\u8BA2\u5355\u6C47\u603B.xlsx");
  const rawData = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"]);

  // Parse all rows
  const orders = [];
  for (const r of rawData) {
    const model = normModel(r["\u4EA7\u54C1\u578B\u53F7"]);
    if (!model) continue;
    const sph = normNum(r["\u7403\u955C"]);
    if (sph === null) continue;
    const cyl = normNum(r["\u67F1\u955C"]) || 0;
    const qty = Number(r["\u6570\u91CF\uFF08\u7247\uFF09"]) || 0;
    if (qty <= 0) continue;
    const date = parseDate(r["\u4E0B\u5355\u65E5\u671F"]);
    if (!date || date < "2024-09-01" || date > "2026-03-31") continue;

    const skuId = buildSKUId(model, sph, cyl);
    orders.push({ skuId, model, sph, cyl, qty, date, week: getISOWeek(date) });
  }
  console.log(`  \u6709\u6548\u8BA2\u5355\u884C: ${orders.length}`);

  // 2. Aggregate by SKU
  const skuAgg = {};
  for (const o of orders) {
    if (!skuAgg[o.skuId]) skuAgg[o.skuId] = { model: o.model, sph: o.sph, cyl: o.cyl, totalQty: 0, weeks: {} };
    skuAgg[o.skuId].totalQty += o.qty;
    skuAgg[o.skuId].weeks[o.week] = (skuAgg[o.skuId].weeks[o.week] || 0) + o.qty;
  }

  // Sort by total qty, take top 100
  const top100 = Object.entries(skuAgg)
    .sort((a, b) => b[1].totalQty - a[1].totalQty)
    .slice(0, 100);

  console.log(`  Top100 SKU \u603B\u9500\u91CF: ${top100.reduce((a, [, v]) => a + v.totalQty, 0)}`);

  // 3. Calculate stats for each SKU
  const allWeeks = [...new Set(orders.map((o) => o.week))].sort();
  const recent4 = allWeeks.slice(-4);
  const recent12 = allWeeks.slice(-12);

  const skuData = top100.map(([skuId, agg], idx) => {
    const weekCount = Object.keys(agg.weeks).length;
    const weeklyAvg = Math.round(agg.totalQty / weekCount);

    // Recent 4-week average
    let r4sum = 0, r4count = 0;
    for (const w of recent4) {
      r4sum += agg.weeks[w] || 0;
      r4count++;
    }
    const recent4Avg = Math.round(r4sum / r4count);

    // Determine type: stock (备货品) if weekly avg >= 5, else custom (定制品)
    const type = weeklyAvg >= 3 ? "\u5907\u8D27\u54C1" : "\u5B9A\u5236\u54C1";

    // Safety stock = 2 weeks of average demand
    const safetyStock = weeklyAvg * 2;

    // Max stock = 12 weeks (3 months)
    const maxStock = weeklyAvg * 12;

    // Simulated current inventory: random between 0.5x ~ 2x weekly avg
    // Make some deliberately low for testing
    let currentStock;
    if (idx < 5) currentStock = Math.max(0, Math.round(weeklyAvg * 0.3)); // low stock
    else if (idx < 8) currentStock = 0; // out of stock
    else currentStock = Math.round(weeklyAvg * (0.8 + Math.random() * 1.5));

    return {
      rank: idx + 1,
      skuId,
      model: agg.model,
      sph: agg.sph,
      cyl: agg.cyl,
      totalQty: agg.totalQty,
      weeklyAvg,
      recent4Avg,
      type,
      safetyStock,
      maxStock,
      currentStock,
    };
  });

  // Print summary
  console.log("\n" + "\u2501".repeat(80));
  console.log("  #   SKU                           \u603B\u91CF  \u5468\u5747  \u8FD14\u5468  \u7C7B\u578B    \u5B89\u5168\u5E93\u5B58  \u6A21\u62DF\u5E93\u5B58");
  console.log("-".repeat(80));
  for (const s of skuData.slice(0, 30)) {
    console.log(
      String(s.rank).padStart(3) + "   " +
      s.skuId.padEnd(28) +
      String(s.totalQty).padStart(6) +
      String(s.weeklyAvg).padStart(6) +
      String(s.recent4Avg).padStart(7) +
      "  " + s.type.padEnd(6) +
      String(s.safetyStock).padStart(8) +
      String(s.currentStock).padStart(8)
    );
  }
  console.log("  ... (\u5171100\u6761)");

  // 4. Connect to Feishu and write
  console.log("\n2\uFE0F\u20E3  \u8FDE\u63A5\u98DE\u4E66 ...");
  await getToken();
  console.log("  \u2713 \u5DF2\u8FDE\u63A5");

  // 5. Clear old mock data
  console.log("\n3\uFE0F\u20E3  \u6E05\u7406\u65E7\u6570\u636E ...");
  const tables = ["sku", "finished_inventory", "blank_inventory", "forecast", "production", "order"];
  for (const t of tables) {
    const n = await deleteAllRecords(TABLES[t]);
    console.log(`  ${t}: \u5220\u9664 ${n} \u6761`);
    await sleep(200);
  }

  // 6. Write SKU master data
  console.log("\n4\uFE0F\u20E3  \u5199\u5165 SKU \u4E3B\u6570\u636E ...");
  const skuRecords = skuData.map((s) => ({
    "SKU\u7F16\u53F7": s.skuId,
    "SKU\u540D\u79F0": s.skuId,
    "\u7C7B\u578B": s.type,
    "\u5B89\u5168\u5E93\u5B58": s.safetyStock,
    "\u6700\u5927\u5E93\u5B58\uFF083\u6708\u91CF\uFF09": s.maxStock,
  }));
  await batchCreate(TABLES.sku, skuRecords);
  console.log(`  \u2713 ${skuRecords.length} \u6761 SKU`);

  // 7. Write inventory
  console.log("\n5\uFE0F\u20E3  \u5199\u5165\u6210\u54C1\u5E93\u5B58 ...");
  const invRecords = skuData.map((s) => {
    // Status based on stock level
    let status;
    if (s.currentStock <= 0) status = "\u274C\u7F3A\u8D27";
    else if (s.currentStock < s.safetyStock) status = "\u26A0\uFE0F\u4F4E\u5E93\u5B58";
    else status = "\u2705\u6709\u8D27";

    return {
      "SKU": s.skuId,
      "\u5F53\u524D\u5E93\u5B58": s.currentStock,
      "\u5728\u4EA7\u91CF": 0,
      "\u72B6\u6001": status,
    };
  });
  await batchCreate(TABLES.finished_inventory, invRecords);
  console.log(`  \u2713 ${invRecords.length} \u6761\u5E93\u5B58`);

  // 8. Write blank inventory (for stock items only, ~60% have blanks)
  console.log("\n6\uFE0F\u20E3  \u5199\u5165\u6BDB\u576F\u5E93\u5B58 ...");
  const stockItems = skuData.filter((s) => s.type === "\u5907\u8D27\u54C1");
  const blankRecords = stockItems.map((s) => ({
    "SKU": s.skuId,
    "\u5F53\u524D\u6BDB\u576F\u5E93\u5B58": Math.round(s.weeklyAvg * (0.5 + Math.random() * 2)),
    "\u5728\u4EA7\u6BDB\u576F\u91CF": 0,
  }));
  await batchCreate(TABLES.blank_inventory, blankRecords);
  console.log(`  \u2713 ${blankRecords.length} \u6761\u6BDB\u576F`);

  // 9. Write forecast (current week + next 2 weeks)
  console.log("\n7\uFE0F\u20E3  \u5199\u5165\u9500\u552E\u9884\u6D4B ...");
  const currentWeek = getISOWeek(new Date().toISOString().slice(0, 10));
  // Next week
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 7);
  const nextWeek = getISOWeek(nextDate.toISOString().slice(0, 10));

  // Only forecast top 30 SKUs to keep it manageable
  const forecastSkus = skuData.slice(0, 30);
  const forecastRecords = [];
  for (const s of forecastSkus) {
    forecastRecords.push({
      "\u9884\u6D4B\u5468\u671F": currentWeek,
      "SKU": s.skuId,
      "\u9884\u6D4B\u9500\u91CF": s.recent4Avg,
      "\u5386\u53F2\u53C2\u8003\u5747\u503C": s.weeklyAvg,
    });
    forecastRecords.push({
      "\u9884\u6D4B\u5468\u671F": nextWeek,
      "SKU": s.skuId,
      "\u9884\u6D4B\u9500\u91CF": s.recent4Avg,
      "\u5386\u53F2\u53C2\u8003\u5747\u503C": s.weeklyAvg,
    });
  }
  await batchCreate(TABLES.forecast, forecastRecords);
  console.log(`  \u2713 ${forecastRecords.length} \u6761\u9884\u6D4B\uFF0830 SKU x 2\u5468\uFF09`);

  // Done
  console.log("\n" + "\u2550".repeat(60));
  console.log("\u2705 \u5BFC\u5165\u5B8C\u6210\uFF01");
  console.log(`   SKU \u4E3B\u6570\u636E: ${skuRecords.length} \u6761`);
  console.log(`   \u6210\u54C1\u5E93\u5B58: ${invRecords.length} \u6761`);
  console.log(`   \u6BDB\u576F\u5E93\u5B58: ${blankRecords.length} \u6761`);
  console.log(`   \u9500\u552E\u9884\u6D4B: ${forecastRecords.length} \u6761`);
  console.log("\n\u63D0\u793A: \u8FD0\u884C node automations.js all \u53EF\u89E6\u53D1\u5168\u90E8\u81EA\u52A8\u5316\u89C4\u5219");
  console.log("\u2550".repeat(60));
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
