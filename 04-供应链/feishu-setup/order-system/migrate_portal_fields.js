/**
 * migrate_portal_fields.js — 为订单表添加代理商门户所需字段（Migration 13）
 *
 * 幂等：重复运行不会重复添加字段
 * Usage: node migrate_portal_fields.js
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
let TOKEN = "";

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
    console.log(`  ⏭️  已存在: ${fieldDef.field_name}`);
    return;
  }
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, fieldDef);
  if (res.code === 0) {
    console.log(`  ✅ 新增: ${fieldDef.field_name}`);
  } else {
    console.error(`  ❌ 失败: ${fieldDef.field_name} — ${res.msg}`);
  }
}

async function main() {
  const env = loadEnv();
  await getToken(env);
  console.log("✅ Token 获取成功\n");
  console.log("=== Migration 13: 代理商门户字段 ===\n");

  const newFields = [
    // 患者信息
    { field_name: "顾客姓名", type: 1 },                      // 文本
    { field_name: "眼别", type: 3,                            // 单选
      property: { options: [{ name: "右眼" }, { name: "左眼" }] } },
    { field_name: "球镜SPH", type: 2 },                       // 数字
    { field_name: "柱镜CYL", type: 2 },
    { field_name: "轴位AXIS", type: 2 },
    { field_name: "瞳距", type: 2 },
    { field_name: "瞳高", type: 2 },
    { field_name: "镜框型号", type: 1 },                      // 文本
    // 代理商/发货信息
    { field_name: "代理商名称", type: 1 },
    { field_name: "代理商ID", type: 1 },
    { field_name: "收货地址", type: 1 },
    // 订单来源标记（区分门户提交 vs 旧系统同步）
    { field_name: "订单来源", type: 3,
      property: { options: [{ name: "代理商门户" }, { name: "旧系统同步" }] } },
  ];

  for (const field of newFields) {
    await ensureField(ORDER_TABLE, field);
  }

  console.log("\n=== Migration 13 完成 ===");
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
