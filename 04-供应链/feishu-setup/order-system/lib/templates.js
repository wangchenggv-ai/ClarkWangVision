// lib/templates.js — HTML 模板（同行单 + 标签）

import QRCode from "qrcode";
import { fmt, fmtAxis } from "./helpers.js";
import { lookupBySphCyl } from "./sku-serial.js";

let getServerBaseUrl;

const SKU_ABBR = {
  "Ultra双效":"ULT","D8":"D8",
  "时空之眼A":"TKAA","时空之眼B":"TKAB",
  "时空之眼PRO":"TKAP","时空之眼MAX":"TKAM",
  "小旋风":"XFJ"
};

function encodeSkuBarcode(sku, sph, cyl) {
  const abbr = SKU_ABBR[sku] || sku.replace(/\W/g,"").toUpperCase().slice(0,4);
  const sphCode = String(Math.round(Math.abs(Number(sph))*100)).padStart(3,"0");
  const cylCode = String(Math.round(Math.abs(Number(cyl))*100)).padStart(3,"0");
  return `${abbr}-${sphCode}-${cylCode}`;
}

export function init({ getServerBaseUrl: gsbu }) {
  getServerBaseUrl = gsbu;
}

// ─── 随货同行单 HTML 模板 ──────────────────────────────────────────────────────

export function slipHTML(order) {
  const { orderNo, orderNos: orderNosIn, customerName, agentName, agentId, shipDate, promiseDate,
          courierName, trackingNo, address, rows } = order;
  const orderNos = orderNosIn?.length ? orderNosIn : [orderNo];
  const orderNosStr = orderNos.join(", ");
  const eyeRow = (r) => `
    <tr>
      <td class="eye ${r.eye === "左眼" ? "eye-l" : "eye-r"}">${r.eye === "左眼" ? "L<br><span>左眼</span>" : "R<br><span>右眼</span>"}</td>
      <td class="sku">${r.sku || "—"}</td>
      <td class="rx">${fmt(r.sph)}</td>
      <td class="rx">${fmt(r.cyl)}</td>
      <td class="rx">${r.axis || "—"}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>随货同行单 ${orderNosStr}</title>
<style>
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 10pt; color: #1a1a2e; background: #fff; }
  .header { display: flex; align-items: flex-end; justify-content: space-between;
            border-bottom: 1.5pt solid #c0392b; padding-bottom: 4mm; margin-bottom: 5mm; }
  .brand { display: flex; flex-direction: column; gap: 1mm; }
  .brand-name { font-size: 18pt; font-weight: 900; letter-spacing: 3px; color: #c0392b; }
  .brand-sub  { font-size: 7.5pt; color: #888; letter-spacing: 1.5px; }
  .doc-title  { text-align: right; }
  .doc-title h1 { font-size: 16pt; font-weight: 800; letter-spacing: 4px; color: #1a1a2e; }
  .doc-title p  { font-size: 7pt; color: #aaa; margin-top: 1mm; letter-spacing: 1px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm;
          background: #fdf5f5; border: 0.5pt solid #f0d0d0; border-radius: 2mm;
          padding: 4mm 5mm; margin-bottom: 5mm; }
  .meta-item { display: flex; flex-direction: column; gap: 0.8mm; }
  .meta-label { font-size: 6pt; color: #aaa; text-transform: uppercase; letter-spacing: 1px; }
  .meta-value { font-size: 10pt; font-weight: 700; color: #1a1a2e; }
  .meta-value.mono { font-family: "Courier New", monospace; font-size: 9pt; }
  .meta-value.red  { color: #c0392b; }
  .rx-title { font-size: 8pt; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
              color: #c0392b; margin-bottom: 2.5mm; padding-left: 2mm;
              border-left: 2pt solid #c0392b; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8mm; }
  thead th { background: #1a1a2e; color: white; font-size: 8pt; font-weight: 600;
             letter-spacing: 0.5px; padding: 3mm 4mm; text-align: center; }
  thead th:first-child { text-align: left; padding-left: 4mm; }
  tbody tr { border-bottom: 0.4pt solid #eee; }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.eye { width: 14mm; font-size: 16pt; font-weight: 900; text-align: center;
           padding: 3mm 0; line-height: 1; }
  td.eye span { font-size: 6pt; font-weight: 400; display: block; margin-top: 0.5mm; }
  td.eye-r { color: #c0392b; }
  td.eye-l { color: #2980b9; }
  td.sku  { padding: 3mm 4mm; font-size: 9pt; font-weight: 600; }
  td.rx   { padding: 3mm; text-align: center; font-family: "Courier New",monospace;
            font-size: 13pt; font-weight: 700; color: #c0392b; }
  .sign-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; margin-bottom: 6mm; }
  .sign-box { border: 0.5pt solid #ddd; border-radius: 2mm; padding: 4mm; min-height: 22mm; }
  .sign-box h3 { font-size: 7pt; color: #aaa; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 2mm; }
  .sign-box .sign-line { border-bottom: 0.5pt solid #ccc; margin: 10mm 2mm 2mm; }
  .sign-box .sign-hint { font-size: 6pt; color: #ccc; text-align: center; }
  .footer { border-top: 0.5pt solid #eee; padding-top: 3mm; display: flex;
            justify-content: space-between; align-items: center; }
  .footer-left { font-size: 6.5pt; color: #bbb; }
  .footer-right { font-size: 6pt; color: #ccc; font-family: "Courier New",monospace; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
  .print-btn { position: fixed; bottom: 20px; right: 20px; padding: 13px 28px;
               background: #c0392b; color: white; border: none; border-radius: 8px;
               font-size: 16px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">打印 / 导出 PDF</button>
<div class="header">
  <div class="brand">
    <div class="brand-name">GAUSH | CLEAR</div>
    <div class="brand-sub">高视星 · 随货同行单</div>
  </div>
  <div class="doc-title">
    <h1>随货同行单</h1>
    <p>PACKING SLIP / DELIVERY NOTE</p>
  </div>
</div>
<div class="meta">
  <div class="meta-item">
    <div class="meta-label">订单号 Order No.</div>
    <div class="meta-value mono red">${orderNosStr}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">顾客 Customer</div>
    <div class="meta-value">${customerName}</div>
  </div>${address ? `
  <div class="meta-item">
    <div class="meta-label">收货地址 Address</div>
    <div class="meta-value" style="font-size:8pt">${address}</div>
  </div>` : ""}
  <div class="meta-item">
    <div class="meta-label">代理商 Agent</div>
    <div class="meta-value">${agentName} <span style="font-size:7pt;color:#aaa">${agentId}</span></div>
  </div>
  <div class="meta-item">
    <div class="meta-label">发货日期 Ship Date</div>
    <div class="meta-value">${shipDate}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">镜片数量 Qty</div>
    <div class="meta-value red">${rows.length} 片</div>
  </div>
</div>
<div class="rx-title">处方参数 Prescription</div>
<table>
  <thead><tr><th>眼别</th><th>SKU / 型号</th><th>SPH 球镜</th><th>CYL 柱镜</th><th>AXIS 轴位</th></tr></thead>
  <tbody>${rows.map(eyeRow).join("\n")}</tbody>
</table>
<div class="sign-section">
  <div class="sign-box">
    <h3>发货方签章 Shipper</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">高视星 / GAUSH CLEAR</div>
  </div>
  <div class="sign-box">
    <h3>代理商签章 Agent</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">${agentName}</div>
  </div>
  <div class="sign-box">
    <h3>顾客签收 Customer Sign</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">签收日期：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</div>
  </div>
</div>
<div class="footer">
  <div class="footer-left">高视星 GAUSH CLEAR &nbsp;|&nbsp; 本单据随货附带，请妥善保存</div>
  <div class="footer-right">打印时间 ${new Date().toLocaleString("zh-CN")} &nbsp;|&nbsp; ${orderNosStr}</div>
</div>
</body></html>`;
}

// ─── 标签 HTML ─────────────────────────────────────────────────────────────────

const LABEL_CSS = `@page{size:75mm 40mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
.label{width:75mm;height:40mm;position:relative;overflow:hidden}
.label-inner{width:75mm;height:40mm;position:relative;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:12pt;transform:scale(0.8);transform-origin:top left;left:4mm}
.lbl-name{position:absolute;left:5mm;top:3mm;width:35mm;height:7mm;font-size:12pt;line-height:7mm;overflow:hidden;white-space:nowrap}
.lbl-eye{position:absolute;left:38mm;top:4mm;width:10mm;height:6mm;font-size:12pt;line-height:6mm}
.lbl-zone{position:absolute;right:1mm;top:1mm;width:20mm;text-align:right;font-size:22pt;font-weight:900;color:#c0392b;line-height:1}
.lbl-date{position:absolute;right:1mm;top:13mm;width:20mm;text-align:right;font-size:7pt;color:#777;font-family:"SF Mono","Consolas","Courier New",monospace}
.lbl-tbl{position:absolute;left:15mm;top:10mm}
.lbl-tbl table{border-collapse:collapse;width:55mm;height:15mm}
.lbl-tbl th{font-size:11pt;text-align:center;padding:1mm 0;border:1px solid #000}
.lbl-tbl td{font-size:14pt;text-align:center;padding:1mm 0;border:1px solid #000;font-family:"SF Mono","Consolas","Courier New",monospace}
.lbl-sku{position:absolute;left:5mm;top:26mm;width:45mm;height:5mm;font-size:10pt;line-height:5mm;overflow:hidden;white-space:nowrap}
.lbl-bin{position:absolute;left:5mm;top:31mm;width:45mm;height:6mm;font-size:11pt;line-height:6mm;font-family:"SF Mono","Consolas","Courier New",monospace;font-weight:700;letter-spacing:0.5px}
.lbl-bin .lbl-serial{background:#1a1a2e;color:#fff;padding:0 1.5mm;border-radius:1mm;margin-right:1.5mm}
.lbl-barcode{position:absolute;left:5mm;top:36mm;width:42mm;height:7mm}
.lbl-barcode svg{width:42mm;height:5mm;display:block}
.lbl-barcode .lc-text{font-size:7pt;font-family:"SF Mono","Consolas",monospace;color:#333;margin-top:0.5mm}
.lbl-qr{position:absolute;left:52mm;top:26mm;width:18mm;height:18mm}
.lbl-qr img{width:18mm;height:18mm;display:block}`;

async function _buildLabelFragment(f, orderNo, { binCode = "" } = {}) {
  const lensCode = f["镜片码（唯一）"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeTag = isRight ? "右眼" : "左眼";
  const sku = f["产品型号"] || "";
  const sph = fmt(f["球镜SPH"] ?? "");
  const cyl = fmt(f["柱镜CYL"] ?? "");
  const axis = fmtAxis(f["轴位AXIS"] ?? "");
  const d = new Date();
  const today = `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const skuBc = encodeSkuBarcode(sku, f["球镜SPH"], f["柱镜CYL"]);
  const skuEntry = lookupBySphCyl(sku, f["球镜SPH"], f["柱镜CYL"]);
  const serialNo = skuEntry ? skuEntry.s : null;
  const binAddr  = skuEntry?.bin ?? null;
  const binLine  = serialNo
    ? `<span class="lbl-serial">${serialNo}</span>${binAddr ?? "待分配"}`
    : "";
  const html = `<div class="label"><div class="label-inner">
<div class="lbl-name">${f["顾客姓名"]||""}</div>
<div class="lbl-eye">${eyeTag}</div>
${binCode ? `<div class="lbl-zone">${binCode}</div>` : ""}
<div class="lbl-date">${today}</div>
<div class="lbl-tbl"><table>
  <tr><th>球镜</th><th>柱镜</th><th>轴位</th></tr>
  <tr><td>${sph}</td><td>${cyl}</td><td>${axis}</td></tr>
</table></div>
<div class="lbl-sku">高视星® ${sku}</div>
${binLine ? `<div class="lbl-bin">${binLine}</div>` : ""}
<div class="lbl-barcode"><svg class="barcode" jsbarcode-value="${skuBc}" jsbarcode-format="CODE128" jsbarcode-width="1.5" jsbarcode-height="28" jsbarcode-displayValue="false" jsbarcode-margin="1"></svg><div class="lc-text">${skuBc}</div></div>
<div class="lbl-qr"><img src="${qrDataUrl}" alt="QR"></div>
</div></div>`;

  return { html, customer, eye, lensCode };
}

async function _renderLabelHtml(f, orderNo, extra = {}) {
  const fragment = await _buildLabelFragment(f, orderNo, extra);
  if (!fragment) return null;

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${fragment.customer} ${fragment.eye}</title>
<style>
body{width:75mm;min-height:40mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:8pt;background:#fff;padding:0}
${LABEL_CSS}
@media print{body{padding:0} .label{border:none}}
</style></head><body>
${fragment.html}
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
<script>JsBarcode(".barcode").init();</script>
</body></html>`;

  return { html, customer: fragment.customer, eye: fragment.eye, lensCode: fragment.lensCode };
}

// 从记录对象生成标签（返回 Buffer，用于 ZIP 打包）
export async function buildLabelHtml(record, orderNo, extra = {}) {
  const r = await _renderLabelHtml(record.fields, orderNo, extra);
  if (!r) return null;
  return { name: `labels/${orderNo}_${r.customer}_${r.eye}.html`, data: Buffer.from(r.html, "utf-8") };
}

// 从字段直接生成标签 HTML（兼容镜片明细表，返回结构化对象）
export async function buildLabelHtmlFromFields(f, orderNo, extra = {}) {
  const r = await _renderLabelHtml(f, orderNo, extra);
  if (!r) return null;
  return { orderNo, customer: r.customer, eye: r.eye, lensCode: r.lensCode, html: r.html };
}

export async function buildPrintPage(labels) {
  const fragments = (await Promise.all(
    labels.map(({ fields, orderNo, binCode = "" }) => _buildLabelFragment(fields, orderNo, { binCode }))
  )).filter(Boolean);
  if (!fragments.length) return null;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>标签打印 — ${fragments.length} 张</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:8pt;background:#fff}
.toolbar{position:fixed;top:0;left:0;right:0;z-index:100;background:#1a1a2e;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-size:13px}
.toolbar button{background:#c0392b;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
.labels-wrap{padding-top:50px}
${LABEL_CSS}
.label{page-break-after:always;margin:0 auto}
.label:last-child{page-break-after:auto}
@media print{.toolbar{display:none} .labels-wrap{padding-top:0} .label{border:none}}
</style></head><body>
<div class="toolbar no-print">
  <span>GAUSH | CLEAR 标签打印 — ${fragments.length} 张</span>
  <button onclick="window.print()">打印</button>
</div>
<div class="labels-wrap">
${fragments.map(f => f.html).join("\n")}
</div>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
<script>JsBarcode(".barcode").init();</script>
</body></html>`;
}

// ─── 配货单 ────────────────────────────────────────────────────────────────────
// 仓库拣货用。按货位路径（A→B→C 区→货架→层→位）排序，减少来回走动。

export function binSortKey(bin) {
  if (!bin) return "Z-99-99-99";
  const [zone, rack, level, slot] = bin.split("-");
  return `${zone||"Z"}-${String(rack||"99").padStart(2,"0")}-${String(level||"9").padStart(2,"0")}-${String(slot||"99").padStart(2,"0")}`;
}

const ZONE_LABELS = { A: "A区（货架1-3）", B: "B区（货架4-5）", C: "C区（货架6-10）" };

export function picklistHTML(orderNos, rows, dateStr) {
  let currentZone = "";
  const rowsHtml = rows.map(r => {
    const zone = r.bin ? r.bin[0] : "?";
    let zoneHeader = "";
    if (zone !== currentZone) {
      currentZone = zone;
      zoneHeader = `<tr class="zone-hd"><td colspan="7">${ZONE_LABELS[zone] || zone + "区"}</td></tr>`;
    }
    const isLeft = r.eye.includes("左");
    return `${zoneHeader}<tr>
      <td class="sn">${r.serialNo}</td>
      <td class="bin">${r.bin || "—"}</td>
      <td>${r.customer}</td>
      <td class="${isLeft ? "eye-l" : "eye-r"}">${isLeft ? "L·左" : "R·右"}</td>
      <td>${r.sku}</td>
      <td>${fmt(r.sph)}</td>
      <td>${fmt(r.cyl)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>配货单</title>
<style>
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC','Microsoft YaHei',sans-serif; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1b3a5c; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
  .sn { font-size: 20px; font-weight: 700; color: #1b3a5c; width: 60px; }
  .bin { font-size: 13px; font-weight: 600; width: 108px; font-family: monospace; }
  .eye-r { font-weight: 700; color: #1b3a5c; }
  .eye-l { font-weight: 700; color: #c0392b; }
  .zone-hd td { background: #e8f0fe; font-weight: 700; font-size: 13px; padding: 6px 8px; color: #1b3a5c; border-bottom: 2px solid #1b3a5c; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; }
  .toolbar button { padding: 6px 16px; border: none; border-radius: 4px; background: #1b3a5c; color: #fff; cursor: pointer; font-size: 13px; }
  .footer { margin-top: 12px; font-size: 11px; color: #999; text-align: right; }
  @media print { .toolbar { display: none; } }
</style>
</head>
<body>
<div class="toolbar">
  <span>配货单 · 共 ${rows.length} 眼</span>
  <button onclick="window.print()">打印</button>
</div>
<h1>配货单</h1>
<div class="meta">
  订单：${orderNos.join("、")}&nbsp;&nbsp;|&nbsp;&nbsp;共 ${rows.length} 眼&nbsp;&nbsp;|&nbsp;&nbsp;${dateStr}&nbsp;&nbsp;|&nbsp;&nbsp;已按拾货路径排序（A→B→C 区）
</div>
<table>
  <thead>
    <tr><th>序列号</th><th>货位</th><th>顾客</th><th>眼别</th><th>产品型号</th><th>SPH</th><th>CYL</th></tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="footer">高视星 GAUSH · CLEAR</div>
</body>
</html>`;
}
