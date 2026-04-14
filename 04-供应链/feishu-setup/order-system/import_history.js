/**
 * 导入历史订单数据 → 分析 → 更新飞书预测表历史参考均值
 *
 * 功能：
 * 1. 读取 合并订单汇总.xlsx
 * 2. 清洗日期（6+ 种格式）、归一化产品型号（49→10 SKU）
 * 3. 按周统计各 SKU 销量
 * 4. 计算最近 12 周周均销量
 * 5. 更新飞书 SKU 主数据表 + 预测表
 *
 * 用法: node import_history.js [analyze|update|both]
 *   analyze — 只分析，输出统计（默认）
 *   update  — 更新飞书表
 *   both    — 分析 + 更新
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
  forecast: "tblFLAHOXLSgWS6Q",
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

// ─── 1. Date parsing ───

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Excel serial number
  if (/^\d{5}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000);
    const iso = d.toISOString().slice(0, 10);
    // filter obviously wrong years
    if (iso < "2024-01" || iso > "2026-12") return null;
    return iso;
  }

  let m;

  // 2025-07-29 00:00:00
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && m[1] >= "2024" && m[1] <= "2026")
    return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");

  // 2025.07.29 or 2025.7.
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{0,2})/);
  if (m && m[1] >= "2024" && m[1] <= "2026")
    return m[1] + "-" + m[2].padStart(2, "0") + "-" + (m[3] || "15").padStart(2, "0");

  // 25.09.01 (2-digit year)
  m = s.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (m) {
    const yr = "20" + m[1];
    if (yr >= "2024" && yr <= "2026")
      return yr + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  }

  // 2026-1- or 2026-2-
  m = s.match(/^(\d{4})-(\d{1,2})-$/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";

  // 24年11月
  m = s.match(/^(\d{2})\u5E74(\d{1,2})\u6708/);
  if (m) return "20" + m[1] + "-" + m[2].padStart(2, "0") + "-15";

  // 2025/11
  m = s.match(/^(\d{4})\/(\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";

  // 2026.2/ or 2026.2-
  m = s.match(/^(\d{4})\.(\d{1,2})[\/\-]/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-15";

  return null;
}

// ─── 2. Product model normalization ───

function normalizeSKU(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");

  // Ultra双效 family (must check before Ultra)
  if (s.includes("ultra") && s.includes("\u53CC\u6548")) return "Ultra\u53CC\u6548";
  if (s.includes("uitra") && s.includes("\u53CC\u6548")) return "Ultra\u53CC\u6548";

  // Ultra family
  if (s === "ultra" || s === "ultra\u7248" || s === "uitra" || s === "urtal") return "Ultra";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Cultra") || s.includes("\u65F6\u7A7A\u4E4B\u773Cutra")
      || s.includes("\u65F6\u7A7A\u4E4B\u773Cu1tra")) return "Ultra";
  if (s.includes("\u9AD8\u89C6\u661Fultra") || s.includes("\u9AD8\u89C6\u661Fuitra")) return "Ultra";
  if (s === "ultra") return "Ultra";

  // AB版
  if (s === "ab\u7248" || s === "ab" || s.includes("\u65F6\u7A7A\u4E4B\u773Eab") || s.includes("ab\u7248")) return "AB\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("ab")) return "AB\u7248";

  // A版
  if (s === "a\u7248" || s === "a") return "A\u7248";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Ea") && !s.includes("ab") && !s.includes("max")) return "A\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("a\u7248")) return "A\u7248";

  // B版
  if (s === "b\u7248" || s === "b") return "B\u7248";
  if (s.includes("\u65F6\u7A7A\u4E4B\u773Eb") && !s.includes("ab")) return "B\u7248";
  if (s.includes("\u52A8\u6001\u79BB\u7126") && s.includes("b\u7248")) return "B\u7248";

  // Max
  if (s.includes("max")) return "Max";

  // PRO
  if (s.includes("pro")) return "PRO";

  // D8
  if (s === "d8") return "D8";

  // 小旋风
  if (s.includes("\u5C0F\u65CB\u98CE")) return "\u5C0F\u65CB\u98CE";

  // SP1
  if (s === "sp1") return "SP1";

  return null;
}

// ─── 3. ISO week calculation ───

function getISOWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ─── Main ───

async function main() {
  const mode = process.argv[2] || "analyze";
  console.log("=== \u5386\u53F2\u8BA2\u5355\u5206\u6790 ===\n");

  // Read Excel
  console.log("\u8BFB\u53D6 Excel ...");
  const wb = XLSX.readFile("C:/Users/wangc/Downloads/order/\u5408\u5E76\u8BA2\u5355\u6C47\u603B.xlsx");
  const rawData = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"]);
  console.log(`  \u539F\u59CB\u884C\u6570: ${rawData.length}\n`);

  // Clean data
  let skipped = { date: 0, sku: 0, qty: 0 };
  const cleaned = [];
  for (const r of rawData) {
    const date = parseDate(r["\u4E0B\u5355\u65E5\u671F"]);
    if (!date || date < "2024-09-01" || date > "2026-03-31") { skipped.date++; continue; }

    const sku = normalizeSKU(r["\u4EA7\u54C1\u578B\u53F7"]);
    if (!sku) { skipped.sku++; continue; }

    const qty = Number(r["\u6570\u91CF\uFF08\u7247\uFF09"]) || 0;
    if (qty <= 0) { skipped.qty++; continue; }

    cleaned.push({ date, sku, qty, week: getISOWeek(date) });
  }

  console.log(`\u6E05\u6D17\u7ED3\u679C: ${cleaned.length} \u6709\u6548\u884C (\u8DF3\u8FC7: \u65E5\u671F${skipped.date} + SKU${skipped.sku} + \u6570\u91CF${skipped.qty})\n`);

  // ── SKU summary ──
  const skuStats = {};
  for (const r of cleaned) {
    if (!skuStats[r.sku]) skuStats[r.sku] = { total: 0, rows: 0, weeks: new Set() };
    skuStats[r.sku].total += r.qty;
    skuStats[r.sku].rows++;
    skuStats[r.sku].weeks.add(r.week);
  }

  console.log("\u2501".repeat(60));
  console.log("\u2503 SKU \u9500\u91CF\u6C47\u603B");
  console.log("\u2501".repeat(60));
  console.log("SKU".padEnd(12) + "\u603B\u9500\u91CF".padStart(8) + "\u8BA2\u5355\u884C".padStart(8) + "\u8DE8\u5468\u6570".padStart(8) + "\u5468\u5747\u9500\u91CF".padStart(10));
  console.log("-".repeat(46));

  const weeklyAvg = {};
  for (const [sku, s] of Object.entries(skuStats).sort((a, b) => b[1].total - a[1].total)) {
    const avg = Math.round(s.total / s.weeks.size);
    weeklyAvg[sku] = avg;
    console.log(
      sku.padEnd(12) +
      String(s.total).padStart(8) +
      String(s.rows).padStart(8) +
      String(s.weeks.size).padStart(8) +
      String(avg).padStart(10)
    );
  }

  // ── Weekly trend (last 12 weeks) ──
  const allWeeks = [...new Set(cleaned.map((r) => r.week))].sort();
  const recent12 = allWeeks.slice(-12);

  console.log("\n" + "\u2501".repeat(60));
  console.log("\u2503 \u6700\u8FD112\u5468\u8D8B\u52BF");
  console.log("\u2501".repeat(60));

  // Build weekly matrix
  const weeklyMatrix = {};
  for (const r of cleaned) {
    if (!recent12.includes(r.week)) continue;
    if (!weeklyMatrix[r.week]) weeklyMatrix[r.week] = {};
    weeklyMatrix[r.week][r.sku] = (weeklyMatrix[r.week][r.sku] || 0) + r.qty;
  }

  const topSkus = Object.entries(skuStats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)
    .map(([k]) => k);

  // Header
  let header = "\u5468\u6B21".padEnd(10);
  for (const sku of topSkus) header += sku.padStart(9);
  header += "\u5408\u8BA1".padStart(9);
  console.log(header);
  console.log("-".repeat(10 + topSkus.length * 9 + 9));

  const recent4WeekData = {};
  for (const w of recent12) {
    let line = w.padEnd(10);
    let wTotal = 0;
    for (const sku of topSkus) {
      const v = weeklyMatrix[w]?.[sku] || 0;
      line += String(v).padStart(9);
      wTotal += v;
    }
    line += String(wTotal).padStart(9);
    console.log(line);

    // Collect last 4 weeks for forecast
    if (recent12.indexOf(w) >= recent12.length - 4) {
      for (const sku of Object.keys(skuStats)) {
        if (!recent4WeekData[sku]) recent4WeekData[sku] = [];
        recent4WeekData[sku].push(weeklyMatrix[w]?.[sku] || 0);
      }
    }
  }

  // ── 4-week average (for forecast) ──
  console.log("\n" + "\u2501".repeat(60));
  console.log("\u2503 \u6700\u8FD14\u5468\u5747\u503C\uFF08\u7528\u4E8E\u9884\u6D4B\u53C2\u8003\uFF09");
  console.log("\u2501".repeat(60));

  const forecast4w = {};
  for (const [sku, vals] of Object.entries(recent4WeekData)) {
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    forecast4w[sku] = avg;
    console.log(`  ${sku.padEnd(12)} ${avg} \u7247/\u5468`);
  }

  // ── Monthly trend ──
  console.log("\n" + "\u2501".repeat(60));
  console.log("\u2503 \u6708\u5EA6\u8D8B\u52BF");
  console.log("\u2501".repeat(60));

  const monthlyTotal = {};
  for (const r of cleaned) {
    const ym = r.date.slice(0, 7);
    monthlyTotal[ym] = (monthlyTotal[ym] || 0) + r.qty;
  }
  for (const [m, v] of Object.entries(monthlyTotal).sort()) {
    const bar = "\u2588".repeat(Math.round(v / 50));
    console.log(`  ${m}  ${String(v).padStart(5)}  ${bar}`);
  }

  // ── Day-of-week distribution ──
  console.log("\n" + "\u2501".repeat(60));
  console.log("\u2503 \u661F\u671F\u5206\u5E03\uFF08\u9A8C\u8BC1\u5468\u672B\u9AD8\u5CF0\uFF09");
  console.log("\u2501".repeat(60));

  const dowNames = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
  const dowQty = [0, 0, 0, 0, 0, 0, 0];
  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  for (const r of cleaned) {
    const d = new Date(r.date + "T00:00:00Z").getUTCDay();
    dowQty[d] += r.qty;
    dowCount[d]++;
  }
  for (let i = 0; i < 7; i++) {
    const bar = "\u2588".repeat(Math.round(dowQty[i] / 100));
    console.log(`  ${dowNames[i]}  ${String(dowQty[i]).padStart(5)} \u7247 (${dowCount[i]}\u884C)  ${bar}`);
  }

  // ── Update Feishu ──
  if (mode === "update" || mode === "both") {
    console.log("\n" + "\u2501".repeat(60));
    console.log("\u2503 \u66F4\u65B0\u98DE\u4E66\u6570\u636E");
    console.log("\u2501".repeat(60));

    await getToken();
    console.log("  \u98DE\u4E66\u5DF2\u8FDE\u63A5");

    // Update forecast table: set historical average
    const forecasts = await listRecords(TABLES.forecast);
    console.log(`  \u5F53\u524D\u9884\u6D4B\u8868\u8BB0\u5F55: ${forecasts.length}`);

    let updated = 0;
    for (const rec of forecasts) {
      const sku = rec.fields["产品型号"];
      if (!sku) continue;

      // Map mock SKU to real product — use the forecast4w data
      // The mock SKUs are SKU-001..012, we need to match them
      // For now, update any forecast record that has a matching SKU
      const avg = forecast4w[sku];
      if (avg !== undefined) {
        await api("PUT",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.forecast}/records/${rec.record_id}`,
          { fields: { "\u5386\u53F2\u53C2\u8003\u5747\u503C": avg } }
        );
        updated++;
        console.log(`  \u2713 ${sku} \u5386\u53F2\u53C2\u8003\u5747\u503C = ${avg}`);
      }
    }

    if (updated === 0) {
      console.log("\n  \u26A0\uFE0F \u73B0\u6709\u9884\u6D4B\u8868\u7528\u7684\u662F\u6A21\u62DF SKU\uFF08SKU-001\u2026\uFF09\uFF0C\u4E0E\u771F\u5B9E\u4EA7\u54C1\u540D\u4E0D\u5339\u914D");
      console.log("  \u5EFA\u8BAE\uFF1A\u7528\u771F\u5B9E\u4EA7\u54C1\u540D\u91CD\u5EFA SKU \u4E3B\u6570\u636E\u8868");
      console.log("\n  \u771F\u5B9E SKU \u5217\u8868\uFF1A");
      for (const [sku, avg] of Object.entries(forecast4w).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${sku.padEnd(12)} \u5468\u5747 ${avg} \u7247`);
      }
    }

    console.log(`\n  \u66F4\u65B0\u5B8C\u6210: ${updated} \u6761`);
  }

  console.log("\n\u2550".repeat(60));
  console.log("Done!");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
