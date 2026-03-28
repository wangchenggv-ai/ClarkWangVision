/**
 * seed_config.js — Seed rule configuration table with default values
 * Business users can then modify values directly in Feishu Bitable.
 *
 * Safe to re-run: skips if records already exist.
 * Usage: node seed_config.js
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
const CONFIG_TABLE = "tbl78V8wgziRs0pt";
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

async function createRecord(tableId, fields) {
  return api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

// All configurable parameters with descriptions
const CONFIG_ROWS = [
  // Rule 1
  { "规则编号": "rule1", "参数名": "instock_delivery_days", "参数值": "3", "说明": "有货订单交期（天）" },
  { "规则编号": "rule1", "参数名": "custom_delivery_days", "参数值": "5", "说明": "定制订单交期（天）" },
  { "规则编号": "rule1", "参数名": "max_order_qty", "参数值": "100", "说明": "单笔订单最大数量，超过需人工审核" },
  { "规则编号": "rule1", "参数名": "custom_product_type", "参数值": "定制品", "说明": "定制品类型名称" },

  // Rule 2
  { "规则编号": "rule2", "参数名": "high_alert_threshold", "参数值": "3", "说明": "预警数超过此值时通知变红色" },

  // Rule 3
  { "规则编号": "rule3", "参数名": "critical_remaining", "参数值": "50", "说明": "模芯剩余次数低于此值标记为「需更换」" },
  { "规则编号": "rule3", "参数名": "default_warning_threshold", "参数值": "500", "说明": "模芯默认预警阈值（次）" },

  // Rule 4
  { "规则编号": "rule4", "参数名": "seasonal_summer", "参数值": "1.3", "说明": "夏季系数（6-8月），如1.3表示+30%" },
  { "规则编号": "rule4", "参数名": "seasonal_summer_months", "参数值": "[6,7,8]", "说明": "夏季月份" },
  { "规则编号": "rule4", "参数名": "seasonal_school", "参数值": "1.2", "说明": "开学季系数（9月）" },
  { "规则编号": "rule4", "参数名": "seasonal_school_months", "参数值": "[9]", "说明": "开学季月份" },
  { "规则编号": "rule4", "参数名": "seasonal_cny", "参数值": "0.8", "说明": "春节系数（1-2月），如0.8表示-20%" },
  { "规则编号": "rule4", "参数名": "seasonal_cny_months", "参数值": "[1,2]", "说明": "春节月份" },
  { "规则编号": "rule4", "参数名": "seasonal_default", "参数值": "1.0", "说明": "其他月份的默认系数" },

  // Rule 5
  { "规则编号": "rule5", "参数名": "blank_safety_multiplier", "参数值": "1.5", "说明": "毛坯安全库存 = SKU安全库存 × 此系数" },
  { "规则编号": "rule5", "参数名": "blank_floor", "参数值": "2000", "说明": "毛坯库存绝对红线（片）" },
  { "规则编号": "rule5", "参数名": "high_alert_threshold", "参数值": "2", "说明": "预警数超过此值时通知变红色" },

  // Rule 6
  { "规则编号": "rule6", "参数名": "warning_hours", "参数值": "24", "说明": "交期预警窗口（小时），距交期低于此值时告警" },
  { "规则编号": "rule6", "参数名": "skip_statuses", "参数值": '["已发货","完成","已签收"]', "说明": "跳过的订单状态（JSON数组）" },

  // Rule 7
  { "规则编号": "rule7", "参数名": "mold_lead_days", "参数值": "28", "说明": "模具采购周期（天）" },
  { "规则编号": "rule7", "参数名": "blank_lead_days", "参数值": "21", "说明": "毛坯采购周期（天）" },
  { "规则编号": "rule7", "参数名": "blank_reorder_point", "参数值": "2000", "说明": "毛坯补货触发点（片）" },
  { "规则编号": "rule7", "参数名": "blank_replenish_target", "参数值": "5000", "说明": "毛坯补货目标库存（片）" },
  { "规则编号": "rule7", "参数名": "blank_min_order_qty", "参数值": "3000", "说明": "毛坯最小采购量（片）" },

  // Rule 8
  { "规则编号": "rule8", "参数名": "specialty_bonus", "参数值": "10", "说明": "车房擅长产品的匹配加分" },
];

async function main() {
  if (!CONFIG_TABLE) {
    console.error("❌ CONFIG_TABLE not set. Run migrate_tables.js first and fill in the table ID.");
    process.exit(1);
  }

  console.log("📋 Seeding rule config table...\n");
  await getToken();

  // Check if records already exist
  const existing = await listRecords(CONFIG_TABLE);
  if (existing.length > 0) {
    console.log(`  ⏭️  Config table already has ${existing.length} records, skipping seed`);
    console.log("  💡 To re-seed, manually clear the table first");
    return;
  }

  let created = 0;
  for (const row of CONFIG_ROWS) {
    const result = await createRecord(CONFIG_TABLE, row);
    if (result) {
      console.log(`  ✅ ${row["规则编号"]}.${row["参数名"]} = ${row["参数值"]}`);
      created++;
    }
  }

  console.log(`\n✅ Seeded ${created} config rows`);
  console.log("💡 Business users can now modify values directly in Feishu Bitable!");
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
