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
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import QRCode from "qrcode";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = "https://open.feishu.cn/open-apis";
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
  // 依次尝试 shared/.env → ../.env（兼容不同部署目录）
  const candidates = [
    resolve(__dirname, "../shared/.env"),
    resolve(__dirname, "../.env"),
    resolve(__dirname, ".env"),
  ];
  const env = {};
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      const key = k.trim();
      if (!(key in env)) env[key] = v.join("=").trim(); // 先找到的优先
    }
  }
  return env;
}

const ENV = loadEnv();

// 飞书多维表格 App Token（从环境变量读取，不硬编码在源码）
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || process.env.FEISHU_APP_TOKEN || "";
if (!APP_TOKEN) {
  console.error("❌ 缺少 FEISHU_APP_TOKEN，请在 .env 中配置");
  process.exit(1);
}

// ─── MiMo 大模型 ─────────────────────────────────────────────────────────────

async function callMiMo(systemPrompt, userPrompt) {
  const url = ENV.MIMO_API_URL + "/chat/completions";
  const body = {
    model: "mimo-v2-pro",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + ENV.MIMO_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.choices?.[0]?.message?.content || "";
}

// Excel 解析缓存（fileHash → result）
const _excelCache = new Map();

async function handleExcelUpload(file) {
  // 1. 解析 Excel
  const buffer = Buffer.from(file.data, "base64");

  // 文件哈希缓存 — 同一文件秒回
  const fileHash = createHash("md5").update(buffer).digest("hex");
  if (_excelCache.has(fileHash)) return _excelCache.get(fileHash);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const allRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  if (allRows.length < 2) return { patients: [], warnings: ["Excel 内容为空或无数据行"] };

  // 2. 找表头行（包含"顾客姓名"的行）
  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].some(c => String(c || "").includes("顾客姓名"))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    // 兜底：用第一行当表头
    headerIdx = 0;
  }

  const headers = allRows[headerIdx].map(c => String(c || "").trim());

  // 模糊匹配列
  const findCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx >= 0) return idx;
    idx = headers.findIndex(h => h.startsWith(name) || h.includes(name));
    return idx;
  };

  // 3. 解析数据行
  const dataRows = allRows.slice(headerIdx + 1, headerIdx + 21); // 最多20行
  const warnings = [];
  const patients = [];
  let lastCustomerName = "";

  for (const row of dataRows) {
    // 跳过空行
    if (!row.some(c => c != null && String(c).trim() !== "")) continue;

    const get = (name) => {
      const idx = findCol(name);
      return idx >= 0 ? row[idx] : undefined;
    };

    const customerName = String(get("顾客姓名") || "").trim();
    const eye = String(get("眼别") || "").trim();
    const productModel = String(get("产品型号") || "").trim();
    const sph = get("球镜");
    const cyl = get("柱镜");
    const axis = get("轴位");
    const qty = get("数量（副）") || get("数量") || 1;
    const remark = String(get("备注") || "").trim();

    // 填充顾客姓名（Excel 中同组可能只填第一行）
    const name = customerName || lastCustomerName;
    if (customerName) lastCustomerName = customerName;

    if (!name) continue;

    // 查找已有患者或新建
    let patient = patients.find(p => p.customerName === name);
    if (!patient) {
      patient = { customerName: name, sku: productModel, quantity: Number(qty) || 1, eyes: [], assembly: false, remark: "" };
      patients.push(patient);
    }
    if (productModel) patient.sku = productModel;
    if (remark && !patient.remark.includes(remark)) {
      patient.remark = patient.remark ? patient.remark + "；" + remark : remark;
    }

    // 添加眼别
    if (eye) {
      const toRx = (v) => {
        if (v == null || v === "") return "0";
        const s = String(v).trim().toUpperCase();
        if (s === "PL" || s === "PLANO" || s.includes("平光")) return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.round(n * 4) / 4);
      };
      const toAxis = (v) => {
        if (v == null || v === "") return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.min(180, Math.max(0, Math.round(n))));
      };
      patient.eyes.push({
        side: eye.includes("右") ? "右眼" : eye.includes("左") ? "左眼" : eye,
        sph: toRx(sph),
        cyl: toRx(cyl),
        axis: toAxis(axis),
      });
    }
  }

  // 4. SKU 校验
  const allSkus = await getSkusWithInventory();
  const modelSkus = getModelSkus(allSkus);
  const skuSet = new Set(modelSkus.map(s => s.sku));
  for (const p of patients) {
    if (!p.sku) p.sku = modelSkus[0]?.sku || "";
    if (!skuSet.has(p.sku)) {
      warnings.push(`SKU "${p.sku}" 未在产品目录中，已保留原值`);
    }
  }

  if (patients.length === 0) {
    warnings.push("未找到有效数据行，请检查列名是否包含「顾客姓名」「眼别」「球镜」等");
  }

  const result = { patients, warnings };
  if (_excelCache.size >= 50) _excelCache.delete(_excelCache.keys().next().value);
  _excelCache.set(fileHash, result);
  return result;
}

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

// 硬编码产品列表（Bitable SKU表已删除）
const HARDCODED_SKUS = [
  { sku: "Ultra双效", name: "Ultra双效", type: "备货品", currentStock: 100, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "D8", name: "D8", type: "备货品", currentStock: 100, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "时空之眼A", name: "时空之眼A", type: "备货品", currentStock: 50, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "时空之眼B", name: "时空之眼B", type: "备货品", currentStock: 50, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "时空之眼PRO", name: "时空之眼PRO", type: "备货品", currentStock: 50, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "时空之眼MAX", name: "时空之眼MAX", type: "备货品", currentStock: 50, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
  { sku: "小旋风", name: "小旋风", type: "备货品", currentStock: 50, safetyStock: 10, status: "instock", statusLabel: "有货", deliveryDays: 3 },
];

async function getSkusWithInventory() {
  if (_skuCache.data && Date.now() - _skuCache.time < CACHE_TTL) {
    return _skuCache.data;
  }
  _skuCache = { data: HARDCODED_SKUS, time: Date.now() };
  return HARDCODED_SKUS;
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
  const r = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${d}-${r}`;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(2).toString("hex").toUpperCase();
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

// ─── 飞书 App 卡片通知（群聊）──────────────────────────────────────────

let _notifyToken = "", _notifyTokenTime = 0;
async function getNotifyToken() {
  if (Date.now() - _notifyTokenTime < 7000000 && _notifyToken) return _notifyToken;
  if (!ENV.NOTIFY_APP_ID || !ENV.NOTIFY_APP_SECRET) return null;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.NOTIFY_APP_ID, app_secret: ENV.NOTIFY_APP_SECRET }),
  });
  const json = await r.json();
  _notifyToken = json.tenant_access_token || "";
  _notifyTokenTime = Date.now();
  return _notifyToken;
}

async function sendFeishuCard(card) {
  const chatId = ENV.NOTIFY_CHAT_ID;
  if (!chatId) return;
  try {
    const token = await getNotifyToken();
    if (!token) return;
    await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) }),
    });
  } catch (e) {
    console.error("飞书卡片通知失败:", e.message);
  }
}

function shipCard({ orderNo, customerName, sku, agentName, courierName, trackingNo, lensCount }) {
  return {
    header: { title: { tag: "plain_text", content: "🚚 订单已发货" }, template: "blue" },
    elements: [
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
        { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
        { is_short: true, text: { tag: "lark_md", content: `**镜片数**\n${lensCount} 片` } },
      ]},
      { tag: "hr" },
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**快递公司**\n${courierName}` } },
        { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${trackingNo}\`` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
      ]},
      { tag: "note", elements: [{ tag: "plain_text", content: `发货时间：${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
    ],
  };
}

function deliveredCard({ orderNo, customerName, sku, agentName, signedAt }) {
  return {
    header: { title: { tag: "plain_text", content: "✅ 消费者已签收" }, template: "green" },
    elements: [
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
        { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
        { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
      ]},
      { tag: "hr" },
      { tag: "markdown", content: `🎉 **订单全流程完成！**\n下单 → 生产 → 发货 → **签收 ✓**\n签收时间：${signedAt}` },
    ],
  };
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

// 允许的跨域来源（从 .env 读取，支持逗号分隔多个）
const ALLOWED_ORIGINS = (ENV.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

function setCorsHeader(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
    // 已配置来源 or 本地开发未配置时允许
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  // 未在白名单内的来源不设 CORS header，浏览器会拒绝
}

function jsonRes(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

// 默认请求体上限 1MB，Excel 上传端点单独校验 5MB
const DEFAULT_BODY_LIMIT = 1 * 1024 * 1024;

function readBody(req, limitBytes = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on("data", chunk => {
      received += chunk.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error(`请求体过大（限制 ${Math.round(limitBytes / 1024)}KB）`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("无效的 JSON")); }
    });
  });
}

// ─── Rate Limiting（基于 IP，内存滑动窗口）────────────────────────────────
const _rateLimitMap = new Map(); // ip → { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟
const RATE_LIMIT_MAX = 60;              // 通用端点：60次/分钟

// 验真端点专用：防止镜片码枚举
const VERIFY_RATE_LIMIT_MAX = 20;       // 20次/分钟

function checkRateLimit(ip, maxPerWindow = RATE_LIMIT_MAX) {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // 新窗口
    _rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  _rateLimitMap.set(ip, entry);
  return entry.count <= maxPerWindow;
}

// 定期清理过期条目（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) _rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(val) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function isAdmin(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const adminToken = url.searchParams.get("admin") || "";
  const envToken = ENV.ADMIN_TOKEN || "";
  if (!envToken || !adminToken) return false;
  try {
    const a = Buffer.from(adminToken.padEnd(64), "utf-8").slice(0, 64);
    const b = Buffer.from(envToken.padEnd(64), "utf-8").slice(0, 64);
    return timingSafeEqual(a, b) && adminToken === envToken;
  } catch {
    return false;
  }
}

// ─── 镜片明细 CRUD ──────────────────────────────────────────────────────

async function createLensDetail(orderNo, fields) {
  return createRecord(TABLES.lens_detail, {
    "订单编号": orderNo,
    ...fields,
  });
}

async function batchCreateLensDetails(records) {
  return batchCreateRecords(TABLES.lens_detail, records);
}

// ─── 镜片码分配（下单即生成） ─────────────────────────────────────────────────

async function assignLensCodes(orderNo, customerName) {
  let lensDetails = await getLensDetailsByOrder(orderNo);
  // 按客户名过滤（②-1）
  if (customerName) {
    lensDetails = lensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName);
  }
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
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
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
// orderInfo: { remark, address, contact, phone } 来自订单主表，lens records 没有这些字段
function buildFactoryExcel(records, orderNo, orderInfo = {}) {
  const { remark: orderRemark = "", address = "", contact = "", phone = "" } = orderInfo;
  const sorted = [...records].sort((a, b) => String(a.fields["顾客姓名"] || "").localeCompare(String(b.fields["顾客姓名"] || ""), "zh-CN"));
  const rows = sorted.map(rec => {
    const f = rec.fields;
    return {
      "订单号": f["订单编号"] || "",
      "顾客": f["顾客姓名"] || "",
      "产品型号": f["产品型号"] || "",
      "数量": Number(f["数量"]) || 1,
      "眼别": f["眼别"] || "",
      "球镜SPH": f["球镜SPH"] ?? "",
      "柱镜CYL": f["柱镜CYL"] ?? "",
      "轴位AXIS": f["轴位AXIS"] ?? "",
      "镜片码": f["镜片码"] || "",
      "是否装配": f["是否装配"] || "",
      "联系人": contact,
      "联系电话": phone,
      "收货地址": address,
      "备注": f["备注"] || "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 6 },
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, `订单${orderNo}`.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// 生成可打印 HTML 标签（QR 内嵌为 base64 data URL）
async function buildLabelHtml(record, orderNo) {
  const f = record.fields;
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

  const fmt = (v) => {
    if (v === "" || v === null || v === undefined) return "--";
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return (n >= 0 ? "+" : "") + n.toFixed(2);
  };
  const fmtAxis = (v) => (v === "" || v === null || v === undefined || Number(v) === 0) ? "--" : `${v}`;

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:80mm 50mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:80mm;height:50mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:7pt;background:#fff;overflow:hidden}
.label{width:80mm;height:50mm;display:flex;flex-direction:column;border:.3mm solid #ddd}
.header{display:flex;align-items:center;justify-content:space-between;background:${eyeColor};color:#fff;padding:1mm 2.5mm;height:8mm;flex-shrink:0}
.eye-badge{font-size:11pt;font-weight:900;letter-spacing:1px}
.brand{font-size:7.5pt;font-weight:700;letter-spacing:1.5px;opacity:.92}
.order-no{font-size:5.5pt;opacity:.85;font-family:monospace}
.body{display:flex;flex:1;padding:1.5mm 2mm 1mm;gap:2mm;background:${eyeBg}}
.info{flex:1;display:flex;flex-direction:column;gap:.5mm;min-width:0}
.customer-row{display:flex;align-items:baseline;gap:1.5mm;border-bottom:.2mm solid ${eyeColor}44;padding-bottom:1mm;margin-bottom:.5mm}
.customer-name{font-size:10pt;font-weight:800;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28mm}
.sku-name{font-size:6.5pt;color:${eyeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-grid{display:grid;grid-template-columns:auto auto auto;column-gap:2.5mm;row-gap:.3mm;margin:.5mm 0}
.rx-label{font-size:5pt;color:#888;text-transform:uppercase;letter-spacing:.3px}
.rx-value{font-size:9pt;font-weight:700;color:#1a1a2e;font-family:"SF Mono","Consolas",monospace;line-height:1.1}
.rx-value.hl{color:${eyeColor}}
.meta-row{display:flex;gap:2mm;margin-top:.5mm;flex-wrap:wrap}
.meta-item{display:flex;align-items:center;gap:.8mm}
.meta-label{font-size:5pt;color:#aaa}
.meta-value{font-size:6pt;color:#444;font-weight:600}
.qr-col{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;flex-shrink:0}
.qr-col img{width:18mm;height:18mm;display:block;border:.3mm solid #ddd;border-radius:1mm}
.qr-label{font-size:4pt;color:#bbb;text-align:center}
.footer{display:flex;align-items:center;justify-content:space-between;background:#f8f9fa;border-top:.2mm solid #e9ecef;padding:.8mm 2.5mm;height:6.5mm;flex-shrink:0}
.lens-code{font-family:"Courier New",monospace;font-size:6pt;font-weight:700;color:#495057;letter-spacing:1px}
.footer-meta{display:flex;flex-direction:column;align-items:flex-end}
.agent-tag{font-size:4.5pt;color:#ccc;margin-top:.2mm}
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

  return { name: `labels/${orderNo}_${customer}_${eye}.html`, data: Buffer.from(html, "utf-8") };
}

// 从字段直接生成标签 HTML（兼容镜片明细表）
async function buildLabelHtmlFromFields(f, orderNo) {
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

  const fmt = (v) => {
    if (v === "" || v === null || v === undefined) return "--";
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return (n >= 0 ? "+" : "") + n.toFixed(2);
  };
  const fmtAxis = (v) => (v === "" || v === null || v === undefined || Number(v) === 0) ? "--" : `${v}`;

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:80mm 50mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:80mm;height:50mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:7pt;background:#fff;overflow:hidden}
.label{width:80mm;height:50mm;display:flex;flex-direction:column;border:.3mm solid #ddd}
.header{display:flex;align-items:center;justify-content:space-between;background:${eyeColor};color:#fff;padding:1mm 2.5mm;height:8mm;flex-shrink:0}
.eye-badge{font-size:11pt;font-weight:900;letter-spacing:1px}
.brand{font-size:7.5pt;font-weight:700;letter-spacing:1.5px;opacity:.92}
.order-no{font-size:5.5pt;opacity:.85;font-family:monospace}
.body{display:flex;flex:1;padding:1.5mm 2mm 1mm;gap:2mm;background:${eyeBg}}
.info{flex:1;display:flex;flex-direction:column;gap:.5mm;min-width:0}
.customer-row{display:flex;align-items:baseline;gap:1.5mm;border-bottom:.2mm solid ${eyeColor}44;padding-bottom:1mm;margin-bottom:.5mm}
.customer-name{font-size:10pt;font-weight:800;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28mm}
.sku-name{font-size:6.5pt;color:${eyeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-grid{display:grid;grid-template-columns:auto auto auto;column-gap:2.5mm;row-gap:.3mm;margin:.5mm 0}
.rx-label{font-size:5pt;color:#888;text-transform:uppercase;letter-spacing:.3px}
.rx-value{font-size:9pt;font-weight:700;color:#1a1a2e;font-family:"SF Mono","Consolas",monospace;line-height:1.1}
.rx-value.hl{color:${eyeColor}}
.meta-row{display:flex;gap:2mm;margin-top:.5mm;flex-wrap:wrap}
.meta-item{display:flex;align-items:center;gap:.8mm}
.meta-label{font-size:5pt;color:#aaa}
.meta-value{font-size:6pt;color:#444;font-weight:600}
.qr-col{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;flex-shrink:0}
.qr-col img{width:18mm;height:18mm;display:block;border:.3mm solid #ddd;border-radius:1mm}
.qr-label{font-size:4pt;color:#bbb;text-align:center}
.footer{display:flex;align-items:center;justify-content:space-between;background:#f8f9fa;border-top:.2mm solid #e9ecef;padding:.8mm 2.5mm;height:6.5mm;flex-shrink:0}
.lens-code{font-family:"Courier New",monospace;font-size:6pt;font-weight:700;color:#495057;letter-spacing:1px}
.footer-meta{display:flex;flex-direction:column;align-items:flex-end}
.agent-tag{font-size:4.5pt;color:#ccc;margin-top:.2mm}
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

  return { orderNo, customer, eye, lensCode, html };
}

// 构建工厂导出 ZIP
// orderInfo: { remark, address, contact, phone } 来自订单主表
async function buildFactoryZip(records, orderNo, orderInfo = {}) {
  const files = [];

  // Excel 文件
  files.push({ name: `订单_${orderNo}.xlsx`, data: buildFactoryExcel(records, orderNo, orderInfo) });

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

  // CORS
  setCorsHeader(req, res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate Limiting（全局）
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const verifyLimit = pathname.startsWith("/verify/") ? VERIFY_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  if (!checkRateLimit(clientIp, verifyLimit)) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "请求过于频繁，请稍后再试" }));
    return logReq(req, 429, start);
  }

  try {
    // ── 静态页面 ──
    if (pathname === "/login" || pathname === "/login.html") {
      serveStatic(res, resolve(__dirname, "public/login.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/admin" || pathname === "/admin-login" || pathname === "/admin-login.html") {
      serveStatic(res, resolve(__dirname, "public/admin-login.html"));
      return logReq(req, 200, start);
    }
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

      // 预校验：收集所有患者错误，有任何错误则整体拒绝
      const validationErrors = [];
      for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        const label = `患者${i + 1}（${p.customerName || "未填姓名"}）`;
        if (!p.customerName?.trim()) { validationErrors.push(`${label}：缺少顾客姓名`); continue; }
        if (!p.sku) { validationErrors.push(`${label}：缺少产品型号`); continue; }
        if (!p.quantity || p.quantity <= 0) { validationErrors.push(`${label}：数量必须大于 0`); continue; }
        if (!Array.isArray(p.eyes) || p.eyes.length === 0) { validationErrors.push(`${label}：请至少填写一只眼的处方`); continue; }
        const skuMatch = skus.find(s => s.sku === p.sku);
        if (!skuMatch) { validationErrors.push(`${label}：产品型号 "${p.sku}" 不在产品目录中`); }
      }
      if (validationErrors.length > 0) {
        jsonRes(res, 400, { error: "部分数据无效，请检查后重新提交", details: validationErrors });
        return logReq(req, 400, start);
      }

      const customerId = await getOrCreateCustomer(agent.name);
      const orderNo = genOrderNo();
      const now = Date.now();
      const orderRecords = [];    // 订单主表记录
      const lensRecords = [];     // 镜片明细表记录
      const items = [];
      let totalLenses = 0;

      for (const p of patients) {
        const { customerName, sku, quantity, eyes, assembly, remark } = p;
        const skuInfo = skus.find(s => s.sku === sku);

        const est = skuInfo ? estimateDelivery(skuInfo, quantity) : { deliveryType: "标准", promiseDate: now + 5 * 86400000 };
        const lensCount = eyes.length;

        // 写入订单主表（每笔患者 = 1 行）
        orderRecords.push({
          fields: {
            "订单编号": orderNo,
            "产品型号": sku,
            "数量": quantity * 2,
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
              "订单编号": orderNo,
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

        // 库存扣减（SKU表已硬编码，跳过Bitable写入）
        if (skuInfo && skuInfo.currentStock > 0) {
          skuInfo.currentStock = Math.max(0, skuInfo.currentStock - quantity);
        }

        items.push({
          sku,
          skuName: skuInfo?.name || sku,
          quantity,
          lensCount: quantity * 2,
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

      // 镜片码+QR 异步生成（不阻塞下单返回），带重试
      (async () => {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const codes = await assignLensCodes(orderNo);
            if (codes.length > 0) {
              console.log(`  镜片码已生成: ${orderNo} → ${codes.join(", ")}`);
              // 镜片码权威来源是镜片明细表，不在此处回写到订单主表
              // 回写留到 confirm 时按 customerName 过滤后写入
            }
            break; // 成功则退出重试
          } catch (e) {
            console.error(`  镜片码生成失败 (尝试 ${attempt}/${maxRetries}): ${orderNo}`, e.message);
            if (attempt === maxRetries) {
              // 全部重试失败：在订单主表标记错误状态
              try {
                const encoded = encodeURIComponent(`"${orderNo}"`);
                const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
                for (const rec of d?.items || []) {
                  await updateRecord(TABLES.order, rec.record_id, { "备注": `[系统] 镜片码生成失败，请人工处理` });
                }
              } catch { /* 标记失败不影响主流程 */ }
            }
          }
        }
      })();

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
      const filterSearch = url.searchParams.get("search") || "";
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
        producing: orders.filter(o => o.status === "生产中").length,
        shipped: orders.filter(o => o.status === "已发货").length,
        received: orders.filter(o => o.status === "已签收").length,
      };

      // 筛选
      orders = applyOrderFilters(orders, { filterStatus, filterSku, filterFrom, filterTo, filterSearch });

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
          remark: f["备注"] || "",
        };
      });

      // 从镜片明细表获取处方数据，合并到 items
      const lensDetails = await getLensDetailsByOrder(orderNo);
      const lenses = lensDetails.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          lensCode: f["镜片码"] || "",
          status: f["订单状态"] || "",
          customerName: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
        };
      });

      // 如果有镜片明细，用镜片明细替换 items（含处方数据），并合并备注
      const remarkMap = {};
      for (const it of items) {
        if (it.customerName && it.remark) remarkMap[it.customerName] = it.remark;
      }
      const displayItems = lenses.length > 0 ? lenses.map(l => ({
        ...l,
        remark: remarkMap[l.customerName] || "",
      })) : items;

      jsonRes(res, 200, {
        orderNo,
        date: firstItem.fields["下单日期"] || firstItem.fields["同步时间"],
        address: firstItem.fields["收货地址"] || "",
        status: firstItem.fields["订单状态"] || "",
        courier: firstItem.fields["物流公司"] || "",
        trackingNo: firstItem.fields["快递单号"] || "",
        shipTime: firstItem.fields["发货时间"] || null,
        items: displayItems,
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
          promiseDate: f["预计交期"] ? formatDate(f["预计交期"]) : "",
          courier: f["物流公司"] || "",
          trackingNo: f["快递单号"] || "",
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      // rows 中 date 已格式化为字符串，转换回时间戳以复用过滤函数
      rows = rows.map(r => ({ ...r, date: r.date ? new Date(r.date).getTime() || null : null }));
      rows = applyOrderFilters(rows, { filterStatus, filterSku, filterFrom, filterTo });
      // 还原 date 为格式化字符串
      rows = rows.map(r => ({ ...r, date: r.date ? formatDate(r.date) : "" }));

      rows.sort((a, b) => a.orderNo.localeCompare(b.orderNo));

      const headers = ["订单号","顾客","终端客户","联系人","电话","产品型号","数量","是否装配","代理商","状态","下单日期","预计交期","物流公司","快递单号","收货地址","备注"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        csvRows.push([r.orderNo, r.customer, r.terminalCustomer, r.contact, r.phone, r.sku, r.qty, r.assembly, r.agent, r.status, r.date, r.promiseDate, r.courier, r.trackingNo, r.address, r.remark].map(csvEscape).join(","));
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
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=1&filter=CurrentValue.[订单编号]=${encoded4}`
      );
      if (!data4?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      if (data4.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权操作此订单" }); return logReq(req, 403, start);
      }

      const of4 = data4.items[0].fields;
      const orderInfo4 = {
        remark: of4["备注"] || "",
        address: of4["收货地址"] || "",
        contact: of4["联系人"] || "",
        phone: of4["联系电话"] || "",
      };
      const lensRecords4 = await getLensDetailsByOrder(orderNo);
      const zipBuf = await buildFactoryZip(lensRecords4, orderNo, orderInfo4);

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
      // 先从镜片明细表精确匹配镜片码（每行一个码）
      const encodedLc = encodeURIComponent(`"${lensCode}"`);
      const lcData = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=1&filter=CurrentValue.[镜片码]=${encodedLc}`
      );

      let found = false;
      let orderInfo = {};
      if (lcData?.items?.length > 0) {
        found = true;
        const lf = lcData.items[0].fields;
        const srcOrderNo = lf["订单编号"] || "";
        const srcCustomer = lf["顾客姓名"] || "";

        // 直接用本镜片码记录的数据，不做姓名二次匹配（防同订单同名客户混入）
        const skuCode = lf["产品型号"] || "";
        const skus = await getSkusWithInventory();
        const skuMatch = skus.find(s => s.sku === skuCode);
        orderInfo = {
          orderNo: srcOrderNo,
          customerName: srcCustomer,
          sku: skuCode,
          skuName: skuMatch?.name || skuCode,
          date: formatDate(lf["下单日期"] || lcData.items[0].fields["创建时间"]),
          eyeSide: lf["眼别"] || "",
          sph: lf["球镜SPH"] ?? "",
          cyl: lf["柱镜CYL"] ?? "",
          axis: lf["轴位AXIS"] ?? "",
        };
      }

      // 读取 verify.html 模板并渲染（所有动态值均做 HTML 转义防注入）
      let html = readFileSync(resolve(__dirname, "public/verify.html"), "utf-8");
      html = html.replace("{{FOUND}}", found ? "true" : "false");
      html = html.replace("{{HERO_CLASS}}", found ? "hero-ok" : "hero-fail");
      html = html.replace("{{LENS_CODE}}", escapeHtml(lensCode));
      html = html.replace("{{ORDER_NO}}", escapeHtml(orderInfo.orderNo || ""));
      html = html.replace("{{CUSTOMER_NAME}}", escapeHtml(orderInfo.customerName || ""));
      html = html.replace("{{SKU_NAME}}", escapeHtml(orderInfo.skuName || ""));
      html = html.replace("{{SKU}}", escapeHtml(orderInfo.sku || ""));
      html = html.replace("{{DATE}}", escapeHtml(orderInfo.date || ""));
      html = html.replace("{{EYE_SIDE}}", escapeHtml(orderInfo.eyeSide || "—"));
      html = html.replace("{{SPH}}", escapeHtml(String(orderInfo.sph ?? "—")));
      html = html.replace("{{CYL}}", escapeHtml(String(orderInfo.cyl ?? "—")));
      html = html.replace("{{AXIS}}", escapeHtml(String(orderInfo.axis ?? "—")));
      html = html.replace("{{NOW}}", escapeHtml(new Date().toLocaleString("zh-CN")));

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
      const filterSku = url.searchParams.get("sku") || "";
      const filterAssembly = url.searchParams.get("assembly") || "";
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
          assembly: f["是否装配"] || "",
          remark: f["备注"] || "",
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
      orders = applyOrderFilters(orders, { filterStatus, filterAgent, filterSku, filterFrom, filterTo, filterQ });
      if (filterAssembly) orders = orders.filter(o => o.assembly === filterAssembly);

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

    // GET /api/admin/batch-zip — 批量导出 ZIP（多订单合并为一个 ZIP）
    const batchZipMatch = pathname.match(/^\/api\/admin\/batch-zip$/);
    if (batchZipMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const allFiles = [];
      const allDetails = [];   // 合并所有订单的镜片记录
      const orderInfoMap = {}; // orderNo → orderInfo

      for (const orderNo of orderNos) {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) continue;

        // 按顾客姓名过滤（④-6）
        if (customerFilter) {
          details = details.filter(r => (r.fields["顾客姓名"] || "") === customerFilter);
        }
        if (!details.length) continue;

        // 获取订单主表：备注、收货地址、联系人、联系电话
        if (!orderInfoMap[orderNo]) {
          const orderEnc = encodeURIComponent(`"${orderNo}"`);
          const orderData = await feishuApi("GET",
            `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${orderEnc}`
          );
          const of = orderData?.items?.[0]?.fields || {};
          orderInfoMap[orderNo] = {
            remark: of["备注"] || "",
            address: of["收货地址"] || "",
            contact: of["联系人"] || "",
            phone: of["联系电话"] || "",
          };
        }

        allDetails.push(...details);

        // QR + 标签按订单分子目录
        const prefix = orderNos.length > 1 ? `${orderNo}/` : "";
        for (const rec of details) {
          const f = rec.fields;
          const lensCode = f["镜片码"];
          if (!lensCode) continue;

          const qrPath = resolve(QR_DIR, `${lensCode}.png`);
          if (existsSync(qrPath)) {
            allFiles.push({ name: `${prefix}qrcodes/${lensCode}.png`, data: readFileSync(qrPath) });
          }

          const labelEntry = await buildLabelHtml(rec, orderNo);
          if (labelEntry) {
            allFiles.push({ name: `${prefix}${labelEntry.name}`, data: labelEntry.data });
          }
        }
      }

      // 合并所有订单到一个 Excel（④-5）
      if (allDetails.length > 0) {
        const mergedRemark = [...new Set(Object.values(orderInfoMap).map(i => i.remark).filter(Boolean))].join("；");
        const firstInfo = Object.values(orderInfoMap)[0] || {};
        const mergedInfo = { ...firstInfo, remark: mergedRemark };
        const excelName = orderNos.length > 1 ? `订单_合并_${orderNos.length}单.xlsx` : `订单_${orderNos[0]}.xlsx`;
        allFiles.push({ name: excelName, data: buildFactoryExcel(allDetails, orderNos.join("+"), mergedInfo) });
      }

      if (!allFiles.length) { jsonRes(res, 404, { error: "所选订单无镜片数据" }); return logReq(req, 404, start); }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const readme = `工厂导出包 — ${dateStr}\n共 ${orderNos.length} 个订单\n`;
      allFiles.push({ name: "说明.txt", data: Buffer.from(readme, "utf-8") });

      const zipBuf = buildZipBuffer(allFiles);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="factory-export-${dateStr}.zip"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(zipBuf);
      return logReq(req, 200, start);
    }

    // POST /api/admin/confirm — 确认订单（批量，可按客户维度）
    if (pathname === "/api/admin/confirm" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只确认该客户
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const results = [];
      for (const orderNo of orderNos) {
        try {
          // 查订单主表记录
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤（②-1）
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          // 生成镜片码（幂等，按客户过滤）
          const lensCodes = await assignLensCodes(orderNo, customerName);

          // 更新状态为生产中 + 回写镜片码（合并已有码，不覆盖其他客户的码）
          for (const rec of records) {
            const existingCodes = String(rec.fields["镜片码"] || "").split(",").filter(Boolean);
            const mergedCodes = [...new Set([...existingCodes, ...lensCodes])];
            await updateRecord(TABLES.order, rec.record_id, {
              "订单状态": "生产中",
              ...(mergedCodes.length > 0 ? { "镜片码": mergedCodes.join(",") } : {}),
            });
          }
          results.push({ orderNo, ok: true, lensCodes });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/ship — 发货（逐单或批量，可按客户维度）
    if (pathname === "/api/admin/ship" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只发该客户
      const courierKey = payload.courier || ""; // 可选指定快递
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      // 快递公司配置
      const COURIERS_WEB = {
        sf: { name: "顺丰速运", icon: "🚚" },
        zt: { name: "中通快递", icon: "📦" },
        yd: { name: "韵达快递", icon: "📮" },
        jd: { name: "京东快递", icon: "🔷" },
      };
      function genTrackingNoWeb(key) {
        const prefix = { sf: "SF", zt: "75", yd: "YD", jd: "JD" };
        const p = prefix[key] || "SF";
        const digits = String(parseInt(randomBytes(6).toString("hex"), 16)).slice(0, 12).padStart(12, "0");
        return p + digits;
      }
      function autoSelectCourierWeb(agentId) {
        const map = { "AG-003": "sf", "AG-006": "sf", "AG-005": "zt" };
        return map[agentId] || "sf";
      }

      const results = [];
      const now = Date.now();

      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤（③-1）
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          const f0 = records[0].fields;
          const rawVal = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");
          const agentId = rawVal(f0["代理商ID"]) || "";
          const ck = courierKey || autoSelectCourierWeb(agentId);
          const courier = COURIERS_WEB[ck] || COURIERS_WEB.sf;
          const trackingNo = genTrackingNoWeb(ck);

          for (const rec of records) {
            await updateRecord(TABLES.order, rec.record_id, {
              "物流公司": courier.name,
              "快递单号": trackingNo,
              "发货时间": now,
              "物流状态": "已发货",
              "订单状态": "已发货",
            });
          }

          // 同步镜片明细表状态
          const shipLensDetails = await getLensDetailsByOrder(orderNo);
          const shipFilteredLens = customerName
            ? shipLensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : shipLensDetails;
          for (const rec of shipFilteredLens) {
            await updateRecord(TABLES.lens_detail, rec.record_id, { "订单状态": "已发货" });
          }

          // 飞书发货卡片
          const custName = rawVal(f0["顾客姓名"]) || "";
          const sku = rawVal(f0["产品型号"]) || "";
          const agentName = rawVal(f0["代理商名称"]) || "";
          sendFeishuCard(shipCard({
            orderNo, customerName: custName, sku, agentName,
            courierName: courier.name, trackingNo,
            lensCount: Number(f0["数量"]) || 0,
          })).catch(e => console.error("发货通知失败:", e.message));

          results.push({ orderNo, ok: true, courier: courier.name, trackingNo });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/deliver — 签收（批量，可按客户维度）
    if (pathname === "/api/admin/deliver" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只签收该客户
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const now = Date.now();
      const results = [];

      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          for (const rec of records) {
            await updateRecord(TABLES.order, rec.record_id, {
              "订单状态": "已签收",
              "物流状态": "已签收",
              "签收时间": now,
            });
          }

          // 同步镜片明细表状态
          const deliverLensDetails = await getLensDetailsByOrder(orderNo);
          const deliverFilteredLens = customerName
            ? deliverLensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : deliverLensDetails;
          for (const rec of deliverFilteredLens) {
            await updateRecord(TABLES.lens_detail, rec.record_id, { "订单状态": "已签收" });
          }

          // 飞书签收卡片
          const f0 = records[0].fields;
          const rawVal = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");
          const signedAt = new Date(now).toLocaleString("zh-CN");
          sendFeishuCard(deliveredCard({
            orderNo,
            customerName: rawVal(f0["顾客姓名"]) || "",
            sku: rawVal(f0["产品型号"]) || "",
            agentName: rawVal(f0["代理商名称"]) || "",
            signedAt,
          })).catch(e => console.error("签收通知失败:", e.message));

          results.push({ orderNo, ok: true });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // ── 自然语言搜索（纯代码解析，不依赖 AI）──────────────────────────────────
    if (pathname === "/api/admin/ai-search" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const query = (payload.query || "").trim();
      if (!query) { jsonRes(res, 400, { error: "请输入搜索内容" }); return logReq(req, 400, start); }

      const filters = {};
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;

      function fmtISO(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      }

      // 状态匹配
      if (/超期|逾期|晚了|慢了|积压/.test(query)) {
        // 不设 status，前端用超期筛选
      } else if (/待处理|未确认|待确认|pending/.test(query)) {
        filters.status = "待处理";
      } else if (/生产中|在做|生产|producing/.test(query)) {
        filters.status = "生产中";
      } else if (/已发货|已发|发货|shipped/.test(query)) {
        filters.status = "已发货";
      } else if (/已签收|签收|收到|received/.test(query)) {
        filters.status = "已签收";
      }

      // 日期匹配
      if (/今天|今日/.test(query)) {
        filters.from = todayStr;
        filters.to = todayStr;
      } else if (/昨天/.test(query)) {
        const d = new Date(now); d.setDate(d.getDate() - 1);
        filters.from = filters.to = fmtISO(d);
      } else if (/本周|这周/.test(query)) {
        const d = new Date(now);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1);
        filters.from = fmtISO(d);
        filters.to = todayStr;
      } else if (/上周/.test(query)) {
        const d = new Date(now);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1 - 7);
        filters.from = fmtISO(d);
        const e = new Date(d); e.setDate(e.getDate() + 6);
        filters.to = fmtISO(e);
      } else if (/本月|这个月/.test(query)) {
        filters.from = `${yyyy}-${mm}-01`;
        filters.to = todayStr;
      } else if (/上月|上个月/.test(query)) {
        const d = new Date(yyyy, now.getMonth() - 1, 1);
        const e = new Date(yyyy, now.getMonth(), 0);
        filters.from = fmtISO(d);
        filters.to = fmtISO(e);
      } else {
        // 匹配 "最近N天"
        const recentMatch = query.match(/最近(\d+)天/);
        if (recentMatch) {
          const d = new Date(now);
          d.setDate(d.getDate() - parseInt(recentMatch[1]));
          filters.from = fmtISO(d);
          filters.to = todayStr;
        }
        // 匹配月份 "3月" "三月"
        const monthMap = {"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10,"十一":11,"十二":12};
        const monthMatch = query.match(/(\d{1,2}|一|二|三|四|五|六|七|八|九|十[一二]?)月/);
        if (monthMatch) {
          let m = parseInt(monthMatch[1]) || monthMap[monthMatch[1]];
          if (m >= 1 && m <= 12) {
            filters.from = `${yyyy}-${String(m).padStart(2,"0")}-01`;
            const lastDay = new Date(yyyy, m, 0).getDate();
            filters.to = `${yyyy}-${String(m).padStart(2,"0")}-${lastDay}`;
          }
        }
      }

      // 代理商匹配（模糊匹配）
      const allRecs = await listRecords(TABLES.order);
      const agentNames = [...new Set(allRecs.map(r => r.fields["代理商名称"]).filter(Boolean))];
      for (const name of agentNames) {
        if (query.includes(name)) {
          filters.agent = name;
          break;
        }
      }

      // 订单号或关键词匹配
      const orderNoMatch = query.match(/ORD-[A-Z0-9-]+/i);
      if (orderNoMatch) {
        filters.q = orderNoMatch[0].toUpperCase();
      } else if (!filters.status && !filters.from && !filters.agent) {
        // 纯文本搜索：可能是顾客名
        const cleaned = query.replace(/的|订单|显示|查找|找|搜索|查看|哪些|个/g, "").trim();
        if (cleaned.length > 0 && cleaned.length < 20) {
          filters.q = cleaned;
        }
      }

      if (Object.keys(filters).length === 0) {
        jsonRes(res, 200, { filters: { error: "无法理解查询内容，试试：待处理订单 / 深圳视力康 / 上周 / 超期" } });
      } else {
        jsonRes(res, 200, { filters });
      }
      return logReq(req, 200, start);
    }

    // ── AI 异常检测 ──────────────────────────────────────────────────────────────
    if (pathname === "/api/admin/ai-anomaly" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const allRecords = await listRecords(TABLES.order);
      const lensRecords = await listRecords(TABLES.lens_detail);
      const now = Date.now();
      const anomalies = [];

      // 1. 超期订单
      for (const r of allRecords) {
        const f = r.fields;
        const status = f["订单状态"] || "";
        const date = f["下单日期"];
        if (!date) continue;
        const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (status === "待处理" && days > 3) {
          anomalies.push({ type: "overdue", severity: "warning", orderNo: f["订单编号"], msg: `待处理 ${days} 天（标准≤3天）`, field: "订单状态" });
        }
        if (status === "生产中" && days > 7) {
          anomalies.push({ type: "overdue", severity: "danger", orderNo: f["订单编号"], msg: `生产中 ${days} 天（标准≤7天）`, field: "订单状态" });
        }
      }

      // 2. 处方异常检测
      const sphRanges = {}; // agentId → [min, max]
      const cylRanges = {};
      for (const r of lensRecords) {
        const f = r.fields;
        const agentId = f["代理商ID"] || "unknown";
        const sph = Number(f["球镜SPH"]) || 0;
        const cyl = Number(f["柱镜CYL"]) || 0;
        if (!sphRanges[agentId]) { sphRanges[agentId] = [sph, sph]; cylRanges[agentId] = [cyl, cyl]; }
        sphRanges[agentId][0] = Math.min(sphRanges[agentId][0], sph);
        sphRanges[agentId][1] = Math.max(sphRanges[agentId][1], sph);
        cylRanges[agentId][0] = Math.min(cylRanges[agentId][0], cyl);
        cylRanges[agentId][1] = Math.max(cylRanges[agentId][1], cyl);
      }

      // 检查极端值
      for (const r of lensRecords) {
        const f = r.fields;
        const sph = Number(f["球镜SPH"]) || 0;
        const cyl = Number(f["柱镜CYL"]) || 0;
        const orderNo = f["订单编号"] || "";
        const agentId = f["代理商ID"] || "unknown";

        if (Math.abs(sph) > 12) {
          anomalies.push({ type: "prescription", severity: "warning", orderNo, msg: `SPH ${sph} 超出常规范围(±12)，请确认处方`, field: "球镜SPH" });
        }
        if (Math.abs(cyl) > 4) {
          anomalies.push({ type: "prescription", severity: "warning", orderNo, msg: `CYL ${cyl} 超出常规范围(±4)，请确认处方`, field: "柱镜CYL" });
        }
        const axis = Number(f["轴位AXIS"]) || 0;
        if (cyl !== 0 && axis === 0) {
          anomalies.push({ type: "prescription", severity: "danger", orderNo, msg: `有柱镜值(${cyl})但轴位为0，请确认`, field: "轴位AXIS" });
        }
      }

      // 3. 重复镜片码检测
      const codeCount = {};
      for (const r of lensRecords) {
        const code = r.fields["镜片码"];
        if (code) { codeCount[code] = (codeCount[code] || 0) + 1; }
      }
      for (const [code, count] of Object.entries(codeCount)) {
        if (count > 1) {
          const related = lensRecords.filter(r => r.fields["镜片码"] === code).map(r => r.fields["订单编号"]);
          anomalies.push({ type: "duplicate", severity: "danger", orderNo: related[0], msg: `镜片码 ${code} 重复 ${count} 次（订单: ${[...new Set(related)].join(", ")}）`, field: "镜片码" });
        }
      }

      jsonRes(res, 200, { total: anomalies.length, anomalies: anomalies.slice(0, 50) });
      return logReq(req, 200, start);
    }

    // ── 数据问答（纯代码规则匹配）────────────────────────────────────────────
    if (pathname === "/api/admin/ai-qa" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const q = (payload.question || "").trim();
      if (!q) { jsonRes(res, 400, { error: "请输入问题" }); return logReq(req, 400, start); }

      const allRecords = await listRecords(TABLES.order);
      const now = Date.now();
      const orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          agent: f["代理商名称"] || "",
          sku: f["产品型号"] || "",
          qty: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          date: f["下单日期"] || null,
        };
      });

      // 统计
      const statusCounts = {};
      let totalDays = 0, daysCount = 0;
      const agentCounts = {};
      const skuCounts = {};
      const overdueList = [];
      const monthCounts = {};

      for (const o of orders) {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        if (o.agent) agentCounts[o.agent] = (agentCounts[o.agent] || 0) + 1;
        if (o.sku) skuCounts[o.sku] = (skuCounts[o.sku] || 0) + o.qty;
        if (o.date) {
          const days = Math.floor((now - o.date) / (1000 * 60 * 60 * 24));
          totalDays += days; daysCount++;
          if ((o.status === "待处理" && days > 3) || (o.status === "生产中" && days > 7)) {
            overdueList.push({ orderNo: o.orderNo, status: o.status, days, agent: o.agent });
          }
          const d = new Date(o.date);
          const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
          monthCounts[mk] = (monthCounts[mk] || 0) + 1;
        }
      }

      const avgDays = daysCount ? Math.round(totalDays / daysCount) : 0;
      const nowDate = new Date();
      const thisMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,"0")}`;
      const thisMonthCount = monthCounts[thisMonthKey] || 0;

      // 排行榜
      const agentSorted = Object.entries(agentCounts).sort((a,b) => b[1]-a[1]);
      const skuSorted = Object.entries(skuCounts).sort((a,b) => b[1]-a[1]);

      let answer = "";

      // 规则匹配常见问题
      if (/总.*多少|共.*多少|多少.*订单|几单|订单.*量|订单.*数/.test(q)) {
        answer = `当前共 ${orders.length} 个订单。其中待处理 ${statusCounts["待处理"]||0}、生产中 ${statusCounts["生产中"]||0}、已发货 ${statusCounts["已发货"]||0}、已签收 ${statusCounts["已签收"]||0}。`;
      } else if (/本月|这个月|当月/.test(q) && /多少|几单|数量/.test(q)) {
        answer = `本月（${thisMonthKey}）新增 ${thisMonthCount} 单。`;
      } else if (/代理商.*多|谁.*多|排名|最多/.test(q)) {
        if (agentSorted.length > 0) {
          const top3 = agentSorted.slice(0, 3).map(([name, count], i) => `${i+1}. ${name}：${count}单`).join("；");
          answer = `代理商排名：${top3}。`;
        }
      } else if (/SKU|产品|型号|卖.*好|销量|热卖/.test(q)) {
        if (skuSorted.length > 0) {
          const top3 = skuSorted.slice(0, 3).map(([name, count], i) => `${i+1}. ${name}：${count}片`).join("；");
          answer = `SKU销量排名：${top3}。`;
        }
      } else if (/超期|逾期|积压|慢/.test(q)) {
        if (overdueList.length === 0) {
          answer = "当前没有超期订单，一切正常。";
        } else {
          const items = overdueList.slice(0, 5).map(o => `${o.orderNo}（${o.status} ${o.days}天）`).join("、");
          answer = `共 ${overdueList.length} 个超期订单：${items}${overdueList.length > 5 ? "等" : ""}。建议立即处理。`;
        }
      } else if (/平均.*天|交期|周期|周转/.test(q)) {
        answer = `平均订单天数 ${avgDays} 天（从下单到当前）。待处理平均待确认时间需结合具体数据分析。`;
      } else if (/待处理|未确认/.test(q)) {
        const pending = orders.filter(o => o.status === "待处理");
        const pendingOverdue = pending.filter(o => o.date && (now - o.date) > 3*86400000);
        answer = `待处理订单 ${pending.length} 个，其中 ${pendingOverdue.length} 个超期（>3天）。`;
      } else if (/生产中|在产|在做/.test(q)) {
        const producing = orders.filter(o => o.status === "生产中");
        const prodOverdue = producing.filter(o => o.date && (now - o.date) > 7*86400000);
        answer = `生产中订单 ${producing.length} 个，其中 ${prodOverdue.length} 个超期（>7天）。`;
      } else if (/已发货|发货/.test(q)) {
        answer = `已发货订单 ${statusCounts["已发货"]||0} 个。`;
      } else if (/已签收|签收/.test(q)) {
        answer = `已签收订单 ${statusCounts["已签收"]||0} 个。`;
      } else {
        answer = `可以问我：本月订单量多少 / 哪个代理商下单最多 / 哪个SKU卖得最好 / 超期订单有哪些 / 平均交期多少天 / 待处理订单。`;
      }

      jsonRes(res, 200, { question: q, answer });
      return logReq(req, 200, start);
    }

    // ── AI 智能建议 ──────────────────────────────────────────────────────────────
    if (pathname === "/api/admin/ai-suggest" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const allRecords = await listRecords(TABLES.order);
      const now = Date.now();
      const suggestions = [];

      const orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          agent: f["代理商名称"] || "",
          sku: f["产品型号"] || "",
          status: f["订单状态"] || "",
          date: f["下单日期"] || null,
          remark: f["备注"] || "",
        };
      });

      // 统计
      const overduePending = orders.filter(o => o.status === "待处理" && o.date && (now - o.date) > 3 * 86400000);
      const overdueProducing = orders.filter(o => o.status === "生产中" && o.date && (now - o.date) > 7 * 86400000);
      const pendingCount = orders.filter(o => o.status === "待处理").length;
      const producingCount = orders.filter(o => o.status === "生产中").length;
      const todayCount = orders.filter(o => {
        if (!o.date) return false;
        const d = new Date(o.date);
        const t = new Date();
        return d.toDateString() === t.toDateString();
      }).length;

      if (overduePending.length > 0) {
        suggestions.push({
          priority: "high",
          action: "批量确认超期待处理订单",
          detail: `${overduePending.length} 个待处理订单已超3天，建议立即确认进入生产`,
          orderNos: overduePending.slice(0, 20).map(o => o.orderNo),
          actionType: "confirm",
        });
      }
      if (overdueProducing.length > 0) {
        suggestions.push({
          priority: "high",
          action: "跟进超期生产订单",
          detail: `${overdueProducing.length} 个生产中订单已超7天，建议联系工厂确认进度`,
          orderNos: overdueProducing.slice(0, 20).map(o => o.orderNo),
          actionType: "follow-up",
        });
      }
      if (producingCount > 0) {
        suggestions.push({
          priority: "medium",
          action: "导出工厂包",
          detail: `${producingCount} 个生产中订单可导出ZIP给工厂`,
          actionType: "export-zip",
        });
      }
      if (pendingCount === 0 && producingCount === 0) {
        suggestions.push({
          priority: "low",
          action: "当前无待办",
          detail: `所有订单已处理完毕，今日新增 ${todayCount} 单`,
          actionType: "none",
        });
      }

      jsonRes(res, 200, { suggestions });
      return logReq(req, 200, start);
    }

    // ── Excel 处方解析 ─────────────────────────────────────────────────────────
    if (pathname === "/api/excel-parse" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const contentLength = parseInt(req.headers["content-length"] || "0");
      if (contentLength > 5 * 1024 * 1024) {
        jsonRes(res, 413, { error: "文件过大，请限制在 5MB 以内" });
        return logReq(req, 413, start);
      }

      const payload = await readBody(req);
      if (!payload.file?.data) {
        jsonRes(res, 400, { error: "请提供 Excel 文件" });
        return logReq(req, 400, start);
      }

      const result = await handleExcelUpload(payload.file);
      jsonRes(res, 200, result);
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

// ─── 公共订单过滤函数（避免三处重复逻辑）────────────────────────────────────
function applyOrderFilters(orders, { filterStatus, filterSku, filterFrom, filterTo, filterSearch, filterAgent, filterQ } = {}) {
  if (filterStatus) orders = orders.filter(o => o.status === filterStatus);
  if (filterSku) orders = orders.filter(o => o.sku === filterSku);
  if (filterAgent) orders = orders.filter(o => o.agentName === filterAgent);
  if (filterFrom) {
    const fromTs = new Date(filterFrom).getTime();
    if (!isNaN(fromTs)) orders = orders.filter(o => o.date && o.date >= fromTs);
  }
  if (filterTo) {
    const toTs = new Date(filterTo + "T23:59:59").getTime();
    if (!isNaN(toTs)) orders = orders.filter(o => o.date && o.date <= toTs);
  }
  const q = filterSearch || filterQ || "";
  if (q) {
    const s = q.trim().toLowerCase();
    orders = orders.filter(o =>
      o.orderNo.toLowerCase().includes(s) ||
      (o.customerName || "").toLowerCase().includes(s)
    );
  }
  return orders;
}

function logReq(req, status, start) {
  console.log(`  ${req.method} ${req.url} → ${status} (${Date.now() - start}ms)`);
}

server.listen(PORT, () => {
  console.log(`\n🚀 代理商门户启动: http://localhost:${PORT}`);
  console.log(`   下单页: http://localhost:${PORT}/order?t=<token>`);
  console.log(`   追踪页: http://localhost:${PORT}/track?t=<token>`);
  console.log(`\n   按 Ctrl+C 停止\n`);
});
