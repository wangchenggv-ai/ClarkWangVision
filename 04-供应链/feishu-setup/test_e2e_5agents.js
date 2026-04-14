/**
 * test_e2e_5agents.js — E2E测试：5个代理商×2单=10副，完整端到端
 *
 * 流程：验证→下单→查询→确认→合单发货→随货通行单→签收
 * 代理商：AG-001 ~ AG-005（从Bitable读取）
 *
 * Usage: node test_e2e_5agents.js
 */

const BASE = "http://localhost:3210";

const agents = [
  { token: "AG-001-e662c4a12861fbf8", id: "AG-001", name: "" },
  { token: "AG-002a-f749def786e71b3a", id: "AG-002a", name: "" },
  { token: "AG-003-886e58610acc5957", id: "AG-003", name: "" },
  { token: "AG-004-f12f5438058fac37", id: "AG-004", name: "" },
  { token: "AG-005-fab4f4f676813bbf", id: "AG-005", name: "" },
];

// 每个代理商2单，不同顾客+SKU+处方
const orderTemplates = [
  [
    { customer: "北京同仁医院", sku: "Ultra双效 -0.75/-0.50", sph: -3.25, cyl: -0.75, axis: 180, side: "左眼" },
    { customer: "北医三院眼科", sku: "D8", sph: -2.50, cyl: -1.00, axis: 170, side: "右眼" },
  ],
  [
    { customer: "天津眼科医院", sku: "Ultra双效 -2.25/-0.50", sph: -4.00, cyl: -0.50, axis: 5, side: "左眼" },
    { customer: "天津爱尔眼科", sku: "Ultra -1.25/-0.50", sph: -1.75, cyl: -1.25, axis: 175, side: "右眼" },
  ],
  [
    { customer: "北京嘉悦眼科", sku: "Ultra", sph: -5.00, cyl: -0.75, axis: 10, side: "左眼" },
    { customer: "铂林眼科诊所", sku: "Ultra双效 -0.75/-0.50", sph: -3.50, cyl: -0.50, axis: 90, side: "右眼" },
  ],
  [
    { customer: "北京捷瑞康成门诊", sku: "D8", sph: -2.00, cyl: -1.50, axis: 160, side: "左眼" },
    { customer: "北京视光中心", sku: "Ultra双效 -2.25/-0.50", sph: -6.00, cyl: -0.75, axis: 5, side: "右眼" },
  ],
  [
    { customer: "广州金眼科总店", sku: "Ultra -1.25/-0.50", sph: -3.75, cyl: -1.00, axis: 170, side: "左眼" },
    { customer: "广州视康眼镜", sku: "Ultra", sph: -4.50, cyl: -0.50, axis: 85, side: "右眼" },
  ],
];

const results = { orders: [], shipped: false, confirmed: 0, delivered: 0 };
const startTime = Date.now();

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, json };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(section, msg) {
  console.log(`  ${section ? `[${section}] ` : ""}${msg}`);
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  E2E报告: 5代理商 × 2单 = 10副 完整端到端");
  console.log("  " + new Date().toLocaleString("zh-CN"));
  console.log("═".repeat(60) + "\n");

  // ── Step 1: 验证代理商 ──
  console.log("[Step 1] 验证5个代理商（从Bitable读取）");
  let verified = 0;
  for (const agent of agents) {
    const res = await api("GET", `/api/agent?t=${agent.token}`);
    if (res.status === 200) {
      agent.name = res.json.name;
      verified++;
      log("", `✅ ${agent.id} ${agent.name}`);
    } else {
      log("", `❌ ${agent.id} 验证失败: ${JSON.stringify(res.json)}`);
    }
  }
  console.log(`  结果: ${verified}/${agents.length} 验证通过\n`);

  // ── Step 2: 下单 ──
  console.log("[Step 2] 下单 5代理商 × 2单 = 10副");
  let totalSubmitted = 0;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const templates = orderTemplates[i];
    log(agent.id, agent.name);

    for (let j = 0; j < templates.length; j++) {
      const t = templates[j];
      const payload = {
        address: `${agent.name} 收货地址-${j + 1}`,
        patients: [{
          customerName: t.customer,
          sku: t.sku,
          quantity: 1,
          eyes: [{
            side: t.side,
            sph: t.sph, cyl: t.cyl, axis: t.axis,
            pd: 32.0, ph: 18.0,
            frame: `测试框-${agent.id}-${j + 1}`,
          }],
          remark: `E2E ${agent.id} #${j + 1}`,
        }],
      };
      const res = await api("POST", `/api/submit?t=${agent.token}`, payload);
      if (res.status === 200 && res.json.success) {
        results.orders.push({
          orderNo: res.json.orderNo,
          agentId: agent.id,
          agentName: agent.name,
          customer: t.customer,
          sku: t.sku,
        });
        totalSubmitted++;
        log("", `  ✅ ${res.json.orderNo} → ${t.customer} ${t.sku}`);
      } else {
        log("", `  ❌ 下单失败: ${JSON.stringify(res.json)}`);
      }
      await delay(300);
    }
  }
  console.log(`  结果: ${totalSubmitted}/10 下单成功\n`);

  // ── Step 3: 查询订单列表 ──
  console.log("[Step 3] 各代理商订单列表");
  for (const agent of agents) {
    const res = await api("GET", `/api/orders?t=${agent.token}&pageSize=20`);
    if (res.status === 200) {
      const items = res.json.items || [];
      const pending = items.filter(o => o.status === "待处理").length;
      log(agent.id, `${agent.name}: ${items.length}单, 待处理=${pending}`);
    }
  }
  console.log();

  // ── Step 4: 确认订单 ──
  console.log("[Step 4] 确认所有订单（生成镜片码+QR）");
  for (const order of results.orders) {
    const agent = agents.find(a => a.id === order.agentId);
    const res = await api("POST", `/api/order/${order.orderNo}/confirm?t=${agent.token}`);
    if (res.status === 200) {
      order.lensCodes = res.json.lensCodes || [];
      results.confirmed++;
      log("", `✅ ${order.orderNo}: 镜片码=${order.lensCodes.join(", ")}`);
    } else {
      log("", `❌ ${order.orderNo} 确认失败: ${JSON.stringify(res.json)}`);
    }
    await delay(200);
  }
  console.log(`  结果: ${results.confirmed}/10 确认成功\n`);

  // ── Step 5: 验证双写 ──
  console.log("[Step 5] 验证双写（订单主表 + 镜片明细表）");
  let lensOk = 0;
  for (const order of results.orders) {
    const agent = agents.find(a => a.id === order.agentId);
    const res = await api("GET", `/api/order/${order.orderNo}?t=${agent.token}`);
    if (res.status === 200) {
      const lenses = res.json.lenses || [];
      const hasLens = lenses.length > 0;
      if (hasLens) lensOk++;
      log("", `${order.orderNo}: 镜片明细=${hasLens ? lenses.length + "条 ✅" : "无 ❌"}`);
      if (hasLens) {
        order.lensDetails = lenses.map(l => `${l.eye} SPH=${l.sph} CYL=${l.cyl} AXIS=${l.axis}`);
      }
    }
  }
  console.log(`  结果: ${lensOk}/10 双写验证通过\n`);

  // ── Step 6: 合单发货 ──
  console.log("[Step 6] 合单发货（按代理商分组）");
  const shipRes = await (async () => {
    // 先查看物流状态
    const statusRes = await api("GET", `/api/admin/orders?admin=`);
    return null;
  })();

  // 用 logistics.js 命令行发货
  const { execSync } = await import("child_process");
  try {
    const shipOutput = execSync("node logistics.js ship-batch", {
      cwd: new URL(".", import.meta.url).pathname.replace(/^\//, ""),
      encoding: "utf-8",
      timeout: 60000,
    });
    log("", shipOutput.trim().split("\n").join("\n  "));
    results.shipped = true;
  } catch (e) {
    log("", "发货输出: " + (e.stdout || e.stderr || e.message));
  }
  console.log();

  // ── Step 7: 签收 ──
  console.log("[Step 7] 签收所有订单");
  for (const order of results.orders) {
    try {
      const deliverOutput = execSync(`node logistics.js deliver --order ${order.orderNo}`, {
        cwd: new URL(".", import.meta.url).pathname.replace(/^\//, ""),
        encoding: "utf-8",
        timeout: 30000,
      });
      if (deliverOutput.includes("已签收")) {
        results.delivered++;
        order.delivered = true;
        log("", `✅ ${order.orderNo} 已签收`);
      } else {
        log("", `⚠️ ${order.orderNo}: ${deliverOutput.trim()}`);
      }
    } catch (e) {
      log("", `❌ ${order.orderNo} 签收失败`);
    }
    await delay(200);
  }
  console.log(`  结果: ${results.delivered}/10 签收成功\n`);

  // ── Step 8: 最终验证 ──
  console.log("[Step 8] 最终状态验证");
  for (const agent of agents) {
    const res = await api("GET", `/api/orders?t=${agent.token}&pageSize=20`);
    if (res.status === 200) {
      const items = res.json.items || [];
      const delivered = items.filter(o => o.status === "已签收").length;
      log(agent.id, `${agent.name}: ${items.length}单, 已签收=${delivered}`);
    }
  }
  console.log();

  // ── 生成报告 ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(60));
  console.log("  E2E 测试报告");
  console.log("═".repeat(60));
  console.log(`\n  测试时间: ${new Date().toLocaleString("zh-CN")}`);
  console.log(`  总耗时: ${elapsed}s\n`);

  console.log("  ┌─────────────────────────────────────────────────────────┐");
  console.log("  │ 阶段                    │ 结果                        │");
  console.log("  ├─────────────────────────────────────────────────────────┤");
  console.log(`  │ 代理商验证（Bitable）    │ ${verified}/${agents.length} ✅                        │`);
  console.log(`  │ 门户下单                │ ${totalSubmitted}/10 ✅                       │`);
  console.log(`  │ 确认（镜片码+QR）        │ ${results.confirmed}/10 ✅                       │`);
  console.log(`  │ 双写验证（主表+明细）     │ ${lensOk}/10 ✅                       │`);
  console.log(`  │ 合单发货                │ ${results.shipped ? "✅" : "❌"}                          │`);
  console.log(`  │ 签收                    │ ${results.delivered}/10 ✅                       │`);
  console.log("  └─────────────────────────────────────────────────────────┘");

  console.log("\n  订单明细:");
  console.log("  ┌────────────────────────┬──────────┬────────────────────┬────────┐");
  console.log("  │ 订单号                  │ 代理商    │ 顾客               │ 状态   │");
  console.log("  ├────────────────────────┼──────────┼────────────────────┼────────┤");
  for (const o of results.orders) {
    const status = o.delivered ? "已签收" : "未签收";
    console.log(`  │ ${o.orderNo.padEnd(22)} │ ${o.agentId.padEnd(8)} │ ${o.customer.padEnd(18)} │ ${status.padEnd(6)} │`);
  }
  console.log("  └────────────────────────┴──────────┴────────────────────┴────────┘");

  console.log("\n  镜片明细:");
  for (const o of results.orders) {
    console.log(`  ${o.orderNo}:`);
    if (o.lensDetails) {
      for (const d of o.lensDetails) console.log(`    - ${d}`);
    }
    if (o.lensCodes) {
      console.log(`    镜片码: ${o.lensCodes.join(", ")}`);
    }
  }

  const allPass = verified === agents.length &&
    totalSubmitted === 10 &&
    results.confirmed === 10 &&
    lensOk === 10 &&
    results.shipped &&
    results.delivered === 10;

  console.log("\n" + "═".repeat(60));
  console.log(`  最终结果: ${allPass ? "✅ 全部通过" : "❌ 部分失败"}`);
  console.log("═".repeat(60) + "\n");
}

main().catch(err => { console.error("💥", err.message, err.stack); process.exit(1); });
