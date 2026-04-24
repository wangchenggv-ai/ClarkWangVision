/**
 * test_30_orders.js — Insert 30 simulated orders to test dashboard changes
 *
 * Usage: node test_30_orders.js
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
  console.log("📝 Inserting 30 test orders...\n");

  const now = Date.now();
  const skus = [
    "Ultra -1.00", "Ultra -1.50", "Ultra -2.00", "Ultra -2.50", "Ultra -3.00",
    "Ultra双效 -1.00/-0.50", "Ultra双效 -1.50/-0.50", "Ultra双效 -2.00/-0.50", "Ultra双效 -2.50/-0.75",
    "AB版 -1.00", "AB版 -1.50", "AB版 -2.00", "A版 -1.00", "A版 -1.50",
    "D8", "D9", "E10", "F11", "G12"
  ];
  
  const orders = [];
  
  // 生成30个订单
  for (let i = 1; i <= 30; i++) {
    const skuIndex = (i - 1) % skus.length;
    const sku = skus[skuIndex];
    
    // 多样化的数量：小批量、中批量、大批量
    let qty;
    if (i % 5 === 0) {
      qty = 20 + Math.floor(Math.random() * 30); // 20-50 大批量
    } else if (i % 3 === 0) {
      qty = 5 + Math.floor(Math.random() * 10);  // 5-15 中批量
    } else {
      qty = 1 + Math.floor(Math.random() * 4);   // 1-4 小批量
    }
    
    orders.push({
      "订单编号": `TEST-${String(i).padStart(3, '0')}`,
      "下单日期": now - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000), // 过去7天内随机时间
      "产品型号": sku,
      "数量": qty
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

  console.log(`\n✅ Done. ${successCount}/30 orders inserted.`);
  console.log(`🔄 Now run: node automations.js all --fresh`);
  console.log(`📊 Then run: node dashboard.js --fresh`);
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
