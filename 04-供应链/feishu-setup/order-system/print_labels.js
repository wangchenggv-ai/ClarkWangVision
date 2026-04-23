/**
 * print_labels.js — 眼镜镜片专业标签生成器
 *
 * 标签规格：75mm × 40mm
 * 内容：品牌 / 眼别 / 顾客 / 处方参数 / SKU / 代理商 / 交期 / 镜片码 / QR码
 * 输出：
 *   docs/labels-YYYY-MM-DD.html   — A4批量打印版（每页6张标签）
 *   docs/labels-YYYY-MM-DD-single/ — 单张标签HTML（可单独打印）
 *
 * Usage:
 *   node print_labels.js                  # 从飞书拉今日有镜片码的订单
 *   node print_labels.js --demo           # 用演示数据（不需要联网）
 *   node print_labels.js --order ORD-xxx  # 指定订单号
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARGS       = process.argv.slice(2);
const DEMO_MODE  = ARGS.includes("--demo");
const ORDER_NO   = ARGS[ARGS.indexOf("--order") + 1] || null;
const BASE       = "https://open.feishu.cn/open-apis";
const APP_TOKEN  = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TBL  = "tblk9Ch4gk2uQ1zG";
const SERVER_BASE = process.env.SERVER_BASE_URL || "http://192.168.0.84:3210";

// ─── 飞书认证 ───────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const env = {};
    for (const line of readFileSync(resolve(__dirname, ".env"), "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      env[k.trim()] = v.join("=").trim();
    }
    return env;
  } catch { return {}; }
}
const ENV = loadEnv();

let _token = "", _tokenTime = 0;
async function getToken() {
  if (Date.now() - _tokenTime < 7000000 && _token) return _token;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  _token = (await r.json()).tenant_access_token;
  _tokenTime = Date.now();
  return _token;
}

async function feishuGet(path) {
  const tk = await getToken();
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tk}` } });
  const j = await r.json();
  return j.code === 0 ? j.data : null;
}

// ─── 从飞书拉数据 ──────────────────────────────────────────────────────────

async function fetchLensRecords(filterOrderNo) {
  console.log("  正在从飞书拉取订单数据...");
  const records = [];
  let pageToken = "";

  // 过滤：镜片码不为空（已确认的订单）
  const filterParam = filterOrderNo
    ? `&filter=CurrentValue.[订单编号]="${filterOrderNo}"`
    : `&filter=CurrentValue.[镜片码]!=""`;

  while (true) {
    const qs = `?page_size=100${filterParam}${pageToken ? "&page_token=" + pageToken : ""}`;
    const data = await feishuGet(`/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records${qs}`);
    if (!data) break;
    records.push(...(data.items || []));
    if (!data.has_more) break;
    pageToken = data.page_token;
  }

  return records.map(r => {
    const f = r.fields;
    const rawVal = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");
    return {
      orderNo:      rawVal(f["订单编号"]) || "",
      customerName: rawVal(f["顾客姓名"])   || "",
      sku:          rawVal(f["产品型号"])         || "",
      eye:          rawVal(f["眼别"])        || "",
      sph:          f["球镜SPH"]  ?? "",
      cyl:          f["柱镜CYL"]  ?? "",
      axis:         f["轴位AXIS"] ?? "",
      pd:           f["瞳距"]     ?? "",
      ph:           f["瞳高"]     ?? "",
      frame:        rawVal(f["镜框型号"])    || "",
      promiseDate:  f["预计交期"] ? new Date(f["预计交期"]).toLocaleDateString("zh-CN") : "",
      agentName:    rawVal(f["代理商名称"]) || "",
      agentId:      rawVal(f["代理商ID"])   || "",
      lensCode:     rawVal(f["镜片码"])     || "",
      orderDate:    f["下单日期"] ? new Date(f["下单日期"]).toLocaleDateString("zh-CN") : "",
      address:      rawVal(f["收货地址"])   || "",
      remark:       rawVal(f["备注"])       || "",
    };
  }).filter(r => r.lensCode);
}

// ─── 演示数据 ──────────────────────────────────────────────────────────────

function demoRecords() {
  const today = new Date().toLocaleDateString("zh-CN");
  const base = [
    { customerName: "王建华", sku: "Ultra -1.00",      eye: "右眼", sph: -1.00, cyl: -0.25, axis: 180, pd: 31, ph: 21, frame: "依视路 E1001",   agentName: "测试代理商",   agentId: "AG-002", orderNo: "ORD-20260413-WQCO2V", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "480605A8612DD33C" },
    { customerName: "王建华", sku: "Ultra -1.00",      eye: "左眼", sph: -1.25, cyl: -0.50, axis: 175, pd: 31, ph: 21, frame: "依视路 E1001",   agentName: "测试代理商",   agentId: "AG-002", orderNo: "ORD-20260413-WQCO2V", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "D2D224BA9F9F915B" },
    { customerName: "张明辉", sku: "Ultra -1.25",      eye: "右眼", sph: -1.25, cyl: -0.75, axis: 180, pd: 33, ph: 23, frame: "暴龙 BT8090",    agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-SUNI3I", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "160B6789E499033F" },
    { customerName: "张明辉", sku: "Ultra -1.25",      eye: "左眼", sph: -1.00, cyl: -0.50, axis: 170, pd: 33, ph: 23, frame: "暴龙 BT8090",    agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-SUNI3I", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "0076435A29F44384" },
    { customerName: "陈小红", sku: "Ultra -2.25",      eye: "右眼", sph: -2.25, cyl: -1.00, axis: 90,  pd: 29, ph: 19, frame: "博士眼镜 BS300", agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-4CMVHS", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "189485853FE409E9", remark: "高度近视，加急" },
    { customerName: "陈小红", sku: "Ultra -2.25",      eye: "左眼", sph: -2.00, cyl: -0.75, axis: 85,  pd: 29, ph: 19, frame: "博士眼镜 BS300", agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-4CMVHS", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "EDA1E5B713BEF1C7", remark: "高度近视，加急" },
    { customerName: "赵大伟", sku: "Ultra -0.75/-0.50",eye: "右眼", sph: -0.75, cyl: -0.50, axis: 180, pd: 32, ph: 22, frame: "精工 SH1052",   agentName: "上海优视光学", agentId: "AG-004", orderNo: "ORD-20260413-EVXU56", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "06B3315D1D16E53D" },
    { customerName: "赵大伟", sku: "Ultra -0.75/-0.50",eye: "左眼", sph: -1.00, cyl: -0.50, axis: 180, pd: 32, ph: 22, frame: "精工 SH1052",   agentName: "上海优视光学", agentId: "AG-004", orderNo: "ORD-20260413-EVXU56", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "0677EB963BD15226" },
    { customerName: "吴志强", sku: "Ultra -1.00",      eye: "右眼", sph: -1.00, cyl: -0.50, axis: 180, pd: 34, ph: 24, frame: "汉光 HG2023",   agentName: "广州明亮眼镜", agentId: "AG-005", orderNo: "ORD-20260413-CHM2DM", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "1EC60A2E60A376BA" },
    { customerName: "何俊杰", sku: "Ultra -2.25",      eye: "右眼", sph: -2.25, cyl: -0.50, axis: 180, pd: 33, ph: 22, frame: "雷朋 RB3025",   agentName: "成都清晰视界", agentId: "AG-006", orderNo: "ORD-20260413-S4ZZYJ", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "258A78B354A11916" },
    { customerName: "李建国", sku: "Ultra -1.25",      eye: "右眼", sph: -1.25, cyl: -0.50, axis: 180, pd: 32, ph: 22, frame: "暴龙 BL8090",   agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-LQ6IW9", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "C0B68BD86DC77F5C" },
    { customerName: "李建国", sku: "Ultra -1.25",      eye: "左眼", sph: -1.00, cyl: -0.25, axis: 15,  pd: 32, ph: 22, frame: "暴龙 BL8090",   agentName: "北京明视眼镜", agentId: "AG-003", orderNo: "ORD-20260413-LQ6IW9", deliveryType: "有货3天", promiseDate: "2026/04/16", lensCode: "048D03C256B64703" },
  ];
  return base.map(r => ({ ...r, orderDate: today, address: "", remark: r.remark || "" }));
}

// ─── 标签 HTML 生成（单张，75mm×40mm）────────────────────────────────────

async function buildLabelHtml(rec) {
  const isRight = rec.eye.includes("右") || rec.eye.toUpperCase() === "R";
  const eyeColor = isRight ? "#c0392b" : "#1a6fb5";    // 右红 左蓝
  const eyeLabel = isRight ? "R  右眼" : "L  左眼";
  const eyeBg    = isRight ? "#fff5f5" : "#f0f7ff";

  // 处方数值格式化（带正负号）
  const fmt = (v) => {
    if (v === "" || v === null || v === undefined) return "—";
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return (n >= 0 ? "+" : "") + n.toFixed(2);
  };
  const fmtAxis = (v) => (v === "" || v === null || v === undefined || Number(v) === 0) ? "—" : `${v}°`;
  const fmtPd   = (v) => (v === "" || v === null || v === undefined) ? "—" : `${v}mm`;

  const verifyUrl = `${SERVER_BASE}/verify/${rec.lensCode}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: "H",
    width: 180,
    margin: 1,
  });

  // 有备注时显示
  const remarkHtml = rec.remark
    ? `<div class="remark">⚠ ${rec.remark}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${rec.orderNo} ${rec.customerName} ${rec.eye}</title>
<style>
/* 标签实际打印尺寸：75mm × 40mm */
@page { size: 75mm 40mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: 75mm; height: 40mm;
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 6pt;
  background: white;
  overflow: hidden;
}
.label {
  width: 75mm; height: 40mm;
  display: flex;
  flex-direction: column;
  border: 0.3mm solid #ddd;
}

/* ── 顶部色带（眼别标识）── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: ${eyeColor};
  color: white;
  padding: .8mm 2mm;
  height: 6.5mm;
  flex-shrink: 0;
}
.eye-badge {
  font-size: 9pt;
  font-weight: 900;
  letter-spacing: 1px;
}
.brand {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 1.5px;
  opacity: 0.92;
}
.order-no {
  font-size: 5pt;
  opacity: 0.85;
  font-family: monospace;
}

/* ── 主体区域 ── */
.body {
  display: flex;
  flex: 1;
  padding: 1mm 1.5mm .8mm;
  gap: 1.5mm;
  background: ${eyeBg};
}

/* ── 左侧：文字信息 ── */
.info { flex: 1; display: flex; flex-direction: column; gap: 0.4mm; min-width: 0; }

.customer-row {
  display: flex;
  align-items: baseline;
  gap: 1.5mm;
  border-bottom: 0.2mm solid ${eyeColor}44;
  padding-bottom: .8mm;
  margin-bottom: .4mm;
}
.customer-name {
  font-size: 8pt;
  font-weight: 800;
  color: #1a1a2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 24mm;
}
.sku-name {
  font-size: 5.5pt;
  color: ${eyeColor};
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 处方参数表 ── */
.rx-grid {
  display: grid;
  grid-template-columns: auto auto auto auto auto;
  column-gap: 2mm;
  row-gap: 0.2mm;
  margin: 0.3mm 0;
}
.rx-label {
  font-size: 4.5pt;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.rx-value {
  font-size: 7.5pt;
  font-weight: 700;
  color: #1a1a2e;
  font-family: "SF Mono", "Consolas", monospace;
  line-height: 1.1;
}
.rx-value.highlight { color: ${eyeColor}; }

/* ── 附加信息行 ── */
.meta-row {
  display: flex;
  gap: 1.5mm;
  margin-top: 0.3mm;
  flex-wrap: wrap;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 0.6mm;
}
.meta-label { font-size: 4.5pt; color: #aaa; }
.meta-value { font-size: 5.5pt; color: #444; font-weight: 600; }

.remark {
  font-size: 4.5pt;
  color: #b7791f;
  background: #fffbeb;
  border-left: 0.8mm solid #f6ad55;
  padding: 0.5mm 1mm;
  margin-top: 0.5mm;
}

/* ── 右侧：QR码 ── */
.qr-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1mm;
  flex-shrink: 0;
}
.qr-col img {
  width: 15mm;
  height: 15mm;
  display: block;
  border: 0.3mm solid #ddd;
  border-radius: 1mm;
}
.qr-label {
  font-size: 3.5pt;
  color: #bbb;
  text-align: center;
}

/* ── 底部：镜片码条 ── */
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f8f9fa;
  border-top: 0.2mm solid #e9ecef;
  padding: 0.6mm 2mm;
  height: 5.5mm;
  flex-shrink: 0;
}
.lens-code {
  font-family: "Courier New", monospace;
  font-size: 5.5pt;
  font-weight: 700;
  color: #495057;
  letter-spacing: 1px;
}
.footer-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.delivery-badge {
  font-size: 4.5pt;
  font-weight: 700;
  color: white;
  background: ${rec.deliveryType.startsWith("有货") ? "#27ae60" : "#e67e22"};
  border-radius: 1mm;
  padding: 0.3mm 1.5mm;
  margin-bottom: 0.3mm;
}
.promise-date { font-size: 4pt; color: #aaa; }
.agent-tag { font-size: 4pt; color: #ccc; margin-top: 0.2mm; }
</style></head><body>
<div class="label">

  <!-- 顶部色带 -->
  <div class="header">
    <div class="eye-badge">${eyeLabel}</div>
    <div style="text-align:right">
      <div class="brand">GAUSH | CLEAR</div>
      <div class="order-no">${rec.orderNo}</div>
    </div>
  </div>

  <!-- 主体 -->
  <div class="body">
    <div class="info">

      <!-- 顾客 + SKU -->
      <div class="customer-row">
        <div class="customer-name">${rec.customerName}</div>
        <div class="sku-name">${rec.sku}</div>
      </div>

      <!-- 处方参数 -->
      <div class="rx-grid">
        <div class="rx-label">SPH</div>
        <div class="rx-label">CYL</div>
        <div class="rx-label">AXIS</div>
        <div class="rx-label">PD</div>
        <div class="rx-label">PH</div>

        <div class="rx-value highlight">${fmt(rec.sph)}</div>
        <div class="rx-value highlight">${fmt(rec.cyl)}</div>
        <div class="rx-value">${fmtAxis(rec.axis)}</div>
        <div class="rx-value">${fmtPd(rec.pd)}</div>
        <div class="rx-value">${fmtPd(rec.ph)}</div>
      </div>

      <!-- 镜框 + 代理商 -->
      <div class="meta-row">
        ${rec.frame ? `<div class="meta-item"><span class="meta-label">镜框</span><span class="meta-value">${rec.frame}</span></div>` : ""}
        <div class="meta-item"><span class="meta-label">渠道</span><span class="meta-value">${rec.agentId}</span></div>
      </div>

      ${remarkHtml}
    </div>

    <!-- QR码 -->
    <div class="qr-col">
      <img src="${qrDataUrl}" alt="QR">
      <div class="qr-label">扫码验真</div>
    </div>
  </div>

  <!-- 底部：镜片码 + 交期 -->
  <div class="footer">
    <div class="lens-code">${rec.lensCode}</div>
    <div class="footer-meta">
      <div class="delivery-badge">${rec.deliveryType}</div>
      ${rec.promiseDate ? `<div class="promise-date">承诺 ${rec.promiseDate}</div>` : ""}
      <div class="agent-tag">${rec.agentName}</div>
    </div>
  </div>

</div>
</body></html>`;
}

// ─── A4 批量打印页（每页 6 张，3列×2行）─────────────────────────────────

async function buildBatchPrintPage(records) {
  console.log(`  生成 A4 批量打印页（${records.length} 张标签）...`);

  // 为每条记录生成 QR data URL
  const cards = [];
  for (const rec of records) {
    const isRight  = rec.eye.includes("右") || rec.eye.toUpperCase() === "R";
    const eyeColor = isRight ? "#c0392b" : "#1a6fb5";
    const eyeBg    = isRight ? "#fff5f5" : "#f0f7ff";
    const eyeLabel = isRight ? "R 右眼" : "L 左眼";

    const fmt = (v) => {
      if (v === "" || v === null || v === undefined) return "—";
      const n = Number(v); if (isNaN(n)) return String(v);
      return (n >= 0 ? "+" : "") + n.toFixed(2);
    };
    const fmtAxis = (v) => (!v || Number(v) === 0) ? "—" : `${v}°`;
    const fmtPd   = (v) => (!v && v !== 0) ? "—" : `${v}mm`;

    const verifyUrl = `${SERVER_BASE}/verify/${rec.lensCode}`;
    const qr = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "H", width: 160, margin: 1 });

    const remark = rec.remark
      ? `<div style="font-size:5.5pt;color:#b7791f;background:#fffbeb;border-left:2px solid #f6ad55;padding:1px 3px;margin-top:1mm">⚠ ${rec.remark}</div>`
      : "";

    cards.push(`
<div class="label" style="--eye-color:${eyeColor};--eye-bg:${eyeBg}">
  <!-- 顶部色带 -->
  <div class="hdr" style="background:${eyeColor}">
    <span class="eye-badge">${eyeLabel}</span>
    <span style="text-align:right;line-height:1.2">
      <span class="brand">GAUSH | CLEAR</span><br>
      <span class="order-no">${rec.orderNo}</span>
    </span>
  </div>

  <!-- 主体 -->
  <div class="body" style="background:${eyeBg}">
    <div class="info">
      <div class="cust-row">
        <span class="cust-name">${rec.customerName}</span>
        <span class="sku-name" style="color:${eyeColor}">${rec.sku}</span>
      </div>
      <div class="rx-grid">
        <div class="rx-lbl">SPH</div><div class="rx-lbl">CYL</div><div class="rx-lbl">AXIS</div><div class="rx-lbl">PD</div><div class="rx-lbl">PH</div>
        <div class="rx-val" style="color:${eyeColor}">${fmt(rec.sph)}</div>
        <div class="rx-val" style="color:${eyeColor}">${fmt(rec.cyl)}</div>
        <div class="rx-val">${fmtAxis(rec.axis)}</div>
        <div class="rx-val">${fmtPd(rec.pd)}</div>
        <div class="rx-val">${fmtPd(rec.ph)}</div>
      </div>
      <div class="meta-row">
        ${rec.frame ? `<span class="meta-item"><span class="meta-lbl">镜框</span> ${rec.frame}</span>` : ""}
        <span class="meta-item"><span class="meta-lbl">代理商</span> ${rec.agentId}·${rec.agentName}</span>
      </div>
      ${remark}
    </div>
    <div class="qr-col">
      <img src="${qr}" width="60" height="60">
      <div style="font-size:4pt;color:#bbb;text-align:center;margin-top:1mm">扫码验真</div>
    </div>
  </div>

  <!-- 底部 -->
  <div class="ftr">
    <span class="lens-code">${rec.lensCode}</span>
    <span style="text-align:right;line-height:1.3">
      <span class="delivery-badge" style="background:${rec.deliveryType.startsWith("有货") ? "#27ae60" : "#e67e22"}">${rec.deliveryType}</span><br>
      ${rec.promiseDate ? `<span style="font-size:4.5pt;color:#aaa">→ ${rec.promiseDate}</span>` : ""}
    </span>
  </div>
</div>`);
  }

  const printDate = new Date().toLocaleString("zh-CN");
  const totalPages = Math.ceil(records.length / 6);

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>高视星镜片标签 — 批量打印（${records.length}张）</title>
<style>
/* ── 打印设置 ── */
@page { size: A4 portrait; margin: 8mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  background: #f5f6fa;
}

/* ── 屏幕预览工具栏 ── */
.toolbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 999;
  background: #1a1f4b; color: white;
  padding: 10px 20px;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
.toolbar h1 { font-size: 14px; }
.toolbar .meta { font-size: 12px; opacity: .7; }
.btn-print {
  background: #27ae60; color: white; border: none;
  padding: 8px 20px; border-radius: 6px; cursor: pointer;
  font-size: 13px; font-weight: 600;
}
.btn-print:hover { background: #219a52; }
@media print { .toolbar { display: none; } body { background: white; } }

/* ── A4 页面容器 ── */
.pages { padding: 60px 10px 10px; }
.a4-page {
  width: 210mm;
  min-height: 297mm;
  background: white;
  margin: 0 auto 12px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 75mm);
  grid-template-rows: repeat(5, 40mm);
  gap: 4mm;
  align-content: start;
  justify-content: center;
  padding: 6mm;
  page-break-after: always;
  box-shadow: 0 2px 16px rgba(0,0,0,.12);
}
@media print {
  .pages { padding: 0; }
  .a4-page { margin: 0; box-shadow: none; }
}

/* ── 单张标签（75mm × 40mm）── */
.label {
  width: 75mm; height: 40mm;
  display: flex; flex-direction: column;
  border: 0.3mm solid #ddd;
  border-radius: 1mm;
  overflow: hidden;
  page-break-inside: avoid;
}

/* 顶部色带 */
.hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1mm 2.5mm;
  height: 8mm; flex-shrink: 0;
  color: white;
}
.eye-badge { font-size: 9.5pt; font-weight: 900; letter-spacing: 1px; }
.brand { font-size: 7pt; font-weight: 700; letter-spacing: 1.5px; }
.order-no { font-size: 5pt; opacity: .8; font-family: monospace; }

/* 主体 */
.body { display: flex; flex: 1; padding: 1.5mm 2mm 1mm; gap: 1.5mm; }
.info { flex: 1; display: flex; flex-direction: column; gap: 0.4mm; min-width: 0; }

.cust-row {
  display: flex; align-items: baseline; gap: 1.5mm;
  border-bottom: 0.2mm solid rgba(0,0,0,.1);
  padding-bottom: 0.8mm; margin-bottom: 0.3mm;
}
.cust-name {
  font-size: 9pt; font-weight: 800; color: #1a1a2e;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 26mm;
}
.sku-name { font-size: 6pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 处方参数 */
.rx-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  column-gap: 1mm; row-gap: 0.2mm;
  margin: 0.3mm 0;
}
.rx-lbl { font-size: 4.5pt; color: #999; text-transform: uppercase; }
.rx-val { font-size: 8pt; font-weight: 700; font-family: "Consolas", "Courier New", monospace; line-height: 1.1; }

/* 附加信息 */
.meta-row { display: flex; flex-wrap: wrap; gap: 1.5mm; margin-top: 0.3mm; }
.meta-item { font-size: 5pt; color: #666; white-space: nowrap; }
.meta-lbl { color: #bbb; }

/* QR列 */
.qr-col { display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.qr-col img { border: 0.3mm solid #ddd; border-radius: 0.8mm; }

/* 底部 */
.ftr {
  display: flex; align-items: center; justify-content: space-between;
  background: #f8f9fa; border-top: 0.2mm solid #e9ecef;
  padding: 0.8mm 2.5mm; height: 7mm; flex-shrink: 0;
}
.lens-code { font-family: "Courier New", monospace; font-size: 5.5pt; font-weight: 700; color: #555; letter-spacing: 0.8px; }
.delivery-badge {
  font-size: 5pt; font-weight: 700; color: white;
  border-radius: 0.8mm; padding: 0.3mm 1.5mm;
}
</style></head><body>

<div class="toolbar no-print">
  <div>
    <div class="toolbar-h1" style="font-size:15px;font-weight:700">高视星镜片标签 — 批量打印</div>
    <div class="meta">${records.length} 张标签 · ${totalPages} 页 A4 · 打印时间：${printDate}</div>
  </div>
  <button class="btn-print" onclick="window.print()">🖨 打印全部</button>
</div>

<div class="pages">
${
  Array.from({ length: totalPages }, (_, pi) => {
    const slice = cards.slice(pi * 6, (pi + 1) * 6);
    return `  <div class="a4-page">\n${slice.join("\n")}\n  </div>`;
  }).join("\n")
}
</div>

</body></html>`;
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   高视星镜片标签生成器 — 专业版                   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // 获取数据
  let records;
  if (DEMO_MODE) {
    console.log("  [演示模式] 使用内置数据...");
    records = demoRecords();
  } else {
    records = await fetchLensRecords(ORDER_NO);
    if (records.length === 0) {
      console.log("  ⚠  飞书中无带镜片码的订单，改用演示数据");
      records = demoRecords();
    }
  }

  console.log(`  共 ${records.length} 条镜片记录\n`);

  // 排序：订单号 → 右眼在前
  records.sort((a, b) => {
    const on = a.orderNo.localeCompare(b.orderNo);
    if (on !== 0) return on;
    const isRightA = a.eye.includes("右") ? 0 : 1;
    const isRightB = b.eye.includes("右") ? 0 : 1;
    return isRightA - isRightB;
  });

  // 确保输出目录存在
  const docsDir    = resolve(__dirname, "docs");
  const singleDir  = resolve(docsDir, `labels-${today}-single`);
  if (!existsSync(docsDir))   mkdirSync(docsDir, { recursive: true });
  if (!existsSync(singleDir)) mkdirSync(singleDir, { recursive: true });

  // 生成单张标签
  console.log(`  生成单张标签 → docs/labels-${today}-single/`);
  for (const rec of records) {
    const html = await buildLabelHtml(rec);
    const safeName = `${rec.orderNo}_${rec.customerName}_${rec.eye}`.replace(/[\/\\:*?"<>|]/g, "_");
    writeFileSync(resolve(singleDir, `${safeName}.html`), html, "utf-8");
    process.stdout.write(`    ✅ ${rec.customerName} ${rec.eye} (${rec.lensCode})\n`);
  }

  // 生成 A4 批量打印页
  const batchHtml = await buildBatchPrintPage(records);
  const batchPath = resolve(docsDir, `labels-${today}.html`);
  writeFileSync(batchPath, batchHtml, "utf-8");

  console.log(`\n  ✅ 完成！`);
  console.log(`  📄 A4批量打印: docs/labels-${today}.html`);
  console.log(`  📁 单张标签:   docs/labels-${today}-single/（${records.length} 个文件）`);
  console.log(`\n  👉 用浏览器打开 A4批量打印页，点"打印全部"→另存为PDF`);
  console.log(`     每页 6 张标签（3列×2行），标准 A4 纸可直接送工厂`);

  // 自动打开
  const { exec } = await import("child_process");
  exec(`start "" "${batchPath}"`);
}

main().catch(err => {
  console.error("💥 失败:", err.message);
  process.exit(1);
});
