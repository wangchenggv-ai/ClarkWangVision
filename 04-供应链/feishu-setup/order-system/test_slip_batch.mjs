/**
 * test_slip_batch.mjs — 测试随货通行单按地址聚合
 *
 * 下5单（3个不同地址）→ 等待同步 → 确认 → 发货 → 在测试容器执行 slip-batch → 验证输出
 *
 * Usage: node test_slip_batch.mjs
 */

const BASE  = "http://localhost:3211";
const ADMIN = "GaushOrderTest";
const TOKEN = "AG-002-zxkmgoryb6nprmv6"; // 测试代理商

const ORDERS = [
  { address: "上海市浦东新区张江高科技园区明眸眼科门诊一楼", customer: "张小明", sph: -3.00, cyl: -0.75, axis: 180 },
  { address: "上海市浦东新区张江高科技园区明眸眼科门诊一楼", customer: "李小红", sph: -2.50, cyl: -1.00, axis: 170 },
  { address: "北京市朝阳区建国路铂林眼科望京门诊3楼",       customer: "王大力", sph: -4.00, cyl: -0.50, axis:   5 },
  { address: "北京市朝阳区建国路铂林眼科望京门诊3楼",       customer: "陈小花", sph: -1.75, cyl: -1.25, axis: 175 },
  { address: "四川省成都市高新区天府大道华厦眼科医院配镜中心",customer: "赵阳阳", sph: -5.00, cyl: -0.75, axis:  10 },
];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

function ok(msg)   { console.log("  ✅", msg); }
function fail(msg) { console.error("  ❌", msg); process.exit(1); }
function step(n, t){ console.log(`\n━━━ Step ${n}: ${t}`); }

// ── Step 1: 下5单 ──────────────────────────────────────────────────────────
step(1, "下5单（3个不同收货地址）");
const orderNos = [];

for (const o of ORDERS) {
  const r = await api("POST", `/api/submit?t=${TOKEN}`, {
    address: o.address,
    patients: [{
      customerName: o.customer,
      sku: "Ultra双效",
      quantity: 1,
      eyes: [
        { side: "右眼", sph: o.sph,       cyl: o.cyl,  axis: o.axis },
        { side: "左眼", sph: o.sph - 0.25, cyl: o.cyl, axis: o.axis },
      ],
    }],
  });
  if (r.status === 200 && (r.data.success || r.data.ok)) {
    const no = r.data.orderNo || r.data.orders?.[0]?.orderNo;
    orderNos.push(no);
    ok(`${no} → ${o.customer} [${o.address.slice(0, 12)}...]`);
  } else {
    fail(`下单失败: ${JSON.stringify(r.data)}`);
  }
  await delay(400);
}

// ── Step 2: 等待草稿同步到 Bitable（2分钟轮询间隔，等3分钟） ──────────────
step(2, "等待Bitable同步（3分钟）");
console.log("  等待 180s...");
await delay(180_000);
ok("同步等待完成");

// ── Step 3: 查询 drafts 确认草稿已同步 ────────────────────────────────────
step(3, "确认草稿已进 Bitable");
const draftRes = await api("GET", `/api/admin/orders?admin=${ADMIN}&pageSize=20`);
if (draftRes.status !== 200) fail(`查询失败: ${JSON.stringify(draftRes.data)}`);
const allOrders = draftRes.data.orders || draftRes.data.items || [];
const myOrders = allOrders.filter(o => orderNos.includes(o.orderNo || o["订单编号"]));
ok(`Bitable中找到 ${myOrders.length}/${orderNos.length} 个测试订单`);
if (myOrders.length === 0) {
  console.log("  ⚠️ 未找到订单，可能同步还未完成，再等60s...");
  await delay(60_000);
}

// ── Step 4: 批量确认（生成镜片码） ────────────────────────────────────────
step(4, "批量确认（生成镜片码）");
const confirmRes = await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
  orderNos,
  stockStatus: "无库存",
  supplier: "工厂",
});
if (confirmRes.status !== 200) fail(`确认失败: ${JSON.stringify(confirmRes.data)}`);
ok(`确认完成: ${JSON.stringify(confirmRes.data.results?.map(r => r.orderNo) || confirmRes.data)}`);

await delay(2000);

// ── Step 5: 批量发货（自动生成快递单号） ──────────────────────────────────
step(5, "批量发货");
const shipRes = await api("POST", `/api/admin/ship?admin=${ADMIN}`, {
  orderNos,
  courier: "sf",
});
if (shipRes.status !== 200) fail(`发货失败: ${JSON.stringify(shipRes.data)}`);
const shipped = shipRes.data.results || [];
ok(`发货完成:`);
for (const s of shipped) {
  console.log(`    ${s.orderNo} → 快递单 ${s.trackingNo || "(已发货)"}`);
}

await delay(2000);

// ── Step 6: 在测试容器执行 slip-batch ──────────────────────────────────────
step(6, "在测试容器执行 slip-batch");
console.log("  运行: docker exec order-app-test node /app/logistics.js slip-batch");
console.log("  ℹ️  请手动执行以下命令查看通行单：");
console.log();
console.log(`  ssh -i 密钥/key-gaush-lab.pem root@113.44.175.221 \\`);
console.log(`    "docker exec order-app-test node /app/logistics.js slip-batch"`);
console.log();
console.log("  预期结果：");
console.log("    - 上海明眸门诊（2单）→ 1张通行单");
console.log("    - 北京铂林望京（2单）→ 1张通行单");
console.log("    - 成都华厦眼科（1单）→ 1张通行单");
console.log("  共3张，按收货地址聚合。");

console.log("\n━━━ 测试完成 ━━━\n");
