/**
 * order-system/server.js — 代理商订单门户后端（生产级）
 *
 * 接口：
 *   GET  /                     → 下单页
 *   GET  /track                → 查询页
 *   GET  /api/agent?t=xxx      → 代理商信息
 *   GET  /api/skus?t=xxx       → SKU列表 + 实时库存状态（5分钟缓存）
 *   GET  /api/delivery-estimate?t=xxx&sku=xxx&qty=N → 交期预估
 *   POST /api/submit?t=xxx     → 提交订单（智能预处理）
 *   GET  /api/orders?t=xxx     → 订单列表（筛选+分页+统计）
 *   GET  /api/order/:orderNo?t=xxx → 单个订单详情
 *   GET  /api/orders/export?t=xxx  → CSV导出
 *   GET  /api/customers?t=xxx  → 历史客户名列表
 *
 * Usage:
 *   node server.js             # 默认端口 3210
 *   PORT=8080 node server.js
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const QR_DIR = resolve(__dirname, "public", "qrcodes");

// 表 ID（与 automations.js 一致）
const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  order: "tblk9Ch4gk2uQ1zG",
  customer: "tbltXNNhF65EBl17",
  lens_detail: "tblC7pve7ObFgIOl",
  agent: "tblHsgGbJWkB31qu",
};

// ─── 配置 ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(__dirname, "../shared/.env");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

const ENV = loadEnv();

// ─── 代理商管理 ──────────────────────────────────────────────────────────────

let _agentsCache = null;
let _agentsCacheTime = 0;

async function loadAgents() {
  if (Date.now() - _agentsCacheTime < 30000 && _agentsCache) return _agentsCache;
  try {
    const records = await listRecords(TABLES.agent);
    _agentsCache = records
      .filter(r => {
        const status = r.fields["状态"];
        return !status || status === "启用"; // 没有状态字段或状态=启用
      })
      .map(r => ({
        id: r.fields["代理商ID"],
        name: r.fields["代理商名称"],
        token: r.fields["下单Token"],
        phone: r.fields["手机号"] || "",
        address: r.fields["地址"] || "",
        crm_id: r.fields["CRM_ID"] || "",
      }));
    _agentsCacheTime = Date.now();
    return _agentsCache;
  } catch (e) {
    console.error("loadAgents error:", e.message);
    return _agentsCache || [];
  }
}

async function findAgent(token) {
  if (!token) return null;
  const agents = await loadAgents();
  return agents.find(a => a.token === token) || null;
}

// ─── 飞书 API ───────────────────────────────────────────────────────────────

let _feishuToken = "";
let _feishuTokenTime = 0;

async function getFeishuToken() {
  if (Date.now() - _feishuTokenTime < 7000 * 1000 && _feishuToken) return _feishuToken;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  _feishuToken = json.tenant_access_token;
  _feishuTokenTime = Date.now();
  return _feishuToken;
}

async function feishuApi(method, path, body) {
  const token = await getFeishuToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`  飞书 API 错误 [${method} ${path}]:`, json.msg);
    return null;
  }
  return json.data;
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function createRecord(tableId, fields) {
  return feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

async function batchCreateRecords(tableId, records) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    if (!res) return false;
  }
  return true;
}

async function updateRecord(tableId, recordId, fields) {
  return feishuApi("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

// ─── SKU + 库存缓存 ──────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5分钟
let _skuCache = { data: null, time: 0 };

async function getSkusWithInventory() {
  if (_skuCache.data && Date.now() - _skuCache.time < CACHE_TTL) {
    return _skuCache.data;
  }

  const [skuRecords, invRecords] = await Promise.all([
    listRecords(TABLES.sku),
    listRecords(TABLES.finished_inventory),
  ]);

  // 建立库存索引
  const invMap = {};
  for (const r of invRecords) {
    const sku = r.fields["产品型号"];
    if (sku) invMap[sku] = r;
  }

  const skus = [];
  for (const r of skuRecords) {
    const f = r.fields;
    const skuId = f["SKU编号"];
    if (!skuId) continue;

    const type = f["类型"] || "备货品";
    const safetyStock = Number(f["安全库存"]) || 0;
    const deliveryDays = Number(f["标准交期"]) || 3;

    const inv = invMap[skuId];
    const currentStock = Number(inv?.fields["当前库存"]) || 0;
    const inProduction = Number(inv?.fields["在产量"]) || 0;

    let status, statusLabel;
    if (type === "定制品") {
      status = "custom";
      statusLabel = "定制";
    } else if (currentStock >= safetyStock && currentStock > 0) {
      status = "instock";
      statusLabel = "有货";
    } else if (currentStock > 0) {
      status = "low";
      statusLabel = "低库存";
    } else {
      status = "out";
      statusLabel = "缺货";
    }

    const days = type === "定制品" ? 5 : (status === "out" ? 5 : 3);

    skus.push({
      sku: skuId,
      name: f["SKU名称"] || skuId,
      type,
      currentStock,
      inProduction,
      safetyStock,
      status,
      statusLabel,
      deliveryDays: days,
    });
  }

  _skuCache = { data: skus, time: Date.now() };
  return skus;
}

// ─── 产品级 SKU 过滤（无空格 = 产品级，有空格 = 处方级） ──────────────────────

function getModelSkus(allSkus) {
  return allSkus.filter(s => !s.sku.includes(" "));
}

// ─── Rule 1 交期逻辑（从 automations.js 移植） ─────────────────────────────

function estimateDelivery(skuInfo, qty) {
  const now = Date.now();

  if (skuInfo.type === "定制品") {
    return {
      deliveryType: "定制5天",
      days: 5,
      promiseDate: now + 5 * 86400000,
      available: false,
    };
  }

  if (skuInfo.currentStock >= qty) {
    return {
      deliveryType: "有货3天",
      days: 3,
      promiseDate: now + 3 * 86400000,
      available: true,
    };
  }

  return {
    deliveryType: "定制5天",
    days: 5,
    promiseDate: now + 5 * 86400000,
    available: false,
  };
}

// ─── 生成编号 ──────────────────────────────────────────────────────────────

function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${d}-${r}`;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUS-${d}-${r}`;
}

// ─── 客户管理 ──────────────────────────────────────────────────────────────

async function getOrCreateCustomer(agentName) {
  const encoded = encodeURIComponent(`"${agentName}"`);
  const res = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.customer}/records?page_size=1&filter=CurrentValue.[客户名称]=${encoded}`
  );
  if (res?.items?.length > 0) {
    return res.items[0].fields["客户ID"] || "";
  }
  const newId = genCustomerId();
  await createRecord(TABLES.customer, {
    客户ID: newId, 客户名称: agentName, 来源系统: "代理商门户",
  });
  return newId;
}

// ─── 客户名缓存 ──────────────────────────────────────────────────────────────

const _customerCache = {};

async function getCustomerNames(agentId) {
  if (_customerCache[agentId] && Date.now() - _customerCache[agentId].time < 10 * 60 * 1000) {
    return _customerCache[agentId].data;
  }

  const encoded = encodeURIComponent(`"${agentId}"`);
  const names = new Set();
  let pageToken = "";
  while (true) {
    let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const res = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
    if (!res) break;
    for (const r of res.items || []) {
      const name = r.fields["顾客姓名"];
      if (name) names.add(name);
    }
    if (!res.has_more) break;
    pageToken = res.page_token;
  }

  const result = [...names].sort();
  _customerCache[agentId] = { data: result, time: Date.now() };
  return result;
}

// ─── 终端客户缓存 ────────────────────────────────────────────────────────

const _terminalCustomerCache = {};

async function getTerminalCustomers(agentId) {
  if (_terminalCustomerCache[agentId] && Date.now() - _terminalCustomerCache[agentId].time < 10 * 60 * 1000) {
    return _terminalCustomerCache[agentId].data;
  }

  // 从订单表获取该代理商历史下的顾客姓名
  const encoded = encodeURIComponent(`"${agentId}"`);
  const orderNames = new Set();
  let pageToken = "";
  while (true) {
    let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const res = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
    if (!res) break;
    for (const r of res.items || []) {
      const name = r.fields["顾客姓名"];
      if (name) orderNames.add(name);
    }
    if (!res.has_more) break;
    pageToken = res.page_token;
  }

  // 从终端客户表获取完整信息
  const allCustomers = await listRecords(TABLES.customer);
  const result = [];
  for (const r of allCustomers) {
    const name = r.fields["客户名称"];
    if (!name) continue;
    // 匹配条件：名称在订单历史中出现过，或者是有联系信息的CRM同步客户
    const isCrmSync = r.fields["来源系统"] === "CRM同步";
    const hasContactInfo = r.fields["联系人"] || r.fields["联系电话"] || r.fields["收货地址"];
    if (orderNames.has(name) || isCrmSync || hasContactInfo) {
      result.push({
        id: r.fields["客户ID"] || "",
        name,
        contact: r.fields["联系人"] || "",
        phone: r.fields["联系电话"] || "",
        address: r.fields["收货地址"] || "",
      });
    }
  }
  result.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  _terminalCustomerCache[agentId] = { data: result, time: Date.now() };
  return result;
}

// ─── 飞书通知 ──────────────────────────────────────────────────────────────

async function sendNotify(agentName, summary, orderNo) {
  if (!ENV.FEISHU_WEBHOOK_URL) return;
  try {
    await fetch(ENV.FEISHU_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          header: { title: { tag: "plain_text", content: "📋 新订单待处理" }, template: "blue" },
          elements: [{
            tag: "markdown",
            content: `**代理商：** ${agentName}\n**订单号：** ${orderNo}\n**摘要：** ${summary}\n\n请登录飞书多维表查看。`,
          }],
        },
      }),
    });
  } catch (e) {
    console.error("通知发送失败:", e.message);
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function jsonRes(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("无效的 JSON")); }
    });
  });
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function csvEscape(val) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function isAdmin(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const adminToken = url.searchParams.get("admin") || "";
  const envToken = ENV.ADMIN_TOKEN || "";
  return envToken && adminToken === envToken;
}

// ─── 镜片明细 CRUD ──────────────────────────────────────────────────────

async function createLensDetail(orderNo, fields) {
  return createRecord(TABLES.lens_detail, {
    "来源订单号": orderNo,
    ...fields,
  });
}

async function batchCreateLensDetails(records) {
  return batchCreateRecords(TABLES.lens_detail, records);
}

// ─── 镜片码分配（下单即生成） ─────────────────────────────────────────────────

async function assignLensCodes(orderNo) {
  const lensDetails = await getLensDetailsByOrder(orderNo);
  const lensCodes = [];
  for (const rec of lensDetails) {
    const existingCode = rec.fields["镜片码"];
    if (existingCode) { lensCodes.push(existingCode); continue; }
    const code = genLensCode();
    await updateRecord(TABLES.lens_detail, rec.record_id, {
      "镜片码": code,
      "订单状态": "生产中",
    });
    await generateQRPng(code);
    lensCodes.push(code);
    console.log(`  镜片码生成: ${orderNo} → ${code}`);
  }
  return lensCodes;
}

async function getLensDetailsByOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const data = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=100&filter=CurrentValue.[来源订单号]=${encoded}`
  );
  return data?.items || [];
}

// ─── QR 溯源码 ──────────────────────────────────────────────────────────────

function genLensCode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

function getServerBaseUrl() {
  return ENV.SERVER_BASE_URL || `http://localhost:${PORT}`;
}

async function generateQRPng(lensCode) {
  const url = `${getServerBaseUrl()}/verify/${lensCode}`;
  mkdirSync(QR_DIR, { recursive: true });
  const filePath = resolve(QR_DIR, `${lensCode}.png`);
  await QRCode.toFile(filePath, url, {
    errorCorrectionLevel: "H",
    width: 400,
    margin: 2,
  });
  return filePath;
}

// 生成工厂 Excel 文件
function buildFactoryExcel(records, orderNo) {
  const rows = records.map(rec => {
    const f = rec.fields;
    return {
      "订单号": f["来源订单号"] || "",
      "顾客": f["顾客姓名"] || "",
      "产品型号": f["产品型号"] || "",
      "数量": Number(f["数量"]) || 1,
      "眼别": f["眼别"] || "",
      "球镜SPH": f["球镜SPH"] ?? "",
      "柱镜CYL": f["柱镜CYL"] ?? "",
      "轴位AXIS": f["轴位AXIS"] ?? "",
      "瞳距": f["瞳距"] ?? "",
      "瞳高": f["瞳高"] ?? "",
      "镜框型号": f["镜框型号"] || "",
      "镜片码": f["镜片码"] || "",
      "收货地址": f["收货地址"] || "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 6 },
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 18 },
    { wch: 10 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, `订单${orderNo}`);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// 生成可打印 HTML 标签（QR 内嵌为 base64 data URL）
async function buildLabelHtml(record, orderNo) {
  const f = record.fields;
  const lensCode = f["镜片码"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const sku = f["产品型号"] || "";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 200, margin: 2 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:6cm 3cm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:3mm;height:100%}
.label{display:flex;gap:2mm;align-items:center;height:100%}
.qr img{width:18mm;height:18mm;display:block}
.info{flex:1;min-width:0}
.order{font-size:6pt;color:#999;margin-bottom:1mm}
.customer{font-weight:700;font-size:9pt;margin-bottom:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx{font-family:"SF Mono",Menlo,monospace;font-size:7pt;line-height:1.4;color:#333}
.code{font-size:6pt;color:#888;margin-top:1mm;font-family:monospace;word-break:break-all}
.brand{font-size:5pt;color:#bbb;text-align:right;margin-top:1mm}
@media print{body{padding:2mm}}
</style></head><body>
<div class="label">
<div class="qr"><img src="${qrDataUrl}"></div>
<div class="info">
<div class="order">${orderNo}</div>
<div class="customer">${f["顾客姓名"]||""} ${eye}</div>
<div class="rx">${sku} SPH ${sph} CYL ${cyl} ${axis ? "AXIS " + axis : ""}</div>
<div class="code">${lensCode}</div>
<div class="brand">GAUSH | CLEAR</div>
</div></div></body></html>`;

  return { name: `labels/${orderNo}_${customer}_${eye}.html`, data: Buffer.from(html, "utf-8") };
}

// 从字段直接生成标签 HTML（兼容镜片明细表）
async function buildLabelHtmlFromFields(f, orderNo) {
  const lensCode = f["镜片码"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const sku = f["产品型号"] || "";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 200, margin: 2 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:6cm 3cm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:3mm;height:100%}
.label{display:flex;gap:2mm;align-items:center;height:100%}
.qr img{width:18mm;height:18mm;display:block}
.info{flex:1;min-width:0}
.order{font-size:6pt;color:#999;margin-bottom:1mm}
.customer{font-weight:700;font-size:9pt;margin-bottom:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx{font-family:"SF Mono",Menlo,monospace;font-size:7pt;line-height:1.4;color:#333}
.code{font-size:6pt;color:#888;margin-top:1mm;font-family:monospace;word-break:break-all}
.brand{font-size:5pt;color:#bbb;text-align:right;margin-top:1mm}
@media print{body{padding:2mm}}
</style></head><body>
<div class="label">
<div class="qr"><img src="${qrDataUrl}"></div>
<div class="info">
<div class="order">${orderNo}</div>
<div class="customer">${f["顾客姓名"]||""} ${eye}</div>
<div class="rx">${sku} SPH ${sph} CYL ${cyl} ${axis ? "AXIS " + axis : ""}</div>
<div class="code">${lensCode}</div>
<div class="brand">GAUSH | CLEAR</div>
</div></div></body></html>`;

  return { orderNo, customer, eye, lensCode, html };
}

// 构建工厂导出 ZIP
async function buildFactoryZip(records, orderNo) {
  const files = [];

  // Excel 文件
  files.push({ name: `订单_${orderNo}.xlsx`, data: buildFactoryExcel(records, orderNo) });

  // QR + 标签
  for (const rec of records) {
    const f = rec.fields;
    const lensCode = f["镜片码"];
    if (!lensCode) continue;

    const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
    const eye = f["眼别"] || "unknown";

    const qrPath = resolve(QR_DIR, `${lensCode}.png`);
    if (existsSync(qrPath)) {
      files.push({ name: `qrcodes/${lensCode}.png`, data: readFileSync(qrPath) });
    }

    const labelEntry = await buildLabelHtml(rec, orderNo);
    if (labelEntry) files.push(labelEntry);
  }

  // 说明文件
  const labelCount = files.filter(f => f.name.startsWith("labels/")).length;
  const qrCount = files.filter(f => f.name.startsWith("qrcodes/")).length;
  const readme = `工厂打印包 — 订单 ${orderNo}
${"=".repeat(34)}

本压缩包包含：
  订单_${orderNo}.xlsx    订单数据（Excel，可导入工厂系统）
  qrcodes/                ${qrCount} 个原始二维码图片
  labels/                 ${labelCount} 个可打印标签（HTML 格式）

标签使用方法：
  1. 在浏览器中打开 labels/ 下的 HTML 文件
  2. Ctrl+P（Mac: Cmd+P）打印
  3. 推荐标签纸：6cm × 3cm

注意事项：
  - 每个镜片码全球唯一，请勿复制或重复使用
  - 消费者扫描二维码即可验证产品真伪
  - Excel 包含完整处方参数，可直接用于生产排产
`;
  files.push({ name: "说明.txt", data: Buffer.from(readme, "utf-8") });

  return buildZipBuffer(files);
}

// 最小 ZIP 实现（Store 模式，不压缩）
function buildZipBuffer(fileEntries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  const parts = [];

  for (const entry of fileEntries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = entry.data;
    const crc = crc32(data);

    // Local file header
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // compression (store)
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);         // crc32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    nameBuf.copy(local, 30);

    parts.push(local, data);

    // Central directory header
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // compression
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(crc, 16);        // crc32
    central.writeUInt32LE(data.length, 20);// compressed size
    central.writeUInt32LE(data.length, 24);// uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra field length
    central.writeUInt16LE(0, 32);          // file comment length
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attributes
    central.writeUInt32LE(0, 38);          // external attributes
    central.writeUInt32LE(offset, 42);     // relative offset of local header
    nameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...parts, centralDirBuf, eocd]);
}

// CRC32 查找表
const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = _crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 确保镜片码字段存在
async function ensureLensCodeField() {
  const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/fields`);
  if (data?.items?.some(f => f.field_name === "镜片码")) return;
  await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/fields`, {
    field_name: "镜片码",
    type: 1, // 文本
  });
  console.log("  已创建飞书字段: 镜片码");
}

// ─── 路由处理 ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
  res.end(readFileSync(filePath));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const start = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const token = url.searchParams.get("t") || "";

  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // ── 静态页面 ──
    if (pathname === "/" || pathname === "/order" || pathname === "/order.html") {
      serveStatic(res, resolve(__dirname, "public/order.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/track" || pathname === "/track.html") {
      serveStatic(res, resolve(__dirname, "public/track.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/labels" || pathname === "/labels.html") {
      serveStatic(res, resolve(__dirname, "public/labels.html"));
      return logReq(req, 200, start);
    }

    // ── 静态资源 ──
    if (pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname.startsWith("/qrcodes/")) {
      serveStatic(res, resolve(__dirname, "public", pathname.slice(1)));
      return logReq(req, 200, start);
    }

    // ── API: 代理商信息 ──
    if (pathname === "/api/agent") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      jsonRes(res, 200, { id: agent.id, name: agent.name });
      return logReq(req, 200, start);
    }

    // ── API: SKU列表 + 库存状态 ──
    if (pathname === "/api/skus") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const allSkus = await getSkusWithInventory();
      const modelsOnly = url.searchParams.has("models");
      const result = modelsOnly ? getModelSkus(allSkus) : allSkus;
      jsonRes(res, 200, result);
      return logReq(req, 200, start);
    }

    // ── API: 交期预估 ──
    if (pathname === "/api/delivery-estimate") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const skuId = url.searchParams.get("sku") || "";
      const qty = Number(url.searchParams.get("qty")) || 0;

      if (!skuId || qty <= 0) {
        jsonRes(res, 400, { error: "请提供有效的 SKU 和数量" });
        return logReq(req, 400, start);
      }
      if (qty > 100) {
        jsonRes(res, 400, { error: "单笔数量不能超过 100" });
        return logReq(req, 400, start);
      }

      const skus = await getSkusWithInventory();
      const skuInfo = skus.find(s => s.sku === skuId);
      if (!skuInfo) {
        jsonRes(res, 404, { error: "未找到该 SKU" });
        return logReq(req, 404, start);
      }

      const est = estimateDelivery(skuInfo, qty);
      jsonRes(res, 200, { ...est, promiseDateFormatted: formatDate(est.promiseDate) });
      return logReq(req, 200, start);
    }

    // ── API: 客户名列表（兼容：返回名称数组）──
    if (pathname === "/api/customers") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const names = await getCustomerNames(agent.id);
      jsonRes(res, 200, { customers: names });
      return logReq(req, 200, start);
    }

    // ── API: 终端客户列表（含联系人/电话/地址）──
    if (pathname === "/api/terminal-customers") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const customers = await getTerminalCustomers(agent.id);
      jsonRes(res, 200, { customers });
      return logReq(req, 200, start);
    }

    // ── API: 提交订单 ──
    if (pathname === "/api/submit" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const payload = await readBody(req);
      const { address, patients, terminalCustomer } = payload;

      if (!terminalCustomer?.name?.trim()) {
        jsonRes(res, 400, { error: "请填写终端客户" });
        return logReq(req, 400, start);
      }
      if (!terminalCustomer?.contact?.trim()) {
        jsonRes(res, 400, { error: "请填写联系人" });
        return logReq(req, 400, start);
      }
      if (!terminalCustomer?.phone?.trim()) {
        jsonRes(res, 400, { error: "请填写联系电话" });
        return logReq(req, 400, start);
      }
      if (!address?.trim()) {
        jsonRes(res, 400, { error: "请填写收货地址" });
        return logReq(req, 400, start);
      }
      if (!Array.isArray(patients) || patients.length === 0) {
        jsonRes(res, 400, { error: "请至少填写一位患者信息" });
        return logReq(req, 400, start);
      }

      const skus = await getSkusWithInventory();
      const modelSkus = getModelSkus(skus);
      const customerId = await getOrCreateCustomer(agent.name);
      const orderNo = genOrderNo();
      const now = Date.now();
      const orderRecords = [];    // 订单主表记录
      const lensRecords = [];     // 镜片明细表记录
      const items = [];
      let totalLenses = 0;

      for (const p of patients) {
        const { customerName, sku, quantity, eyes, assembly, remark } = p;
        if (!customerName?.trim() || !sku || !quantity || quantity <= 0) continue;
        if (!Array.isArray(eyes) || eyes.length === 0) continue;

        // SKU 软校验：不在产品目录中则 warn，不拒绝
        const skuInfo = skus.find(s => s.sku === sku);
        if (!skuInfo) {
          console.warn(`  ⚠️ SKU "${sku}" not in catalog, accepting anyway`);
        }

        const est = skuInfo ? estimateDelivery(skuInfo, quantity) : { deliveryType: "标准", promiseDate: now + 5 * 86400000 };
        const lensCount = eyes.length;

        // 写入订单主表（每笔患者 = 1 行）
        orderRecords.push({
          fields: {
            "产品型号": sku,
            "数量": quantity * lensCount,
            "订单状态": "待处理",
            "预计交期": est.promiseDate,
            "下单日期": now,
            "顾客姓名": customerName.trim(),
            "代理商名称": agent.name,
            "代理商ID": agent.id,
            "收货地址": address.trim(),
            "订单来源": "代理商门户",
            "客户ID": customerId,
            "是否装配": assembly !== false ? "是" : "否",
            ...(terminalCustomer?.name ? { "终端客户": terminalCustomer.name } : {}),
            ...(terminalCustomer?.contact ? { "联系人": terminalCustomer.contact } : {}),
            ...(terminalCustomer?.phone ? { "联系电话": terminalCustomer.phone } : {}),
            ...(remark?.trim() ? { "备注": remark.trim() } : {}),
          },
        });

        // 写入镜片明细表（每眼 = 1 行）
        for (const eye of eyes) {
          lensRecords.push({
            fields: {
              "来源订单号": orderNo,
              "眼别": eye.side || "",
              "球镜SPH": Number(eye.sph) || 0,
              "柱镜CYL": Number(eye.cyl) || 0,
              "轴位AXIS": Number(eye.axis) || 0,
              "是否装配": assembly !== false ? "是" : "否",
              "产品型号": sku,
              "顾客姓名": customerName.trim(),
              "代理商名称": agent.name,
              "代理商ID": agent.id,
              "订单状态": "待处理",
            },
          });
          totalLenses++;
        }

        // 有货时扣减库存
        if (est.available && skuInfo && skuInfo.currentStock > 0) {
          const invRecords = await listRecords(TABLES.finished_inventory);
          const invRec = invRecords.find(r => r.fields["产品型号"] === sku);
          if (invRec) {
            const newStock = Math.max(0, Number(invRec.fields["当前库存"] || 0) - quantity);
            await updateRecord(TABLES.finished_inventory, invRec.record_id, { "当前库存": newStock });
            skuInfo.currentStock = newStock;
          }
        }

        items.push({
          sku,
          skuName: skuInfo?.name || sku,
          quantity,
          customerName: customerName.trim(),
          deliveryType: est.deliveryType,
          promiseDate: est.promiseDate,
          promiseDateFormatted: formatDate(est.promiseDate),
        });
      }

      if (orderRecords.length === 0) {
        jsonRes(res, 400, { error: "没有有效的订单数据" });
        return logReq(req, 400, start);
      }

      // 写入订单主表
      const okOrder = await batchCreateRecords(TABLES.order, orderRecords);
      if (!okOrder) {
        jsonRes(res, 500, { error: "写入飞书失败（订单主表），请重试" });
        return logReq(req, 500, start);
      }

      // 写入镜片明细表
      if (lensRecords.length > 0) {
        const okLens = await batchCreateRecords(TABLES.lens_detail, lensRecords);
        if (!okLens) {
          console.error(`  ⚠️ 镜片明细写入失败，订单 ${orderNo} 主表已写入`);
        }
      }

      // 下单即生成镜片码+QR（不等确认环节）
      const lensCodes = await assignLensCodes(orderNo);
      if (lensCodes.length > 0) {
        console.log(`  镜片码已生成: ${orderNo} → ${lensCodes.join(", ")}`);
      }

      // 通知
      const summary = items.map(i => `${i.skuName}×${i.quantity}(${i.deliveryType})`).join("、");
      sendNotify(agent.name, summary, orderNo);

      // 清除客户名缓存
      delete _customerCache[agent.id];
      delete _terminalCustomerCache[agent.id];

      jsonRes(res, 200, {
        success: true,
        orderNo,
        items,
        summary: { totalPatients: patients.length, totalLenses },
      });
      return logReq(req, 200, start);
    }

    // ── API: 订单列表（筛选+分页+统计） ──
    if (pathname === "/api/orders") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const filterStatus = url.searchParams.get("status") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 20));

      // 获取该代理商的全部订单
      const encoded = encodeURIComponent(`"${agent.id}"`);
      let allRecords = [];
      let pageToken = "";
      while (true) {
        let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
        if (pageToken) qs += `&page_token=${pageToken}`;
        const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
        if (!data) break;
        allRecords.push(...(data.items || []));
        if (!data.has_more) break;
        pageToken = data.page_token;
      }

      // 转换格式
      let orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          sku: f["产品型号"] || "",
          skuDisplay: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          customerName: f["顾客姓名"] || "",
          date: f["下单日期"] || f["同步时间"] || null,
          promiseDate: f["预计交期"] || null,
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      // 统计（过滤前）
      const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "待处理").length,
        shipped: orders.filter(o => o.status === "已发货" || o.status === "已签收" || o.status === "完成").length,
      };

      // 筛选
      if (filterStatus) orders = orders.filter(o => o.status === filterStatus);
      if (filterSku) orders = orders.filter(o => o.sku === filterSku);
      if (filterFrom) {
        const fromTs = new Date(filterFrom).getTime();
        if (!isNaN(fromTs)) orders = orders.filter(o => o.date && o.date >= fromTs);
      }
      if (filterTo) {
        const toTs = new Date(filterTo + "T23:59:59").getTime();
        if (!isNaN(toTs)) orders = orders.filter(o => o.date && o.date <= toTs);
      }

      // 排序（最新的在前）
      orders.sort((a, b) => (b.date || 0) - (a.date || 0));

      // 分页
      const totalPages = Math.ceil(orders.length / pageSize) || 1;
      const paged = orders.slice((page - 1) * pageSize, page * pageSize);

      jsonRes(res, 200, { orders: paged, stats, page, pageSize, totalPages, totalFiltered: orders.length });
      return logReq(req, 200, start);
    }

    // ── API: 单个订单详情 ──
    if (pathname.startsWith("/api/order/") && pathname.split("/").length === 4) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = pathname.split("/").pop();
      if (!orderNo) {
        jsonRes(res, 400, { error: "缺少订单号" });
        return logReq(req, 400, start);
      }

      const encoded = encodeURIComponent(`"${orderNo}"`);
      const data = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
      );

      if (!data?.items?.length) {
        jsonRes(res, 404, { error: "未找到该订单" });
        return logReq(req, 404, start);
      }

      // 验证权限：只能查自己的订单
      const firstItem = data.items[0];
      if (firstItem.fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权查看此订单" });
        return logReq(req, 403, start);
      }

      const items = data.items.map(r => {
        const f = r.fields;
        return {
          customerName: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
        };
      });

      // 从镜片明细表获取处方数据
      const lensDetails = await getLensDetailsByOrder(orderNo);
      const lenses = lensDetails.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          pd: f["瞳距"],
          ph: f["瞳高"],
          frame: f["镜框型号"] || "",
          lensCode: f["镜片码"] || "",
          status: f["订单状态"] || "",
        };
      });

      jsonRes(res, 200, {
        orderNo,
        date: firstItem.fields["下单日期"] || firstItem.fields["同步时间"],
        address: firstItem.fields["收货地址"] || "",
        remark: firstItem.fields["备注"] || "",
        status: firstItem.fields["订单状态"] || "",
        items,
        lenses,
      });
      return logReq(req, 200, start);
    }

    // ── API: CSV 导出 ──
    if (pathname === "/api/orders/export") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      // 复用 orders 查询逻辑，不分页
      const filterStatus = url.searchParams.get("status") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";

      const encoded = encodeURIComponent(`"${agent.id}"`);
      let allRecords = [];
      let pageToken = "";
      while (true) {
        let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
        if (pageToken) qs += `&page_token=${pageToken}`;
        const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
        if (!data) break;
        allRecords.push(...(data.items || []));
        if (!data.has_more) break;
        pageToken = data.page_token;
      }

      let rows = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
          qty: Number(f["数量"]) || 1,
          agent: f["代理商名称"] || "",
          terminalCustomer: f["终端客户"] || "",
          contact: f["联系人"] || "",
          phone: f["联系电话"] || "",
          assembly: f["是否装配"] || "",
          status: f["订单状态"] || "",
          date: f["下单日期"] ? formatDate(f["下单日期"]) : "",
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      if (filterStatus) rows = rows.filter(r => r.status === filterStatus);
      if (filterSku) rows = rows.filter(r => r.sku === filterSku);
      if (filterFrom) {
        const fromTs = new Date(filterFrom).getTime();
        if (!isNaN(fromTs)) rows = rows.filter(r => r.date >= filterFrom);
      }
      if (filterTo) {
        rows = rows.filter(r => r.date <= filterTo);
      }

      rows.sort((a, b) => a.orderNo.localeCompare(b.orderNo));

      const headers = ["订单号","顾客","终端客户","联系人","电话","产品型号","数量","是否装配","代理商","状态","下单日期","收货地址","备注"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        csvRows.push([r.orderNo, r.customer, r.terminalCustomer, r.contact, r.phone, r.sku, r.qty, r.assembly, r.agent, r.status, r.date, r.address, r.remark].map(csvEscape).join(","));
      }

      const csv = "\uFEFF" + csvRows.join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=orders-${agent.id}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      res.end(csv);
      return logReq(req, 200, start);
    }

    // ── API: 查询订单镜片码 ──
    const lensCodesMatch = pathname.match(/^\/api\/order\/([^/]+)\/lens-codes$/);
    if (lensCodesMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(lensCodesMatch[1]);
      const encodedLC = encodeURIComponent(`"${orderNo}"`);
      const dataLC = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encodedLC}`
      );
      if (!dataLC?.items?.length) { jsonRes(res, 200, { lensCodes: [] }); return logReq(req, 200, start); }

      if (dataLC.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权查看" }); return logReq(req, 403, start);
      }

      const codes = dataLC.items.map(r => r.fields["镜片码"]).filter(Boolean);
      jsonRes(res, 200, { lensCodes: codes });
      return logReq(req, 200, start);
    }

    // ── API: 确认订单 → 生成镜片码 + QR ──
    const confirmMatch = pathname.match(/^\/api\/order\/([^/]+)\/confirm$/);
    if (confirmMatch && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(confirmMatch[1]);

      // 查飞书订单
      const encoded2 = encodeURIComponent(`"${orderNo}"`);
      const data2 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded2}`
      );
      if (!data2?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      // 权限校验
      if (data2.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权操作此订单" }); return logReq(req, 403, start);
      }

      // 确保镜片码字段存在
      await ensureLensCodeField();

      // 幂等：调用 assignLensCodes，已有码的自动跳过
      const lensCodes = await assignLensCodes(orderNo);

      // 更新主表状态为生产中（无论镜片码是否已存在）
      if (data2.items.length > 0) {
        await updateRecord(TABLES.order, data2.items[0].record_id, {
          "订单状态": "生产中",
          ...(lensCodes.length > 0 ? { "镜片码": lensCodes.join(",") } : {}),
        });
      }

      jsonRes(res, 200, { success: true, orderNo, lensCodes });
      return logReq(req, 200, start);
    }

    // ── API: 下载 QR 码 ──
    const qrMatch = pathname.match(/^\/api\/order\/([^/]+)\/qrcode$/);
    if (qrMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(qrMatch[1]);
      const encoded3 = encodeURIComponent(`"${orderNo}"`);
      const data3 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded3}`
      );
      if (!data3?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      const codes = data3.items.map(r => r.fields["镜片码"]).filter(Boolean);
      if (codes.length === 0) { jsonRes(res, 400, { error: "该订单尚未生成镜片码，请先确认订单" }); return logReq(req, 400, start); }

      // 返回第一个镜片的 QR（可扩展为批量下载 ZIP）
      const filePath = resolve(QR_DIR, `${codes[0]}.png`);
      if (!existsSync(filePath)) { jsonRes(res, 404, { error: "QR 文件不存在" }); return logReq(req, 404, start); }
      serveStatic(res, filePath);
      return logReq(req, 200, start);
    }

    // ── API: 工厂导出 ZIP ──
    const zipMatch = pathname.match(/^\/api\/order\/([^/]+)\/factory-zip$/);
    if (zipMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(zipMatch[1]);
      const encoded4 = encodeURIComponent(`"${orderNo}"`);
      const data4 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded4}`
      );
      if (!data4?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      if (data4.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权操作此订单" }); return logReq(req, 403, start);
      }

      const zipBuf = await buildFactoryZip(data4.items, orderNo);

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=factory-${orderNo}.zip`,
      });
      res.end(zipBuf);
      return logReq(req, 200, start);
    }

    // ── 验真页面（无 auth）──
    const verifyMatch = pathname.match(/^\/verify\/([A-Fa-f0-9]+)$/);
    if (verifyMatch) {
      const lensCode = verifyMatch[1].toUpperCase();
      const encoded5 = encodeURIComponent(`"${lensCode}"`);
      const data5 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=1&filter=CurrentValue.[镜片码]=${encoded5}`
      );

      let found = false;
      let orderInfo = {};
      if (data5?.items?.length > 0) {
        found = true;
        const f = data5.items[0].fields;
        const srcOrderNo = f["订单编号"] || "";

        // 从镜片明细表获取处方数据
        const lensDetails = await getLensDetailsByOrder(srcOrderNo);
        const leftEye = lensDetails.find(r => r.fields["眼别"] === "左眼");
        const rightEye = lensDetails.find(r => r.fields["眼别"] === "右眼");

        orderInfo = {
          orderNo: srcOrderNo,
          customerName: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
          date: formatDate(f["下单日期"]),
          leftSph: leftEye?.fields["球镜SPH"] ?? "",
          leftCyl: leftEye?.fields["柱镜CYL"] ?? "",
          rightSph: rightEye?.fields["球镜SPH"] ?? "",
          rightCyl: rightEye?.fields["柱镜CYL"] ?? "",
        };
      }

      // 读取 verify.html 模板并渲染
      let html = readFileSync(resolve(__dirname, "public/verify.html"), "utf-8");
      html = html.replace("{{FOUND}}", found ? "true" : "false");
      html = html.replace("{{LENS_CODE}}", lensCode);
      html = html.replace("{{ORDER_NO}}", orderInfo.orderNo || "");
      html = html.replace("{{CUSTOMER_NAME}}", orderInfo.customerName || "");
      html = html.replace("{{SKU}}", orderInfo.sku || "");
      html = html.replace("{{DATE}}", orderInfo.date || "");
      html = html.replace("{{LEFT_SPH}}", String(orderInfo.leftSph ?? "—"));
      html = html.replace("{{LEFT_CYL}}", String(orderInfo.leftCyl ?? "—"));
      html = html.replace("{{RIGHT_SPH}}", String(orderInfo.rightSph ?? "—"));
      html = html.replace("{{RIGHT_CYL}}", String(orderInfo.rightCyl ?? "—"));
      html = html.replace("{{NOW}}", new Date().toLocaleString("zh-CN"));

      res.writeHead(found ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return logReq(req, found ? 200 : 404, start);
    }

    // ── 管理端 API（简单密码鉴权） ──────────────────────────────────────

    // GET /api/admin/orders — 全部订单列表（管理端，无代理商过滤）
    if (pathname === "/api/admin/orders") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const filterStatus = url.searchParams.get("status") || "";
      const filterAgent = url.searchParams.get("agent") || "";
      const filterQ = url.searchParams.get("q") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 50));

      const allRecords = await listRecords(TABLES.order);

      let orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customerName: f["顾客姓名"] || "",
          agentName: f["代理商名称"] || "",
          agentId: f["代理商ID"] || "",
          sku: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          date: f["下单日期"] || f["同步时间"] || null,
          lensCode: f["镜片码"] || "",
        };
      });

      // 统计
      const agents = [...new Set(orders.map(o => o.agentName).filter(Boolean))].sort();
      const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "待处理").length,
        producing: orders.filter(o => o.status === "生产中").length,
        shipped: orders.filter(o => o.status === "已发货").length,
        received: orders.filter(o => o.status === "已签收").length,
      };

      // 筛选
      if (filterStatus) orders = orders.filter(o => o.status === filterStatus);
      if (filterAgent) orders = orders.filter(o => o.agentName === filterAgent);
      if (filterQ) orders = orders.filter(o => o.orderNo.includes(filterQ) || o.customerName.includes(filterQ));
      if (filterFrom) {
        const fromTs = new Date(filterFrom).getTime();
        if (!isNaN(fromTs)) orders = orders.filter(o => o.date && o.date >= fromTs);
      }
      if (filterTo) {
        const toTs = new Date(filterTo + "T23:59:59").getTime();
        if (!isNaN(toTs)) orders = orders.filter(o => o.date && o.date <= toTs);
      }

      orders.sort((a, b) => (b.date || 0) - (a.date || 0));
      const totalPages = Math.ceil(orders.length / pageSize) || 1;
      const paged = orders.slice((page - 1) * pageSize, page * pageSize);

      jsonRes(res, 200, { orders: paged, stats, agents, page, pageSize, totalPages, totalFiltered: orders.length });
      return logReq(req, 200, start);
    }

    // GET /api/admin/order/:orderNo/lens-details — 获取某订单镜片明细
    const adminLensMatch = pathname.match(/^\/api\/admin\/order\/([^/]+)\/lens-details$/);
    if (adminLensMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(adminLensMatch[1]);
      const details = await getLensDetailsByOrder(orderNo);
      const lenses = details.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"] ?? "",
          cyl: f["柱镜CYL"] ?? "",
          axis: f["轴位AXIS"] ?? "",
          pd: f["瞳距"] ?? "",
          ph: f["瞳高"] ?? "",
          frame: f["镜框型号"] || "",
          lensCode: f["镜片码"] || "",
          sku: f["产品型号"] || "",
          customerName: f["顾客姓名"] || "",
          status: f["订单状态"] || "",
        };
      });
      jsonRes(res, 200, { orderNo, lenses });
      return logReq(req, 200, start);
    }

    // GET /api/admin/labels/batch — 批量生成标签 HTML
    const adminLabelsMatch = pathname.match(/^\/api\/admin\/labels\/batch$/);
    if (adminLabelsMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const allLabels = [];

      for (const orderNo of orderNos) {
        const details = await getLensDetailsByOrder(orderNo);
        for (const rec of details) {
          const f = rec.fields;
          if (!f["镜片码"]) continue;
          const html = await buildLabelHtmlFromFields(f, orderNo);
          if (html) allLabels.push(html);
        }
      }

      jsonRes(res, 200, { labels: allLabels, count: allLabels.length });
      return logReq(req, 200, start);
    }

    // ── 404 ──
    jsonRes(res, 404, { error: "Not found" });
    logReq(req, 404, start);

  } catch (err) {
    console.error("Server error:", err);
    jsonRes(res, 500, { error: "服务器内部错误" });
    logReq(req, 500, start);
  }
});

function logReq(req, status, start) {
  console.log(`  ${req.method} ${req.url} → ${status} (${Date.now() - start}ms)`);
}

server.listen(PORT, () => {
  console.log(`\n🚀 代理商门户启动: http://localhost:${PORT}`);
  console.log(`   下单页: http://localhost:${PORT}/order?t=<token>`);
  console.log(`   追踪页: http://localhost:${PORT}/track?t=<token>`);
  console.log(`\n   按 Ctrl+C 停止\n`);
});
