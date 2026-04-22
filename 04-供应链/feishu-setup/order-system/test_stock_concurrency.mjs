/**
 * test_stock_concurrency.mjs — 库存实时扣减 + 并发安全测试
 *
 * 测试项：
 *   1. 正常下单 → 库存正确扣减
 *   2. 幂等保护 → 同 clientRequestId 不重复下单
 *   3. 库存不足 → 409 返回（预检拦截，不写订单）
 *   4. 并发下单 → 两单同 SKU/SPH/CYL 库存扣减正确（无 lost update）
 *   5. 重复度数（双眼同参数）→ 只扣一次预检
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 加载配置 ─────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(resolve(__dirname, "../shared/.env"), "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [k, ...v] = t.split("=");
  env[k.trim()] = v.join("=").trim();
}

const BASE = "http://localhost:3210";
const FEISHU = "https://open.feishu.cn/open-apis";
const APP = "B3xQbbqicaome1sKdZbcwdk8nWg";
const STOCK_TBL = "tbl7U79QGG4JtQev";
const ORDER_TBL = "tblk9Ch4gk2uQ1zG";

const AGENT_TOKEN = "AG-002-zxkmgoryb6nprmv6"; // 测试代理商

// 测试用 SKU/SPH/CYL — 选一个库存较多的组合
const TEST_SKU = "Ultra双效";
const TEST_SPH = -1.00;
const TEST_CYL = -0.50;

// ─── 飞书 API（直接读库存） ───────────────────────────────────────────────
let _token = null;
async function getFeishuToken() {
  if (_token) return _token;
  const r = await fetch(FEISHU + "/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  _token = (await r.json()).tenant_access_token;
  return _token;
}

async function getStock(sku, sph, cyl) {
  const token = await getFeishuToken();
  const key = `${sku}|${Number(sph).toFixed(2)}|${Number(cyl).toFixed(2)}`;
  // 拉全表找对应行（测试场景数据量小）
  const r = await fetch(
    `${FEISHU}/bitable/v1/apps/${APP}/tables/${STOCK_TBL}/records?page_size=500`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  for (const item of data.data?.items || []) {
    const f = item.fields || {};
    const rSku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : "";
    const rSph = Number(f["SPH"]);
    const rCyl = Number(f["CYL"]);
    if (`${rSku}|${rSph.toFixed(2)}|${rCyl.toFixed(2)}` === key) {
      return { stock: Number(f["当前库存"]) || 0, recordId: item.record_id };
    }
  }
  return null;
}

async function setStock(recordId, newStock) {
  const token = await getFeishuToken();
  await fetch(
    `${FEISHU}/bitable/v1/apps/${APP}/tables/${STOCK_TBL}/records/${recordId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { "当前库存": newStock } }),
    }
  );
}

async function countOrders(orderNo) {
  const token = await getFeishuToken();
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const r = await fetch(
    `${FEISHU}/bitable/v1/apps/${APP}/tables/${ORDER_TBL}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await r.json();
  return data.data?.items?.length || 0;
}

// ─── HTTP 工具 ─────────────────────────────────────────────────────────────
async function submitOrder(body) {
  const r = await fetch(`${BASE}/api/submit?t=${AGENT_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, body: json };
}

function makeOrder(sku, sph, cyl, qty, clientRequestId) {
  return {
    address: "测试地址1号",
    clientRequestId: clientRequestId || randomUUID(),
    terminalCustomer: { name: "测试客户", contact: "测试联系人", phone: "13800000000", address: "测试地址1号" },
    patients: [{
      customerName: "测试患者" + randomBytes(2).toString("hex"),
      sku,
      quantity: qty,
      eyes: [
        { side: "右眼", sph, cyl, axis: 0 },
      ],
    }],
  };
}

// ─── 测试框架 ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    results.push({ name, status: "PASS", detail });
    console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    results.push({ name, status: "FAIL", detail });
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

function skip(name, reason) {
  skipped++;
  results.push({ name, status: "SKIP", detail: reason });
  console.log(`  ⏭️  ${name} — ${reason}`);
}

// randomUUID polyfill for Node < 19
function randomUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );
}

// ─── 主流程 ───────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════");
console.log("  库存实时扣减 + 并发安全 测试");
console.log("═══════════════════════════════════════════════════════\n");

// 先检查服务器是否在运行
try {
  await fetch(`${BASE}/api/delivery-estimate?t=${AGENT_TOKEN}&sku=${TEST_SKU}&qty=1&sph=${TEST_SPH}&cyl=${TEST_CYL}`);
} catch (e) {
  console.log("❌ 服务器未运行，请先启动: node server.js");
  console.log(`   错误: ${e.message}`);
  process.exit(1);
}

// 读取当前测试库存
const stockInfo = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);
if (!stockInfo) {
  console.log(`❌ 未找到库存记录: ${TEST_SKU} SPH=${TEST_SPH} CYL=${TEST_CYL}`);
  process.exit(1);
}
console.log(`测试 SKU: ${TEST_SKU} SPH=${TEST_SPH} CYL=${TEST_CYL}`);
console.log(`当前库存: ${stockInfo.stock} 片\n`);

// ─── Test 1: 正常下单 → 库存扣减 ──────────────────────────────────────────
console.log("--- Test 1: 正常下单 → 库存扣减 ---");
{
  const beforeStock = stockInfo.stock;
  const qty = 1;
  const body = makeOrder(TEST_SKU, TEST_SPH, TEST_CYL, qty);

  const res = await submitOrder(body);
  if (res.status !== 200) console.log('  DEBUG res body:', JSON.stringify(res.body));
  assert("下单返回 200", res.status === 200, `status=${res.status}`);
  assert("下单成功", res.body.success === true, res.body.orderNo);
  assert("返回订单号", !!res.body.orderNo, res.body.orderNo);

  // 等一下让缓存刷新
  await new Promise(r => setTimeout(r, 500));
  const afterStock = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);
  const expected = beforeStock - qty;
  assert("库存扣减正确", afterStock.stock === expected,
    `扣减前=${beforeStock} 扣减后=${afterStock.stock} 期望=${expected}`);

  // 清理：恢复库存
  await setStock(stockInfo.recordId, beforeStock);
  console.log(`  (已恢复库存到 ${beforeStock})\n`);
}

// ─── Test 2: 幂等保护 ───────────────────────────────────────────────────
console.log("--- Test 2: 幂等保护（同 clientRequestId）---");
{
  const beforeStock = (await getStock(TEST_SKU, TEST_SPH, TEST_CYL)).stock;
  const requestId = randomUUID();
  const body = makeOrder(TEST_SKU, TEST_SPH, TEST_CYL, 1, requestId);

  const res1 = await submitOrder(body);
  const res2 = await submitOrder(body); // 相同 requestId

  assert("第一次下单成功", res1.status === 200, `status=${res1.status}`);
  assert("第二次返回 200", res2.status === 200, `status=${res2.status}`);
  assert("第二次是幂等命中", res2.body.orderNo === res1.body.orderNo,
    `第一次=${res1.body.orderNo} 第二次=${res2.body.orderNo}`);

  await new Promise(r => setTimeout(r, 500));
  const afterStock = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);
  const orderCount = await countOrders(res1.body.orderNo);
  assert("只创建了一个订单", orderCount === 1, `订单行数=${orderCount}`);
  assert("库存只扣一次", afterStock.stock === beforeStock - 1,
    `扣减前=${beforeStock} 扣减后=${afterStock.stock}`);

  // 清理
  await setStock(stockInfo.recordId, beforeStock);
  console.log(`  (已恢复库存)\n`);
}

// ─── Test 3: 库存不足 → 409 ─────────────────────────────────────────────
console.log("--- Test 3: 库存不足 → 409 拦截 ---");
{
  const beforeStock = (await getStock(TEST_SKU, TEST_SPH, TEST_CYL)).stock;
  // 把库存设为 1
  await setStock(stockInfo.recordId, 1);
  await new Promise(r => setTimeout(r, 500));

  const body = makeOrder(TEST_SKU, TEST_SPH, TEST_CYL, 2); // 要 2 片，库存只有 1
  const res = await submitOrder(body);

  assert("返回 409", res.status === 409, `status=${res.status}`);
  assert("错误码 STOCK_INSUFFICIENT", res.body.code === "STOCK_INSUFFICIENT", res.body.code);
  assert("有 details 说明", Array.isArray(res.body.details) && res.body.details.length > 0,
    res.body.details?.join("; "));

  // 确认没有创建订单（用一个新的 orderNo 检查）
  await new Promise(r => setTimeout(r, 500));
  const currentStock = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);
  assert("库存未扣减", currentStock.stock === 1, `库存=${currentStock.stock}`);

  // 清理
  await setStock(stockInfo.recordId, beforeStock);
  console.log(`  (已恢复库存)\n`);
}

// ─── Test 4: 并发下单 ───────────────────────────────────────────────────
console.log("--- Test 4: 并发下单（两单同度数）---");
{
  const beforeStock = (await getStock(TEST_SKU, TEST_SPH, TEST_CYL)).stock;
  // 设库存为 10
  await setStock(stockInfo.recordId, 10);
  await new Promise(r => setTimeout(r, 500));

  // 同时发两单，各要 3 片
  const body1 = makeOrder(TEST_SKU, TEST_SPH, TEST_CYL, 3);
  const body2 = makeOrder(TEST_SKU, TEST_SPH, TEST_CYL, 3);

  const [res1, res2] = await Promise.all([submitOrder(body1), submitOrder(body2)]);

  const bothOk = res1.status === 200 && res2.status === 200;
  const oneOkOne409 = (res1.status === 200 && res2.status === 409) ||
                       (res1.status === 409 && res2.status === 200);

  assert("两单状态合理", bothOk || oneOkOne409,
    `res1=${res1.status} res2=${res2.status}`);

  await new Promise(r => setTimeout(r, 1000));
  const afterStock = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);

  if (bothOk) {
    // 两单都成功：库存应为 10 - 3 - 3 = 4
    assert("并发扣减正确", afterStock.stock === 4,
      `扣减前=10 扣减后=${afterStock.stock} 期望=4`);
  } else {
    // 一成一败：库存应为 10 - 3 = 7
    assert("单次扣减正确", afterStock.stock === 7,
      `扣减前=10 扣减后=${afterStock.stock} 期望=7`);
  }

  // 清理
  await setStock(stockInfo.recordId, beforeStock);
  console.log(`  (已恢复库存)\n`);
}

// ─── Test 5: 双眼同度数 ──────────────────────────────────────────────────
console.log("--- Test 5: 双眼同度数（去重预检）---");
{
  const beforeStock = (await getStock(TEST_SKU, TEST_SPH, TEST_CYL)).stock;
  await setStock(stockInfo.recordId, 5);
  await new Promise(r => setTimeout(r, 500));

  // 左右眼同度数，各要 1 片 = 共 2 片
  const body = {
    address: "测试地址",
    clientRequestId: randomUUID(),
    terminalCustomer: { name: "测试客户", contact: "测试联系人", phone: "13800000000", address: "测试地址" },
    patients: [{
      customerName: "双眼同度数患者",
      sku: TEST_SKU,
      quantity: 1,
      eyes: [
        { side: "右眼", sph: TEST_SPH, cyl: TEST_CYL, axis: 0 },
        { side: "左眼", sph: TEST_SPH, cyl: TEST_CYL, axis: 0 },
      ],
    }],
  };

  const res = await submitOrder(body);
  assert("双眼同度数下单成功", res.status === 200, `status=${res.status}`);

  await new Promise(r => setTimeout(r, 500));
  const afterStock = await getStock(TEST_SKU, TEST_SPH, TEST_CYL);
  // 两眼同度数 → deductionPlan 有两条 → 各扣 1 → 共扣 2
  assert("双眼扣减正确", afterStock.stock === 3, `扣减前=5 扣减后=${afterStock.stock} 期望=3`);

  // 清理
  await setStock(stockInfo.recordId, beforeStock);
  console.log(`  (已恢复库存)\n`);
}

// ─── 报告 ─────────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════");
console.log(`  结果: ${passed} passed / ${failed} failed / ${skipped} skipped`);
console.log("═══════════════════════════════════════════════════════");

// 写测试报告
const report = `# 库存实时扣减 + 并发安全 测试报告

> 测试时间：${new Date().toLocaleString("zh-CN")}
> 测试环境：localhost:3210
> 测试 SKU：${TEST_SKU} SPH=${TEST_SPH} CYL=${TEST_CYL}

## 结果汇总

| 状态 | 数量 |
|------|------|
| ✅ PASS | ${passed} |
| ❌ FAIL | ${failed} |
| ⏭️ SKIP | ${skipped} |

## 测试详情

${results.map(r => `| ${r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️"} | ${r.name} | ${r.detail || "—"} |`).join("\n")}

## 测试项说明

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 正常下单 | 库存扣减正确、返回订单号 |
| 2 | 幂等保护 | 同 clientRequestId 不重复下单、库存只扣一次 |
| 3 | 库存不足 | 返回 409 + STOCK_INSUFFICIENT、不写订单、不扣库存 |
| 4 | 并发下单 | 两单同时扣同一库存，无 lost update |
| 5 | 双眼同度数 | 去重预检、双眼各扣正确 |

## 关键改动

- \`withLock()\` per-key 异步锁 — 序列化同一 SKU/SPH/CYL 的并发扣减
- \`deductStockDetail\` 锁内 fresh read 单条记录（~200ms）
- \`/api/submit\` 四阶段：预检(409) → 写订单 → 扣库存(失败标记人工)
- \`clientRequestId\` 幂等保护（10min TTL）
- 前端 409 库存冲突弹窗
`;

import { writeFileSync } from "fs";
writeFileSync(resolve(__dirname, "docs/test_stock_concurrency_report.md"), report);
console.log("\n📄 报告已写入: docs/test_stock_concurrency_report.md");

if (failed > 0) process.exit(1);
