/**
 * test_slip_e2e.mjs — 随货通行单 E2E 测试
 *
 * 用现有"生产中"订单测试：
 * 1. 单订单通行单（发货1人 → 生成通行单 → PDF）
 * 2. 合单通行单（发货3人同代理商同一快递 → 合单通行单 → PDF）
 * 3. 生成测试报告
 *
 * Usage: no_proxy=localhost node test_slip_e2e.mjs
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync, statSync, readFileSync } from "fs";
import { createConnection } from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3210";
const ADMIN = "admin-gsx-2026";
const ADMIN_TOKEN_PARAM = `admin=${ADMIN}`;

const step = (n, msg) => console.log(`\n${"─".repeat(56)}\n步骤 ${n} — ${msg}\n${"─".repeat(56)}`);
const ok   = (msg) => console.log(`  ✅ ${msg}`);
const info = (msg) => console.log(`  ℹ  ${msg}`);
const err  = (msg) => console.error(`  ✗ ${msg}`);

// ─── 测试用订单 ────────────────────────────────────────────────────────────
// ORD-20260422-80399A7C（AG-026 武汉亿祥昊，多个客户在"生产中"）
// 注意：侴梓铮 在第一轮测试中已发货，第二轮用剩余 3 人

const ORDER_NO = "ORD-20260422-80399A7C";
const SINGLE_CUSTOMER = "侴梓铮";
const BATCH_CUSTOMERS = ["罗绍文", "郭骏腾", "王柳雯"];
const AGENT_ID = "AG-026";
const AGENT_NAME = "武汉亿祥昊医疗有限公司";

// ─── API ───────────────────────────────────────────────────────────────────

function checkPort(port) {
  return new Promise(r => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.setTimeout(2000);
    s.on("connect", () => { s.destroy(); r(true); });
    s.on("error",   () => { s.destroy(); r(false); });
    s.on("timeout", () => { s.destroy(); r(false); });
  });
}

async function api(path, { method = "GET", body } = {}) {
  let url = `${BASE}${path}`;
  if (path.includes("/admin/") && !url.includes("admin=")) {
    url += (url.includes("?") ? "&" : "?") + ADMIN_TOKEN_PARAM;
  }
  const opts = { method, headers: {} };
  if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ─── PDF 生成 ──────────────────────────────────────────────────────────────

async function htmlToPdf(html, outPath) {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
  await page.pdf({
    path: outPath, format: "A4", printBackground: true,
    margin: { top: "5mm", bottom: "5mm", left: "5mm", right: "5mm" },
  });
  await browser.close();
  return (statSync(outPath).size / 1024).toFixed(1);
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

(async () => {
  const startTime = Date.now();
  mkdirSync(resolve(__dirname, "docs"), { recursive: true });

  // 检查服务器
  step(0, "检查服务器");
  if (!await checkPort(3210)) { err("服务器未运行，请先启动 node server.js"); process.exit(1); }
  ok("服务器运行中");

  const reportData = { single: {}, batch: {}, errors: [] };

  // ═══════════════════════════════════════════════════════════════════════
  // Part 1: 单订单随货通行单
  // ═══════════════════════════════════════════════════════════════════════

  step(1, `单订单测试 — 发货 ${SINGLE_CUSTOMER}`);
  const ship1 = await api("/api/admin/ship", {
    method: "POST", body: { orderNos: [ORDER_NO], customerName: SINGLE_CUSTOMER },
  });
  if (!ship1.results?.[0]?.ok) { err(`发货失败: ${JSON.stringify(ship1)}`); process.exit(1); }
  reportData.single.courier = ship1.results[0].courier;
  reportData.single.trackingNo = ship1.results[0].trackingNo;
  ok(`${SINGLE_CUSTOMER} 已发货  快递: ${ship1.results[0].courier}  单号: ${ship1.results[0].trackingNo}`);

  step(2, "单订单测试 — ship-preview 预览");
  const preview = await api(`/api/admin/ship-preview?${ADMIN_TOKEN_PARAM}&orderNos=${ORDER_NO}&customer=${encodeURIComponent(SINGLE_CUSTOMER)}`);
  if (!preview.orders?.length) { err(`预览失败: ${JSON.stringify(preview)}`); process.exit(1); }
  const pv = preview.orders[0];
  reportData.single.rows = pv.rows;
  ok(`预览: ${pv.customerName} | ${pv.rows.length} 片 | ${pv.agentName}`);
  for (const r of pv.rows) info(`  ${r.eye} ${r.sku} SPH=${r.sph} CYL=${r.cyl} AXIS=${r.axis} 码=${r.lensCode}`);

  step(3, "单订单测试 — 生成随货通行单 HTML");
  const singleHtml = await api(`/api/admin/slip/${ORDER_NO}?${ADMIN_TOKEN_PARAM}&customer=${encodeURIComponent(SINGLE_CUSTOMER)}`);
  if (typeof singleHtml !== "string" || singleHtml.length < 100) { err("通行单 HTML 异常"); process.exit(1); }
  writeFileSync(resolve(__dirname, "docs/test-slip-single.html"), singleHtml, "utf-8");
  ok(`HTML: docs/test-slip-single.html (${(singleHtml.length / 1024).toFixed(1)} KB)`);

  const checks1 = {
    orderNo: singleHtml.includes(ORDER_NO),
    customer: pv.rows.some(r => singleHtml.includes(r.lensCode)),
    qr: singleHtml.includes("qr-cell"),
    sph: singleHtml.includes("SPH"),
    brand: singleHtml.includes("GAUSH"),
    printBtn: singleHtml.includes("window.print"),
  };
  reportData.single.checks = checks1;
  info(`内容: 订单号=${checks1.orderNo} 镜片码=${checks1.customer} QR=${checks1.qr} 处方=${checks1.sph} 品牌=${checks1.brand}`);

  step(4, "单订单测试 — 转换 PDF");
  const singlePdfPath = resolve(__dirname, "docs/test-slip-single.pdf");
  try {
    const pdfSize = await htmlToPdf(singleHtml, singlePdfPath);
    reportData.single.pdfSize = pdfSize;
    ok(`PDF: docs/test-slip-single.pdf (${pdfSize} KB)`);
  } catch (e) { err(`PDF 失败: ${e.message}`); reportData.errors.push({ step: "single-pdf", error: e.message }); }

  // ═══════════════════════════════════════════════════════════════════════
  // Part 2: 合单随货通行单（3人同代理商，同一次发货 = 同一快递单号）
  // ═══════════════════════════════════════════════════════════════════════

  step(5, `合单测试 — 批量发货 3 人（同一次调用，共享快递单号）`);
  // 一次 ship 调用处理整个订单，所有客户共享同一个快递单号
  const batchShip = await api("/api/admin/ship", {
    method: "POST", body: { orderNos: [ORDER_NO] },
  });
  const batchShipResults = [];
  if (batchShip.results?.[0]?.ok) {
    batchShipResults.push({ customer: "全部3人", courier: batchShip.results[0].courier, trackingNo: batchShip.results[0].trackingNo });
    ok(`已发货  快递: ${batchShip.results[0].courier}  单号: ${batchShip.results[0].trackingNo}`);
  } else {
    err(`批量发货失败: ${JSON.stringify(batchShip)}`);
    reportData.errors.push({ step: "batch-ship", error: JSON.stringify(batchShip) });
  }

  step(6, "合单测试 — 生成合单随货通行单（按日期查全部）");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const batchHtml = await api(`/api/admin/slip-batch?${ADMIN_TOKEN_PARAM}&date=${today}&agent=${AGENT_ID}`);
  if (typeof batchHtml !== "string" || batchHtml.length < 100) { err("合单通行单异常"); process.exit(1); }

  // 检查是汇总页还是实际通行单
  const isSummaryPage = batchHtml.includes("随货通行单汇总");
  const isActualSlip = batchHtml.includes("合单随货通行单");

  if (isSummaryPage) {
    ok(`返回汇总页 (${(batchHtml.length / 1024).toFixed(1)} KB) — 包含多个快递单号分组`);
    // 提取所有分组链接，逐个获取通行单
    const linkRegex = /href="([^"]*slip-batch[^"]*)"/g;
    const links = [];
    let m;
    while ((m = linkRegex.exec(batchHtml)) !== null) links.push(m[1]);
    info(`发现 ${links.length} 个分组`);

    const allSlipHtmls = [];
    for (const link of links) {
      // 确保链接包含 admin token
      const linkWithToken = link.includes("admin=") ? link : link + (link.includes("?") ? "&" : "?") + ADMIN_TOKEN_PARAM;
      const slipHtml = await api(linkWithToken);
      if (typeof slipHtml === "string" && slipHtml.includes("合单随货通行单")) {
        allSlipHtmls.push(slipHtml);
        ok(`获取分组通行单 (${(slipHtml.length / 1024).toFixed(1)} KB)`);
      }
    }

    // 合并为一个多页 HTML
    if (allSlipHtmls.length > 0) {
      const combinedHtml = allSlipHtmls.join('\n<div style="page-break-before:always"></div>\n');
      writeFileSync(resolve(__dirname, "docs/test-slip-batch.html"), combinedHtml, "utf-8");
      ok(`合并 ${allSlipHtmls.length} 张通行单: docs/test-slip-batch.html`);
      reportData.batch.totalSlips = allSlipHtmls.length;
      reportData.batch.htmlSize = (combinedHtml.length / 1024).toFixed(1);
    }

    // 也保存汇总页
    writeFileSync(resolve(__dirname, "docs/test-slip-summary.html"), batchHtml, "utf-8");
    info(`汇总页: docs/test-slip-summary.html`);
  } else if (isActualSlip) {
    ok(`直接返回通行单 (${(batchHtml.length / 1024).toFixed(1)} KB)`);
    writeFileSync(resolve(__dirname, "docs/test-slip-batch.html"), batchHtml, "utf-8");
    reportData.batch.htmlSize = (batchHtml.length / 1024).toFixed(1);
  }

  // 验证内容
  const batchCombined = readFileSync(resolve(__dirname, "docs/test-slip-batch.html"), "utf-8");
  const batchChecks = {
    agent: batchCombined.includes(AGENT_NAME),
    cust1: batchCombined.includes(BATCH_CUSTOMERS[0]),
    cust2: batchCombined.includes(BATCH_CUSTOMERS[1]),
    cust3: batchCombined.includes(BATCH_CUSTOMERS[2]),
    summary: batchCombined.includes("订单汇总") || batchCombined.includes("处方明细"),
    qr: batchCombined.includes("qr-cell"),
  };
  reportData.batch.checks = batchChecks;
  info(`内容: 代理商=${batchChecks.agent} 顾客B=${batchChecks.cust1} 顾客C=${batchChecks.cust2} 顾客D=${batchChecks.cust3} 明细=${batchChecks.summary}`);

  step(7, "合单测试 — 转换 PDF");
  const batchPdfPath = resolve(__dirname, "docs/test-slip-batch.pdf");
  try {
    const pdfSize = await htmlToPdf(batchCombined, batchPdfPath);
    reportData.batch.pdfSize = pdfSize;
    ok(`PDF: docs/test-slip-batch.pdf (${pdfSize} KB)`);
  } catch (e) { err(`PDF 失败: ${e.message}`); reportData.errors.push({ step: "batch-pdf", error: e.message }); }

  // ═══════════════════════════════════════════════════════════════════════
  // 报告
  // ═══════════════════════════════════════════════════════════════════════

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const allPass = reportData.errors.length === 0;

  const report = `# 随货通行单 E2E 测试报告

**日期：** ${new Date().toLocaleString("zh-CN")}
**耗时：** ${elapsed}s
**结果：** ${allPass ? "✅ 全部通过" : "❌ 有失败项"}
**环境：** 本地 server.js + 测试 Bitable

---

## 测试 1：单订单随货通行单

**订单信息：**

| 项目 | 值 |
|------|-----|
| 订单号 | \`${ORDER_NO}\` |
| 顾客 | ${SINGLE_CUSTOMER} |
| 代理商 | ${AGENT_NAME} (${AGENT_ID}) |
| 快递 | ${reportData.single.courier || "N/A"} |
| 单号 | ${reportData.single.trackingNo || "N/A"} |
| 镜片数 | ${reportData.single.rows?.length || 0} 片 |

**处方明细：**

| 眼别 | SKU | SPH | CYL | AXIS | 镜片码 |
|------|-----|-----|-----|------|--------|
${(reportData.single.rows || []).map(r => `| ${r.eye} | ${r.sku} | ${r.sph} | ${r.cyl} | ${r.axis} | \`${r.lensCode}\` |`).join("\n")}

**内容检查：**

| 检查项 | 结果 |
|--------|------|
| HTML 包含订单号 | ${checks1.orderNo ? "✅" : "❌"} |
| HTML 包含镜片码 | ${checks1.customer ? "✅" : "❌"} |
| HTML 包含 QR 码 | ${checks1.qr ? "✅" : "❌"} |
| HTML 包含处方参数 | ${checks1.sph ? "✅" : "❌"} |
| HTML 包含品牌标识 | ${checks1.brand ? "✅" : "❌"} |
| PDF 生成成功 | ${reportData.single.pdfSize ? "✅" : "❌"} (${reportData.single.pdfSize || "N/A"} KB) |

---

## 测试 2：合单随货通行单（3 单同代理商）

**订单信息：**

| 项目 | 值 |
|------|-----|
| 订单号 | \`${ORDER_NO}\` |
| 顾客 | ${BATCH_CUSTOMERS.join("、")} |
| 代理商 | ${AGENT_NAME} (${AGENT_ID}) |
| 分组数 | ${reportData.batch.totalSlips || 1} 个快递单号 |
| 总镜片数 | ${BATCH_CUSTOMERS.length * 2} 片 |

**发货信息：**

| 项目 | 值 |
|------|-----|
| 快递公司 | ${batchShipResults[0]?.courier || "N/A"} |
| 快递单号 | ${batchShipResults[0]?.trackingNo || "N/A"} |
| 发货方式 | 3人同一次发货，共享快递单号 |

**内容检查：**

| 检查项 | 结果 |
|--------|------|
| HTML 包含代理商名 | ${batchChecks.agent ? "✅" : "❌"} |
| HTML 包含罗绍文 | ${batchChecks.cust1 ? "✅" : "❌"} |
| HTML 包含郭骏腾 | ${batchChecks.cust2 ? "✅" : "❌"} |
| HTML 包含王柳雯 | ${batchChecks.cust3 ? "✅" : "❌"} |
| HTML 包含明细数据 | ${batchChecks.summary ? "✅" : "❌"} |
| HTML 包含 QR 码 | ${batchChecks.qr ? "✅" : "❌"} |
| PDF 生成成功 | ${reportData.batch.pdfSize ? "✅" : "❌"} (${reportData.batch.pdfSize || "N/A"} KB) |

---

## 生成文件

| 文件 | 大小 | 说明 |
|------|------|------|
| \`docs/test-slip-single.html\` | - | 单订单通行单 HTML |
| \`docs/test-slip-single.pdf\` | ${reportData.single.pdfSize || "N/A"} KB | 单订单通行单 PDF |
| \`docs/test-slip-batch.html\` | ${reportData.batch.htmlSize || "N/A"} KB | 合单通行单 HTML |
| \`docs/test-slip-batch.pdf\` | ${reportData.batch.pdfSize || "N/A"} KB | 合单通行单 PDF |
| \`docs/test-slip-summary.html\` | - | 合单汇总页（含多个快递分组） |

${reportData.errors.length > 0 ? `## 失败项\n\n${reportData.errors.map(e => `- **${e.step}:** ${e.error}`).join("\n")}` : ""}
`;

  writeFileSync(resolve(__dirname, "docs/slip_e2e_report.md"), report, "utf-8");

  console.log(`\n${"═".repeat(56)}`);
  console.log(`  随货通行单 E2E ${allPass ? "全部通过 ✅" : "有失败 ❌"}  |  耗时 ${elapsed}s`);
  console.log(`  单订单: test-slip-single.pdf ${reportData.single.pdfSize ? "(" + reportData.single.pdfSize + " KB)" : ""}`);
  console.log(`  合  单: test-slip-batch.pdf ${reportData.batch.pdfSize ? "(" + reportData.batch.pdfSize + " KB)" : ""}`);
  console.log(`  报告: docs/slip_e2e_report.md`);
  console.log(`${"═".repeat(56)}\n`);
})().catch(e => { console.error("✗ 错误:", e.message, e.stack); process.exit(1); });
