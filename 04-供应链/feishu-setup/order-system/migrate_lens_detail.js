/**
 * migrate_lens_detail.js — 为订单主表中有镜片码但lens_detail表中无记录的订单补建镜片明细
 *
 * 用法: node migrate_lens_detail.js [--dry-run]
 */

import { init, listRecords, batchCreateRecords } from "./lib/feishu.js";
import { TABLES } from "./shared/tables.js";
import { readFileSync } from "fs";

const dryRun = process.argv.includes("--dry-run");

// Load env
const envRaw = readFileSync(new URL("../shared/.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
init({ base: "https://open.feishu.cn/open-apis", appToken: "B3xQbbqicaome1sKdZbcwdk8nWg", env });

async function main() {
  console.log("1. 读取订单主表...");
  const orders = await listRecords(TABLES.order);
  const withCodes = orders.filter(r => {
    const code = r.fields?.["镜片码"];
    return code && String(code).trim().length > 0;
  });
  console.log(`   订单总数: ${orders.length}, 有镜片码: ${withCodes.length}`);

  // 收集所有订单中的镜片码
  const orderLensMap = new Map(); // lensCode → { orderNo, customerName, sku, pairIndex, status }
  for (const rec of withCodes) {
    const f = rec.fields;
    const orderNo = f["订单编号"] || "";
    const customerName = f["顾客姓名"] || "";
    const sku = f["产品型号"] || "";
    const pairIndex = Number(f["序号"] || 1);
    const status = f["订单状态"] || "";
    const codes = String(f["镜片码"]).split(",").map(s => s.trim()).filter(Boolean);
    for (const code of codes) {
      if (!orderLensMap.has(code)) {
        orderLensMap.set(code, { orderNo, customerName, sku, pairIndex, status });
      }
    }
  }
  console.log(`   镜片码总数: ${orderLensMap.size}`);

  console.log("2. 读取镜片明细表...");
  const lensDetails = await listRecords(TABLES.lens_detail);
  const existingCodes = new Set(lensDetails.map(r => r.fields?.["镜片码"] || "").filter(Boolean));
  console.log(`   lens_detail 记录数: ${lensDetails.length}, 已有镜片码: ${existingCodes.size}`);

  console.log("3. 找出缺失的镜片码...");
  const missing = [];
  for (const [code, info] of orderLensMap) {
    if (!existingCodes.has(code)) {
      missing.push({ code, ...info });
    }
  }
  console.log(`   缺失: ${missing.length} 条`);

  if (missing.length === 0) {
    console.log("无需补建，退出。");
    return;
  }

  console.log("4. 补建镜片明细记录...");
  const records = missing.map(m => ({
    fields: {
      "镜片码": m.code,
      "订单编号": m.orderNo,
      "顾客姓名": m.customerName,
      "产品型号": m.sku,
      "序号": m.pairIndex,
      "订单状态": m.status,
    },
  }));

  if (dryRun) {
    console.log(`   [DRY-RUN] 将创建 ${records.length} 条记录，前5条:`);
    records.slice(0, 5).forEach(r => console.log(`     ${r.fields["镜片码"]} → ${r.fields["订单编号"]} | ${r.fields["顾客姓名"]}`));
    return;
  }

  // 分批写入（Bitable batch_create 上限 500）
  let created = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const ok = await batchCreateRecords(TABLES.lens_detail, batch);
    if (ok) created += batch.length;
    else console.error(`   ⚠️ 批次 ${Math.floor(i / 500) + 1} 写入失败`);
  }
  console.log(`   完成: 创建 ${created} 条镜片明细记录`);
}

main().catch(e => { console.error(e); process.exit(1); });
