/**
 * classify_skus.js — ABC-XYZ SKU classification
 *
 * Reads order data from Feishu, calculates volume tier (ABC) and
 * demand variability (XYZ), writes classification + adjusted safety
 * stock back to SKU master table.
 *
 * Usage: node classify_skus.js
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  order: "tblk9Ch4gk2uQ1zG",
  forecast: "tblFLAHOXLSgWS6Q",
};
let TOKEN = "";

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`  API error [${method} ${path}]:`, json.msg);
    return null;
  }
  return json.data;
}

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  TOKEN = json.tenant_access_token;
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function updateRecord(tableId, recordId, fields) {
  return api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

// ─── Classification logic ─────────────────────────────────

function classifyABC(skus) {
  const sorted = [...skus].sort((a, b) => b.totalQty - a.totalQty);
  const totalVolume = sorted.reduce((sum, s) => sum + s.totalQty, 0);
  if (totalVolume === 0) return sorted;
  let cumulative = 0;
  for (const sku of sorted) {
    cumulative += sku.totalQty;
    const pct = cumulative / totalVolume;
    if (pct <= 0.7) sku.abc = "A";
    else if (pct <= 0.9) sku.abc = "B";
    else sku.abc = "C";
  }
  return sorted;
}

function classifyXYZ(skus) {
  for (const sku of skus) {
    const weeks = sku.weeklyQtys;
    if (weeks.length < 2) { sku.xyz = "Z"; continue; }
    const mean = weeks.reduce((s, v) => s + v, 0) / weeks.length;
    const variance = weeks.reduce((s, v) => s + (v - mean) ** 2, 0) / weeks.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 999;
    if (cv < 0.5) sku.xyz = "X";
    else if (cv < 1.0) sku.xyz = "Y";
    else sku.xyz = "Z";
  }
  return skus;
}

function getStrategy(abc, xyz) {
  if (abc === "A" && (xyz === "X" || xyz === "Y")) return "推式备库";
  if (abc === "C" && xyz === "Z") return "纯按单";
  return "混合";
}

function getSafetyMultiplier(abc, xyz) {
  const map = {
    AX: 3.0, AY: 2.5, AZ: 2.0,
    BX: 2.0, BY: 1.5, BZ: 1.0,
    CX: 1.0, CY: 0.5, CZ: 0,
  };
  return map[abc + xyz] || 1.0;
}

// Get ISO week number
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - week1) / 86400000 + (week1.getDay() + 6) % 7 - 3) / 7) + 1;
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("📊 ABC-XYZ SKU Classification\n");
  await getToken();
  console.log("✅ Connected to Feishu\n");

  // Fetch data
  const skuRecords = await listRecords(TABLES.sku);
  const orderRecords = await listRecords(TABLES.order);

  console.log(`  SKUs: ${skuRecords.length}, Orders: ${orderRecords.length}\n`);

  // Aggregate orders by SKU and week
  const skuStats = {};
  for (const r of orderRecords) {
    const f = r.fields;
    const sku = f["SKU"];
    const qty = Number(f["数量"]) || 0;
    const dateVal = f["下单日期"];
    if (!sku || !qty) continue;

    if (!skuStats[sku]) {
      skuStats[sku] = { totalQty: 0, weekMap: {} };
    }
    skuStats[sku].totalQty += qty;

    // Group by week
    if (dateVal) {
      const ts = typeof dateVal === "number" ? dateVal : new Date(dateVal).getTime();
      const d = new Date(ts);
      const weekKey = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`;
      skuStats[sku].weekMap[weekKey] = (skuStats[sku].weekMap[weekKey] || 0) + qty;
    }
  }

  // Build classification input
  const skuList = skuRecords.map(r => {
    const f = r.fields;
    const skuId = f["SKU编号"];
    const stats = skuStats[skuId] || { totalQty: 0, weekMap: {} };
    return {
      record_id: r.record_id,
      skuId,
      name: f["SKU名称"],
      type: f["类型"],
      currentSafety: f["安全库存"] || 0,
      totalQty: stats.totalQty,
      weeklyQtys: Object.values(stats.weekMap),
    };
  });

  // Classify
  classifyABC(skuList);
  classifyXYZ(skuList);

  // Write back
  console.log("  SKU   | ABC | XYZ | Strategy     | Safety Multiplier");
  console.log("  " + "─".repeat(60));

  let updated = 0;
  for (const sku of skuList) {
    const abc = sku.abc || "C";
    const xyz = sku.xyz || "Z";
    const strategy = getStrategy(abc, xyz);
    const multiplier = getSafetyMultiplier(abc, xyz);
    const weeklyAvg = sku.weeklyQtys.length > 0
      ? sku.weeklyQtys.reduce((s, v) => s + v, 0) / sku.weeklyQtys.length
      : 0;
    const newSafety = Math.ceil(weeklyAvg * multiplier);

    console.log(`  ${(sku.skuId || "").padEnd(20)} | ${abc}   | ${xyz}   | ${strategy.padEnd(12)} | ×${multiplier} → ${newSafety}`);

    // Feishu NUMBER fields reject 0; ensure minimum safety stock of 1
    const safetyValue = Math.max(newSafety || sku.currentSafety || 0, 1);
    await updateRecord(TABLES.sku, sku.record_id, {
      "ABC分类": abc,
      "XYZ分类": xyz,
      "备库策略": strategy,
      "安全库存": safetyValue,
    });
    updated++;
  }

  console.log(`\n✅ Classification complete: ${updated} SKUs updated`);
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
