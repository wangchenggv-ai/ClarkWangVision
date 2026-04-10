/**
 * sync_customers.js — 增量同步 CRM 客户表 → 供应链终端客户表
 *
 * CRM 客户表只读，不做任何写操作。
 * 用客户名称匹配，存在则跳过，不存在则新建（自动生成客户ID）。
 *
 * Usage:
 *   node sync_customers.js            # 全量同步（客户数量少，直接全量）
 *   node sync_customers.js --dry-run  # 只打印，不写入
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const NEW_APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const CUSTOMER_TABLE = "tbltXNNhF65EBl17";

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

let TOKEN = "";
async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function listAllRecords(appToken, tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${appToken}/tables/${tableId}/records${qs}`);
    if (res.code !== 0) { console.error("  ❌ 读取失败:", res.msg); break; }
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUS-${d}-${r}`;
}

// 从飞书字段值中提取纯文本（兼容数组/对象/字符串）
function val(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(i => i.text || i.name || String(i)).join("");
  if (typeof v === "object") return v.text || v.name || "";
  return String(v);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== CRM客户同步 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const env = loadEnv();
  if (!env.CRM_APP_TOKEN || env.CRM_APP_TOKEN === "待填") {
    console.log("⚠️  .env 中 CRM_APP_TOKEN 尚未填写，退出");
    process.exit(1);
  }

  await getToken(env);
  console.log("✅ 飞书 token 获取成功\n");

  // 读 CRM 客户表
  console.log("[1] 读取 CRM 客户表...");
  const crmCustomers = await listAllRecords(env.CRM_APP_TOKEN, env.CRM_CUSTOMER_TABLE);
  console.log(`    读到 ${crmCustomers.length} 条`);

  if (crmCustomers.length === 0) {
    console.log("\n✅ CRM 客户表为空，无需同步");
    return;
  }

  // 读供应链现有客户（建名称索引）
  console.log("\n[2] 读取供应链现有客户...");
  const existingCustomers = await listAllRecords(NEW_APP_TOKEN, CUSTOMER_TABLE);
  const existingNames = new Set(existingCustomers.map(r => val(r.fields["客户名称"])));
  console.log(`    已有 ${existingNames.size} 个客户`);

  // 同步
  console.log("\n[3] 同步中...");
  let created = 0, skipped = 0;

  for (const rec of crmCustomers) {
    const name = val(rec.fields["客户名称"]) || val(rec.fields["名称"]) || val(rec.fields["customer_name"]);
    if (!name) { skipped++; continue; }
    if (existingNames.has(name)) { skipped++; continue; }

    const newId = genCustomerId();
    const fields = {
      客户ID: newId,
      客户名称: name,
      来源系统: "CRM手动",
    };

    // 可选字段（如果 CRM 有这些字段）
    const type = val(rec.fields["客户类型"]);
    const city = val(rec.fields["所在城市"]) || val(rec.fields["城市"]);
    if (type) fields["客户类型"] = type;
    if (city) fields["所在城市"] = city;

    if (dryRun) {
      console.log(`  [DRY] 新建客户: ${name} → ${newId}`);
    } else {
      const r = await apiPost(
        `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${CUSTOMER_TABLE}/records`,
        { fields }
      );
      if (r.code !== 0) { console.error(`  ❌ 写入失败 ${name}:`, r.msg); continue; }
      console.log(`  ✅ 新建客户: ${name} → ${newId}`);
    }
    created++;
    existingNames.add(name);
  }

  console.log(`\n✅ 同步完成: 新建 ${created} 个，跳过已有 ${skipped} 个`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
