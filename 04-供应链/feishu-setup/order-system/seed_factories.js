/**
 * seed_factories.js — Insert factory capacity records into Feishu Bitable
 * Safe to re-run: skips if records already exist.
 *
 * Usage: node seed_factories.js
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
const FACTORY_TABLE = "tblJ6RXFENJFQe9A";
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

async function main() {
  console.log("🏭 Seeding factory capacity data...\n");
  await getToken();

  // Check if records already exist
  const existing = await listRecords(FACTORY_TABLE);
  if (existing.length > 0) {
    console.log(`  ⏭️  Factory table already has ${existing.length} records, skipping seed`);
    return;
  }

  const factories = [
    {
      "车房名称": "欧陆",
      "日产能（片）": 3000,
      "擅长产品": "Ultra,Ultra双效,Max,PRO",
      "当前排队量": 0,
      "状态": "正常",
    },
    {
      "车房名称": "九次方",
      "日产能（片）": 200,
      "擅长产品": "Ultra,AB版,A版,B版",
      "当前排队量": 0,
      "状态": "正常",
    },
    {
      "车房名称": "圣谱",
      "日产能（片）": 90,
      "擅长产品": "小旋风,SP1,D8",
      "当前排队量": 0,
      "状态": "正常",
    },
  ];

  for (const f of factories) {
    const result = await createRecord(FACTORY_TABLE, f);
    if (result) {
      console.log(`  ✅ Created: ${f["车房名称"]} (${f["日产能（片）"]}片/日)`);
    }
  }

  console.log("\n✅ Factory seed complete");
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
