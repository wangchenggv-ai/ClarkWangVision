/**
 * migrate_tables.js — Safely add new fields/tables to live Bitable
 * Idempotent: re-running won't duplicate fields or tables.
 *
 * Usage: node migrate_tables.js
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
let TOKEN = "";

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
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

async function listFields(tableId) {
  const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  if (res.code !== 0) return [];
  return res.data.items || [];
}

async function ensureField(tableId, tableName, fieldDef) {
  const existing = await listFields(tableId);
  const found = existing.find(f => f.field_name === fieldDef.field_name);
  if (found) {
    console.log(`  ⏭️  ${tableName}.${fieldDef.field_name} already exists`);
    return found;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, fieldDef);
  if (res.code === 0) {
    console.log(`  ✅ Added ${tableName}.${fieldDef.field_name}`);
    return res.data;
  } else {
    console.error(`  ❌ Failed to add ${tableName}.${fieldDef.field_name}:`, res.msg);
    return null;
  }
}

async function ensureTable(tableName, fields) {
  const listRes = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables`);
  if (listRes.code !== 0) { console.error("Failed to list tables"); return null; }
  const existing = (listRes.data.items || []).find(t => t.name === tableName);
  if (existing) {
    console.log(`  ⏭️  Table "${tableName}" already exists (${existing.table_id})`);
    return existing.table_id;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: { name: tableName, fields },
  });
  if (res.code === 0) {
    console.log(`  ✅ Created table "${tableName}" (${res.data.table_id})`);
    return res.data.table_id;
  } else {
    console.error(`  ❌ Failed to create table "${tableName}":`, res.msg);
    return null;
  }
}

async function main() {
  console.log("🔄 Running migrations...\n");
  await getToken();

  // Migration 1: Add 状态 field to blank_inventory
  console.log("Migration 1: blank_inventory.状态");
  await ensureField("tbladv6bQTXlNOlM", "blank_inventory", {
    field_name: "状态",
    type: 1, // TEXT
  });

  // Migration 2: Add 安全毛坯库存 field to blank_inventory
  console.log("Migration 2: blank_inventory.安全毛坯库存");
  await ensureField("tbladv6bQTXlNOlM", "blank_inventory", {
    field_name: "安全毛坯库存",
    type: 2, // NUMBER
    property: { formatter: "0" },
  });

  // Migration 3: Create procurement tracking table
  console.log("\nMigration 3: 采购跟踪表");
  const procurementId = await ensureTable("采购跟踪", [
    { field_name: "采购编号", type: 1 },
    { field_name: "采购类型", type: 3, property: { options: [
      { name: "模具" }, { name: "毛坯" }, { name: "其他" }
    ]}},
    { field_name: "关联SKU", type: 1 },
    { field_name: "数量", type: 2, property: { formatter: "0" } },
    { field_name: "发起日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { field_name: "预计到货", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { field_name: "实际到货", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { field_name: "状态", type: 3, property: { options: [
      { name: "待下单" }, { name: "已下单" }, { name: "在途" }, { name: "已到货" }, { name: "已取消" }
    ]}},
    { field_name: "触发来源", type: 1 },
    { field_name: "备注", type: 1 },
  ]);
  if (procurementId) {
    console.log(`  📝 Procurement table ID: ${procurementId} — add to TABLES in automations.js`);
  }

  // Migration 4: Create factory capacity table
  console.log("\nMigration 4: 车房产能表");
  const factoryId = await ensureTable("车房产能", [
    { field_name: "车房名称", type: 1 },
    { field_name: "日产能（片）", type: 2, property: { formatter: "0" } },
    { field_name: "擅长产品", type: 1 },
    { field_name: "当前排队量", type: 2, property: { formatter: "0" } },
    { field_name: "排队天数", type: 2, property: { formatter: "0.0" } },
    { field_name: "联系人", type: 1 },
    { field_name: "状态", type: 3, property: { options: [
      { name: "正常" }, { name: "满负荷" }, { name: "停产" }
    ]}},
  ]);
  if (factoryId) {
    console.log(`  📝 Factory table ID: ${factoryId} — add to TABLES in automations.js`);
  }

  // Migration 5: Add 分配车房 field to production table
  console.log("\nMigration 5: production.分配车房");
  await ensureField("tbltSntfaR9KCI7B", "production", {
    field_name: "分配车房",
    type: 1,
  });

  // Migration 6: Add ABC/XYZ classification fields to SKU table
  console.log("\nMigration 6: sku.ABC分类 + XYZ分类 + 备库策略");
  await ensureField("tblwQsvGAahoeoJV", "sku", {
    field_name: "ABC分类",
    type: 3, property: { options: [{ name: "A" }, { name: "B" }, { name: "C" }] },
  });
  await ensureField("tblwQsvGAahoeoJV", "sku", {
    field_name: "XYZ分类",
    type: 3, property: { options: [{ name: "X" }, { name: "Y" }, { name: "Z" }] },
  });
  await ensureField("tblwQsvGAahoeoJV", "sku", {
    field_name: "备库策略",
    type: 3, property: { options: [
      { name: "推式备库" }, { name: "混合" }, { name: "纯按单" }
    ]},
  });

  // Migration 7: Add 已计模芯 field to production table
  console.log("\nMigration 7: production.已计模芯");
  await ensureField("tbltSntfaR9KCI7B", "production", {
    field_name: "已计模芯",
    type: 3, property: { options: [{ name: "是" }, { name: "否" }] },
  });

  // Migration 8: Create after-sales tracking table
  console.log("\nMigration 8: 售后记录表");
  const afterSalesId = await ensureTable("售后记录", [
    { field_name: "售后编号", type: 1 },
    { field_name: "关联订单", type: 1 },
    { field_name: "SKU", type: 1 },
    { field_name: "问题类型", type: 3, property: { options: [
      { name: "度数不准" }, { name: "膜色问题" }, { name: "白点" },
      { name: "破损" }, { name: "发错货" }, { name: "其他" }
    ]}},
    { field_name: "问题描述", type: 1 },
    { field_name: "处理状态", type: 3, property: { options: [
      { name: "待处理" }, { name: "处理中" }, { name: "已解决" }, { name: "已关闭" }
    ]}},
    { field_name: "处理结果", type: 1 },
    { field_name: "创建时间", type: 1001 },
  ]);
  if (afterSalesId) {
    console.log(`  📝 After-sales table ID: ${afterSalesId}`);
  }

  // Migration 9: Add 备注 field to order table
  console.log("\nMigration 9: order.备注");
  await ensureField("tblk9Ch4gk2uQ1zG", "order", {
    field_name: "备注",
    type: 1,
  });

  console.log("\n✅ All migrations complete");
}

main().catch(err => { console.error("💥 Migration failed:", err.message); process.exit(1); });
