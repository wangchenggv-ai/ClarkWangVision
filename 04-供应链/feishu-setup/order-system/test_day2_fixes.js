/**
 * test_day2_fixes.js — Day2 bug 修复验证
 *
 * 覆盖：①-1(PL) / ①-2(联系信息导入) / ①-3(单眼数量) / ②-1(按客户确认)
 *       ④-1(ZIP含Excel) / ④-2(Excel格式) / ④-6(按客户导出)
 *
 * Usage: node test_day2_fixes.js
 * 前置：node server.js（端口 3210）
 */

import { read, utils } from "xlsx";

const BASE = "http://localhost:3210";
const ADMIN = "admin-gsx-2026";
const AGENT = { id: "AG-002", name: "测试代理商", token: "AG-002-zxkmgoryb6nprmv6" };
const TC = { name: "高视星测试终端", contact: "测试联系人", phone: "13800000000" };

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
  console.log("║   Day2 Bug 修复验证 — 7 项                                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 健康检查
  const health = await api("GET", "/api/agent?t=" + AGENT.token);
  if (health.status !== 200) {
    console.log("❌ 服务器未启动或代理商 token 无效");
    process.exit(1);
  }

  // ═══ Bug ①-1: PL 度数识别 ═══════════════════════════════════════════════
  console.log("─── Bug ①-1: PL 度数识别 ───");
  {
    const res = await api("POST", `/api/submit?t=${AGENT.token}`, {
      terminalCustomer: TC,
      address: "测试地址PL",
      patients: [{
        customerName: "PL测试人", sku: "小旋风", quantity: 1,
        eyes: [
          { side: "右眼", sph: "PL", cyl: "PL", axis: 0 },
          { side: "左眼", sph: -1.00, cyl: -0.50, axis: 90 },
        ],
      }],
    });
    const ok = res.status === 200 && res.json?.success;
    assert("①-1 提交 PL 订单", ok, ok ? res.json.orderNo : JSON.stringify(res.json));

    if (ok) {
      const orderNo = res.json.orderNo;
      // 确认后查镜片明细
      await api("POST", `/api/admin/confirm?admin=${ADMIN}`, { orderNos: [orderNo] });
      const detail = await api("GET", `/api/admin/order/${encodeURIComponent(orderNo)}/lens-details?admin=${ADMIN}`);
      const lenses = detail.json?.lenses || [];
      const rightEye = lenses.find(l => l.eye === "右眼");
      const leftEye = lenses.find(l => l.eye === "左眼");

      // PL 应识别为 0 而非 NaN
      assert("①-1 右眼 SPH=0（PL→0）", rightEye && Number(rightEye.sph) === 0, `sph=${rightEye?.sph}`);
      assert("①-1 右眼 CYL=0（PL→0）", rightEye && Number(rightEye.cyl) === 0, `cyl=${rightEye?.cyl}`);
      assert("①-1 左眼 SPH=-1.00", leftEye && Number(leftEye.sph) === -1, `sph=${leftEye?.sph}`);
      assert("①-1 左眼 CYL=-0.50", leftEye && Number(leftEye.cyl) === -0.5, `cyl=${leftEye?.cyl}`);

      // 签收清理
      await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [orderNo] });
    }
  }

  // ═══ Bug ①-2: 联系人/电话/地址导入 ══════════════════════════════════════
  console.log("\n─── Bug ①-2: 联系信息导入 ───");
  {
    // 构造一个简单 Excel base64（含联系人/电话/地址/备注列）
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ["顾客姓名", "眼别", "产品型号", "球镜", "柱镜", "轴位", "数量（副）", "备注", "联系人", "联系电话", "收货地址"],
      ["导入测试A", "右眼", "小旋风", -1.00, -0.25, 180, 1, "加急", "王联系", "13900001111", "深圳市南山区XX路"],
      ["导入测试A", "左眼", "小旋风", -1.25, -0.50, 175, 1, "", "王联系", "13900001111", "深圳市南山区XX路"],
    ]);
    xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    const b64 = Buffer.from(buf).toString("base64");

    const res = await api("POST", `/api/excel-parse?t=${AGENT.token}`, {
      file: { data: b64, name: "test_day2_1_2.xlsx" },
    });

    assert("①-2 excel-parse 返回 200", res.status === 200, `status=${res.status}`);
    const patients = res.json?.patients || [];
    assert("①-2 解析出 1 个患者", patients.length === 1, `count=${patients.length}`);

    // 检查联系信息
    const contact = res.json?.contact || "";
    const phone = res.json?.phone || "";
    const address = res.json?.address || "";
    assert("①-2 联系人='王联系'", contact === "王联系", `contact=${contact}`);
    assert("①-2 电话='13900001111'", phone === "13900001111", `phone=${phone}`);
    assert("①-2 地址='深圳市南山区XX路'", address === "深圳市南山区XX路", `address=${address}`);

    // 检查备注
    const remark = patients[0]?.remark || "";
    assert("①-2 备注='加急'", remark.includes("加急"), `remark=${remark}`);
  }

  // ═══ Bug ①-3: 单眼数量 ══════════════════════════════════════════════════
  console.log("\n─── Bug ①-3: 单眼数量 ───");
  {
    const res = await api("POST", `/api/submit?t=${AGENT.token}`, {
      terminalCustomer: TC,
      address: "测试地址单眼",
      patients: [{
        customerName: "单眼测试人", sku: "时空之眼A", quantity: 1,
        eyes: [{ side: "右眼", sph: -0.75, cyl: 0, axis: 0 }],
      }],
    });
    const ok = res.status === 200 && res.json?.success;
    assert("①-3 提交单眼订单", ok, ok ? res.json.orderNo : JSON.stringify(res.json));

    if (ok) {
      const orderNo = res.json.orderNo;
      const orders = await api("GET", `/api/admin/orders?admin=${ADMIN}&pageSize=100`);
      const row = orders.json?.orders?.find(o => o.orderNo === orderNo);
      const qty = row?.quantity;
      // quantity=1副, 单眼(lensCount=1) → 应为 1 片
      assert("①-3 数量=1（1副×1眼=1片）", qty === 1, `quantity=${qty}`);

      await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [orderNo] });
    }
  }

  // ═══ Bug ②-1: 按客户确认过滤 ═══════════════════════════════════════════
  console.log("\n─── Bug ②-1: 按客户确认 ───");
  {
    // 提交同订单号多客户
    const res = await api("POST", `/api/submit?t=${AGENT.token}`, {
      terminalCustomer: TC,
      address: "测试地址客户过滤",
      patients: [
        {
          customerName: "客户过滤A", sku: "D8", quantity: 1,
          eyes: [{ side: "右眼", sph: -1.00, cyl: -0.25, axis: 90 }],
        },
        {
          customerName: "客户过滤B", sku: "D8", quantity: 1,
          eyes: [{ side: "右眼", sph: -2.00, cyl: -0.50, axis: 180 }],
        },
      ],
    });
    const orderNo = res.json?.orderNo;
    assert("②-1 提交多客户订单", res.json?.success, orderNo || JSON.stringify(res.json));

    if (orderNo) {
      // 只确认客户A
      const cRes = await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
        orderNos: [orderNo], customerName: "客户过滤A",
      });
      const r = cRes.json?.results?.[0];
      assert("②-1 只确认客户A", r?.ok, `codes=${r?.lensCodes?.length}`);

      // 查镜片明细，验证客户A的镜片码已生成
      const detail = await api("GET", `/api/admin/order/${encodeURIComponent(orderNo)}/lens-details?admin=${ADMIN}`);
      const lenses = detail.json?.lenses || [];
      const custA = lenses.filter(l => l.customerName === "客户过滤A");
      const custAHasCodes = custA.every(l => l.lensCode && l.lensCode.length > 0);
      assert("②-1 客户A有镜片码", custAHasCodes, `A lenses=${custA.length}`);

      // 确认客户B后再验证
      await api("POST", `/api/admin/confirm?admin=${ADMIN}`, {
        orderNos: [orderNo], customerName: "客户过滤B",
      });
      const detail2 = await api("GET", `/api/admin/order/${encodeURIComponent(orderNo)}/lens-details?admin=${ADMIN}`);
      const custB2 = detail2.json?.lenses?.filter(l => l.customerName === "客户过滤B") || [];
      const custB2HasCodes = custB2.every(l => l.lensCode && l.lensCode.length > 0);
      assert("②-1 客户B确认后有镜片码", custB2HasCodes);

      await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [orderNo] });
    }
  }

  // ═══ Bug ④-1/④-2: ZIP 含 Excel ══════════════════════════════════════════
  console.log("\n─── Bug ④-1/④-2: ZIP 含 Excel ───");
  {
    // 先提交一个订单并确认
    const res = await api("POST", `/api/submit?t=${AGENT.token}`, {
      terminalCustomer: TC,
      address: "测试地址ZIP",
      patients: [{
        customerName: "ZIP测试人", sku: "Ultra双效", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.00, cyl: -0.50, axis: 180 },
          { side: "左眼", sph: -1.25, cyl: -0.75, axis: 175 },
        ],
      }],
    });
    const orderNo = res.json?.orderNo;
    assert("④-1 提交ZIP测试订单", res.json?.success, orderNo);

    if (orderNo) {
      await api("POST", `/api/admin/confirm?admin=${ADMIN}`, { orderNos: [orderNo] });

      // 导出 ZIP
      const zipRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${encodeURIComponent(orderNo)}`);
      assert("④-1 ZIP 返回 200", zipRes.status === 200, `status=${zipRes.status}`);

      const zipBuf = Buffer.from(await zipRes.arrayBuffer());
      assert("④-1 ZIP 非空", zipBuf.length > 100, `size=${zipBuf.length}`);

      // 解析 ZIP：查找 .xlsx 文件
      // ZIP 中心目录中搜索 .xlsx 签名
      const zipContent = zipBuf.toString("latin1");
      const hasXlsx = zipContent.includes(".xlsx");
      assert("④-1 ZIP 含 .xlsx 文件", hasXlsx);

      // 用 xlsx 库解析 ZIP 中的 Excel（手动提取）
      // 简单验证：ZIP 包含 xlsx 格式的 PK 签名
      const pkCount = (zipBuf.toString("binary").match(/PK/g) || []).length;
      assert("④-2 ZIP 包含多个 PK 条目", pkCount >= 4, `PK count=${pkCount}（期望≥4：local+central+data）`);

      await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [orderNo] });
    }
  }

  // ═══ Bug ④-6: 按客户名导出 ══════════════════════════════════════════════
  console.log("\n─── Bug ④-6: 按客户名导出 ───");
  {
    // 提交同订单号多客户
    const res = await api("POST", `/api/submit?t=${AGENT.token}`, {
      terminalCustomer: TC,
      address: "测试地址客户导出",
      patients: [
        {
          customerName: "导出客户X", sku: "时空之眼A", quantity: 1, remark: "X的备注",
          eyes: [{ side: "右眼", sph: -1.00, cyl: 0, axis: 0 }],
        },
        {
          customerName: "导出客户Y", sku: "时空之眼B", quantity: 1, remark: "Y的备注",
          eyes: [{ side: "右眼", sph: -2.00, cyl: 0, axis: 0 }],
        },
      ],
    });
    const orderNo = res.json?.orderNo;
    assert("④-6 提交多客户订单", res.json?.success, orderNo);

    if (orderNo) {
      await api("POST", `/api/admin/confirm?admin=${ADMIN}`, { orderNos: [orderNo] });

      // 按客户X导出
      const zipRes = await fetch(`${BASE}/api/admin/batch-zip?admin=${ADMIN}&orderNos=${encodeURIComponent(orderNo)}&customer=${encodeURIComponent("导出客户X")}`);
      assert("④-6 按客户导出返回 200", zipRes.status === 200);

      const zipBuf = Buffer.from(await zipRes.arrayBuffer());
      const zipContent = zipBuf.toString("utf8");

      // 验证 ZIP 内容不含客户Y的数据
      // 通过检查标签文件名（labels/文件名含客户名）
      const hasCustomerX = zipContent.includes("导出客户X");
      const hasCustomerY = zipContent.includes("导出客户Y");
      assert("④-6 ZIP 含客户X标签", hasCustomerX);
      assert("④-6 ZIP 不含客户Y标签", !hasCustomerY, hasCustomerY ? "仍包含Y" : "已过滤");

      await api("POST", `/api/admin/deliver?admin=${ADMIN}`, { orderNos: [orderNo] });
    }
  }

  // ═══ 汇总 ══════════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   测试结果汇总                                               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  断言数: ${results.length}    ✅ ${passed}    ❌ ${failed}`);
  console.log(`  耗时: ${elapsed}s`);

  if (failed > 0) {
    console.log("\n  ❌ 失败项:");
    results.filter(r => !r.ok).forEach(r => console.log(`    - ${r.name}: ${r.detail}`));
  }

  console.log(failed === 0 ? "\n🎉 全部通过！" : "\n⚠️  有失败项，请检查");

  // 生成报告
  await generateReport(passed, failed, elapsed);
}

async function generateReport(passed, failed, elapsed) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const lines = [
    `# Day2 Bug 修复测试报告`,
    ``,
    `> 测试时间：${now}`,
    `> 耗时：${elapsed}s`,
    `> 断言数：${results.length}  通过：${passed}  失败：${failed}`,
    ``,
    `## 测试结果`,
    ``,
    `| # | Bug | 测试项 | 结果 | 详情 |`,
    `|---|-----|--------|------|------|`,
  ];

  const bugGroups = {};
  for (const r of results) {
    const match = r.name.match(/^(①-[123]|②-1|④-[126])/);
    const bug = match ? match[0] : "其他";
    if (!bugGroups[bug]) bugGroups[bug] = [];
    bugGroups[bug].push(r);
  }

  let idx = 1;
  for (const [bug, items] of Object.entries(bugGroups)) {
    for (const r of items) {
      lines.push(`| ${idx} | ${bug} | ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.detail} |`);
      idx++;
    }
  }

  lines.push("");
  lines.push(failed === 0 ? "## 结论：全部通过 🎉" : "## 结论：有失败项 ⚠️");
  lines.push("");

  const reportPath = new URL("./docs/day2_test_report.md", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  // decode URI-encoded Chinese characters
  const decodedPath = decodeURIComponent(reportPath);
  const fs = await import("fs");
  fs.writeFileSync(decodedPath, lines.join("\n"), "utf-8");
  console.log(`\n📄 报告已写入: ${decodedPath}`);
}

main().catch(e => { console.error("测试异常:", e); process.exit(1); });
