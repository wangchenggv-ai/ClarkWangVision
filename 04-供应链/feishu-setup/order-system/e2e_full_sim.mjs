/**
 * e2e_full_sim.mjs — 完整 E2E 模拟测试
 * 下单 → 确认 → 导出ZIP → 发货 → 标签预览 → 签收
 * 每步有断言，任何步失败立即终止
 */

process.env.no_proxy = "localhost,127.0.0.1";
process.env.http_proxy = "";
process.env.https_proxy = "";

const BASE = "http://localhost:3210";
const ADMIN = "admin-gsx-2026";
const AGENT_TOKEN = "AG-002-zxkmgoryb6nprmv6";

async function http(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

function fail(msg) { console.error(`\n❌ FATAL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function step(n, title) { console.log(`\n━━━ Step ${n}: ${title} ━━━`); }

// ─── Test Data ────────────────────────────────────────────────────
const testPayload = {
  clientRequestId: `e2e-${Date.now()}`,
  terminalCustomer: { name: "运城眼科医院（E2E测试）", contact: "测试联系人", phone: "13800000000" },
  address: "山西省运城市盐湖区运城眼科医院（E2E测试地址）",
  patients: [
    {
      customerName: "E2E-测试顾客Alpha",
      sku: "Ultra双效", quantity: 1, assembly: true,
      remark: "E2E模拟测试-Alpha",
      eyes: [
        { side: "右眼", sph: -2.75, cyl: -1.00, axis: 90 },
        { side: "左眼", sph: -3.00, cyl: -0.75, axis: 85 },
      ],
    },
    {
      customerName: "E2E-测试顾客Beta",
      sku: "Ultra双效", quantity: 1, assembly: false,
      remark: "E2E模拟测试-Beta",
      eyes: [
        { side: "右眼", sph: -5.00, cyl: -1.25, axis: 180 },
        { side: "左眼", sph: -4.75, cyl: -1.00, axis: 170 },
      ],
    },
  ],
};

console.log("╔══════════════════════════════════════════════╗");
console.log("║   订单交付系统 E2E 全流程模拟测试            ║");
console.log("╚══════════════════════════════════════════════╝");

let orderNumbers = [];

// ── Step 1: 下单 ──────────────────────────────────────────────────
step(1, "下单 — POST /api/submit");

const submitRes = await http("POST", `/api/submit?t=${AGENT_TOKEN}`, testPayload);
if (submitRes.status !== 200) fail(`下单 HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data)}`);
if (!submitRes.data.success && !submitRes.data.ok) fail(`下单业务失败: ${JSON.stringify(submitRes.data)}`);

if (submitRes.data.orderNo) orderNumbers.push(submitRes.data.orderNo);
if (submitRes.data.orders) for (const o of submitRes.data.orders) orderNumbers.push(o.orderNo);
if (orderNumbers.length === 0) fail("下单成功但未返回订单号");

const summary = submitRes.data.summary || {};
pass(`订单 ${orderNumbers[0]} — ${summary.totalPatients || '?'} 顾客 / ${summary.totalLenses || '?'} 镜片`);

// ── Step 1.5: 等待草稿同步 ──────────────────────────────────────────
step(1.5, "等待草稿同步到 Bitable（~3 分钟）");
console.log("  等待 180 秒...");
await new Promise(r => setTimeout(r, 180000));
pass("草稿同步等待完成");

// ── Step 2: 确认 ──────────────────────────────────────────────────
step(2, "确认订单 — POST /api/admin/confirm");

const confirmRes = await http("POST", `/api/admin/confirm?admin=${ADMIN}`, { orderNos: orderNumbers });
if (confirmRes.status !== 200) fail(`确认 HTTP ${confirmRes.status}: ${JSON.stringify(confirmRes.data)}`);
for (const r of (confirmRes.data.results || [])) {
  if (!r.ok) fail(`确认 ${r.orderNo} 失败: ${r.error}`);
}
pass(`全部确认成功`);

// ── Step 3: 导出ZIP ───────────────────────────────────────────────
step(3, "批量导出ZIP — GET /api/admin/batch-zip");

const zipRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${orderNumbers.join(",")}`);
if (!zipRes.ok) fail(`ZIP HTTP ${zipRes.status}: ${await zipRes.text()}`);
const zipBuf = Buffer.from(await zipRes.arrayBuffer());
if (zipBuf.length < 100) fail(`ZIP 太小，可能为空: ${zipBuf.length} bytes`);
pass(`ZIP ${(zipBuf.length / 1024).toFixed(1)} KB`);

// ── Step 4: 发货 ──────────────────────────────────────────────────
step(4, "发货 — POST /api/admin/ship");

const shipRes = await http("POST", `/api/admin/ship?admin=${ADMIN}`, { orderNos: orderNumbers });
if (shipRes.status !== 200) fail(`发货 HTTP ${shipRes.status}: ${JSON.stringify(shipRes.data)}`);
let trackingNo = "";
for (const r of (shipRes.data.results || [])) {
  if (!r.ok) fail(`发货 ${r.orderNo} 失败: ${r.error}`);
  trackingNo = r.trackingNo || "";
}
if (!trackingNo) fail("发货成功但未返回快递单号");
pass(`快递单号 ${trackingNo}`);

// ── Step 5: 标签预览 ──────────────────────────────────────────────
step(5, "标签预览 — GET /api/admin/labels/batch");

const labelRes = await fetch(`${BASE}/api/admin/labels/batch?admin=${ADMIN}&orderNos=${orderNumbers.join(",")}`);
if (!labelRes.ok) fail(`标签 HTTP ${labelRes.status}: ${await labelRes.text()}`);
const labelData = await labelRes.json();
const labels = labelData.labels || [];
if (labels.length === 0) fail("标签返回空");

// 验证每个标签的内容
const expectedCustomers = ["E2E-测试顾客Alpha", "E2E-测试顾客Beta"];
for (const lb of labels) {
  if (!lb.html) fail(`标签缺少 html`);
  if (!lb.lensCode) fail(`标签缺少 lensCode`);
  if (!/^[0-9A-F]{16}$/.test(lb.lensCode)) fail(`镜片码格式错误: ${lb.lensCode}`);
  if (!lb.html.includes("data:image/png;base64,")) fail(`标签缺少QR码图片`);
  if (!lb.html.includes("#c0392b") && !lb.html.includes("#1a6fb5")) fail(`标签缺少红/蓝眼别色带`);
  if (!lb.html.includes("GAUSH")) fail(`标签缺少品牌标识`);
}
pass(`${labels.length} 张标签，镜片码/验真/色带/品牌 全部验证通过`);

// ── Step 6: 签收 ──────────────────────────────────────────────────
step(6, "签收 — POST /api/admin/deliver");

const deliverRes = await http("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: orderNumbers });
if (deliverRes.status !== 200) fail(`签收 HTTP ${deliverRes.status}: ${JSON.stringify(deliverRes.data)}`);
for (const r of (deliverRes.data.results || [])) {
  if (!r.ok) fail(`签收 ${r.orderNo} 失败: ${r.error}`);
}
pass(`全部签收成功`);

// ── Step 7: 最终状态验证 ──────────────────────────────────────────
step(7, "验证最终状态 — GET /api/admin/orders");

const ordersRes = await http("GET", `/api/admin/orders?admin=${ADMIN}`);
if (ordersRes.status !== 200) fail(`查询 HTTP ${ordersRes.status}`);
const allOrders = ordersRes.data.orders || [];
const testOrders = allOrders.filter(o => orderNumbers.includes(o.orderNo));
if (testOrders.length === 0) fail(`未找到本次测试订单（共 ${allOrders.length} 条记录中）`);

for (const o of testOrders) {
  if (o.status !== "已发货") fail(`${o.orderNo} 状态为 "${o.status}"，期望 "已发货"`);
  pass(`${o.orderNo} — ${o.customerName} — ${o.status}`);
}

console.log("\n╔══════════════════════════════════════════════╗");
console.log("║   E2E 全流程模拟完成 ✅                      ║");
console.log("╚══════════════════════════════════════════════╝");
console.log(`  订单: ${orderNumbers.join(", ")}`);
console.log("  下单 → 确认 → 导出ZIP → 发货 → 标签预览 → 签收");
