import { init, listRecords, updateRecord } from "./lib/feishu.js";
import { TABLES } from "./shared/tables.js";
import { readFileSync } from "fs";

// Load env
const envRaw = readFileSync(new URL("../shared/.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

init({ base: "https://open.feishu.cn/open-apis", appToken: "B3xQbbqicaome1sKdZbcwdk8nWg", env });

const orders = await listRecords(TABLES.order);
console.log(`共读取 ${orders.length} 条记录`);

// Debug: check first record's fields
if (orders.length > 0) {
  console.log("字段列表:", Object.keys(orders[0].fields || {}));
  // Find all unique statuses
  const statuses = new Set(orders.map(r => r.fields?.["订单状态"]));
  console.log("所有订单状态:", [...statuses]);
}

const stale = orders.filter(r => r.fields?.["订单状态"] === "待签收");
console.log(`找到 ${stale.length} 条待签收残留`);

for (const rec of stale) {
  const f = rec.fields || {};
  const orderNo = f["订单编号"] || "?";
  const name = f["顾客姓名"] || "?";
  await updateRecord(TABLES.order, rec.record_id, { "订单状态": "已发货" });
  console.log(`  ✓ ${orderNo} | ${name} → 已发货`);
}

console.log("清理完成");
