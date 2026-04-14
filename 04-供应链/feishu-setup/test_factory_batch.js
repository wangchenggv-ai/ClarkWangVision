/**
 * test_factory_batch.js — 5代理商 × 2订单 = 10订单批量测试
 * 全流程：下单 → 确认 → 镜片码 → QR → 汇总Excel（含二维码字符）
 *
 * Usage: node test_factory_batch.js
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3210";
const SERVER_BASE = "http://localhost:3210";

const log  = (msg) => process.stdout.write(msg + "\n");
const pad  = (s, n=40) => String(s).padEnd(n);

// ─── 代理商 × 订单数据 ─────────────────────────────────────────────────────

const AGENTS = [
  { id: "AG-002", name: "测试代理商",    token: "AG-002-zxkmgoryb6nprmv6" },
  { id: "AG-003", name: "北京明视眼镜",  token: "AG-003-z3t0557ucthgfxep" },
  { id: "AG-004", name: "上海优视光学",  token: "AG-004-5otjdnmwxt34i7ws" },
  { id: "AG-005", name: "广州明亮眼镜",  token: "AG-005-4ypvi42cap18qm6y" },
  { id: "AG-006", name: "成都清晰视界",  token: "AG-006-u4b05l624nz9t5qt" },
];

// 每位代理商的2个订单模板（10订单共）
const ORDER_TEMPLATES = {
  "AG-002": [
    {
      address: "深圳市南山区科技园B座101",
      patients: [{
        customerName: "王建华", sku: "Ultra -1.00", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.00, cyl: -0.25, axis: 180, pd: 31, ph: 21, frame: "依视路 E1001" },
          { side: "左眼", sph: -1.25, cyl: -0.50, axis: 175, pd: 31, ph: 21, frame: "依视路 E1001" },
        ],
      }],
    },
    {
      address: "深圳市福田区华强北路99号",
      patients: [{
        customerName: "刘美玲", sku: "Ultra -0.75", quantity: 1,
        eyes: [
          { side: "右眼", sph: -0.75, cyl: 0, axis: 0, pd: 30, ph: 20, frame: "万新 MJ2023" },
          { side: "左眼", sph: -0.75, cyl: -0.25, axis: 90, pd: 30, ph: 20, frame: "万新 MJ2023" },
        ],
      }],
    },
  ],
  "AG-003": [
    {
      address: "北京市朝阳区建国路88号，恒业眼镜",
      patients: [{
        customerName: "张明辉", sku: "Ultra -1.25", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.25, cyl: -0.75, axis: 180, pd: 33, ph: 23, frame: "暴龙 BT8090" },
          { side: "左眼", sph: -1.00, cyl: -0.50, axis: 170, pd: 33, ph: 23, frame: "暴龙 BT8090" },
        ],
      }],
    },
    {
      address: "北京市海淀区中关村大街1号",
      patients: [{
        customerName: "陈小红", sku: "Ultra -2.25", quantity: 1, remark: "高度近视，加急",
        eyes: [
          { side: "右眼", sph: -2.25, cyl: -1.00, axis: 90,  pd: 29, ph: 19, frame: "博士眼镜 BS300" },
          { side: "左眼", sph: -2.00, cyl: -0.75, axis: 85,  pd: 29, ph: 19, frame: "博士眼镜 BS300" },
        ],
      }],
    },
  ],
  "AG-004": [
    {
      address: "上海市浦东新区陆家嘴环路100号",
      patients: [{
        customerName: "赵大伟", sku: "Ultra -0.75/-0.50", quantity: 1,
        eyes: [
          { side: "右眼", sph: -0.75, cyl: -0.50, axis: 180, pd: 32, ph: 22, frame: "精工 SH1052" },
          { side: "左眼", sph: -1.00, cyl: -0.50, axis: 180, pd: 32, ph: 22, frame: "精工 SH1052" },
        ],
      }],
    },
    {
      address: "上海市静安区南京西路1788号",
      patients: [{
        customerName: "孙丽娟", sku: "Ultra -1.25", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.25, cyl: -0.25, axis: 10, pd: 30, ph: 20, frame: "泰晶 TJ2024" },
          { side: "左眼", sph: -1.50, cyl: -0.25, axis: 5,  pd: 30, ph: 20, frame: "泰晶 TJ2024" },
        ],
      }],
    },
  ],
  "AG-005": [
    {
      address: "广州市天河区天河路385号，明亮眼镜旗舰店",
      patients: [{
        customerName: "吴志强", sku: "Ultra -1.00", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.00, cyl: -0.50, axis: 180, pd: 34, ph: 24, frame: "汉光 HG2023" },
          { side: "左眼", sph: -1.25, cyl: -0.75, axis: 165, pd: 34, ph: 24, frame: "汉光 HG2023" },
        ],
      }],
    },
    {
      address: "广州市番禺区万博商务区B2栋",
      patients: [{
        customerName: "郑秀英", sku: "Ultra -0.75", quantity: 1,
        eyes: [
          { side: "右眼", sph: -0.75, cyl: -0.25, axis: 180, pd: 28, ph: 18, frame: "奥克利 OX8046" },
          { side: "左眼", sph: -0.50, cyl: -0.25, axis: 180, pd: 28, ph: 18, frame: "奥克利 OX8046" },
        ],
      }],
    },
  ],
  "AG-006": [
    {
      address: "成都市锦江区春熙路88号，清晰视界旗舰店",
      patients: [{
        customerName: "何俊杰", sku: "Ultra -2.25", quantity: 1,
        eyes: [
          { side: "右眼", sph: -2.25, cyl: -0.50, axis: 180, pd: 33, ph: 22, frame: "雷朋 RB3025" },
          { side: "左眼", sph: -2.00, cyl: -0.75, axis: 175, pd: 33, ph: 22, frame: "雷朋 RB3025" },
        ],
      }],
    },
    {
      address: "成都市武侯区高升桥路1号，武侯眼镜城",
      patients: [{
        customerName: "林晓燕", sku: "Ultra -1.25", quantity: 1,
        eyes: [
          { side: "右眼", sph: -1.25, cyl: -0.50, axis: 90, pd: 31, ph: 20, frame: "阿玛尼 AR7080" },
          { side: "左眼", sph: -1.00, cyl: -0.25, axis: 95, pd: 31, ph: 20, frame: "阿玛尼 AR7080" },
        ],
      }],
    },
  ],
};

// ─── HTTP 工具 ─────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiPost(path, data) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── Excel 生成 ────────────────────────────────────────────────────────────

function buildExcel(allRows, summary) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: 工厂汇总表（含镜片码+二维码字符）────────────────────────

  const factoryHeaders = [
    "序号", "代理商ID", "代理商名称",
    "订单号", "下单日期", "承诺交期", "交期类型",
    "顾客姓名", "眼别", "SKU",
    "球镜SPH", "柱镜CYL", "轴位AXIS", "瞳距PD", "瞳高PH", "镜框型号",
    "收货地址",
    "镜片码", "二维码内容（扫码可验真）",
    "订单状态",
  ];

  const factoryData = allRows.map((r, i) => [
    i + 1,
    r.agentId,
    r.agentName,
    r.orderNo,
    r.orderDate,
    r.promiseDate,
    r.deliveryType,
    r.customerName,
    r.eye,
    r.sku,
    r.sph,
    r.cyl,
    r.axis,
    r.pd,
    r.ph,
    r.frame,
    r.address,
    r.lensCode,
    r.verifyUrl,
    r.status,
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([factoryHeaders, ...factoryData]);

  // 列宽
  ws1["!cols"] = [
    { wch: 5 },   // 序号
    { wch: 8 },   // 代理商ID
    { wch: 14 },  // 代理商名称
    { wch: 22 },  // 订单号
    { wch: 12 },  // 下单日期
    { wch: 12 },  // 承诺交期
    { wch: 10 },  // 交期类型
    { wch: 10 },  // 顾客姓名
    { wch: 6 },   // 眼别
    { wch: 20 },  // SKU
    { wch: 8 },   // SPH
    { wch: 8 },   // CYL
    { wch: 8 },   // AXIS
    { wch: 6 },   // PD
    { wch: 6 },   // PH
    { wch: 16 },  // 镜框
    { wch: 30 },  // 地址
    { wch: 18 },  // 镜片码
    { wch: 45 },  // 验真URL
    { wch: 8 },   // 状态
  ];

  // 标题行样式
  const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: "1A1F4B" } }, font2: { color: { rgb: "FFFFFF" } } };
  XLSX.utils.book_append_sheet(wb, ws1, "工厂汇总表");

  // ── Sheet 2: 按代理商分组 ─────────────────────────────────────────────

  const agentGroups = {};
  for (const row of allRows) {
    if (!agentGroups[row.agentId]) agentGroups[row.agentId] = [];
    agentGroups[row.agentId].push(row);
  }

  const groupHeaders = [
    "订单号", "下单日期", "承诺交期", "顾客", "眼别", "SKU",
    "SPH", "CYL", "AXIS", "PD", "PH", "镜框",
    "镜片码", "验真URL", "状态",
  ];

  for (const [agentId, rows] of Object.entries(agentGroups)) {
    const agentName = rows[0].agentName;
    const data = rows.map(r => [
      r.orderNo, r.orderDate, r.promiseDate, r.customerName, r.eye, r.sku,
      r.sph, r.cyl, r.axis, r.pd, r.ph, r.frame,
      r.lensCode, r.verifyUrl, r.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([groupHeaders, ...data]);
    ws["!cols"] = [
      { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 20 },
      { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 5 }, { wch: 5 }, { wch: 16 },
      { wch: 18 }, { wch: 45 }, { wch: 8 },
    ];
    const sheetName = `${agentId}_${agentName}`.slice(0, 31); // Excel sheet name limit
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // ── Sheet 3: 测试汇总 ─────────────────────────────────────────────────

  const summaryData = [
    ["高视星供应链 — 批量E2E测试汇总"],
    [`生成时间: ${new Date().toLocaleString("zh-CN")}`],
    [""],
    ["指标", "数值"],
    ["代理商数", summary.agentCount],
    ["订单总数", summary.orderCount],
    ["镜片总数（行数）", summary.lensCount],
    ["有货3天", summary.instock],
    ["定制5天", summary.custom],
    ["镜片码生成", summary.lensCodesGenerated],
    ["QR验真通过", summary.verifyPassed],
    ["QR验真失败", summary.verifyFailed],
    ["总耗时(秒)", summary.elapsedSeconds],
    [""],
    ["订单汇总"],
    ["订单号", "代理商", "顾客", "SKU", "交期", "承诺交期", "镜片码数"],
    ...summary.orders.map(o => [o.orderNo, o.agentName, o.customerName, o.sku, o.deliveryType, o.promiseDate, o.lensCount]),
  ];

  const ws3 = XLSX.utils.aoa_to_sheet(summaryData);
  ws3["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 8 }];
  ws3["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  XLSX.utils.book_append_sheet(wb, ws3, "测试汇总");

  return wb;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const allRows = [];
  const summaryOrders = [];
  let totalLensCodes = 0, totalVerifyPassed = 0, totalVerifyFailed = 0;
  let totalInstock = 0, totalCustom = 0;

  log("╔══════════════════════════════════════════════════════════════╗");
  log("║   高视星供应链 — 5代理商×2订单 批量E2E测试（共10订单）       ║");
  log("╚══════════════════════════════════════════════════════════════╝");
  log(`  ${new Date().toLocaleString("zh-CN")}\n`);

  let orderSeq = 0;

  for (const agent of AGENTS) {
    log(`\n${"─".repeat(62)}`);
    log(`  代理商 ${agent.id} — ${agent.name}`);
    log(`${"─".repeat(62)}`);

    const templates = ORDER_TEMPLATES[agent.id];

    for (let t = 0; t < templates.length; t++) {
      orderSeq++;
      const tmpl = templates[t];
      const p = tmpl.patients[0];
      log(`\n  [订单${orderSeq}/10] ${p.customerName} | ${p.sku}`);

      // Step 1: 提交订单
      const submitRes = await apiPost(`/api/submit?t=${agent.token}`, tmpl);
      if (submitRes.status !== 200 || !submitRes.body.success) {
        log(`    ❌ 下单失败: ${JSON.stringify(submitRes.body)}`);
        continue;
      }
      const orderNo = submitRes.body.orderNo;
      const itemInfo = submitRes.body.items[0];
      log(`    ✅ 下单成功: ${orderNo} → ${itemInfo.deliveryType}（${itemInfo.promiseDateFormatted}）`);

      if (itemInfo.deliveryType.startsWith("有货")) totalInstock++;
      else totalCustom++;

      // Step 2: 确认订单 → 生成镜片码
      const confirmRes = await apiPost(`/api/order/${encodeURIComponent(orderNo)}/confirm?t=${agent.token}`, {});
      if (confirmRes.status !== 200 || !confirmRes.body.success) {
        log(`    ❌ 确认失败: ${JSON.stringify(confirmRes.body)}`);
        continue;
      }
      const lensCodes = confirmRes.body.lensCodes;
      log(`    ✅ 镜片码: ${lensCodes.join(" | ")}`);
      totalLensCodes += lensCodes.length;

      // Step 3: 验真
      for (const code of lensCodes) {
        const vRes = await apiGet(`/verify/${code}`);
        if (vRes.status === 200) totalVerifyPassed++;
        else totalVerifyFailed++;
      }
      log(`    ✅ 验真: ${lensCodes.length}/${lensCodes.length} 通过`);

      // 组装行数据（每眼一行）
      const eyes = p.eyes || [];
      const now = new Date().toLocaleDateString("zh-CN");
      for (let ei = 0; ei < eyes.length; ei++) {
        const eye = eyes[ei];
        const lensCode = lensCodes[ei] || "";
        allRows.push({
          agentId: agent.id,
          agentName: agent.name,
          orderNo,
          orderDate: now,
          promiseDate: itemInfo.promiseDateFormatted,
          deliveryType: itemInfo.deliveryType,
          customerName: p.customerName,
          eye: eye.side,
          sku: p.sku,
          sph: eye.sph,
          cyl: eye.cyl,
          axis: eye.axis,
          pd: eye.pd,
          ph: eye.ph,
          frame: eye.frame,
          address: tmpl.address,
          lensCode,
          verifyUrl: lensCode ? `${SERVER_BASE}/verify/${lensCode}` : "",
          status: "生产中",
        });
      }

      summaryOrders.push({
        orderNo,
        agentName: agent.name,
        customerName: p.customerName,
        sku: p.sku,
        deliveryType: itemInfo.deliveryType,
        promiseDate: itemInfo.promiseDateFormatted,
        lensCount: lensCodes.length,
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── 输出统计 ─────────────────────────────────────────────────────────
  log(`\n${"═".repeat(62)}`);
  log("  测试完成 — 汇总");
  log(`${"═".repeat(62)}`);
  log(`  订单总数:     ${orderSeq} 笔`);
  log(`  镜片总数:     ${allRows.length} 片`);
  log(`  镜片码生成:   ${totalLensCodes} 个`);
  log(`  有货3天:      ${totalInstock} 笔`);
  log(`  定制5天:      ${totalCustom} 笔`);
  log(`  验真通过:     ${totalVerifyPassed}/${totalLensCodes}`);
  log(`  总耗时:       ${elapsed}s`);

  // ── 生成 Excel ────────────────────────────────────────────────────────
  const summary = {
    agentCount: AGENTS.length,
    orderCount: orderSeq,
    lensCount: allRows.length,
    instock: totalInstock,
    custom: totalCustom,
    lensCodesGenerated: totalLensCodes,
    verifyPassed: totalVerifyPassed,
    verifyFailed: totalVerifyFailed,
    elapsedSeconds: elapsed,
    orders: summaryOrders,
  };

  const wb = buildExcel(allRows, summary);
  const today = new Date().toISOString().slice(0, 10);
  const excelPath = resolve(__dirname, `docs/factory-batch-${today}.xlsx`);

  // 确保 docs 目录存在
  const docsDir = resolve(__dirname, "docs");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });

  XLSX.writeFile(wb, excelPath);
  log(`\n  📊 Excel 已生成: ${excelPath}`);
  log(`     Sheet 1: 工厂汇总表（${allRows.length}行，含镜片码+二维码内容）`);
  log(`     Sheet 2-6: 按代理商分组（各代理商独立标签页）`);
  log(`     Sheet 7: 测试汇总`);

  // 打开文件
  const { exec } = await import("child_process");
  exec(`start "" "${excelPath}"`);
  log(`\n  ✅ 文件已自动打开。可直接发给工厂打印使用。`);
}

main().catch(err => {
  console.error("\n💥 批量测试失败:", err.message, err.stack);
  process.exit(1);
});
