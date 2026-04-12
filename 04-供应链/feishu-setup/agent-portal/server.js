/**
 * agent-portal/server.js — 代理商订单门户后端（生产级）
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
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

// 表 ID（与 automations.js 一致）
const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  order: "tblk9Ch4gk2uQ1zG",
  customer: "tbltXNNhF65EBl17",
};

// ─── 配置 ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(__dirname, "../.env");
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

function loadAgents() {
  if (Date.now() - _agentsCacheTime < 30000 && _agentsCache) return _agentsCache;
  try {
    _agentsCache = JSON.parse(readFileSync(resolve(__dirname, "agents.json"), "utf-8"));
    _agentsCacheTime = Date.now();
    return _agentsCache;
  } catch {
    return [];
  }
}

function findAgent(token) {
  if (!token) return null;
  return loadAgents().find(a => a.token === token) || null;
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
    const sku = r.fields["SKU"];
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

    // ── 静态资源 ──
    if (pathname.startsWith("/css/") || pathname.startsWith("/js/")) {
      serveStatic(res, resolve(__dirname, "public", pathname));
      return logReq(req, 200, start);
    }

    // ── API: 代理商信息 ──
    if (pathname === "/api/agent") {
      const agent = findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      jsonRes(res, 200, { id: agent.id, name: agent.name });
      return logReq(req, 200, start);
    }

    // ── API: SKU列表 + 库存状态 ──
    if (pathname === "/api/skus") {
      const agent = findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const skus = await getSkusWithInventory();
      jsonRes(res, 200, skus);
      return logReq(req, 200, start);
    }

    // ── API: 交期预估 ──
    if (pathname === "/api/delivery-estimate") {
      const agent = findAgent(token);
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

    // ── API: 客户名列表 ──
    if (pathname === "/api/customers") {
      const agent = findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const names = await getCustomerNames(agent.id);
      jsonRes(res, 200, { customers: names });
      return logReq(req, 200, start);
    }

    // ── API: 提交订单 ──
    if (pathname === "/api/submit" && req.method === "POST") {
      const agent = findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const payload = await readBody(req);
      const { address, patients } = payload;

      if (!address?.trim()) {
        jsonRes(res, 400, { error: "请填写收货地址" });
        return logReq(req, 400, start);
      }
      if (!Array.isArray(patients) || patients.length === 0) {
        jsonRes(res, 400, { error: "请至少填写一位患者信息" });
        return logReq(req, 400, start);
      }

      const skus = await getSkusWithInventory();
      const customerId = await getOrCreateCustomer(agent.name);
      const orderNo = genOrderNo();
      const now = Date.now();
      const batchRecords = [];
      const items = [];
      let totalLenses = 0;

      for (const p of patients) {
        const { customerName, sku, quantity, eyes, remark } = p;
        if (!customerName?.trim() || !sku || !quantity || quantity <= 0) continue;
        if (!Array.isArray(eyes) || eyes.length === 0) continue;

        const skuInfo = skus.find(s => s.sku === sku);
        if (!skuInfo) continue;

        const est = estimateDelivery(skuInfo, quantity);

        for (const eye of eyes) {
          batchRecords.push({
            fields: {
              "来源订单号": orderNo,
              "SKU": sku,
              "数量": quantity,
              "订单状态": "待处理",
              "交期类型": est.deliveryType,
              "承诺交货日": est.promiseDate,
              "下单日期": now,
              "同步时间": now,
              "顾客姓名": customerName.trim(),
              "眼别": eye.side || "",
              "球镜SPH": Number(eye.sph) || 0,
              "柱镜CYL": Number(eye.cyl) || 0,
              "轴位AXIS": Number(eye.axis) || 0,
              "瞳距": Number(eye.pd) || 0,
              "瞳高": Number(eye.ph) || 0,
              "镜框型号": eye.frame?.trim() || "",
              "代理商名称": agent.name,
              "代理商ID": agent.id,
              "收货地址": address.trim(),
              "订单来源": "代理商门户",
              "客户ID": customerId,
              ...(remark?.trim() ? { "备注": remark.trim() } : {}),
            },
          });
          totalLenses++;
        }

        // 有货时扣减库存
        if (est.available && skuInfo.currentStock > 0) {
          const invRecords = await listRecords(TABLES.finished_inventory);
          const invRec = invRecords.find(r => r.fields["SKU"] === sku);
          if (invRec) {
            const newStock = Math.max(0, Number(invRec.fields["当前库存"] || 0) - quantity);
            await updateRecord(TABLES.finished_inventory, invRec.record_id, { "当前库存": newStock });
            skuInfo.currentStock = newStock;
          }
        }

        items.push({
          sku,
          skuName: skuInfo.name,
          quantity,
          customerName: customerName.trim(),
          deliveryType: est.deliveryType,
          promiseDate: est.promiseDate,
          promiseDateFormatted: formatDate(est.promiseDate),
        });
      }

      if (batchRecords.length === 0) {
        jsonRes(res, 400, { error: "没有有效的订单数据" });
        return logReq(req, 400, start);
      }

      const ok = await batchCreateRecords(TABLES.order, batchRecords);
      if (!ok) {
        jsonRes(res, 500, { error: "写入飞书失败，请重试" });
        return logReq(req, 500, start);
      }

      // 通知
      const summary = items.map(i => `${i.skuName}×${i.quantity}(${i.deliveryType})`).join("、");
      sendNotify(agent.name, summary, orderNo);

      // 清除客户名缓存
      delete _customerCache[agent.id];

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
      const agent = findAgent(token);
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
          orderNo: f["来源订单号"] || "",
          sku: f["SKU"] || "",
          skuDisplay: f["SKU"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          deliveryType: f["交期类型"] || "",
          customerName: f["顾客姓名"] || "",
          eye: f["眼别"] || "",
          date: f["同步时间"] || f["下单日期"] || null,
          promiseDate: f["承诺交货日"] || null,
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
          // 处方详情
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          pd: f["瞳距"],
          ph: f["瞳高"],
          frame: f["镜框型号"] || "",
        };
      });

      // 统计（过滤前）
      const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "待处理").length,
        instock: orders.filter(o => o.deliveryType && o.deliveryType.startsWith("有货")).length,
        custom: orders.filter(o => o.deliveryType && o.deliveryType.startsWith("定制")).length,
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
    if (pathname.startsWith("/api/order/")) {
      const agent = findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = pathname.split("/").pop();
      if (!orderNo) {
        jsonRes(res, 400, { error: "缺少订单号" });
        return logReq(req, 400, start);
      }

      const encoded = encodeURIComponent(`"${orderNo}"`);
      const data = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[来源订单号]=${encoded}`
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
          sku: f["SKU"] || "",
          quantity: Number(f["数量"]) || 1,
          eye: f["眼别"] || "",
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          pd: f["瞳距"],
          ph: f["瞳高"],
          frame: f["镜框型号"] || "",
          deliveryType: f["交期类型"] || "",
          status: f["订单状态"] || "",
        };
      });

      jsonRes(res, 200, {
        orderNo,
        date: firstItem.fields["下单日期"] || firstItem.fields["同步时间"],
        address: firstItem.fields["收货地址"] || "",
        remark: firstItem.fields["备注"] || "",
        deliveryType: firstItem.fields["交期类型"] || "",
        promiseDate: firstItem.fields["承诺交货日"] || null,
        status: firstItem.fields["订单状态"] || "",
        items,
      });
      return logReq(req, 200, start);
    }

    // ── API: CSV 导出 ──
    if (pathname === "/api/orders/export") {
      const agent = findAgent(token);
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
          orderNo: f["来源订单号"] || "",
          customer: f["顾客姓名"] || "",
          sku: f["SKU"] || "",
          qty: Number(f["数量"]) || 1,
          eye: f["眼别"] || "",
          sph: f["球镜SPH"] ?? "",
          cyl: f["柱镜CYL"] ?? "",
          axis: f["轴位AXIS"] ?? "",
          pd: f["瞳距"] ?? "",
          ph: f["瞳高"] ?? "",
          frame: f["镜框型号"] || "",
          deliveryType: f["交期类型"] || "",
          status: f["订单状态"] || "",
          date: f["下单日期"] ? formatDate(f["下单日期"]) : "",
          promiseDate: f["承诺交货日"] ? formatDate(f["承诺交货日"]) : "",
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

      const headers = ["订单号","顾客","SKU","数量","眼别","球镜SPH","柱镜CYL","轴位AXIS","瞳距","瞳高","镜框型号","交期类型","状态","下单日期","承诺交货日","收货地址","备注"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        csvRows.push([r.orderNo, r.customer, r.sku, r.qty, r.eye, r.sph, r.cyl, r.axis, r.pd, r.ph, r.frame, r.deliveryType, r.status, r.date, r.promiseDate, r.address, r.remark].map(csvEscape).join(","));
      }

      const csv = "\uFEFF" + csvRows.join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=orders-${agent.id}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      res.end(csv);
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
