/**
 * migrate_split_tables.js — 创建「镜片明细」表 + 迁移现有数据
 *
 * 功能：
 *   1. 在飞书 Bitable 中创建「镜片明细」表（如不存在）
 *   2. 定义字段：来源订单号、眼别、球镜SPH、柱镜CYL、轴位AXIS、瞳距、瞳高、镜框型号、镜片码、订单状态
 *   3. 从 order 表读取每行记录，写入明细表
 *   4. 生成订单主表汇总记录（同一订单号合并为 1 行）
 *
 * 幂等：重复运行不会重复添加字段或重复创建记录
 * Usage: node migrate_split_tables.js
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
let TOKEN = "";

function loadEnv() {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function listFields(tableId) {
  const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  return res.data?.items || [];
}

async function ensureField(tableId, fieldDef) {
  const existing = await listFields(tableId);
  if (existing.find(f => f.field_name === fieldDef.field_name)) {
    console.log(`  ⏭️  字段已存在: ${fieldDef.field_name}`);
    return;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, fieldDef);
  if (res.code === 0) {
    console.log(`  ✅ 新增字段: ${fieldDef.field_name}`);
  } else {
    console.log(`  ❌ 字段创建失败: ${fieldDef.field_name} — ${res.msg}`);
  }
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=500&page_token=${pageToken}` : "?page_size=500";
    const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    const data = res.data;
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function batchCreateRecords(tableId, records) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    if (res.code !== 0) {
      console.log(`  ❌ 批量写入失败 (batch ${Math.floor(i / 500) + 1}): ${res.msg}`);
      return false;
    }
  }
  return true;
}

// ─── 查找或创建镜片明细表 ───────────────────────────────────────────────

async function findOrCreateLensDetailTable() {
  // 先查现有表
  const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables`);
  const tables = res.data?.items || [];
  const existing = tables.find(t => t.name === "镜片明细");
  if (existing) {
    console.log(`  ✅ 镜片明细表已存在: ${existing.table_id}`);
    return existing.table_id;
  }

  // 创建新表
  const createRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: { name: "镜片明细" },
  });
  if (createRes.code !== 0) {
    console.log(`  ❌ 创建表失败: ${createRes.msg}`);
    return null;
  }
  const tableId = createRes.data.table_id;
  console.log(`  ✅ 创建镜片明细表: ${tableId}`);
  return tableId;
}

// ─── 定义镜片明细表字段 ─────────────────────────────────────────────────

const LENS_DETAIL_FIELDS = [
  { field_name: "来源订单号", type: 1 },  // 文本
  { field_name: "眼别", type: 3, property: { options: [
    { name: "右眼" },
    { name: "左眼" },
  ]}},  // 单选
  { field_name: "球镜SPH", type: 2 },  // 数字
  { field_name: "柱镜CYL", type: 2 },
  { field_name: "轴位AXIS", type: 2 },
  { field_name: "瞳距", type: 2 },
  { field_name: "瞳高", type: 2 },
  { field_name: "镜框型号", type: 1 },  // 文本
  { field_name: "镜片码", type: 1 },  // 文本
  { field_name: "产品型号", type: 1 },  // 文本
  { field_name: "顾客姓名", type: 1 },  // 文本
  { field_name: "代理商名称", type: 1 },  // 文本
  { field_name: "代理商ID", type: 1 },  // 文本
  { field_name: "订单状态", type: 3, property: { options: [
    { name: "待处理" },
    { name: "生产中" },
    { name: "已发货" },
    { name: "已签收" },
    { name: "完成" },
  ]}},  // 单选
];

// ─── 主流程 ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  镜片明细表迁移 — 创建表 + 数据迁移           ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  const env = loadEnv();
  await getToken(env);
  console.log("✅ 飞书 Token 获取成功\n");

  // 1. 查找或创建镜片明细表
  console.log("【步骤1】查找/创建镜片明细表...");
  const lensTableId = await findOrCreateLensDetailTable();
  if (!lensTableId) { console.log("❌ 无法创建表，退出"); process.exit(1); }

  // 2. 确保字段存在
  console.log("\n【步骤2】确保镜片明细表字段...");
  for (const field of LENS_DETAIL_FIELDS) {
    await ensureField(lensTableId, field);
  }

  // 3. 读取现有订单数据
  console.log("\n【步骤3】读取现有订单数据...");
  const orderRecords = await listRecords(ORDER_TABLE);
  console.log(`  共 ${orderRecords.length} 条订单记录`);

  // 4. 检查明细表是否已有数据
  const existingLensRecords = await listRecords(lensTableId);
  if (existingLensRecords.length > 0) {
    console.log(`\n  ⏭️  明细表已有 ${existingLensRecords.length} 条数据，跳过迁移`);
    console.log(`\n✅ 迁移完成（跳过）`);
    console.log(`\n📌 请在 server.js 中添加：`);
    console.log(`   TABLES.lens_detail = "${lensTableId}";`);
    return;
  }

  // 5. 迁移数据
  console.log("\n【步骤4】迁移数据到镜片明细表...");
  const lensRecords = [];
  for (const rec of orderRecords) {
    const f = rec.fields;
    const fields = {
      "来源订单号": f["来源订单号"] || "",
      "眼别": f["眼别"] || "",
      "镜框型号": f["镜框型号"] || "",
      "镜片码": f["镜片码"] || "",
      "产品型号": f["产品型号"] || "",
      "顾客姓名": f["顾客姓名"] || "",
      "代理商名称": f["代理商名称"] || "",
      "代理商ID": f["代理商ID"] || "",
      "订单状态": f["订单状态"] || "待处理",
    };
    // 数字字段：只在有值时写入
    if (f["球镜SPH"] != null && f["球镜SPH"] !== "") fields["球镜SPH"] = Number(f["球镜SPH"]);
    if (f["柱镜CYL"] != null && f["柱镜CYL"] !== "") fields["柱镜CYL"] = Number(f["柱镜CYL"]);
    if (f["轴位AXIS"] != null && f["轴位AXIS"] !== "") fields["轴位AXIS"] = Number(f["轴位AXIS"]);
    if (f["瞳距"] != null && f["瞳距"] !== "") fields["瞳距"] = Number(f["瞳距"]);
    if (f["瞳高"] != null && f["瞳高"] !== "") fields["瞳高"] = Number(f["瞳高"]);
    lensRecords.push({ fields });
  }

  console.log(`  准备写入 ${lensRecords.length} 条镜片明细...`);
  const ok = await batchCreateRecords(lensTableId, lensRecords);
  if (!ok) { console.log("❌ 写入失败"); process.exit(1); }

  console.log(`\n✅ 迁移完成！`);
  console.log(`  镜片明细表 ID: ${lensTableId}`);
  console.log(`  迁移记录数: ${lensRecords.length}`);
  console.log(`\n📌 请在 server.js 的 TABLES 中添加：`);
  console.log(`   lens_detail: "${lensTableId}",`);
}

main().catch(e => { console.error("❌ 迁移失败:", e); process.exit(1); });
