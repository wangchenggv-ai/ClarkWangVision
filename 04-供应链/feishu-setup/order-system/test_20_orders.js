/**
 * test_20_orders.js — Insert 20 simulated orders with diverse scenarios
 *
 * Usage: node test_20_orders.js
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

async function createOrder(fields) {
  const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ fields }),
  });
  return res.json();
}

async function main() {
  await getToken();
  console.log("📝 Inserting 20 test orders...\n");

  const now = Date.now();
  const skus = [
    "Ultra -1.00", "Ultra -1.50", "Ultra -2.00", "Ultra -2.50", "Ultra -3.00",
    "Ultra双效 -1.00/-0.50", "Ultra双效 -1.50/-0.50", "Ultra双效 -2.00/-0.50", "Ultra双效 -2.50/-0.75",
    "AB版 -1.00", "AB版 -1.50", "AB版 -2.00", "A版 -1.00", "A版 -1.50",
    "D8", "D9", "E10", "F11", "G12"
  ];

  const orders = [];

  for (let i = 1; i <= 20; i++) {
    const sku = skus[(i - 1) % skus.length];

    let qty;
    if (i % 5 === 0) {
      qty = 20 + Math.floor(Math.random() * 30); // 大批量 20-50
    } else if (i % 3 === 0) {
      qty = 5 + Math.floor(Math.random() * 10);  // 中批量 5-15
    } else {
      qty = 1 + Math.floor(Math.random() * 4);   // 小批量 1-4
    }

    orders.push({
      "订单编号": `T20-${String(i).padStart(3, "0")}`,
      "下单日期": now - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000),
      "产品型号": sku,
      "数量": qty,
    });
  }

  let successCount = 0;
  for (const order of orders) {
    const json = await createOrder(order);
    if (json.code === 0) {
      console.log(`  ✅ ${order["订单编号"]} | ${order["产品型号"]} × ${order["数量"]}`);
      successCount++;
    } else {
      console.log(`  ❌ ${order["订单编号"]} failed: ${json.msg}`);
    }
  }

  console.log(`\n✅ Done. ${successCount}/20 orders inserted.`);
  console.log(`🔄 Now run: node automations.js all --fresh`);
  console.log(`📊 Then run: node dashboard.js --fresh`);
}

main().catch((err) => {
  console.error("💥 Failed:", err.message);
  process.exit(1);
});
