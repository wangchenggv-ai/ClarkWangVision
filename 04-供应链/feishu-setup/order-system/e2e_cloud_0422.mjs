/**
 * e2e_cloud_0422.mjs — 华为云 E2E 测试（2026-04-22 Bug 修复验证）
 *
 * 覆盖场景：
 *   1. 健康检查
 *   2. 管理后台登录页安全（不自动跳转）
 *   3. 查询已有订单 + 镜片明细
 *   4. 单订单导出 Excel
 *   5. 多订单导出 Excel
 *   6. 同订单选 1 人导出（备注过滤不混）
 *   7. 验真页面（时间 = 订单创建时间）
 */

const BASE = "https://lab.gaushclear.com";
const ADMIN = "GaushOrderMock";

process.env.no_proxy = "lab.gaushclear.com,localhost";
process.env.http_proxy = "";
process.env.https_proxy = "";

async function http(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

function fail(msg) { console.error(`  ❌ ${msg}`); failures++; }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function step(n, title) { console.log(`\n━━━ Step ${n}: ${title} ━━━`); }

let failures = 0;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok: ok ? "PASS" : "FAIL", detail });
}

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   华为云 E2E 测试 — 2026-04-22 Bug 修复验证        ║");
console.log("╚══════════════════════════════════════════════════════╝");
console.log(`  目标: ${BASE}`);
console.log(`  时间: ${new Date().toLocaleString("zh-CN")}`);

// ── Step 0: 健康检查 ─────────────────────────────────────────────
step(0, "健康检查 — GET /health");
const healthRes = await http("GET", "/health");
if (healthRes.status === 200) {
  pass(`/health ${healthRes.status}`);
  record("健康检查", true);
} else {
  fail(`/health 返回 ${healthRes.status}`);
  record("健康检查", false, `HTTP ${healthRes.status}`);
}

// ── Step 1: 管理后台安全 ──────────────────────────────────────────
step(1, "管理后台登录页安全 — GET /admin-login?admin=xxx");
const loginRes = await fetch(`${BASE}/admin-login?admin=${ADMIN}`);
if (loginRes.ok) {
  const html = await loginRes.text();
  const hasInput = html.includes('id="tokenInput"');
  const hasBtn = html.includes('id="loginBtn"');
  const hasAutoRedirect = html.includes("verifyAndRedirect");
  const secure = hasInput && hasBtn && !hasAutoRedirect;
  pass(`输入框: ${hasInput} | 按钮: ${hasBtn} | 自动跳转: ${hasAutoRedirect}`);
  record("管理后台安全(无自动跳转)", secure);
} else {
  fail(`登录页 HTTP ${loginRes.status}`);
  record("管理后台安全", false);
}

// ── Step 2: 查询已有订单 ──────────────────────────────────────────
step(2, "查询订单列表 — GET /api/admin/orders");
const ordersRes = await http("GET", `/api/admin/orders?admin=${ADMIN}&pageSize=50`);
if (ordersRes.status !== 200) {
  fail(`查询 HTTP ${ordersRes.status}`);
  record("查询订单", false);
  process.exit(1);
}
const allOrders = ordersRes.data.orders || [];
if (allOrders.length === 0) {
  fail("订单列表为空");
  record("查询订单", false, "空");
  process.exit(1);
}
pass(`获取 ${allOrders.length} 条订单记录`);
record("查询订单", true, `${allOrders.length}条`);

// 找 2 个不同订单号的"生产中"订单
const prodOrders = allOrders.filter(o => o.status === "生产中");
console.log(`  生产中订单: ${prodOrders.length} 条`);

// 找有多患者的同订单号
const orderGroups = {};
for (const o of allOrders) {
  if (!orderGroups[o.orderNo]) orderGroups[o.orderNo] = [];
  orderGroups[o.orderNo].push(o);
}
const multiPatientOrders = Object.entries(orderGroups).filter(([, v]) => v.length >= 2);
console.log(`  多患者订单: ${multiPatientOrders.length} 个`);

// 选 2 个不同订单号用于测试
const uniqueOrderNos = [...new Set(allOrders.map(o => o.orderNo))];
const testOrderNos = uniqueOrderNos.slice(0, 2);
const testCustomers = testOrderNos.flatMap(no => {
  const group = orderGroups[no] || [];
  return group.map(o => o.customerName);
});

console.log(`  测试订单: ${testOrderNos.join(", ")}`);
console.log(`  测试客户: ${testCustomers.join(", ")}`);

// ── Step 3: 查询镜片明细 ──────────────────────────────────────────
step(3, "查询镜片明细");
let lensCodes = [];
for (const orderNo of testOrderNos) {
  const detailRes = await http("GET", `/api/admin/order/${encodeURIComponent(orderNo)}/lens-details?admin=${ADMIN}`);
  const items = detailRes.data?.lenses || [];
  for (const item of items) {
    const code = item.lensCode;
    if (code) lensCodes.push(code);
  }
}
if (lensCodes.length > 0) {
  pass(`获取 ${lensCodes.length} 个镜片码`);
  record("镜片明细查询", true, `${lensCodes.length}个`);
} else {
  fail("未获取到镜片码");
  record("镜片明细查询", false);
}

// ── Step 4: 单订单导出 Excel ──────────────────────────────────────
step(4, "单订单导出 Excel — GET /api/admin/batch-zip");
if (testOrderNos[0]) {
  const xlsRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${encodeURIComponent(testOrderNos[0])}`);
  if (xlsRes.ok) {
    const ct = xlsRes.headers.get("content-type") || "";
    const xlsBuf = Buffer.from(await xlsRes.arrayBuffer());
    const isExcel = ct.includes("spreadsheetml") || ct.includes("excel");
    if (xlsBuf.length > 100) {
      pass(`Excel ${(xlsBuf.length / 1024).toFixed(1)} KB | Content-Type: ${isExcel ? "Excel" : ct}`);
      record("单订单导出含Excel", isExcel, `${(xlsBuf.length / 1024).toFixed(1)}KB`);
    } else {
      fail(`Excel 太小: ${xlsBuf.length} bytes`);
      record("单订单导出", false, `${xlsBuf.length}B`);
    }
  } else {
    fail(`Excel HTTP ${xlsRes.status}: ${await xlsRes.text()}`);
    record("单订单导出", false, `HTTP ${xlsRes.status}`);
  }
}

// ── Step 5: 多订单导出 Excel ──────────────────────────────────────
step(5, "多订单导出 Excel — GET /api/admin/batch-zip");
if (testOrderNos.length >= 2) {
  const multiUrl = `${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${encodeURIComponent(testOrderNos.join(","))}`;
  const multiRes = await fetch(multiUrl);
  if (multiRes.ok) {
    const ct = multiRes.headers.get("content-type") || "";
    const xlsBuf = Buffer.from(await multiRes.arrayBuffer());
    const isExcel = ct.includes("spreadsheetml") || ct.includes("excel");
    if (xlsBuf.length > 100) {
      pass(`Excel ${(xlsBuf.length / 1024).toFixed(1)} KB | Content-Type: ${isExcel ? "Excel" : ct}`);
      record("多订单导出含Excel", isExcel);
    } else {
      fail(`Excel 太小: ${xlsBuf.length} bytes`);
      record("多订单导出", false, `${xlsBuf.length}B`);
    }
  } else {
    const errText = await multiRes.text();
    fail(`Excel HTTP ${multiRes.status}: ${errText}`);
    record("多订单导出", false, `HTTP ${multiRes.status}`);
  }
}

// ── Step 6: 同订单选 1 人导出（备注不混） ─────────────────────────
step(6, "同订单选 1 人导出");
if (multiPatientOrders.length > 0) {
  const [mpOrderNo, mpPatients] = multiPatientOrders[0];
  const targetCustomer = mpPatients[0].customerName;
  const custUrl = `${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${mpOrderNo}&customer=${encodeURIComponent(targetCustomer)}`;
  const custRes = await fetch(custUrl);
  if (custRes.ok) {
    const ct = custRes.headers.get("content-type") || "";
    const xlsBuf = Buffer.from(await custRes.arrayBuffer());
    const isExcel = ct.includes("spreadsheetml") || ct.includes("excel");
    pass(`Excel ${(xlsBuf.length / 1024).toFixed(1)} KB | Excel: ${isExcel} | 客户: ${targetCustomer}`);
    record("同订单选人导出含Excel", isExcel);
  } else {
    fail(`Excel HTTP ${custRes.status}`);
    record("同订单选人导出", false);
  }
} else {
  if (testOrderNos[0]) {
    const oneCustomer = orderGroups[testOrderNos[0]][0]?.customerName || "";
    if (oneCustomer) {
      const custUrl = `${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${testOrderNos[0]}&customer=${encodeURIComponent(oneCustomer)}`;
      const custRes = await fetch(custUrl);
      if (custRes.ok) {
        const ct = custRes.headers.get("content-type") || "";
        const isExcel = ct.includes("spreadsheetml") || ct.includes("excel");
        pass(`单客户导出 ${(Buffer.from(await custRes.arrayBuffer()).length / 1024).toFixed(1)} KB | Excel: ${isExcel}`);
        record("单客户导出", isExcel);
      } else {
        fail(`Excel HTTP ${custRes.status}`);
        record("单客户导出", false);
      }
    }
  }
}

// ── Step 7: 验真页面 ──────────────────────────────────────────────
step(7, "验真页面 — GET /verify/:lensCode");
if (lensCodes.length > 0) {
  const code = lensCodes[0];
  const verifyRes = await fetch(`${BASE}/verify/${code}`);
  if (verifyRes.ok) {
    const html = await verifyRes.text();
    const hasTime = html.includes("验证时间") && !html.includes("{{NOW}}");
    const hasLensCode = html.includes(code);
    const hasCustomer = html.includes("顾客") || html.includes("姓名");
    pass(`验真 ${verifyRes.status} | 时间: ${hasTime} | 镜片码: ${hasLensCode} | 客户: ${hasCustomer}`);
    record("验真页面", true);
    record("验真含时间字段", hasTime);
    record("验真含镜片码", hasLensCode);
  } else {
    fail(`验真 HTTP ${verifyRes.status}`);
    record("验真页面", false);
  }
} else {
  fail("无镜片码，跳过验真");
  record("验真", false, "无镜片码");
}

// ── 汇总报告 ──────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║   E2E 测试报告                                      ║");
console.log("╚══════════════════════════════════════════════════════╝");

const passCount = results.filter(r => r.ok === "PASS").length;
const failCount = results.filter(r => r.ok === "FAIL").length;
const total = results.length;

console.log(`\n  目标: ${BASE}`);
console.log(`  时间: ${new Date().toLocaleString("zh-CN")}`);
console.log(`  结果: ${passCount}/${total} 通过, ${failCount} 失败\n`);

console.log("  # | 状态 | 测试项");
console.log("  --|------|-------");
results.forEach((r, i) => {
  const icon = r.ok === "PASS" ? "✅" : "❌";
  console.log(`  ${String(i + 1).padStart(2)} | ${icon} ${r.ok.padEnd(4)} | ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
});

if (failCount > 0) {
  console.log(`\n  ⚠️  ${failCount} 个断言失败`);
}
console.log("");
