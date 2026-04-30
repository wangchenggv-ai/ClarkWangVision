/**
 * test_seed_5.mjs — 创建5条测试数据走通标签打印+发货中心流程
 *
 * 流程：下单→确认→打印入队→发货→标记待签收
 * 代理商：AG-002 测试代理商
 * 目标：labels-print.html 有数据显示
 *
 * Usage: node test_seed_5.mjs
 */

const BASE = "http://localhost:3210";
const ADMIN = "admin=GaushOrderMock";
const TOKEN = "AG-002-zxkmgoryb6nprmv6";

const patients = [
  { name: "测试-张三", sku: "Ultra双效", sph: -3.00, cyl: -0.75, axis: 180, eye: "右眼", qty: 1 },
  { name: "测试-李四", sku: "D8", sph: -2.50, cyl: -1.00, axis: 170, eye: "右眼", qty: 1 },
  { name: "测试-王五", sku: "时空之眼A", sph: -4.00, cyl: -0.50, axis: 5, eye: "左眼", qty: 1 },
  { name: "测试-赵六", sku: "时空之眼PRO", sph: -1.75, cyl: -1.25, axis: 175, eye: "右眼", qty: 2 },
  { name: "测试-孙七", sku: "小旋风", sph: -5.00, cyl: -0.75, axis: 10, eye: "左眼", qty: 1 },
];

let createdOrders = [];
let passed = 0;
let failed = 0;

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function ng(msg, detail) { console.log(`  ❌ ${msg}${detail ? ': ' + detail : ''}`); failed++; }

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

console.log("\n" + "=".repeat(60));
console.log("  种子数据：5 条测试订单（标签打印 + 发货中心）");
console.log("  " + new Date().toLocaleString("zh-CN"));
console.log("=".repeat(60) + "\n");

async function main() {
  // ── Step 1: 验证代理商 ──
  console.log("[Step 1] 验证代理商 AG-002");
  const ares = await api("GET", `/api/agent?t=${TOKEN}`);
  if (ares.status === 200) ok(`AG-002 ${ares.json.name}`);
  else ng("代理商验证失败", JSON.stringify(ares.json));

  // ── Step 2: 逐个下单 ──
  console.log("\n[Step 2] 创建 5 条测试订单");
  for (const p of patients) {
    const eyes = [];
    if (p.eye === "双眼" || p.eye === "右眼") eyes.push({ side: "右眼", sph: p.sph, cyl: p.cyl, axis: p.axis, pd: 32, ph: 18 });
    if (p.eye === "双眼" || p.eye === "左眼") eyes.push({ side: "左眼", sph: p.sph, cyl: p.cyl, axis: p.axis, pd: 32, ph: 18 });
    if (eyes.length === 0) eyes.push({ side: p.eye, sph: p.sph, cyl: p.cyl, axis: p.axis, pd: 32, ph: 18 });

    const payload = {
      clientRequestId: genId(),
      terminalCustomer: { name: `终端-${p.name}`, contact: "测试联系人", phone: "13800138000" },
      address: `测试收货地址-${p.name}`,
      patients: [{
        customerName: p.name,
        sku: p.sku,
        quantity: p.qty || 1,
        eyes,
        remark: `种子数据 ${p.name}`,
      }],
    };

    const res = await api("POST", `/api/submit?t=${TOKEN}`, payload);
    if (res.status === 200 && res.json.success) {
      createdOrders.push({ orderNo: res.json.orderNo, ...p });
      ok(`${res.json.orderNo} → ${p.name} ${p.sku}`);
    } else {
      ng(`${p.name} 下单失败`, JSON.stringify(res.json));
    }
  }

  if (createdOrders.length === 0) {
    console.log("\n❌ 无订单创建成功，终止");
    process.exit(1);
  }

  // ── Step 3: 确认订单（管理后台批量）──
  console.log(`\n[Step 3] 确认 ${createdOrders.length} 条订单（生成镜片码→生产中）`);
  for (const o of createdOrders) {
    const res = await api("POST", `/api/admin/confirm?${ADMIN}`, {
      orderNos: [o.orderNo],
      customerName: o.name,
      pairIndex: "1",
      stockStatus: "有库存",
      supplier: "九次方",
    });
    if (res.status === 200) {
      const r = res.json.results?.[0];
      if (r?.ok) {
        o.lensCodes = r.lensCodes || r.lensCode ? [r.lensCode] : [];
        ok(`${o.orderNo}: ${o.name} 确认成功 (${(o.lensCodes.length || "?")} 镜片码)`);
      } else {
        ng(`${o.orderNo} 确认返回异常`, JSON.stringify(r || res.json));
      }
    } else {
      ng(`${o.orderNo} 确认失败`, JSON.stringify(res.json));
    }
  }

  // ── Step 4: 入队打印标签（前3条）──
  console.log("\n[Step 4] 入队打印标签（前3条 → 打印队列）");
  const toPrint = createdOrders.slice(0, 3);
  for (const o of toPrint) {
    const res = await api("POST", `/api/admin/print-queue?${ADMIN}`, {
      orderNo: o.orderNo,
      customerName: o.name,
      pairIndex: "1",
      type: "zpl",
      copies: 1,
    });
    if (res.status === 200) ok(`${o.orderNo} ${o.name} 已入队`);
    else ng(`${o.orderNo} 入队失败`, JSON.stringify(res.json));
  }

  // ── Step 5: 发货（前2条）──
  console.log("\n[Step 5] 发货（前2条 → 已发货）");
  const toShip = createdOrders.slice(0, 2);
  for (const o of toShip) {
    const res = await api("POST", `/api/admin/ship?${ADMIN}`, {
      orderNos: [o.orderNo],
      customerName: o.name,
      pairIndex: "1",
      courier: "sf",
    });
    if (res.status === 200) {
      const r = res.json.results?.[0];
      if (r?.ok) ok(`${o.orderNo}: ${o.name} 已发货`);
      else ng(`${o.orderNo} 发货返回异常`, JSON.stringify(r || res.json));
    } else {
      ng(`${o.orderNo} 发货失败`, JSON.stringify(res.json));
    }
  }

  // ── Step 6: 标记待签收（第1条）──
  console.log("\n[Step 6] 标记待签收（第1条）");
  if (toShip[0]) {
    const o = toShip[0];
    const res = await api("POST", `/api/admin/deliver?${ADMIN}`, {
      orderNos: [o.orderNo],
      customerName: o.name,
      pairIndex: "1",
    });
    if (res.status === 200) {
      const r = res.json.results?.[0];
      if (r?.ok) ok(`${o.orderNo}: ${o.name} 已标记待签收`);
      else ng(`${o.orderNo} 标记失败`, JSON.stringify(r || res.json));
    } else {
      ng(`${o.orderNo} 标记失败`, JSON.stringify(res.json));
    }
  }

  // ── Step 7: 打印队列状态 ──
  console.log("\n[Step 7] 打印队列状态");
  const qres = await api("GET", `/api/admin/print-queue?${ADMIN}`);
  if (qres.status === 200) {
    const q = qres.json;
    console.log(`  待打印: ${q.pending || 0}  已完成: ${q.done || 0}  失败: ${q.failed || 0}  总计: ${q.total || 0}`);
    ok("打印队列有数据");
  } else {
    ng("查询队列失败");
  }

  // ── Step 8: 验证最终状态 ──
  console.log("\n[Step 8] 验证测试订单状态");
  const ores = await api("GET", `/api/admin/orders?${ADMIN}&limit=30`);
  if (ores.status === 200) {
    const orders = ores.json.orders || [];
    const ourOrders = orders.filter(o => o.customerName && o.customerName.startsWith("测试-"));
    console.log(`  找到 ${ourOrders.length} 条测试订单:`);
    for (const o of ourOrders) {
      console.log(`    ${o.orderNo.slice(0, 24)} ${o.customerName} 状态=${o.status}`);
    }
    if (ourOrders.length >= createdOrders.length) ok("所有测试订单可见");
  }

  // ── 汇总 ──
  console.log("\n" + "=".repeat(60));
  console.log(`  结果: ✅ ${passed}  ❌ ${failed}`);
  console.log("=".repeat(60));
  console.log("\n  labels-print 页面:");
  console.log(`  https://lab.gaushclear.com/labels-print?admin=GaushOrderMock\n`);

  console.log("  种子数据清单:");
  for (const o of createdOrders) {
    let status = "待处理";
    if (toShip.includes(o)) status = "已发货";
    else if (toPrint.includes(o)) status = "已确认+入队打印";
    else status = "已确认";
    console.log(`  ${o.orderNo.slice(0, 24)} ${o.name.padEnd(8)} ${o.sku.padEnd(12)} ${status}`);
  }
  console.log();
}

main().catch(err => { console.error("💥", err); process.exit(1); });
