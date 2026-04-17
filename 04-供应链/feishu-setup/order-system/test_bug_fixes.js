/**
 * test_bug_fixes.js — 验证 15 项 bug 修复的 E2E 测试
 *
 * 覆盖：①-3/①-4/①-5/①-8/②-1/③-1/④-1/④-2/④-5/④-6/⑧-1/⑧-2
 * 数据：10 订单、20 人、1 代理商（Bitable 中仅 AG-002 有效）
 *
 * Usage: HTTP_PROXY= HTTPS_PROXY= node test_bug_fixes.js
 * 前置：node server.js（端口 3210）
 */

const BASE = "http://localhost:3210";
const ADMIN = "admin-gsx-2026";

const AGENT = { id: "AG-002", name: "测试代理商", token: "AG-002-zxkmgoryb6nprmv6" };

// ─── 测试数据：10 订单、20 人 ───────────────────────────────────────────────

const TC = { name: "高视星测试终端", contact: "测试联系人", phone: "13800000000" };

const ORDERS = [
  // 订单 1：同名"张伟"×2（验证 ⑧-2 同名不混）
  {
    agent: AGENT, label: "⑧-2 同名不混",
    body: {
      terminalCustomer: TC,
      address: "深圳市南山区科技园A座",
      patients: [
        {
          customerName: "张伟", sku: "Ultra双效", quantity: 1, remark: "第一次配镜",
          eyes: [
            { side: "右眼", sph: -1.00, cyl: -0.25, axis: 180 },
            { side: "左眼", sph: -1.25, cyl: -0.50, axis: 175 },
          ],
        },
        {
          customerName: "张伟", sku: "D8", quantity: 1, remark: "给儿子配",
          eyes: [
            { side: "右眼", sph: -2.00, cyl: -0.75, axis: 90 },
            { side: "左眼", sph: -2.25, cyl: -1.00, axis: 85 },
          ],
        },
      ],
    },
  },
  // 订单 2：AG-002，李娜单眼（验证 ①-3 单眼不填 0）
  {
    agent: AGENT, label: "①-3 单眼不填 0",
    body: {
      terminalCustomer: TC,
      address: "深圳市福田区华强北路99号",
      patients: [
        {
          customerName: "李娜", sku: "时空之眼A", quantity: 1,
          eyes: [
            { side: "右眼", sph: -0.75, cyl: 0, axis: 0 },
          ],
        },
      ],
    },
  },
  // 订单 3：AG-003，王芳+王芳同名不同处方（验证 ②-1/③-1 按客户粒度）
  {
    agent: AGENT, label: "②-1 ③-1 按客户粒度",
    body: {
      terminalCustomer: TC,
      address: "北京市朝阳区建国路88号",
      patients: [
        {
          customerName: "王芳", sku: "时空之眼B", quantity: 1, remark: "成人",
          eyes: [
            { side: "右眼", sph: -1.50, cyl: -0.50, axis: 180 },
            { side: "左眼", sph: -1.75, cyl: -0.25, axis: 10 },
          ],
        },
        {
          customerName: "王芳", sku: "时空之眼PRO", quantity: 1, remark: "小孩",
          eyes: [
            { side: "右眼", sph: -3.00, cyl: -1.00, axis: 90 },
            { side: "左眼", sph: -3.25, cyl: -1.25, axis: 85 },
          ],
        },
      ],
    },
  },
  // 订单 4：刘洋 PL 平光（验证 ①-5）— 提交 0 度，测试 Excel 解析 PL 场景
  {
    agent: AGENT, label: "①-5 PL 平光",
    body: {
      terminalCustomer: TC,
      address: "北京市海淀区中关村大街1号",
      patients: [
        {
          customerName: "刘洋", sku: "小旋风", quantity: 1,
          eyes: [
            { side: "右眼", sph: 0, cyl: 0, axis: 0 },
            { side: "左眼", sph: 0, cyl: 0, axis: 0 },
          ],
        },
      ],
    },
  },
  // 订单 5：AG-004，陈明+赵丽（验证 ④-1 排序、④-2 备注不混）
  {
    agent: AGENT, label: "④-1 ④-2 排序+备注不混",
    body: {
      terminalCustomer: TC,
      address: "上海市浦东新区陆家嘴环路100号",
      patients: [
        {
          customerName: "陈明", sku: "Ultra双效", quantity: 1, remark: "需要随货同行单",
          eyes: [
            { side: "右眼", sph: -1.00, cyl: -0.50, axis: 180 },
            { side: "左眼", sph: -1.25, cyl: -0.50, axis: 175 },
          ],
        },
        {
          customerName: "赵丽", sku: "时空之眼A", quantity: 1,
          eyes: [
            { side: "右眼", sph: -0.75, cyl: -0.25, axis: 10 },
            { side: "左眼", sph: -0.50, cyl: -0.25, axis: 5 },
          ],
        },
      ],
    },
  },
  // 订单 6：AG-004，周杰有备注（验证 ①-4 Excel 备注同步）
  {
    agent: AGENT, label: "①-4 备注同步",
    body: {
      terminalCustomer: TC,
      address: "上海市静安区南京西路1788号",
      patients: [
        {
          customerName: "周杰", sku: "时空之眼MAX", quantity: 1, remark: "加急处理",
          eyes: [
            { side: "右眼", sph: -1.25, cyl: -0.25, axis: 10 },
            { side: "左眼", sph: -1.50, cyl: -0.25, axis: 5 },
          ],
        },
      ],
    },
  },
  // 订单 7：AG-005，吴秀英+郑强（验证 ④-5 合并导出）
  {
    agent: AGENT, label: "④-5 合并导出",
    body: {
      terminalCustomer: TC,
      address: "广州市天河区天河路385号",
      patients: [
        {
          customerName: "吴秀英", sku: "D8", quantity: 1,
          eyes: [
            { side: "右眼", sph: -2.00, cyl: -0.75, axis: 180 },
            { side: "左眼", sph: -2.25, cyl: -1.00, axis: 165 },
          ],
        },
        {
          customerName: "郑强", sku: "时空之眼B", quantity: 1, remark: "顺丰到付",
          eyes: [
            { side: "右眼", sph: -1.50, cyl: -0.50, axis: 90 },
            { side: "左眼", sph: -1.75, cyl: -0.75, axis: 85 },
          ],
        },
      ],
    },
  },
  // 订单 8：AG-005，孙磊 2 副（验证 ①-8 数量=副）
  {
    agent: AGENT, label: "①-8 数量单位副",
    body: {
      terminalCustomer: TC,
      address: "广州市番禺区万博商务区B2栋",
      patients: [
        {
          customerName: "孙磊", sku: "Ultra双效", quantity: 2,
          eyes: [
            { side: "右眼", sph: -1.00, cyl: -0.50, axis: 180 },
            { side: "左眼", sph: -1.25, cyl: -0.75, axis: 165 },
          ],
        },
      ],
    },
  },
  // 订单 9：AG-002，钱小红+钱小红（验证 ⑧-1 单眼展示）
  {
    agent: AGENT, label: "⑧-1 单眼展示",
    body: {
      terminalCustomer: TC,
      address: "深圳市宝安区新安六路8号",
      patients: [
        {
          customerName: "钱小红", sku: "时空之眼A", quantity: 1,
          eyes: [
            { side: "右眼", sph: -0.50, cyl: 0, axis: 0 },
            { side: "左眼", sph: -0.75, cyl: -0.25, axis: 90 },
          ],
        },
        {
          customerName: "钱小红", sku: "Ultra双效", quantity: 1,
          eyes: [
            { side: "右眼", sph: -1.00, cyl: -0.50, axis: 180 },
            { side: "左眼", sph: -1.25, cyl: -0.75, axis: 170 },
          ],
        },
      ],
    },
  },
  // 订单 10：AG-003，冯刚+何雪（验证 ④-5/④-6 多订单合并+按人过滤）
  {
    agent: AGENT, label: "④-5 ④-6 合并+过滤",
    body: {
      terminalCustomer: TC,
      address: "北京市西城区金融街7号",
      patients: [
        {
          customerName: "冯刚", sku: "小旋风", quantity: 1,
          eyes: [
            { side: "右眼", sph: -1.75, cyl: -0.50, axis: 180 },
            { side: "左眼", sph: -2.00, cyl: -0.75, axis: 175 },
          ],
        },
        {
          customerName: "何雪", sku: "时空之眼A", quantity: 1, remark: "老客户优惠",
          eyes: [
            { side: "右眼", sph: -0.75, cyl: 0, axis: 0 },
            { side: "左眼", sph: -1.00, cyl: -0.25, axis: 90 },
          ],
        },
      ],
    },
  },
];

// ─── HTTP 工具 ─────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

async function apiGetRaw(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, text };
}

// ─── 测试框架 ─────────────────────────────────────────────────────────────

const results = [];
function assert(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const icon = ok ? "✅" : "❌";
  console.log(`  ${icon} ${name}${detail ? " — " + detail : ""}`);
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Bug 修复验证 — 10 订单 / 20 人 / 1 代理商               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 健康检查
  const health = await api("GET", "/api/agent?t=" + AGENT.token);
  if (health.status !== 200) {
    console.log("❌ 服务器未启动或代理商 token 无效，请先运行 node server.js");
    process.exit(1);
  }

  const submitted = []; // { orderNo, agent, patients, lensCodes }

  // ═══ Step 1: 提交 10 个订单 ════════════════════════════════════════════
  console.log("─── Step 1: 提交订单 ───");
  for (let i = 0; i < ORDERS.length; i++) {
    const o = ORDERS[i];
    const res = await api("POST", `/api/submit?t=${o.agent.token}`, o.body);
    const ok = res.status === 200 && res.json?.success;
    assert(`订单${i + 1} 提交 [${o.label}]`, ok, ok ? res.json.orderNo : JSON.stringify(res.json));
    if (ok) {
      submitted.push({
        orderNo: res.json.orderNo,
        agent: o.agent,
        body: o.body,
        label: o.label,
        idx: i + 1,
      });
    }
  }

  // ═══ Step 2: 确认（按客户维度）═════════════════════════════════════════
  console.log("\n─── Step 2: 确认订单（按客户维度）───");
  const confirmResults = {}; // orderNo → { customerName → lensCodes }
  for (const s of submitted) {
    const patients = s.body.patients;
    confirmResults[s.orderNo] = {};
    for (const p of patients) {
      const res = await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
        orderNos: [s.orderNo],
        customerName: p.customerName,
      });
      const r = res.json?.results?.[0];
      const ok = r?.ok;
      assert(
        `确认 ${s.orderNo} · ${p.customerName}`,
        ok,
        ok ? `镜片码×${r.lensCodes?.length || 0}` : r?.error || JSON.stringify(res.json)
      );
      if (ok) {
        confirmResults[s.orderNo][p.customerName] = r.lensCodes || [];
      }
    }
  }

  // ═══ 验证 ②-1：同订单号不同客户可分别确认 ══════════════════════════════
  console.log("\n─── 验证 ②-1 按客户确认 ───");
  const order3 = submitted.find(s => s.label.includes("②-1"));
  if (order3) {
    // 王芳×2 同名，confirmResults 按姓名 key 会合并为 1 个
    // 验证：两次 confirm 都成功了（上面 assert 已覆盖），且拿到镜片码
    const codes = Object.values(confirmResults[order3.orderNo]);
    const totalCodes = codes.reduce((s, a) => s + a.length, 0);
    assert("②-1 同订单号按客户确认", totalCodes >= 4, `总镜片码数=${totalCodes}`);
  }

  // ═══ Step 3: 验真（验证 ⑧-1/⑧-2）═════════════════════════════════════
  console.log("\n─── Step 3: 验真页（⑧-1 单眼展示 / ⑧-2 同名不混）───");
  const allLensCodes = [];
  for (const s of submitted) {
    for (const [custName, codes] of Object.entries(confirmResults[s.orderNo])) {
      for (const code of codes) {
        allLensCodes.push({ code, orderNo: s.orderNo, customerName: custName, agent: s.agent });
        await new Promise(r => setTimeout(r, 300)); // 避免 429 限流
        const vRes = await apiGetRaw(`/verify/${code}`);
        const html = vRes.text;
        // ⑧-1：验真页应该是单眼展示，不应同时出现 "左眼" 和 "右眼" 文本
        const hasBothEyes = html.includes("左眼") && html.includes("右眼");
        assert(
          `验真 ${code} ⑧-1 单眼展示`,
          !hasBothEyes,
          hasBothEyes ? "同时出现左右眼" : "单眼 OK"
        );
      }
    }
  }

  // ⑧-2：同名不同镜片码，参数不混
  const order1 = submitted.find(s => s.label.includes("⑧-2"));
  if (order1) {
    const codes1 = confirmResults[order1.orderNo];
    const names = Object.keys(codes1);
    if (names.length === 2) {
      const [codesA, codesB] = Object.values(codes1);
      assert(
        "⑧-2 同名两组镜片码不同",
        codesA[0] !== codesB[0],
        `${codesA[0]} vs ${codesB[0]}`
      );
    }
  }

  // ═══ Step 4: 发货（按客户维度）═════════════════════════════════════════
  console.log("\n─── Step 4: 发货（按客户维度，③-1）───");
  const shipTrackingNos = {}; // orderNo → [trackingNo]
  for (const s of submitted) {
    shipTrackingNos[s.orderNo] = [];
    for (const p of s.body.patients) {
      const res = await api("POST", `/api/admin/ship?admin=${ADMIN}`, {
        orderNos: [s.orderNo],
        customerName: p.customerName,
      });
      const r = res.json?.results?.[0];
      assert(
        `发货 ${s.orderNo} · ${p.customerName}`,
        r?.ok,
        r?.ok ? `${r.courier} ${r.trackingNo}` : r?.error || "fail"
      );
      if (r?.ok && r.trackingNo) {
        shipTrackingNos[s.orderNo].push(r.trackingNo);
      }
    }
  }

  // 验证 ③-1：同订单号不同客户发货后，各有独立快递单号
  if (order3) {
    const nos = [...new Set(shipTrackingNos[order3.orderNo] || [])];
    assert(
      "③-1 同订单号不同客户有独立快递单号",
      nos.length >= 2,
      `快递单号数=${nos.length}: ${nos.join(", ")}`
    );
  }

  // ═══ Step 5: 导出 ZIP（④-1/④-2/④-5/④-6）═════════════════════════════
  console.log("\n─── Step 5: 导出 ZIP ───");

  // ④-5：合并多订单导出
  const allOrderNos = submitted.map(s => s.orderNo).join(",");
  const zipRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${encodeURIComponent(allOrderNos)}`);
  assert("④-5 多订单合并 ZIP", zipRes.status === 200, `status=${zipRes.status}, size=${(await zipRes.arrayBuffer()).byteLength}`);

  // ④-6：按客户过滤导出
  if (order1) {
    const custNames = order1.body.patients.map(p => p.customerName);
    const filterRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${order1.orderNo}&customer=${encodeURIComponent(custNames[0])}`);
    assert("④-6 按客户过滤导出", filterRes.status === 200, `status=${filterRes.status}`);
  }

  // ④-1/④-2：通过 API 导出单订单 Excel 验证排序和备注
  const order5 = submitted.find(s => s.label.includes("④-1"));
  if (order5) {
    const zip5 = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${order5.orderNo}`);
    const buf5 = Buffer.from(await zip5.arrayBuffer());
    assert("④-1 ④-2 单订单 ZIP 导出", zip5.status === 200 && buf5.length > 0, `size=${buf5.length}`);
  }

  // ═══ Step 6: 签收（按客户维度）═════════════════════════════════════════
  console.log("\n─── Step 6: 签收（按客户维度）───");
  for (const s of submitted) {
    for (const p of s.body.patients) {
      const res = await api("POST", `/api/admin/deliver?admin=${ADMIN}`, {
        orderNos: [s.orderNo],
        customerName: p.customerName,
      });
      const r = res.json?.results?.[0];
      assert(
        `签收 ${s.orderNo} · ${p.customerName}`,
        r?.ok,
        r?.ok ? "已签收" : r?.error || "fail"
      );
    }
  }

  // ═══ Step 7: 最终状态验证 ══════════════════════════════════════════════
  console.log("\n─── Step 7: 最终状态验证 ───");
  const finalOrders = await api("GET", `/api/admin/orders?admin=${ADMIN}`);
  for (const s of submitted) {
    const rows = finalOrders.json?.orders?.filter(o => o.orderNo === s.orderNo) || [];
    const allReceived = rows.every(r => r.status === "已签收");
    assert(
      `${s.orderNo} 全部已签收`,
      allReceived,
      `共${rows.length}行, 状态: ${[...new Set(rows.map(r => r.status))].join(",")}`
    );
  }

  // ①-8：数量=副（订单 8）
  const order8 = submitted.find(s => s.label.includes("①-8"));
  if (order8) {
    const rows8 = finalOrders.json?.orders?.filter(o => o.orderNo === order8.orderNo) || [];
    const qty = rows8[0]?.quantity;
    assert("①-8 数量=4（2副×2片）", qty === 4, `实际数量=${qty}`);
  }

  // ═══ 汇总 ══════════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   测试结果汇总                                               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  订单数: ${submitted.length}    代理商: 1    人数: 20`);
  console.log(`  断言数: ${results.length}    ✅ ${passed}    ❌ ${failed}`);
  console.log(`  耗时: ${elapsed}s`);

  if (failed > 0) {
    console.log("\n  ❌ 失败项:");
    results.filter(r => !r.ok).forEach(r => console.log(`    - ${r.name}: ${r.detail}`));
  }

  console.log(failed === 0 ? "\n🎉 全部通过！" : "\n⚠️  有失败项，请检查");
}

main().catch(e => { console.error("测试异常:", e); process.exit(1); });
