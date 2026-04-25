// lib/templates.js — HTML 模板（同行单 + 标签）

import QRCode from "qrcode";
import { fmt, fmtAxis } from "./helpers.js";

let getServerBaseUrl;

export function init({ getServerBaseUrl: gsbu }) {
  getServerBaseUrl = gsbu;
}

// ─── 随货同行单 HTML 模板 ──────────────────────────────────────────────────────

export function slipHTML(order) {
  const { orderNo, orderNos: orderNosIn, customerName, agentName, agentId, shipDate, promiseDate,
          courierName, trackingNo, address, rows } = order;
  const orderNos = orderNosIn?.length ? orderNosIn : [orderNo];
  const orderNosStr = orderNos.join(", ");
  const base = getServerBaseUrl();

  const eyeRow = (r) => {
    const lc = r.lensCode || "—";
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=64x64&ecc=M&data=${encodeURIComponent(base + "/verify/" + lc)}`;
    return `
    <tr>
      <td class="eye ${r.eye === "左眼" ? "eye-l" : "eye-r"}">${r.eye === "左眼" ? "L<br><span>左眼</span>" : "R<br><span>右眼</span>"}</td>
      <td class="sku">${r.sku || "—"}</td>
      <td class="rx">${fmt(r.sph)}</td>
      <td class="rx">${fmt(r.cyl)}</td>
      <td class="rx">${r.axis || "—"}</td>
      <td class="lc"><span class="lc-code">${lc}</span></td>
      <td class="qr-cell"><img src="${qr}" alt="QR" width="52" height="52"></td>
    </tr>`;
  };

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
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  thead th { background: #1a1a2e; color: white; font-size: 7pt; font-weight: 600;
             letter-spacing: 0.5px; padding: 2.5mm 3mm; text-align: center; }
  thead th:first-child { text-align: left; padding-left: 4mm; }
  tbody tr { border-bottom: 0.4pt solid #eee; }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.eye { width: 14mm; font-size: 16pt; font-weight: 900; text-align: center;
           padding: 3mm 0; line-height: 1; }
  td.eye span { font-size: 6pt; font-weight: 400; display: block; margin-top: 0.5mm; }
  td.eye-r { color: #c0392b; }
  td.eye-l { color: #2980b9; }
  td.sku  { padding: 3mm; font-size: 8pt; font-weight: 600; }
  td.rx   { padding: 3mm; text-align: center; font-family: "Courier New",monospace;
            font-size: 11pt; font-weight: 700; color: #c0392b; }
  td.lc   { padding: 3mm; }
  .lc-code { font-family: "Courier New",monospace; font-size: 7.5pt; font-weight: 700;
             background: #1a1a2e; color: #fff; padding: 1mm 2mm; border-radius: 1mm; letter-spacing: 1px; }
  td.qr-cell { padding: 2mm; text-align: center; width: 18mm; }
  .logistics { display: flex; gap: 5mm; margin-bottom: 6mm; }
  .logistics-box { flex: 1; border: 0.5pt solid #ddd; border-radius: 2mm; padding: 4mm; }
  .logistics-box h3 { font-size: 7pt; font-weight: 700; letter-spacing: 1.5px;
                       text-transform: uppercase; color: #888; margin-bottom: 3mm; }
  .tracking-no { font-family: "Courier New",monospace; font-size: 14pt; font-weight: 900;
                 color: #1a1a2e; letter-spacing: 2px; }
  .courier-name { font-size: 9pt; color: #555; margin-top: 1mm; }
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
    <div class="brand-sub">高视星 · 镜片溯源系统</div>
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
    <div class="meta-label">承诺交期 Promise Date</div>
    <div class="meta-value">${promiseDate || "—"}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">镜片数量 Qty</div>
    <div class="meta-value red">${rows.length} 片</div>
  </div>
</div>
<div class="rx-title">处方参数 Prescription</div>
<table>
  <thead><tr><th>眼别</th><th>SKU / 型号</th><th>SPH 球镜</th><th>CYL 柱镜</th><th>AXIS 轴位</th><th>镜片码 Lens Code</th><th>溯源</th></tr></thead>
  <tbody>${rows.map(eyeRow).join("\n")}</tbody>
</table>
<div class="logistics">
  <div class="logistics-box">
    <h3>物流信息 Shipping</h3>
    <div class="tracking-no">${trackingNo || "—"}</div>
    <div class="courier-name">${courierName || "—"}</div>
  </div>
  <div class="logistics-box" style="flex:2">
    <h3>温馨提示 Notes</h3>
    <p style="font-size:8pt;color:#555;line-height:1.8">
      1. 请在签收前检查包装完好性，如有破损请拒收并联系代理商。<br>
      2. 扫描各镜片上的二维码可查询溯源信息及真伪验证。<br>
      3. 如有疑问请联系：<strong>${agentName}</strong>
    </p>
  </div>
</div>
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
  <div class="footer-left">高视星镜片溯源系统 GAUSH CLEAR Supply Chain v1.0 &nbsp;|&nbsp; 本单据随货附带，请妥善保存</div>
  <div class="footer-right">打印时间 ${new Date().toLocaleString("zh-CN")} &nbsp;|&nbsp; ${orderNosStr}</div>
</div>
</body></html>`;
}

// ─── 标签 HTML ─────────────────────────────────────────────────────────────────

// 内部共享：从 fields 生成标签 HTML
async function _renderLabelHtml(f, orderNo) {
  const lensCode = f["镜片码"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeColor = isRight ? "#c0392b" : "#1a6fb5";
  const eyeLabel = isRight ? "R  右眼" : "L  左眼";
  const eyeBg = isRight ? "#fff5f5" : "#f0f7ff";
  const sku = f["产品型号"] || "";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:75mm 40mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:75mm;min-height:40mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:6pt;background:#fff}
.label{width:75mm;min-height:40mm;display:flex;flex-direction:column;border:.3mm solid #ddd}
.header{display:flex;align-items:center;justify-content:space-between;background:${eyeColor};color:#fff;padding:.8mm 2mm;height:6.5mm;flex-shrink:0}
.eye-badge{font-size:9pt;font-weight:900;letter-spacing:1px}
.brand{font-size:6.5pt;font-weight:700;letter-spacing:1.5px;opacity:.92}
.order-no{font-size:5pt;opacity:.85;font-family:monospace}
.body{display:flex;flex:1;padding:1mm 1.5mm .8mm;gap:1.5mm;background:${eyeBg}}
.info{flex:1;display:flex;flex-direction:column;gap:.4mm;min-width:0}
.customer-row{display:flex;align-items:baseline;gap:1.5mm;border-bottom:.2mm solid ${eyeColor}44;padding-bottom:.8mm;margin-bottom:.4mm}
.customer-name{font-size:8pt;font-weight:800;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:24mm}
.sku-name{font-size:5.5pt;color:${eyeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-grid{display:grid;grid-template-columns:auto auto auto;column-gap:2mm;row-gap:.2mm;margin:.3mm 0}
.rx-label{font-size:4.5pt;color:#888;text-transform:uppercase;letter-spacing:.3px}
.rx-value{font-size:7.5pt;font-weight:700;color:#1a1a2e;font-family:"SF Mono","Consolas",monospace;line-height:1.1}
.rx-value.hl{color:${eyeColor}}
.meta-row{display:flex;gap:1.5mm;margin-top:.3mm;flex-wrap:wrap}
.meta-item{display:flex;align-items:center;gap:.6mm}
.meta-label{font-size:4.5pt;color:#aaa}
.meta-value{font-size:5.5pt;color:#444;font-weight:600}
.qr-col{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8mm;flex-shrink:0}
.qr-col img{width:15mm;height:15mm;display:block;border:.3mm solid #ddd;border-radius:1mm}
.qr-label{font-size:3.5pt;color:#bbb;text-align:center}
.footer{display:flex;align-items:center;justify-content:space-between;background:#f8f9fa;border-top:.2mm solid #e9ecef;padding:.6mm 2mm;height:5.5mm;flex-shrink:0}
.lens-code{font-family:"Courier New",monospace;font-size:5.5pt;font-weight:700;color:#495057;letter-spacing:1px}
.footer-meta{display:flex;flex-direction:column;align-items:flex-end}
.agent-tag{font-size:4pt;color:#ccc;margin-top:.2mm}
@media print{body{padding:0}}
</style></head><body>
<div class="label">
<div class="header"><div class="eye-badge">${eyeLabel}</div><div style="text-align:right"><div class="brand">GAUSH | CLEAR</div><div class="order-no">${orderNo}</div></div></div>
<div class="body"><div class="info">
<div class="customer-row"><div class="customer-name">${f["顾客姓名"]||""}</div><div class="sku-name">${sku}</div></div>
<div class="rx-grid">
<div class="rx-label">SPH</div><div class="rx-label">CYL</div><div class="rx-label">AXIS</div>
<div class="rx-value hl">${fmt(sph)}</div><div class="rx-value hl">${fmt(cyl)}</div><div class="rx-value">${fmtAxis(axis)}</div>
</div>
<div class="meta-row"><div class="meta-item"><span class="meta-label">渠道</span><span class="meta-value">${agentId}</span></div></div>
</div><div class="qr-col"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">扫码验真</div></div></div>
<div class="footer"><div class="lens-code">${lensCode}</div><div class="footer-meta"><div class="agent-tag">${agentName}</div></div></div>
</div></body></html>`;

  return { html, customer, eye, lensCode };
}

// 从记录对象生成标签（返回 Buffer，用于 ZIP 打包）
export async function buildLabelHtml(record, orderNo) {
  const r = await _renderLabelHtml(record.fields, orderNo);
  if (!r) return null;
  return { name: `labels/${orderNo}_${r.customer}_${r.eye}.html`, data: Buffer.from(r.html, "utf-8") };
}

// 从字段直接生成标签 HTML（兼容镜片明细表，返回结构化对象）
export async function buildLabelHtmlFromFields(f, orderNo) {
  const r = await _renderLabelHtml(f, orderNo);
  if (!r) return null;
  return { orderNo, customer: r.customer, eye: r.eye, lensCode: r.lensCode, html: r.html };
}
