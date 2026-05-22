/**
 * migrate_finance.js — 财务结算体系建表+字段迁移
 * 幂等：重跑不会重复创建
 *
 * 用法:
 *   node migrate_finance.js              # 使用 .env.test（默认）
 *   node migrate_finance.js --prod       # 使用 ../shared/.env（生产）
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const useProd = process.argv.includes("--prod");

function loadEnv() {
  const envFile = useProd
    ? resolve(__dirname, "../shared/.env")
    : resolve(__dirname, ".env.test");
  console.log(`📄 加载环境: ${envFile}`);
  const content = readFileSync(envFile, "utf-8");
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
const APP_TOKEN = env.FEISHU_APP_TOKEN;
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
  console.log(`🔑 Token 获取成功 (app: ${env.FEISHU_APP_ID})`);
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
    console.log(`  ⏭️  ${tableName}.${fieldDef.field_name} 已存在`);
    return found;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, fieldDef);
  if (res.code === 0) {
    console.log(`  ✅ 添加 ${tableName}.${fieldDef.field_name}`);
    return res.data;
  } else {
    console.error(`  ❌ 添加 ${tableName}.${fieldDef.field_name} 失败:`, res.msg);
    return null;
  }
}

async function ensureTable(tableName, fields) {
  const listRes = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables`);
  if (listRes.code !== 0) { console.error("❌ 获取表列表失败"); return null; }
  const existing = (listRes.data.items || []).find(t => t.name === tableName);
  if (existing) {
    console.log(`  ⏭️  表 "${tableName}" 已存在 (${existing.table_id})`);
    return existing.table_id;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: { name: tableName, fields },
  });
  if (res.code === 0) {
    console.log(`  ✅ 创建表 "${tableName}" (${res.data.table_id})`);
    return res.data.table_id;
  } else {
    console.error(`  ❌ 创建表 "${tableName}" 失败:`, res.msg);
    return null;
  }
}

// ─── 主流程 ──────────────────────────────────────────────

async function main() {
  console.log(`🔄 财务结算迁移 (Bitable: ${APP_TOKEN})\n`);
  await getToken();

  const tableIds = {};

  // ── 表1: 代理商定价表 ──
  console.log("\n📋 表1: 代理商定价表");
  tableIds.agent_pricing = await ensureTable("代理商定价", [
    { field_name: "代理商ID", type: 1 },
    { field_name: "产品型号", type: 1 },
    { field_name: "单价", type: 2, property: { formatter: "0.00" } },
    { field_name: "拼接key", type: 1 }, // 公式字段需在Bitable UI设置，这里先建文本
  ]);

  // ── 表2: 预存款流水表 ──
  console.log("\n📋 表2: 预存款流水表");
  tableIds.agent_deposit_log = await ensureTable("预存款流水", [
    { field_name: "代理商ID", type: 1 },
    { field_name: "类型", type: 3, property: { options: [
      { name: "recharge" }, { name: "deduct" }, { name: "rebate_apply" }, { name: "return" },
    ]}},
    { field_name: "金额", type: 2, property: { formatter: "0.00" } },
    { field_name: "关联订单号", type: 1 },
    { field_name: "操作人", type: 1 },
    { field_name: "时间", type: 5, property: { date_formatter: "yyyy/MM/dd HH:mm" } },
    { field_name: "备注", type: 1 },
  ]);

  // ── 表3: 退换货登记表 ──
  console.log("\n📋 表3: 退换货登记表");
  tableIds.return_exchange = await ensureTable("退换货登记", [
    { field_name: "日期", type: 5, property: { date_formatter: "yyyy/MM/dd" } },
    { field_name: "原订单号", type: 1 },
    { field_name: "代理商", type: 1 },
    { field_name: "产品型号", type: 1 },
    { field_name: "眼别", type: 3, property: { options: [
      { name: "左" }, { name: "右" }, { name: "双" },
    ]}},
    { field_name: "类型", type: 3, property: { options: [
      { name: "退货" }, { name: "换货" },
    ]}},
    { field_name: "原因", type: 3, property: { options: [
      { name: "质量问题" }, { name: "验光问题" }, { name: "下单错误" },
    ]}},
    { field_name: "责任方", type: 3, property: { options: [
      { name: "公司" }, { name: "代理商" }, { name: "分担" },
    ]}},
    { field_name: "退款金额", type: 2, property: { formatter: "0.00" } },
    { field_name: "旧镜片码", type: 1 },
    { field_name: "新镜片码", type: 1 },
    { field_name: "处理人", type: 1 },
    { field_name: "备注", type: 1 },
  ]);

  // ── 表4: 返利规则表 ──
  console.log("\n📋 表4: 返利规则表");
  tableIds.rebate_rule = await ensureTable("返利规则", [
    { field_name: "代理商ID", type: 1 },
    { field_name: "季度发货量门槛", type: 2, property: { formatter: "0" } },
    { field_name: "每件返利金额", type: 2, property: { formatter: "0.00" } },
    { field_name: "备注", type: 1 },
  ]);

  // ── 表5: 返利记录表 ──
  console.log("\n📋 表5: 返利记录表");
  tableIds.rebate_record = await ensureTable("返利记录", [
    { field_name: "代理商ID", type: 1 },
    { field_name: "季度", type: 1 },
    { field_name: "合计签收量", type: 2, property: { formatter: "0" } },
    { field_name: "应得返利金额", type: 2, property: { formatter: "0.00" } },
    { field_name: "状态", type: 3, property: { options: [
      { name: "待确认" }, { name: "已确认" }, { name: "已抵扣" },
    ]}},
    { field_name: "抵扣目标季度", type: 1 },
  ]);

  // ── lens_detail 新增作废字段 ──
  console.log("\n📋 lens_detail 新增字段");
  const lensTableId = useProd ? "tblC7pve7ObFgIOl" : await findTableByName("镜片明细");
  if (lensTableId) {
    await ensureField(lensTableId, "lens_detail", {
      field_name: "镜片码状态",
      type: 3, property: { options: [{ name: "active" }, { name: "void" }] },
    });
    await ensureField(lensTableId, "lens_detail", {
      field_name: "替换码",
      type: 1,
    });
  } else {
    console.log("  ⚠️ 未找到镜片明细表，跳过（测试Bitable中表名可能不同）");
  }

  // ── 输出结果 ──
  console.log("\n" + "═".repeat(50));
  console.log("📊 迁移结果汇总:");
  for (const [key, id] of Object.entries(tableIds)) {
    console.log(`  ${key}: ${id || "❌ 失败"}`);
  }
  console.log(`\n📝 请将以上 ID 回填到 shared/tables.js`);
  console.log("═".repeat(50));
}

async function findTableByName(name) {
  const listRes = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables`);
  if (listRes.code !== 0) return null;
  const found = (listRes.data.items || []).find(t => t.name.includes(name));
  return found?.table_id || null;
}

main().catch(err => { console.error("💥 迁移失败:", err.message); process.exit(1); });
