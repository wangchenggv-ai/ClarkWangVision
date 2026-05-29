/**
 * 关联门店 + 通行单功能测试（从ECS本机运行：node test_store_link.mjs）
 */

const BASE_URL = "http://localhost:3211";
const ADMIN_TOKEN = "GaushOrderTest";
const AGENT_TOKEN = "AG-002-zxkmgoryb6nprmv6"; // 测试代理商 token

function ok(cond, msg) { console.log(`  ${cond ? "✅" : "❌"} ${msg}`); }

// ── 1. 门店主数据下拉 ──
async function testStoresAPI() {
  console.log("\n=== 1. 门店下拉 /api/terminal-stores ===");
  const r = await fetch(`${BASE_URL}/api/terminal-stores?t=${AGENT_TOKEN}`);
  const d = await r.json();
  const stores = d.stores || [];
  ok(r.ok, `HTTP ${r.status}`);
  ok(stores.length > 0, `返回 ${stores.length} 条门店`);
  if (stores.length) {
    const s = stores[0];
    console.log(`  首条: ${s.name} | ${s.address?.slice(0,20)} | recordId=${s.recordId?.slice(0,10)||"无"}`);
    ok(!!s.recordId, `首条门店带 recordId`);
  }
  return stores;
}

// ── 2. 下单（带 recordId）──
async function testSubmitWithRecordId(stores) {
  console.log("\n=== 2. 下单（关联门店 recordId）===");
  const store = stores.find(s => s.recordId) || stores[0];
  if (!store) { console.log("  ⚠️ 无可用门店，跳过"); return null; }
  console.log(`  使用门店: ${store.name} (recordId=${store.recordId?.slice(0,12)}...)`);

  const payload = {
    clientRequestId: `test-${Date.now()}`,
    terminalCustomer: {
      name: store.name,
      contact: store.contact || "测试联系人",
      phone: store.phone || "13800000001",
      address: store.address || "测试地址",
      recordId: store.recordId,
    },
    address: store.address || "测试地址",
    patients: [{
      customerName: "测试顾客甲",
      sku: "时空之眼A",
      quantity: 2,
      eyes: [
        { side: "右眼", sph: -3.0, cyl: -0.75, axis: 180 },
        { side: "左眼", sph: -2.5, cyl: -0.50, axis: 175 },
      ],
      assembly: "否", firstOrder: "否", remark: "关联门店功能测试",
    }],
  };

  const r = await fetch(`${BASE_URL}/api/submit?t=${AGENT_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  ok(r.ok && d.orderNo, `提交成功: ${d.orderNo || d.error}`);
  return d.orderNo || null;
}

// ── 3. 等同步后检查关联门店字段 ──
async function testOrderFields(orderNo) {
  console.log(`\n=== 3. 检查写入字段（等5s同步）===`);
  await new Promise(r => setTimeout(r, 5000));

  const r = await fetch(`${BASE_URL}/api/order/${orderNo}?t=${AGENT_TOKEN}`);
  if (!r.ok) { console.log(`  ❌ 获取订单失败 ${r.status}`); return; }
  const d = await r.json();
  console.log(`  状态: ${d.status || d.order?.status}`);

  // 再直接查 Bitable（绕过服务端缓存）
  const r2 = await fetch(`${BASE_URL}/api/admin/orders?admin=${ADMIN_TOKEN}&page=1&pageSize=5`);
  const d2 = await r2.json();
  const order = (d2.orders || []).find(o => o.orderNo === orderNo);
  if (order) {
    ok(!!order.terminalCustomer || !!order.storeName, `终端客户字段: ${order.terminalCustomer || order.storeName || "空"}`);
  }
}

// ── 4. 确认订单（生成镜片码，状态→打标签）──
async function confirmOrder(orderNo) {
  console.log(`\n=== 4. 确认订单 → 打标签 ===`);
  const r = await fetch(`${BASE_URL}/api/admin/confirm?admin=${ADMIN_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNos: [orderNo], stockStatus: "有库存" }),
  });
  const d = await r.json();
  ok(r.ok, `confirm: ${r.status} ${d.message || JSON.stringify(d).slice(0,80)}`);
  await new Promise(r => setTimeout(r, 2000));
}

// ── 5. 单订单通行单 ──
async function testSingleSlip(orderNo) {
  console.log(`\n=== 5. 单订单通行单 ===`);
  const r = await fetch(`${BASE_URL}/api/admin/slip/${orderNo}?admin=${ADMIN_TOKEN}`);
  ok(r.ok, `HTTP ${r.status}`);
  if (r.ok) {
    const html = await r.text();
    ok(html.includes(orderNo), `含订单号 ${orderNo}`);
    ok(html.includes("随货同行单"), `HTML结构正确`);
    // 验证地址是否来自查找引用（更准确的地址）
    const hasAddr = html.includes("朝聚") || html.includes("包头") || html.includes("测试地址");
    ok(hasAddr, `含门店地址`);
  }
}

// ── 6. 批量通行单（按门店分组）──
async function testBatchSlip(orderNo) {
  console.log(`\n=== 6. 批量通行单 slip-batch ===`);
  const r = await fetch(`${BASE_URL}/api/admin/slip-batch?orderNos=${encodeURIComponent(orderNo)}&admin=${ADMIN_TOKEN}`);
  ok(r.ok, `HTTP ${r.status}`);
  if (r.ok) {
    const html = await r.text();
    const isSlip = html.includes("随货同行单");
    const isList = html.includes("打印同行单");
    ok(isSlip || isList, `返回通行单或门店汇总页`);
    if (isSlip) console.log(`  → 单门店直接返回通行单`);
    if (isList) {
      // 提取门店卡片数量
      const count = (html.match(/打印同行单/g) || []).length;
      console.log(`  → 汇总页，${count} 个门店卡片`);
    }
  }
}

// ── 7. 已有关联门店的老订单通行单 ──
async function testExistingLinkedOrder() {
  console.log(`\n=== 7. 已有关联门店的老订单通行单 ===`);
  // recvia96VEQQnW 有关联门店，订单编号需要找
  const r = await fetch(`${BASE_URL}/api/admin/orders?admin=${ADMIN_TOKEN}&page=1&pageSize=20`);
  const d = await r.json();
  const linked = (d.orders || []).find(o => o.terminalCustomer === "高清打印");
  if (!linked) { console.log("  ⚠️ 未找到高清打印订单"); return; }
  console.log(`  订单: ${linked.orderNo} | 门店: ${linked.terminalCustomer}`);

  const r2 = await fetch(`${BASE_URL}/api/admin/slip/${linked.orderNo}?admin=${ADMIN_TOKEN}`);
  if (r2.ok) {
    const html = await r2.text();
    ok(html.includes("包头") || html.includes("朝聚"), `通行单地址来自查找引用字段`);
    ok(html.includes(linked.orderNo), `含订单号`);
    console.log(`  地址片段: ${html.match(/<div class="meta-value" style="font-size:8pt">([^<]+)<\/div>/)?.[1]?.slice(0,30) || "未找到"}`);
  } else {
    console.log(`  ❌ slip: ${r2.status}`);
  }
}

async function main() {
  console.log(`=== 关联门店功能测试 @ ${BASE_URL} ===`);
  try {
    const stores = await testStoresAPI();
    const orderNo = await testSubmitWithRecordId(stores);
    if (orderNo) {
      await testOrderFields(orderNo);
      await confirmOrder(orderNo);
      await testSingleSlip(orderNo);
      await testBatchSlip(orderNo);
    }
    await testExistingLinkedOrder();
  } catch(e) {
    console.error("❌ 异常:", e.message);
  }
  console.log("\n=== 测试完成 ===");
}

main();
