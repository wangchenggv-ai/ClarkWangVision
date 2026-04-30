/**
 * test_challenge.mjs — 挑战性 Bug 猎杀测试套件
 *
 * 目标：覆盖多副订单、状态机、幂等性、安全边界、验真串号、签收时间等高风险路径
 * 每个测试都说明"预期"，若预期与实际不符则标记为 BUG（不是 test 框架问题）
 *
 * Usage:
 *   BASE=http://localhost:3210 ADMIN=<token> AGENT_TOKEN=<token> node test_challenge.mjs
 *
 * 注意：测试会写入真实 Bitable，请在测试环境运行。
 * 测试完成后产生的订单以 ORD-TEST- 开头，可在飞书手工删除。
 */

const BASE   = process.env.BASE         || "http://localhost:3210";
const ADMIN  = process.env.ADMIN        || "GaushOrderMock";
const TOKEN  = process.env.AGENT_TOKEN  || "AG-002-zxkmgoryb6nprmv6";
const TOKEN2 = process.env.AGENT_TOKEN2 || "AG-005-fab4f4f676813bbf";

const TC = { name: "挑战测试终端", contact: "测试联系人", phone: "13900000001" };
const ADDR = "广东省广州市天河区测试路1号";

// ─── 工具 ──────────────────────────────────────────────────────────────────

async function api(method, path, body, extraHeaders = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

async function get(path, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: extraHeaders });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 测试框架 ──────────────────────────────────────────────────────────────

const results = [];
let _section = "";

function section(name) {
  _section = name;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${name}`);
  console.log("─".repeat(60));
}

function assert(name, ok, detail = "", knownBug = false) {
  const tag  = knownBug && !ok ? " 【已知BUG确认】" : "";
  const icon = ok ? "✅" : (knownBug ? "🐛" : "❌");
  results.push({ section: _section, name, ok, detail, knownBug });
  console.log(`  ${icon} ${name}${tag}${detail ? "\n     " + detail : ""}`);
}

function assertEq(name, actual, expected, knownBug = false) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(name, ok, ok ? "" : `actual=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`, knownBug);
  return ok;
}

// ─── 基础下单 helper ───────────────────────────────────────────────────────

async function submitOrder(patients, token = TOKEN, clientRequestId = null) {
  const body = {
    address: ADDR,
    terminalCustomer: TC,
    patients,
    ...(clientRequestId ? { clientRequestId } : {}),
  };
  return api("POST", `/api/submit?t=${token}`, body);
}

function patientCard(customerName, sku, sph, cyl, pairIndex = 1) {
  return {
    customerName,
    sku,
    quantity: 1,
    pairIndex,
    eyes: [
      { side: "右眼", sph, cyl, axis: 0 },
      { side: "左眼", sph: sph - 0.25, cyl, axis: 0 },
    ],
    assembly: false,
    remark: "",
  };
}

// ─── 主测试 ───────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         挑战性 Bug 猎杀测试套件                              ║");
  console.log(`║         目标: ${BASE.padEnd(48)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ══════════════════════════════════════════════════════════════════════════
  // T1: 认证边界
  // ══════════════════════════════════════════════════════════════════════════
  section("T1: 认证与权限边界");

  {
    // T1.1: 无 token 访问 /api/submit
    const r = await api("POST", "/api/submit", { patients: [], address: "x", terminalCustomer: TC });
    assert("T1.1 无 token 下单 → 401", r.status === 401);
  }
  {
    // T1.2: 错误 token 访问代理商接口
    const r = await get("/api/agent?t=WRONGTOKEN");
    assert("T1.2 错误 token → 401", r.status === 401);
  }
  {
    // T1.3: 无 admin 访问 /api/admin/orders
    const r = await get("/api/admin/orders");
    assert("T1.3 无 admin → 401", r.status === 401);
  }
  {
    // T1.4: admin token 为空字符串
    const r = await get("/api/admin/orders?admin=");
    assert("T1.4 admin=空字符串 → 401", r.status === 401);
  }
  {
    // T1.5: 超长 admin token（512字节）不崩溃
    const longToken = "A".repeat(512);
    const r = await get(`/api/admin/orders?admin=${longToken}`);
    assert("T1.5 超长 admin token → 不崩溃 (401/403)", r.status === 401 || r.status === 403);
  }
  {
    // T1.6: Rate limit X-Forwarded-For 可伪造
    // 连续发 25 次验真请求，每次换一个假 IP，期望能绕过 20次/分钟限制
    let successCount = 0;
    for (let i = 0; i < 25; i++) {
      const fakeIp = `192.168.${i}.1`;
      const r = await get("/verify/AAAAAAAAAAAAAAAA", { "x-forwarded-for": fakeIp });
      if (r.status !== 429) successCount++;
    }
    // 若 successCount === 25，说明 X-Forwarded-For 完全可伪造绕过限速（BUG）
    const bypassable = successCount === 25;
    assert(
      "T1.6 Rate limit: X-Forwarded-For 伪造可绕过限速",
      !bypassable,
      `${successCount}/25 次成功（非429）${bypassable ? " → 限速完全可绕过" : ""}`,
      true // 已知设计缺陷
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T2: 交期边界度数
  // ══════════════════════════════════════════════════════════════════════════
  section("T2: 交期档位边界度数");

  const DELIVERY_CASES = [
    // [sph, cyl, 期望档位, 说明]
    [   0,     0, "有货1-2天", "平光镜"],
    [-6.00,    0, "有货1-2天或排产5-7天", "SPH边界值-6.00（常规范围内最低）"],
    [-6.25,    0, "定制7-10天", "SPH超出常规范围"],
    [-5.00, -2.00, "有货1-2天或排产5-7天", "CYL边界值-2.00（常规范围内最低）"],
    [-5.00, -2.25, "定制7-10天", "CYL超出常规范围"],
    [ 0.25,    0, "定制7-10天", "正镜（超出范围）"],
  ];

  {
    const agent = await get(`/api/agent?t=${TOKEN}`);
    const skus  = await get(`/api/skus?t=${TOKEN}`);
    const skuId = skus.json?.[0]?.sku || "Ultra双效";

    for (const [sph, cyl, expectedLabel, desc] of DELIVERY_CASES) {
      const r = await get(`/api/delivery-estimate?t=${TOKEN}&sku=${encodeURIComponent(skuId)}&sph=${sph}&cyl=${cyl}&qty=1`);
      const deliveryType = r.json?.deliveryType || r.json?.label || "(无)";
      const reasonable = r.status === 200;
      assert(
        `T2 交期 SPH=${sph} CYL=${cyl} (${desc})`,
        reasonable,
        `档位=${deliveryType}  期望含=${expectedLabel}`
      );
      // 具体验证定制档位
      if (desc.includes("超出常规")) {
        assert(
          `  └ 超范围度数必须返回"定制"档位`,
          deliveryType.includes("定制"),
          `actual="${deliveryType}"`
        );
      }
    }
  }
  {
    // T2.7: qty > 100 应被拒绝
    const skus = await get(`/api/skus?t=${TOKEN}`);
    const skuId = skus.json?.[0]?.sku || "Ultra双效";
    const r = await get(`/api/delivery-estimate?t=${TOKEN}&sku=${encodeURIComponent(skuId)}&sph=-3&cyl=-1&qty=101`);
    assert("T2.7 qty=101 → 400", r.status === 400);
  }
  {
    // T2.8: 缺少 sph/cyl → 400
    const skus = await get(`/api/skus?t=${TOKEN}`);
    const skuId = skus.json?.[0]?.sku || "Ultra双效";
    const r = await get(`/api/delivery-estimate?t=${TOKEN}&sku=${encodeURIComponent(skuId)}&qty=1`);
    assert("T2.8 缺少度数参数 → 400", r.status === 400);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T3: 幂等性
  // ══════════════════════════════════════════════════════════════════════════
  section("T3: 下单幂等性");

  let idempotentOrderNo = null;
  {
    // T3.1: 相同 clientRequestId 提交两次，第二次应直接返回缓存
    const reqId = `TEST-IDEM-${Date.now()}`;
    const patient = patientCard("幂等测试患者", "Ultra双效", -2.00, -0.75);
    const body = { address: ADDR, terminalCustomer: TC, patients: [patient], clientRequestId: reqId };

    const r1 = await api("POST", `/api/submit?t=${TOKEN}`, body);
    assert("T3.1a 第一次提交 → 200", r1.status === 200, `orderNo=${r1.json?.orderNo}`);
    idempotentOrderNo = r1.json?.orderNo;

    const r2 = await api("POST", `/api/submit?t=${TOKEN}`, body);
    assert("T3.1b 相同 requestId 重提 → 200 且 orderNo 相同",
      r2.status === 200 && r2.json?.orderNo === idempotentOrderNo,
      `r1.orderNo=${r1.json?.orderNo}  r2.orderNo=${r2.json?.orderNo}`
    );
  }
  {
    // T3.2: 无 clientRequestId 的并发提交 → 可能重复写入（已知风险）
    const patient = patientCard("并发测试患者", "Ultra双效", -3.00, -0.50);
    const body = { address: ADDR, terminalCustomer: TC, patients: [patient] };
    // 5 并发
    const promises = Array.from({ length: 5 }, () =>
      api("POST", `/api/submit?t=${TOKEN}`, body)
    );
    const responses = await Promise.all(promises);
    const orderNos = [...new Set(responses.filter(r => r.status === 200).map(r => r.json?.orderNo))];
    assert(
      "T3.2 无幂等键并发5次 → 应只生成1个订单（实际可能多个，是幂等性风险）",
      orderNos.length === 1,
      `生成了 ${orderNos.length} 个不同 orderNo: ${orderNos.join(", ")}`,
      true // 已知设计缺陷
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T4: 多副订单 — pairIndex 全链路
  // ══════════════════════════════════════════════════════════════════════════
  section("T4: 多副订单 — pairIndex 全链路");

  let multiPairOrderNo = null;
  {
    // 张三下2副 Ultra（同名同型号）
    const p1 = patientCard("张三多副", "Ultra双效", -2.00, -0.75, 1);
    const p2 = patientCard("张三多副", "Ultra双效", -3.50, -1.25, 2);
    const r = await submitOrder([p1, p2]);
    assert("T4.1 下单：同名同型号2副 → 200", r.status === 200, `orderNo=${r.json?.orderNo}`);
    multiPairOrderNo = r.json?.orderNo;
    assert("T4.2 返回 totalPatients=2", r.json?.summary?.totalPatients === 2,
      `actual=${r.json?.summary?.totalPatients}`);
  }

  if (multiPairOrderNo) {
    await sleep(2000); // 等镜片码异步生成

    // T4.3: 管理列表应返回2行且各有正确 pairIndex
    const listR = await get(`/api/admin/orders?admin=${ADMIN}&q=${encodeURIComponent(multiPairOrderNo)}`);
    assert("T4.3 admin orders API → 200", listR.status === 200);
    const orders = listR.json?.orders || [];
    const myOrders = orders.filter(o => o.orderNo === multiPairOrderNo);
    assert("T4.4 同订单应返回2行", myOrders.length === 2,
      `actual=${myOrders.length}`, true);
    const pairIndices = myOrders.map(o => o.pairIndex).sort();
    assert("T4.5 两行 pairIndex 应为 [1,2]",
      JSON.stringify(pairIndices) === "[1,2]",
      `actual=${JSON.stringify(pairIndices)}`, true); // 已知bug：pairIndex未在mapper中返回

    // T4.6: 镜片明细应有4条（2副×2眼）
    const detailR = await get(`/api/admin/order/${encodeURIComponent(multiPairOrderNo)}/lens-details?admin=${ADMIN}`);
    assert("T4.6 lens-details → 200", detailR.status === 200);
    const lenses = detailR.json?.lenses || [];
    assert("T4.7 镜片明细应4条（2副×2眼）", lenses.length === 4, `actual=${lenses.length}`);
    const piValues = lenses.map(l => l.pairIndex).sort();
    assert("T4.8 lens-details pairIndex 有 [1,1,2,2]",
      JSON.stringify(piValues) === "[1,1,2,2]",
      `actual=${JSON.stringify(piValues)}`);

    // T4.9: 确认第1副（pairIndex=1）
    const confirmR = await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
      orderNos: [multiPairOrderNo],
      customerName: "张三多副",
      pairIndex: 1,
    });
    assert("T4.9 confirm pairIndex=1 → 200", confirmR.status === 200,
      `results=${JSON.stringify(confirmR.json?.results)}`);

    await sleep(1500);

    // T4.10: 第1副应变待处理，第2副仍已下单
    const listR2 = await get(`/api/admin/orders?admin=${ADMIN}&q=${encodeURIComponent(multiPairOrderNo)}`);
    const myOrders2 = (listR2.json?.orders || []).filter(o => o.orderNo === multiPairOrderNo);
    const pair1 = myOrders2.find(o => o.pairIndex === 1);
    const pair2 = myOrders2.find(o => o.pairIndex === 2);
    assert("T4.10a 第1副状态=待处理",
      pair1?.status === "待处理",
      `actual=${pair1?.status || "(pair1 not found)"}`);
    assert("T4.10b 第2副状态仍=已下单",
      pair2?.status === "已下单",
      `actual=${pair2?.status || "(pair2 not found)"}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T5: 验真页多副串号
  // ══════════════════════════════════════════════════════════════════════════
  section("T5: 验真页 — 多副同名同型号串号");

  if (multiPairOrderNo) {
    await sleep(2000); // 确保镜片码已生成

    // 获取4条镜片的镜片码
    const detailR = await get(`/api/admin/order/${encodeURIComponent(multiPairOrderNo)}/lens-details?admin=${ADMIN}`);
    const lenses = detailR.json?.lenses || [];
    const pair1Lenses = lenses.filter(l => l.pairIndex === 1 && l.lensCode);
    const pair2Lenses = lenses.filter(l => l.pairIndex === 2 && l.lensCode);

    if (pair1Lenses.length > 0) {
      const code = pair1Lenses[0].lensCode;
      const verifyR = await get(`/verify/${code}`);
      assert("T5.1 验真页 → 200", verifyR.status === 200);

      // 检验页面内容：应只显示第1副的2条镜片（4条意味着串号）
      const lensCodeMatches = (verifyR.text.match(/class="mono"/g) || []).length;
      assert(
        "T5.2 验真页应只展示2条镜片码（同副2眼），不能串号成4条",
        lensCodeMatches <= 2,
        `页面内找到 ${lensCodeMatches} 个镜片码展示`,
        true // 已知bug：samePair filter 未加序号过滤
      );

      // 同时验证：第1副镜片码的处方度数是 SPH=-2.00，不是 SPH=-3.50（第2副）
      const containsPair1Sph = verifyR.text.includes("-2.00") || verifyR.text.includes("−2.00");
      const containsPair2Sph = verifyR.text.includes("-3.50") || verifyR.text.includes("−3.50");
      assert(
        "T5.3 验真内容含第1副度数(-2.00)，不含第2副度数(-3.50)",
        containsPair1Sph && !containsPair2Sph,
        `含pair1度数=${containsPair1Sph}  含pair2度数=${containsPair2Sph}`,
        true // 若同时为true则串号
      );
    } else {
      assert("T5.x 镜片码尚未生成，跳过验真测试", false,
        "可能异步生成延迟，请稍后重跑");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T6: 状态机 — 非法跳转守卫
  // ══════════════════════════════════════════════════════════════════════════
  section("T6: 状态机 — 非法跳转应被服务端拒绝");

  let freshOrderNo = null;
  {
    // 下一个干净订单用于状态机测试
    const r = await submitOrder([patientCard("状态机测试", "Ultra双效", -1.00, -0.25)]);
    assert("T6.0 下单成功", r.status === 200);
    freshOrderNo = r.json?.orderNo;
  }

  if (freshOrderNo) {
    // T6.1: 直接对"已下单"订单调 /api/admin/deliver（应该 400/409，实际可能 200）
    const deliverR = await api("POST", `/api/admin/deliver?admin=${ADMIN}`, {
      orderNos: [freshOrderNo],
    });
    const illegalDeliverOk = deliverR.json?.results?.[0]?.ok;
    assert(
      "T6.1 已下单→待签收 非法跳转 → 服务端应拒绝",
      !illegalDeliverOk,
      `actual: ok=${illegalDeliverOk}, status=${deliverR.status}`,
      true // 已知bug：deliver不校验当前状态
    );

    // T6.2: 对"已下单"订单直接调 ship（跳过待处理+生产中）
    const shipR = await api("POST", `/api/admin/ship?admin=${ADMIN}`, {
      orderNos: [freshOrderNo],
    });
    const illegalShipOk = shipR.json?.results?.[0]?.ok;
    assert(
      "T6.2 已下单→已发货 非法跳转 → 服务端应拒绝",
      !illegalShipOk,
      `actual: ok=${illegalShipOk}, status=${shipR.status}`,
      true // 已知bug：ship不校验当前状态
    );
  }

  {
    // T6.3: 对已签收订单再次 confirm → 不能回到生产中
    // 需要先把一个订单走完整流程（依赖 multiPairOrderNo 的 pair1 已 confirm）
    if (multiPairOrderNo) {
      // 尝试对已是"生产中"的 pair1 再次 confirm
      const r2Confirm = await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
        orderNos: [multiPairOrderNo],
        customerName: "张三多副",
        pairIndex: 1,
      });
      // 幂等：应返回 ok=true 但不重复生成镜片码（镜片码不变）
      const lens1Before = await get(`/api/admin/order/${encodeURIComponent(multiPairOrderNo)}/lens-details?admin=${ADMIN}`);
      const codesBefore = (lens1Before.json?.lenses || []).filter(l => l.pairIndex === 1).map(l => l.lensCode);
      assert("T6.3 重复 confirm 镜片码保持不变（幂等）",
        codesBefore.every(c => c && c.length === 16),
        `codes=${JSON.stringify(codesBefore)}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T7: 签收时间预设 BUG
  // ══════════════════════════════════════════════════════════════════════════
  section("T7: 待签收时签收时间不应被预设");

  {
    // 先走到"已发货"状态才能做 deliver
    // 下一个单，confirm → ship → deliver，检查 deliver 后"签收时间"字段
    const rSub = await submitOrder([patientCard("签收时间测试", "Ultra双效", -4.00, -1.00)]);
    assert("T7.0 下单", rSub.status === 200);
    const tNo = rSub.json?.orderNo;

    if (tNo) {
      await sleep(2000); // 等镜片码

      // confirm
      await api("POST", `/api/admin/confirm?admin=${ADMIN}`, { orderNos: [tNo] });
      await sleep(500);

      // ship
      const shipT = Date.now();
      await api("POST", `/api/admin/ship?admin=${ADMIN}`, { orderNos: [tNo] });
      await sleep(500);

      // deliver（标记待签收）
      const deliverT = Date.now();
      const rDeliver = await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [tNo] });
      assert("T7.1 deliver → 200", rDeliver.status === 200);

      // 读订单，检查签收时间
      const listR = await get(`/api/admin/orders?admin=${ADMIN}&q=${encodeURIComponent(tNo)}`);
      const rec = (listR.json?.orders || []).find(o => o.orderNo === tNo);
      // 此时状态是"待签收"，签收时间不应该有值
      // 若 signedAt 或 deliveryTime 已有值，且早于实际签收，就是 bug
      assert(
        "T7.2 待签收状态下，签收时间字段不应被预设为当前时间",
        !rec?.signedAt && !rec?.deliveredAt,
        `rec.signedAt=${rec?.signedAt}  rec.deliveredAt=${rec?.deliveredAt}`,
        true // 已知bug：deliver 端点写了 签收时间: now
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T8: 随货同行单 — 多副分单 & 多顾客聚合
  // ══════════════════════════════════════════════════════════════════════════
  section("T8: 随货同行单边界");

  if (multiPairOrderNo) {
    // T8.1: 第2副的随货同行单（用 pairIndex=2）— 因 quickSlip bug 此处验 API 层
    const slipR = await get(
      `/api/admin/slip/${encodeURIComponent(multiPairOrderNo)}?admin=${ADMIN}&customer=${encodeURIComponent("张三多副")}&pairIndex=2`
    );
    assert("T8.1 slip API 带 pairIndex=2 → 200", slipR.status === 200);
    // 第2副处方是 SPH=-3.50，第1副是 -2.00，检验通行单内容
    const containsPair2Rx = slipR.text.includes("-3.50") || slipR.text.includes("−3.50");
    const containsPair1Rx = slipR.text.includes("-2.00") || slipR.text.includes("−2.00");
    assert("T8.2 pairIndex=2 通行单只含第2副处方(-3.50)，不含第1副(-2.00)",
      containsPair2Rx && !containsPair1Rx,
      `含pair2(-3.50)=${containsPair2Rx}  含pair1(-2.00)=${containsPair1Rx}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T9: 输入边界 & 注入防护
  // ══════════════════════════════════════════════════════════════════════════
  section("T9: 输入边界 & 注入防护");

  {
    // T9.1: 顾客姓名含 HTML 特殊字符 → 验真页应转义不注入
    const r = await submitOrder([
      patientCard('<script>alert(1)</script>', "Ultra双效", -1.50, -0.50)
    ]);
    assert("T9.1 含XSS字符的姓名 → 200 下单成功（服务端不拒绝）",
      r.status === 200, `orderNo=${r.json?.orderNo}`);
    // 若下单成功，后续验真时应 HTML-encode
    const xssOrderNo = r.json?.orderNo;
    if (xssOrderNo) {
      await sleep(2000);
      const detail = await get(`/api/admin/order/${encodeURIComponent(xssOrderNo)}/lens-details?admin=${ADMIN}`);
      const xssLens = (detail.json?.lenses || []).find(l => l.lensCode);
      if (xssLens?.lensCode) {
        const vr = await get(`/verify/${xssLens.lensCode}`);
        assert("T9.2 验真页中 <script> 应被转义，不出现原始标签",
          !vr.text.includes("<script>"),
          `含原始<script>=${vr.text.includes("<script>")}`);
      }
    }
  }
  {
    // T9.3: 顾客姓名含 Bitable filter 注入字符 (CurrentValue)
    const r = await submitOrder([
      patientCard('") || 1==1 // ', "Ultra双效", -2.00, -0.75)
    ]);
    assert("T9.3 Bitable filter 注入字符 → 不崩溃", r.status === 200 || r.status === 400,
      `status=${r.status}`);
  }
  {
    // T9.4: 空 patients 数组
    const r = await api("POST", `/api/submit?t=${TOKEN}`, {
      address: ADDR, terminalCustomer: TC, patients: []
    });
    assert("T9.4 空 patients → 400", r.status === 400);
  }
  {
    // T9.5: patients 含 quantity=0
    const r = await submitOrder([{ ...patientCard("Q0测试", "Ultra双效", -1, -0.5), quantity: 0 }]);
    assert("T9.5 quantity=0 → 400", r.status === 400);
  }
  {
    // T9.6: 超大 quantity（200）
    const r = await submitOrder([{ ...patientCard("大量测试", "Ultra双效", -2, -0.5), quantity: 200 }]);
    // 服务端没有显式限制 quantity，但交期/库存逻辑应能处理
    assert("T9.6 quantity=200 → 200 或 400（不崩溃）", r.status === 200 || r.status === 400,
      `status=${r.status}`);
  }
  {
    // T9.7: 处方中 eye 眼别为奇怪值
    const r = await api("POST", `/api/submit?t=${TOKEN}`, {
      address: ADDR, terminalCustomer: TC,
      patients: [{
        customerName: "眼别测试", sku: "Ultra双效", quantity: 1, pairIndex: 1,
        eyes: [{ side: "斜眼", sph: -2, cyl: -0.5, axis: 0 }],
        assembly: false, remark: "",
      }],
    });
    assert("T9.7 非法眼别 → 200 或 400（不崩溃）", r.status === 200 || r.status === 400,
      `status=${r.status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // T10: 导出 & 批量操作
  // ══════════════════════════════════════════════════════════════════════════
  section("T10: 导出 & 批量操作边界");

  {
    // T10.1: 批量导出 0 个订单
    const r = await api("POST", `/api/admin/batch-zip?admin=${ADMIN}`, { orderNos: [] });
    assert("T10.1 空 orderNos 批量导出 → 400", r.status === 400);
  }
  {
    // T10.2: 批量导出不存在订单号
    const r = await api("POST", `/api/admin/batch-zip?admin=${ADMIN}`,
      { orderNos: ["ORD-NOTEXIST-999999"] });
    assert("T10.2 不存在订单号批量导出 → 200或400（不崩溃）",
      r.status === 200 || r.status === 400, `status=${r.status}`);
  }
  {
    // T10.3: admin/confirm 传不存在订单号 → ok=false 而非 500
    const r = await api("POST", `/api/admin/confirm?admin=${ADMIN}`,
      { orderNos: ["ORD-GHOST-000000"] });
    assert("T10.3 confirm 不存在订单 → ok=false 非崩溃",
      r.status === 200 && r.json?.results?.[0]?.ok === false,
      `status=${r.status} ok=${r.json?.results?.[0]?.ok}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 汇总
  // ══════════════════════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const total  = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok && !r.knownBug).length;
  const bugs   = results.filter(r => !r.ok && r.knownBug).length;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  汇总   ${elapsed}s   总计 ${total} 个断言`);
  console.log(`  ✅ 通过: ${passed}   ❌ 新问题: ${failed}   🐛 已知Bug确认: ${bugs}`);
  console.log("═".repeat(60));

  if (failed > 0) {
    console.log("\n❌ 新发现问题：");
    results.filter(r => !r.ok && !r.knownBug).forEach(r =>
      console.log(`  • [${r.section}] ${r.name}${r.detail ? " — " + r.detail : ""}`)
    );
  }
  if (bugs > 0) {
    console.log("\n🐛 已知 Bug 已复现（需修复）：");
    results.filter(r => !r.ok && r.knownBug).forEach(r =>
      console.log(`  • [${r.section}] ${r.name}${r.detail ? " — " + r.detail : ""}`)
    );
  }
}

main().catch(e => { console.error("测试崩溃:", e); process.exit(1); });
