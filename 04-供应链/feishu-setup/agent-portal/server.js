/**
 * agent-portal/server.js — 代理商订单门户后端
 *
 * 接口：
 *   GET  /             → 重定向到 /order.html
 *   GET  /order?t=xxx  → 下单页（验证token）
 *   GET  /track?t=xxx  → 查询页（验证token）
 *   POST /api/submit   → 提交订单
 *   GET  /api/orders?t=xxx → 查询本代理商订单
 *   GET  /api/agent?t=xxx  → 返回代理商信息（前端用）
 *
 * Usage:
 *   node server.js           # 默认端口 3000
 *   PORT=8080 node server.js
 */

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
const CUSTOMER_TABLE = "tbltXNNhF65EBl17";

// ─── Config ──────────────────────────────────────────────────────────────────

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

function loadAgents() {
  return JSON.parse(readFileSync(resolve(__dirname, "agents.json"), "utf-8"));
}

function findAgent(token) {
  if (!token) return null;
  return loadAgents().find(a => a.token === token) || null;
}

// ─── Feishu API ───────────────────────────────────────────────────────────────

let _token = "";
let _tokenExpiry = 0;

async function getFeishuToken() {
  if (Date.now() < _tokenExpiry) return _token;
  const env = loadEnv();
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  _token = json.tenant_access_token;
  _tokenExpiry = Date.now() + (json.expire - 60) * 1000;
  return _token;
}

async function feishuPost(path, body) {
  const token = await getFeishuToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function feishuGet(path) {
  const token = await getFeishuToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// ─── 生成订单编号 ──────────────────────────────────────────────────────────────

function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${d}-${r}`;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUS-${d}-${r}`;
}

// ─── 查或建终端客户（收货地址作为客户名称） ────────────────────────────────────

async function getOrCreateCustomer(agentName) {
  const token = await getFeishuToken();
  const encoded = encodeURIComponent(`"${agentName}"`);
  const res = await feishuGet(
    `/bitable/v1/apps/${APP_TOKEN}/tables/${CUSTOMER_TABLE}/records` +
    `?page_size=1&filter=CurrentValue.[客户名称]=${encoded}`
  );
  if (res.code === 0 && res.data?.items?.length > 0) {
    return res.data.items[0].fields["客户ID"] || "";
  }
  const newId = genCustomerId();
  await feishuPost(`/bitable/v1/apps/${APP_TOKEN}/tables/${CUSTOMER_TABLE}/records`, {
    fields: { 客户ID: newId, 客户名称: agentName, 来源系统: "代理商门户" },
  });
  return newId;
}

// ─── 发送飞书通知 ──────────────────────────────────────────────────────────────

async function sendNotify(agentName, orderCount, orderNos) {
  const env = loadEnv();
  if (!env.FEISHU_WEBHOOK_URL) return;
  const body = {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: "📋 新订单待审核" }, template: "blue" },
      elements: [{
        tag: "markdown",
        content: `**代理商：** ${agentName}\n**本次提交：** ${orderCount} 片（${orderNos.length} 个患者）\n**订单编号：** ${orderNos.join("、")}\n\n请登录飞书多维表审核确认。`,
      }],
    },
  };
  await fetch(env.FEISHU_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── 提交订单 ──────────────────────────────────────────────────────────────────

async function submitOrders(agent, payload) {
  // payload: { address: string, patients: [{name, sku, remark, eyes: [{side, sph, cyl, axis, pd, ph, frame}]}] }
  const { address, patients } = payload;
  if (!Array.isArray(patients) || patients.length === 0) {
    return { ok: false, error: "至少填写一位患者" };
  }

  const customerId = await getOrCreateCustomer(agent.name);
  const orderNos = [];
  let totalLenses = 0;
  const batchRecords = [];

  for (const patient of patients) {
    const { name, sku, remark, eyes } = patient;
    if (!name || !sku || !Array.isArray(eyes) || eyes.length === 0) continue;

    const orderNo = genOrderNo();
    orderNos.push(orderNo);

    for (const eye of eyes) {
      batchRecords.push({
        fields: {
          // 基础字段
          "来源订单号": orderNo,
          "SKU": sku,
          "数量": 1,
          "订单状态": "待审核",
          "同步时间": Date.now(),
          "客户ID": customerId,
          "订单来源": "代理商门户",
          // 患者字段
          "顾客姓名": name,
          "眼别": eye.side,          // 左眼/右眼
          "球镜SPH": Number(eye.sph) || 0,
          "柱镜CYL": Number(eye.cyl) || 0,
          "轴位AXIS": Number(eye.axis) || 0,
          "瞳距": Number(eye.pd) || 0,
          "瞳高": Number(eye.ph) || 0,
          "镜框型号": eye.frame || "",
          // 代理商字段
          "代理商名称": agent.name,
          "代理商ID": agent.id,
          "收货地址": address || "",
          // 备注
          ...(remark ? { "备注": remark } : {}),
        },
      });
      totalLenses++;
    }
  }

  if (batchRecords.length === 0) {
    return { ok: false, error: "没有有效的订单数据" };
  }

  // 批量写入（每次最多500条，实际场景远不到）
  for (let i = 0; i < batchRecords.length; i += 500) {
    const batch = batchRecords.slice(i, i + 500);
    const res = await feishuPost(
      `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records/batch_create`,
      { records: batch }
    );
    if (res.code !== 0) {
      return { ok: false, error: `写入失败: ${res.msg}` };
    }
  }

  await sendNotify(agent.name, totalLenses, orderNos);
  return { ok: true, orderNos, totalLenses };
}

// ─── 查询订单 ──────────────────────────────────────────────────────────────────

async function getAgentOrders(agentId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const encoded = encodeURIComponent(`"${agentId}"`);
    let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const res = await feishuGet(`/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records${qs}`);
    if (res.code !== 0) break;
    for (const r of res.data?.items || []) {
      records.push({
        orderNo: r.fields["来源订单号"] || "",
        patient: r.fields["顾客姓名"] || "",
        sku: r.fields["SKU"] || "",
        eye: r.fields["眼别"] || "",
        status: r.fields["订单状态"] || "",
        date: r.fields["同步时间"] ? new Date(r.fields["同步时间"]).toLocaleDateString("zh-CN") : "",
        address: r.fields["收货地址"] || "",
      });
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  return records;
}

// ─── Static file server ───────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
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

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const token = url.searchParams.get("t") || "";

  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // Static pages
    if (path === "/" || path === "/order" || path === "/order.html") {
      return serveStatic(res, resolve(__dirname, "public/order.html"));
    }
    if (path === "/track" || path === "/track.html") {
      return serveStatic(res, resolve(__dirname, "public/track.html"));
    }

    // API: agent info
    if (path === "/api/agent") {
      const agent = findAgent(token);
      if (!agent) { res.writeHead(401); return res.end(JSON.stringify({ error: "无效链接" })); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: agent.id, name: agent.name }));
    }

    // API: submit order
    if (path === "/api/submit" && req.method === "POST") {
      const agent = findAgent(token);
      if (!agent) { res.writeHead(401); return res.end(JSON.stringify({ error: "无效链接" })); }

      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);

      const result = await submitOrders(agent, payload);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    }

    // API: query orders
    if (path === "/api/orders") {
      const agent = findAgent(token);
      if (!agent) { res.writeHead(401); return res.end(JSON.stringify({ error: "无效链接" })); }
      const orders = await getAgentOrders(agent.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(orders));
    }

    res.writeHead(404);
    res.end("Not found");

  } catch (err) {
    console.error("Server error:", err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 代理商门户启动: http://localhost:${PORT}`);
  console.log(`   下单页: http://localhost:${PORT}/order?t=<token>`);
  console.log(`   查询页: http://localhost:${PORT}/track?t=<token>`);
  console.log(`\n   按 Ctrl+C 停止\n`);
});
