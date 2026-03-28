/**
 * 测试规则1：新增空白订单，然后跑规则1看交期自动填写
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
  const json = await res.json();
  TOKEN = json.tenant_access_token;
}

async function main() {
  await getToken();

  // 新增3条没有交期类型的测试订单
  const today = Date.now();
  const testOrders = [
    { "订单编号": "TEST-001", "下单日期": today, "SKU": "SKU-001", "数量": 5 },   // 有库存→有货3天
    { "订单编号": "TEST-002", "下单日期": today, "SKU": "SKU-007", "数量": 3 },   // 零库存→定制5天
    { "订��编号": "TEST-003", "下单日期": today, "SKU": "SKU-009", "数量": 10 },  // 库存3<10→定制5天
  ];

  console.log("📝 新增3条测试订单（无交期类型）...\n");
  for (const order of testOrders) {
    const res = await fetch(
      `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ fields: order }),
      }
    );
    const json = await res.json();
    if (json.code === 0) {
      console.log(`  ✅ ${order["订单编号"]} | ${order["SKU"]} × ${order["数量"]}`);
    } else {
      console.log(`  ❌ ${order["订单编号"]} 失败:`, json.msg);
    }
  }

  console.log("\n现在运行: node automations.js rule1");
}

main().catch(console.error);
