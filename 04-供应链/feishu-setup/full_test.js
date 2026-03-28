/**
 * Sprint 4：全链路联调测试
 * 模拟一个完整业务周期，验证所有数据流转
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  forecast: "tblFLAHOXLSgWS6Q",
  order: "tblk9Ch4gk2uQ1zG",
};

let TOKEN = "";

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function listRecords(tableId) {
  const res = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=100`);
  return res.data?.items || [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name} — ${detail}`);
    failed++;
  }
}

// ─── 测试流程 ───────────────────────────────────────────

async function main() {
  console.log("🧪 全链路联调测试\n");
  await getToken();
  console.log("✅ 飞书已连接\n");

  // ── 测试1：数据完整性 ──
  console.log("━".repeat(50));
  console.log("📋 测试1：数据完整性检查");
  console.log("━".repeat(50));

  const skus = await listRecords(TABLES.sku);
  check("SKU主数据表有数据", skus.length === 12, `期望12条，实际${skus.length}`);

  const inventory = await listRecords(TABLES.finished_inventory);
  check("成品库存表有数据", inventory.length === 12, `期望12条，实际${inventory.length}`);

  const molds = await listRecords(TABLES.mold);
  check("模芯管理表有数据", molds.length === 7, `期望7条，实际${molds.length}`);

  const orders = await listRecords(TABLES.order);
  check("订单表有数据", orders.length >= 5, `期望≥5条，实际${orders.length}`);

  const forecasts = await listRecords(TABLES.forecast);
  check("销售预测表有数据", forecasts.length === 9, `期望9条，实际${forecasts.length}`);

  const production = await listRecords(TABLES.production);
  check("排产计划表有数据", production.length >= 3, `期望≥3条，实际${production.length}`);

  // ── 测试2：规则1 — 订单交期判定 ──
  console.log("\n" + "━".repeat(50));
  console.log("📦 测试2：订单交期判定（规则1）");
  console.log("━".repeat(50));

  // 找有交期的订单
  const ordersWithType = orders.filter(r => r.fields["交期类型"]);
  check("已处理订单有交期类型", ordersWithType.length >= 5, `${ordersWithType.length}条有交期`);

  // 检查有货订单
  const inStockOrders = ordersWithType.filter(r => r.fields["交期类型"] === "有货3天");
  check("有「有货3天」类型订单", inStockOrders.length > 0, "没有有货订单");

  // 检查定制订单
  const customOrders = ordersWithType.filter(r => r.fields["交期类型"] === "定制5天");
  check("有「定制5天」类型订单", customOrders.length > 0, "没有定制订单");

  // 检查承诺交货日
  const withDate = ordersWithType.filter(r => r.fields["承诺交货日"]);
  check("已处理订单有承诺交货日", withDate.length > 0, "没有承诺交货日");

  // ── 测试3：规则2 — 库存预警 ──
  console.log("\n" + "━".repeat(50));
  console.log("📊 测试3：库存状态（规则2）");
  console.log("━".repeat(50));

  const lowStock = inventory.filter(r => {
    const status = r.fields["状态"] || "";
    return status.includes("低库存") || status.includes("缺货");
  });
  check("有低库存/缺货 SKU", lowStock.length >= 2, `只有${lowStock.length}条预警`);

  const sku007 = inventory.find(r => r.fields["SKU"] === "SKU-007");
  check("SKU-007 状态为缺货", sku007?.fields["状态"]?.includes("缺货"), `实际状态: ${sku007?.fields["状态"]}`);

  const sku004 = inventory.find(r => r.fields["SKU"] === "SKU-004");
  check("SKU-004 状态为低库存", sku004?.fields["状态"]?.includes("低库存"), `实际状态: ${sku004?.fields["状态"]}`);

  // ── 测试4：规则3 — 模芯预警 ──
  console.log("\n" + "━".repeat(50));
  console.log("🔧 测试4：模芯预警（规则3）");
  console.log("━".repeat(50));

  const mc003 = molds.find(r => r.fields["模芯编号"] === "MC-003");
  check("MC-003 状态为预警", mc003?.fields["状态"]?.includes("预警"), `实际: ${mc003?.fields["状态"]}`);

  const mc004 = molds.find(r => r.fields["模芯编号"] === "MC-004");
  check("MC-004 状态为需更换", mc004?.fields["状态"]?.includes("更换"), `实际: ${mc004?.fields["状态"]}`);

  const mc001 = molds.find(r => r.fields["模芯编号"] === "MC-001");
  check("MC-001 状态为正常", mc001?.fields["状态"]?.includes("正常"), `实际: ${mc001?.fields["状态"]}`);

  // ── 测试5：规则4 — 排产建议 ──
  console.log("\n" + "━".repeat(50));
  console.log("📋 测试5：排产建议（规则4）");
  console.log("━".repeat(50));

  const sku007Plan = production.find(r => r.fields["SKU"] === "SKU-007");
  check("SKU-007 有排产建议", !!sku007Plan, "缺货SKU没有排产计划");
  if (sku007Plan) {
    check("SKU-007 建议产量=10", Number(sku007Plan.fields["建议产量"]) === 10,
      `实际: ${sku007Plan.fields["建议产量"]}`);
    check("SKU-007 状态为待确认", sku007Plan.fields["状态"] === "待确认",
      `实际: ${sku007Plan.fields["状态"]}`);
  }

  const sku004Plan = production.find(r => r.fields["SKU"] === "SKU-004");
  check("SKU-004 有排产建议", !!sku004Plan, "低库存SKU没有排产计划");

  const sku009Plan = production.find(r => r.fields["SKU"] === "SKU-009");
  check("SKU-009 有排产建议", !!sku009Plan, "低库存SKU没有排产计划");

  // ── 测试6：数据一致性 ──
  console.log("\n" + "━".repeat(50));
  console.log("🔗 测试6：数据一致性");
  console.log("━".repeat(50));

  // 每个库存记录的 SKU 都应该在 SKU 主数据表中
  const skuIds = new Set(skus.map(r => r.fields["SKU编号"]));
  const allInvSkuValid = inventory.every(r => skuIds.has(r.fields["SKU"]));
  check("库存表 SKU 全部存在于主数据表", allInvSkuValid, "有孤立的库存记录");

  // 排产计划的 SKU 应该在主数据表中
  const allProdSkuValid = production.every(r => skuIds.has(r.fields["SKU"]));
  check("排产表 SKU 全部存在于主数据表", allProdSkuValid, "有孤立的排产记录");

  // 模芯的 SKU 应该在主数据表中
  const allMoldSkuValid = molds.every(r => skuIds.has(r.fields["SKU"]));
  check("模芯表 SKU 全部存在于主数据表", allMoldSkuValid, "有孤立的模芯记录");

  // ── 汇总 ──
  console.log("\n" + "═".repeat(50));
  console.log(`🏁 测试完成: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 项`);
  console.log("═".repeat(50));

  if (failed === 0) {
    console.log("\n🎉 全部通过！供应链系统联调成功！");
  } else {
    console.log(`\n⚠️ 有 ${failed} 项未通过，请检查。`);
  }
}

main().catch((err) => {
  console.error("\n💥 执行失败:", err.message);
  process.exit(1);
});
