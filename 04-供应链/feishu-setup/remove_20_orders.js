/**
 * remove_20_orders.js — Remove 20 orders to reduce total count
 *
 * Usage: node remove_20_orders.js
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Fix Windows PowerShell encoding
if (process.platform === "win32") {
  process.stdout.setEncoding("utf8");
  process.stderr.setEncoding("utf8");
}

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
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
let TOKEN = "";

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function listOrders() {
  const orders = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const json = await res.json();
    if (json.code !== 0) break;
    if (json.data.items) orders.push(...json.data.items);
    if (!json.data.has_more) break;
    pageToken = json.data.page_token;
  }
  return orders;
}

async function deleteOrder(recordId) {
  const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records/${recordId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function main() {
  await getToken();
  console.log("🔍 Fetching all orders...");

  const orders = await listOrders();
  console.log(`📋 Total orders: ${orders.length}`);

  // Take first 20 orders to delete
  const ordersToDelete = orders.slice(0, 20);
  console.log(`🗑️  Deleting ${ordersToDelete.length} orders...\n`);

  let deletedCount = 0;
  for (const order of ordersToDelete) {
    const recordId = order.record_id;
    const orderNo = order.fields["订单编号"];
    const sku = order.fields["SKU"];
    const qty = order.fields["数量"];

    const result = await deleteOrder(recordId);
    if (result.code === 0) {
      console.log(`  ✅ Deleted: ${orderNo} | ${sku} × ${qty}`);
      deletedCount++;
    } else {
      console.log(`  ❌ Failed to delete ${orderNo}: ${result.msg}`);
    }

    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Done. ${deletedCount}/${ordersToDelete.length} orders deleted.`);
  console.log(`🔄 Now run: node automations.js all --fresh`);
  console.log(`📊 Then run: node dashboard.js --fresh`);
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
