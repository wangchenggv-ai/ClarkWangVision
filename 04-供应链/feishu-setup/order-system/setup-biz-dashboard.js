/**
 * 业务看板建表脚本 — 创建销售经理映射表和大客户标记表
 *
 * 使用方式:
 *   node setup-biz-dashboard.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────

function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim();
    }
    return env;
  } catch {
    console.error("❌ 找不到 .env 文件");
    process.exit(1);
  }
}

const env = loadEnv();
const APP_ID = env.FEISHU_APP_ID;
const APP_SECRET = env.FEISHU_APP_SECRET;
const APP_TOKEN = env.FEISHU_APP_TOKEN || "B3xQbbqicaome1sKdZbcwdk8nWg";

if (!APP_ID || !APP_SECRET) {
  console.error("❌ 请在 .env 中填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET");
  process.exit(1);
}

const BASE = "https://open.feishu.cn/open-apis";

// ─── HTTP 工具 ──────────────────────────────────────────

async function request(method, path, body, token) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`API 错误 [${path}]:`, JSON.stringify(json, null, 2));
    throw new Error(`API code=${json.code} msg=${json.msg}`);
  }
  return json.data;
}

// ─── 获取 tenant_access_token ───────────────────────────

async function getTenantToken() {
  console.log("🔑 获取 tenant_access_token ...");
  const url = `${BASE}/auth/v3/tenant_access_token/internal`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error("获取 token 失败:", json);
    throw new Error("无法获取 tenant_access_token");
  }
  console.log("✅ token 获取成功");
  return json.tenant_access_token;
}

// ─── 飞书字段类型 ───────────────────────────────────────

const T = {
  TEXT: 1,
  NUMBER: 2,
  SELECT: 3,
  DATE: 5,
};

// ─── 创建表 ─────────────────────────────────────────────

async function createTable(token, name, fields) {
  console.log(`\n📊 创建表「${name}」...`);
  const data = await request("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: { name, fields },
  }, token);
  const tableId = data.table_id;
  console.log(`✅ 表已创建: ${tableId}`);
  return tableId;
}

// ─── 主流程 ─────────────────────────────────────────────

async function main() {
  const token = await getTenantToken();

  // 创建销售经理映射表
  const managerTableId = await createTable(token, "销售经理映射表", [
    { field_name: "经理姓名", type: T.TEXT },
    { field_name: "负责代理商", type: T.TEXT },
    { field_name: "备注", type: T.TEXT },
  ]);

  // 创建大客户标记表
  const keyAccountTableId = await createTable(token, "大客户标记表", [
    { field_name: "客户名称", type: T.TEXT },
    { field_name: "所属代理商", type: T.TEXT },
    { field_name: "标记时间", type: T.DATE, property: { date_formatter: "yyyy/MM/dd" } },
    { field_name: "备注", type: T.TEXT },
  ]);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✅ 建表完成！请更新 shared/tables.js 中的表 ID：");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`sales_manager: "${managerTableId}",`);
  console.log(`key_account: "${keyAccountTableId}",`);
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(e => {
  console.error("❌ 执行失败:", e.message);
  process.exit(1);
});
