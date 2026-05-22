/**
 * test_pricing_reconciliation.js — 定价锁价 + 对账单生成 E2E 测试
 *
 * 直接调 Bitable API 验证数据流（不依赖服务器表ID映射）
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, ".env.test"), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = env.FEISHU_APP_TOKEN;
let TOKEN = "";

// 测试Bitable实际表ID
const T = {
  order: "tblmlRxaq0bNYgaf",
  lens_detail: "tblNPrsAB5uET9Hm",
  agent_pricing: "tbl7eFXyw8s2fkYN",
  agent_deposit_log: "tblObRYwlLa0Giua",
  return_exchange: "tbldW8XLtXPf0lZC",
  rebate_record: "tblvtvJdtVLh6Ijy",
};

const results = [];
const cleanup = [];
function ok(n) { results.push({ n, pass: true }); console.log(`  ✅ ${n}`); }
function fail(n, e) { results.push({ n, pass: false }); console.log(`  ❌ ${n}: ${e}`); }

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await r.json()).tenant_access_token;
}

function extractText(val) {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(v => v.text || "").join("");
  if (val?.text) return val.text;
  return String(val || "");
}

function hex16() { return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join(""); }

async function main() {
  await getToken();
  console.log("🧪 定价锁价 + 对账单 E2E 测试\n" + "═".repeat(50));

  const agentId = "AG-PRICING-TEST";
  const now = Date.now();
  const createdOrderIds = [];

  // ════════════════════════════════════════════════
  // 第一部分：定价锁价
  // ════════════════════════════════════════════════

  console.log("\n━━━ 第一部分：定价锁价 ━━━");

  // 1. 创建定价记录
  console.log("\n📋 1. 创建代理商定价");
  const pricingData = [
    { sku: "Ultra双效", price: 1280 },
    { sku: "D8", price: 980 },
    { sku: "时空之眼A", price: 1580 },
  ];
  const pricingIds = [];
  for (const p of pricingData) {
    const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records`, {
      fields: { "代理商ID": agentId, "产品型号": p.sku, "单价": p.price, "拼接key": `${agentId}-${p.sku}` },
    });
    if (res.code === 0) { pricingIds.push(res.data.record.record_id); ok(`定价: ${p.sku}=${p.price}`); }
    else fail(`定价: ${p.sku}`, res.msg);
  }
  cleanup.push(...pricingIds.map(id => () => api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records/${id}`)));

  // 2. 模拟下单：查询定价 → 快照写入订单
  console.log("\n📋 2. 模拟下单（查价+锁价）");
  const orderNo1 = `ORD-PRI-${Date.now().toString(36).toUpperCase()}`;

  // 查价逻辑（模拟 processPendingDrafts 中的 getPricingMap）
  const encoded = encodeURIComponent(`"${agentId}"`);
  const pricingRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records/search`, {
    page_size: 500,
    filter: { conjunction: "and", conditions: [{ field_name: "代理商ID", operator: "is", value: [agentId] }] },
  });
  const priceMap = new Map();
  for (const rec of (pricingRes.data?.items || [])) {
    const f = rec.fields;
    priceMap.set(extractText(f["产品型号"]), Number(f["单价"]) || 0);
  }

  // 创建订单（带单价+金额）
  const testCases = [
    { sku: "Ultra双效", qty: 2, lensCount: 2 },
    { sku: "D8", qty: 1, lensCount: 2 },
  ];
  for (const tc of testCases) {
    const unitPrice = priceMap.get(tc.sku) || 0;
    const amount = unitPrice * tc.qty * tc.lensCount;
    const orderRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records`, {
      fields: {
        "订单编号": orderNo1, "产品型号": tc.sku, "数量": tc.qty * tc.lensCount,
        "订单状态": "已签收", "下单日期": now, "签收时间": now,
        "顾客姓名": "定价测试门店", "代理商名称": "测试代理商", "代理商ID": agentId,
        "单价": unitPrice, "金额": amount,
      },
    });
    if (orderRes.code === 0) {
      createdOrderIds.push(orderRes.data.record.record_id);
      ok(`订单: ${tc.sku} 单价=${unitPrice} 金额=${amount}`);
    } else fail(`订单: ${tc.sku}`, orderRes.msg);
  }

  // 3. 验证订单中的价格是否正确
  console.log("\n📋 3. 验证锁价结果");
  const verifyRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records/search`, {
    page_size: 10,
    filter: { conjunction: "and", conditions: [{ field_name: "订单编号", operator: "is", value: [orderNo1] }] },
  });
  for (const rec of (verifyRes.data?.items || [])) {
    const f = rec.fields;
    const sku = extractText(f["产品型号"]);
    const expectedPrice = priceMap.get(sku) || 0;
    const actualPrice = Number(f["单价"]) || 0;
    const actualAmount = Number(f["金额"]) || 0;
    const qty = Number(f["数量"]) || 0;
    if (actualPrice === expectedPrice) ok(`${sku} 单价锁定正确: ${actualPrice}`);
    else fail(`${sku} 单价`, `期望=${expectedPrice} 实际=${actualPrice}`);
    if (actualAmount === expectedPrice * qty) ok(`${sku} 金额正确: ${actualAmount}`);
    else fail(`${sku} 金额`, `期望=${expectedPrice * qty} 实际=${actualAmount}`);
  }

  // 4. 修改定价表，验证历史订单不受影响
  console.log("\n📋 4. 改价后验证历史锁价");
  if (pricingIds[0]) {
    await api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records/${pricingIds[0]}`, {
      fields: { "单价": 9999 },
    });
    ok("Ultra双效定价改为9999");

    // 重新查订单，确认金额不变
    const reVerify = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records/search`, {
      page_size: 10,
      filter: { conjunction: "and", conditions: [{ field_name: "订单编号", operator: "is", value: [orderNo1] }] },
    });
    const ultraOrder = (reVerify.data?.items || []).find(r => extractText(r.fields["产品型号"]) === "Ultra双效");
    const ultraPrice = Number(ultraOrder?.fields?.["单价"]) || 0;
    if (ultraOrder && ultraPrice === 1280) ok("历史订单单价未变(1280)");
    else fail("历史锁价", `单价被改了: ${ultraPrice}`);
  }

  // ════════════════════════════════════════════════
  // 第二部分：对账单
  // ════════════════════════════════════════════════

  console.log("\n━━━ 第二部分：对账单生成 ━━━");

  // 5. 创建更多签收订单（模拟一个季度的数据）
  console.log("\n📋 5. 创建季度签收数据");
  const orderNo2 = `ORD-REC-${Date.now().toString(36).toUpperCase()}`;
  const q2Orders = [
    { sku: "Ultra双效", qty: 3, price: 1280 },
    { sku: "D8", qty: 2, price: 980 },
    { sku: "时空之眼A", qty: 1, price: 1580 },
  ];
  for (const o of q2Orders) {
    const amount = o.price * o.qty * 2;
    const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records`, {
      fields: {
        "订单编号": orderNo2, "产品型号": o.sku, "数量": o.qty * 2,
        "订单状态": "已签收", "下单日期": now, "签收时间": now,
        "顾客姓名": "对账测试门店", "代理商名称": "测试代理商", "代理商ID": agentId,
        "单价": o.price, "金额": amount,
      },
    });
    if (res.code === 0) createdOrderIds.push(res.data.record.record_id);
  }
  ok(`季度签收订单 ${q2Orders.length} 笔`);

  // 6. 创建退换货记录
  console.log("\n📋 6. 创建退换货冲销");
  const returnRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.return_exchange}/records`, {
    fields: {
      "日期": now, "原订单号": orderNo2, "代理商": agentId, "产品型号": "Ultra双效",
      "眼别": "左", "类型": "退货", "原因": "质量问题", "责任方": "公司",
      "退款金额": 1280, "处理人": "测试",
    },
  });
  if (returnRes.code === 0) { cleanup.push(() => api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.return_exchange}/records/${returnRes.data.record.record_id}`)); ok("退货冲销 1280元"); }
  else fail("退货冲销", returnRes.msg);

  // 7. 创建返利抵扣
  console.log("\n📋 7. 创建返利抵扣");
  const rebateRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.rebate_record}/records`, {
    fields: { "代理商ID": agentId, "季度": "2026Q1", "合计签收量": 200, "应得返利金额": 5000, "状态": "已确认" },
  });
  if (rebateRes.code === 0) { cleanup.push(() => api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.rebate_record}/records/${rebateRes.data.record.record_id}`)); ok("返利抵扣 5000元"); }
  else fail("返利抵扣", rebateRes.msg);

  // 8. 创建预存款流水
  console.log("\n📋 8. 创建预存款余额");
  const depositRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_deposit_log}/records`, {
    fields: { "代理商ID": agentId, "类型": "recharge", "金额": 100000, "操作人": "测试", "时间": now },
  });
  if (depositRes.code === 0) { cleanup.push(() => api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_deposit_log}/records/${depositRes.data.record.record_id}`)); ok("充值 100000元"); }
  else fail("充值", depositRes.msg);

  // 9. 模拟对账单计算（直接查 Bitable 汇总）
  console.log("\n📋 9. 对账单汇总计算");

  // 9a. 货款小计：所有已签收订单的金额之和
  const allSigned = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records/search`, {
    page_size: 100,
    filter: { conjunction: "and", conditions: [
      { field_name: "代理商ID", operator: "is", value: [agentId] },
      { field_name: "订单状态", operator: "is", value: ["已签收"] },
    ]},
  });
  let subtotal = 0;
  const orderLines = [];
  for (const rec of (allSigned.data?.items || [])) {
    const f = rec.fields;
    const amount = Number(f["金额"]) || 0;
    subtotal += amount;
    orderLines.push({ sku: extractText(f["产品型号"]), qty: Number(f["数量"]), price: Number(f["单价"]), amount });
  }
  ok(`货款小计: ${subtotal}元 (${orderLines.length}笔)`);

  // 9b. 退货冲销
  const allReturns = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.return_exchange}/records/search`, {
    page_size: 100,
    filter: { conjunction: "and", conditions: [{ field_name: "代理商", operator: "is", value: [agentId] }] },
  });
  let returnTotal = 0;
  for (const rec of (allReturns.data?.items || [])) returnTotal += Number(rec.fields["退款金额"]) || 0;
  ok(`退货冲销: -${returnTotal}元`);

  // 9c. 返利抵扣
  const allRebates = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.rebate_record}/records/search`, {
    page_size: 100,
    filter: { conjunction: "and", conditions: [
      { field_name: "代理商ID", operator: "is", value: [agentId] },
      { field_name: "状态", operator: "is", value: ["已确认"] },
    ]},
  });
  let rebateTotal = 0;
  for (const rec of (allRebates.data?.items || [])) rebateTotal += Number(rec.fields["应得返利金额"]) || 0;
  ok(`返利抵扣: -${rebateTotal}元`);

  // 9d. 预存款余额
  const allDeposits = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_deposit_log}/records/search`, {
    page_size: 100,
    filter: { conjunction: "and", conditions: [{ field_name: "代理商ID", operator: "is", value: [agentId] }] },
  });
  let depositBalance = 0;
  for (const rec of (allDeposits.data?.items || [])) depositBalance += Number(rec.fields["金额"]) || 0;
  ok(`预存款余额: ${depositBalance}元`);

  // 9e. 本期实付
  const netAmount = subtotal - returnTotal - rebateTotal;
  ok(`本期实付: ${netAmount}元`);

  // 10. 打印对账单
  console.log(`\n${"═".repeat(50)}`);
  console.log(`${agentId} 对账单`);
  console.log("═".repeat(50));
  console.log(`\n订单明细:`);
  for (const line of orderLines) {
    console.log(`  ${line.sku} × ${line.qty} @ ${line.price} = ${line.amount}元`);
  }
  console.log(`\n货款小计:      ${subtotal}元`);
  console.log(`退货冲销:     -${returnTotal}元`);
  console.log(`返利抵扣:     -${rebateTotal}元`);
  console.log(`─────────────────────`);
  console.log(`本期实付:      ${netAmount}元`);
  console.log(`预存款余额:    ${depositBalance}元`);
  console.log("═".repeat(50));

  // 验证对账单数据一致性
  console.log("\n📋 10. 验证对账单一致性");
  const expectedSubtotal = 1280*2*2 + 980*1*2 + 1280*3*2 + 980*2*2 + 1580*1*2; // = 5120+1960+7680+3920+3160 = 21840
  if (subtotal === expectedSubtotal) ok(`货款小计正确: ${subtotal}`);
  else fail("货款小计", `期望=${expectedSubtotal} 实际=${subtotal}`);
  if (netAmount === expectedSubtotal - 1280 - 5000) ok(`本期实付正确: ${netAmount}`);
  else fail("本期实付", `期望=${expectedSubtotal - 1280 - 5000} 实际=${netAmount}`);

  // ── 清理 ──
  console.log("\n🧹 清理测试数据...");
  let cleaned = 0;
  for (const fn of cleanup) { try { await fn(); cleaned++; } catch {} }
  // 清理订单
  for (const id of createdOrderIds) {
    try { await api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records/${id}`); cleaned++; } catch {}
  }
  console.log(`   清理 ${cleaned} 条`);

  // ── 汇总 ──
  console.log("\n" + "═".repeat(50));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`📊 结果: ${passed} 通过, ${failed} 失败, 共 ${results.length} 项`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.n}`));
  }
  console.log("═".repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("💥", e.message); process.exit(1); });
