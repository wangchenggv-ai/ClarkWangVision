import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(__dirname, "../shared/.env"), resolve(__dirname, ".env")]) {
  try {
    const lines = readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  } catch {}
}

const feishuMod = await import("./lib/feishu.js");

const ENV = process.env;
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || "B3xQbbqicaome1sKdZbcwdk8nWg";
const BASE = "https://open.feishu.cn/open-apis";

feishuMod.init({ base: BASE, appToken: APP_TOKEN, env: ENV });
const { feishuApi, createRecord } = feishuMod;
const LENS_TABLE = "tblC7pve7ObFgIOl";
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";

const orderNo1 = "ORD-TEST-CACHE-001";
const orderNo2 = "ORD-TEST-CACHE-002";
const lc1r = "AABB112233445566";
const lc1l = "AABB112233445577";
const lc2r = "CCDD112233445588";
const lc2l = "CCDD112233445599";

// Create order records
await createRecord(ORDER_TABLE, {
  "订单编号": orderNo1, "顾客姓名": "测试缓存A", "产品型号": "D8",
  "订单状态": "已下单", "数量": 2, "代理商名称": "测试", "代理商ID": "AG-TEST",
});
await createRecord(ORDER_TABLE, {
  "订单编号": orderNo2, "顾客姓名": "测试缓存B", "产品型号": "Ultra双效",
  "订单状态": "已下单", "数量": 2, "代理商名称": "测试", "代理商ID": "AG-TEST",
});

// Create lens detail records
for (const [orderNo, customer, sku, lcR, lcL] of [
  [orderNo1, "测试缓存A", "D8", lc1r, lc1l],
  [orderNo2, "测试缓存B", "Ultra双效", lc2r, lc2l],
]) {
  await createRecord(LENS_TABLE, {
    "订单编号": orderNo, "顾客姓名": customer, "产品型号": sku,
    "眼别": "右眼", "球镜SPH": -3.00, "柱镜CYL": -1.00, "轴位AXIS": 180,
    "镜片码（唯一）": lcR, "序号": 1, "订单状态": "已发货",
  });
  await createRecord(LENS_TABLE, {
    "订单编号": orderNo, "顾客姓名": customer, "产品型号": sku,
    "眼别": "左眼", "球镜SPH": -3.50, "柱镜CYL": -0.75, "轴位AXIS": 170,
    "镜片码（唯一）": lcL, "序号": 1, "订单状态": "已发货",
  });
}

console.log("ORDER1:", lc1r);
console.log("ORDER2:", lc2r);
console.log("DONE");
