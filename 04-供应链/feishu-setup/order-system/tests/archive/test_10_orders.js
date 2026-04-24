/**
 * test_10_orders.js — Insert 10 simulated orders with diverse scenarios
 *
 * Scenarios covered:
 *   1-3: Normal in-stock orders (should get "有货3天")
 *   4-5: Large quantity orders (should trigger "定制5天" due to insufficient stock)
 *   6:   Abnormal qty > 100 (should trigger "待人工审核")
 *   7:   Positive diopter anomaly (should trigger "待人工审核")
 *   8-9: Orders for high-demand A-class SKUs
 *   10:  Rush order for low-stock SKU
 *
 * Usage: node test_10_orders.js
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
  console.log("📝 Inserting 10 test orders...\n");

  const now = Date.now();
  const orders = [
    // 1-3: Normal in-stock (small qty, common SKUs)
    { "订单编号": "SIM-001", "下单日期": now, "产品型号": "Ultra -1.00",           "数量": 2 },
    { "订单编号": "SIM-002", "下单日期": now, "产品型号": "Ultra双效 -1.50",       "数量": 3 },
    { "订单编号": "SIM-003", "下单日期": now, "产品型号": "AB版 -1.25",            "数量": 2 },

    // 4-5: Large qty → likely exceeds stock → "定制5天"
    { "订单编号": "SIM-004", "下单日期": now, "产品型号": "Ultra双效 -0.75/-0.50", "数量": 50 },
    { "订单编号": "SIM-005", "下单日期": now, "产品型号": "A版 -1.00",             "数量": 30 },

    // 6: Abnormal qty > 100 → "待人工审核"
    { "订单编号": "SIM-006", "下单日期": now, "产品型号": "Ultra -2.00",           "数量": 200 },

    // 7: Positive diopter → "待人工审核"
    { "订单编号": "SIM-007", "下单日期": now, "产品型号": "Ultra +1.50",           "数量": 5 },

    // 8-9: A-class high-demand SKUs (push-stock strategy)
    { "订单编号": "SIM-008", "下单日期": now, "产品型号": "Ultra双效 -2.25/-0.50", "数量": 4 },
    { "订单编号": "SIM-009", "下单日期": now, "产品型号": "Ultra双效 -1.75/-0.50", "数量": 3 },

    // 10: Low-stock SKU (should go custom)
    { "订单编号": "SIM-010", "下单日期": now, "产品型号": "D8",                    "数量": 5 },
  ];

  for (const order of orders) {
    const json = await createOrder(order);
    if (json.code === 0) {
      console.log(`  ✅ ${order["订单编号"]} | ${order["产品型号"]} × ${order["数量"]} `);
    } else {
      console.log(`  ❌ ${order["订单编号"]} failed: ${json.msg}`);
    }
  }

  console.log(`\n✅ Done. Now run: node automations.js all`);
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
