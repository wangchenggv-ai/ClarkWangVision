/**
 * logistics.js — 物流全链路管理
 *
 * 功能：
 *   1. 为已打印标签的订单生成快递单号（顺丰/中通/韵达）
 *   2. 更新飞书订单表物流字段（快递单号/公司/发货时间/状态）
 *   3. 发送飞书通知：【已发货】
 *   4. 接收签收回调，更新状态并发送【已签收】通知
 *   5. 模拟消费者签收（--simulate-delivery）
 *
 * Usage:
 *   node logistics.js ship                        # 为今日"生产中"订单生成快递单并发货通知
 *   node logistics.js ship --order ORD-xxx        # 指定订单发货
 *   node logistics.js deliver --order ORD-xxx     # 模拟消费者签收
 *   node logistics.js status                      # 查看在途物流汇总
 *   node logistics.js migrate                     # 添加物流字段到飞书订单表
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { slipHTML, init as initTemplates } from "./lib/templates.js";
import { rawVal } from "./lib/helpers.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE      = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TBL = "tblk9Ch4gk2uQ1zG";
const LENS_TBL  = "tblC7pve7ObFgIOl";
const ENV       = loadEnv();
const SERVER_BASE = ENV.SERVER_BASE_URL || "http://localhost:3210";
initTemplates({ getServerBaseUrl: () => SERVER_BASE });
const ARGS      = process.argv.slice(2);
const CMD       = ARGS[0] || "help";
const ORDER_NO  = ARGS[ARGS.indexOf("--order") + 1] || null;
const _ci = ARGS.indexOf("--courier");
const COURIER_ARG = _ci !== -1 ? ARGS[_ci + 1] : null;

// ─── 配置 ──────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const env = {};
    for (const line of readFileSync(resolve(__dirname, "../shared/.env"), "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      env[k.trim()] = v.join("=").trim();
    }
    return env;
  } catch { return {}; }
}

// ─── 快递公司配置 ──────────────────────────────────────────────────────────

const COURIERS = {
  sf: {
    name: "顺丰速运",
    code: "SF",
    prefix: "SF",
    digits: 12,
    icon: "🟠",
    url: (no) => `https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${no}`,
  },
  zt: {
    name: "中通快递",
    code: "ZTO",
    prefix: "75",
    digits: 10,
    icon: "🟡",
    url: (no) => `https://www.zto.com/express/expressSearch.html?billCode=${no}`,
  },
  yd: {
    name: "韵达快递",
    code: "YD",
    prefix: "YD",
    digits: 12,
    icon: "🔵",
    url: (no) => `https://www.yundaex.com/cn/index.php?waybill_id=${no}`,
  },
  jd: {
    name: "京东物流",
    code: "JDL",
    prefix: "JD",
    digits: 13,
    icon: "🔴",
    url: (no) => `https://www.jdl.com/`,
  },
};

function genTrackingNo(courierKey) {
  const c = COURIERS[courierKey] || COURIERS.sf;
  const digits = Array.from({ length: c.digits }, () => Math.floor(Math.random() * 10)).join("");
  return `${c.prefix}${digits}`;
}

// 根据代理商自动分配快递（示例规则：北方→顺丰，南方→中通）
function autoSelectCourier(agentId) {
  const sfAgents = ["AG-003", "AG-006"]; // 北京/成都→顺丰
  const ztAgents = ["AG-005"];            // 广州→中通
  if (sfAgents.includes(agentId)) return "sf";
  if (ztAgents.includes(agentId)) return "zt";
  return "sf"; // 默认顺丰
}

// ─── 飞书 API ─────────────────────────────────────────────────────────────

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

async function feishuReq(method, path, body) {
  const tk = await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  return j.code === 0 ? j.data : null;
}

async function listRecords(filter = "") {
  const records = [];
  let pt = "";
  while (true) {
    const qs = `?page_size=100${filter ? "&filter=" + encodeURIComponent(filter) : ""}${pt ? "&page_token=" + pt : ""}`;
    const d = await feishuReq("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records${qs}`);
    if (!d) break;
    records.push(...(d.items || []));
    if (!d.has_more) break;
    pt = d.page_token;
  }
  return records;
}

async function updateRecord(recordId, fields) {
  return feishuReq("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records/${recordId}`, { fields });
}

async function updateLensRecord(recordId, fields) {
  return feishuReq("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${LENS_TBL}/records/${recordId}`, { fields });
}

async function getLensDetailsByOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const d = await feishuReq("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${LENS_TBL}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
  );
  return d?.items || [];
}

// ─── 飞书通知（私信）─────────────────────────────────────────────────────

let _notifyToken = "", _notifyTokenTime = 0;
async function getNotifyToken() {
  if (Date.now() - _notifyTokenTime < 7000000 && _notifyToken) return _notifyToken;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.NOTIFY_APP_ID, app_secret: ENV.NOTIFY_APP_SECRET }),
  }).then(r => r.json());
  _notifyToken = r.tenant_access_token;
  _notifyTokenTime = Date.now();
  return _notifyToken;
}

async function notify(card) {
  const openId = ENV.NOTIFY_OPEN_ID;
  if (!openId) {
    console.log("  ⚠  NOTIFY_OPEN_ID 未配置，跳过通知");
    return;
  }
  try {
    const token = await getNotifyToken();
    const r = await fetch(`${BASE}/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) }),
    }).then(r => r.json());
    if (r.code !== 0) console.error("  通知失败:", JSON.stringify(r));
  } catch (e) {
    console.error("  通知失败:", e.message);
  }
}

function shipCard({ orderNo, customerName, sku, agentName, courierName, trackingNo, trackingUrl, promiseDate, lensCount }) {
  return {
    header: { title: { tag: "plain_text", content: "🚚 订单已发货" }, template: "blue" },
    elements: [
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
          { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
        ],
      },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
          { is_short: true, text: { tag: "lark_md", content: `**镜片数**\n${lensCount} 片` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**快递公司**\n${courierName}` } },
          { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${trackingNo}\`` } },
        ],
      },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
          { is_short: true, text: { tag: "lark_md", content: `**承诺交期**\n${promiseDate || "—"}` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          { tag: "button", text: { tag: "plain_text", content: "📦 查询物流" }, type: "primary", url: trackingUrl },
        ],
      },
      { tag: "note", elements: [{ tag: "plain_text", content: `发货时间：${new Date().toLocaleString("zh-CN")}` }] },
    ],
  };
}

function deliveredCard({ orderNo, customerName, sku, agentName, courierName, trackingNo, signedAt, lensCount }) {
  return {
    header: { title: { tag: "plain_text", content: "✅ 消费者已签收" }, template: "green" },
    elements: [
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
          { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
        ],
      },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
          { is_short: true, text: { tag: "lark_md", content: `**镜片数**\n${lensCount} 片` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**快递**\n${courierName} \`${trackingNo}\`` } },
          { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "markdown",
        content: `🎉 **订单全流程完成！**\n下单 → 生产 → 发货 → **签收 ✓**\n签收时间：${signedAt}`,
      },
    ],
  };
}

// ─── 字段迁移（添加物流字段）────────────────────────────────────────────

async function migrate() {
  console.log("\n🔧 检查并添加物流字段...");
  const data = await feishuReq("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/fields`);
  const existing = new Set((data?.items || []).map(f => f.field_name));

  const toAdd = [
    { field_name: "物流公司",   type: 1 },   // 文本
    { field_name: "快递单号",   type: 1 },   // 文本
    { field_name: "发货时间",   type: 5 },   // 日期时间
    { field_name: "签收时间",   type: 5 },   // 日期时间
    { field_name: "物流状态",   type: 3, property: { options: [  // 单选
      { name: "待发货", color: 4 },
      { name: "已发货", color: 1 },
      { name: "运输中", color: 6 },
      { name: "已签收", color: 2 },
    ]}},
  ];

  for (const f of toAdd) {
    if (existing.has(f.field_name)) {
      console.log(`  ⏭  ${f.field_name} 已存在`);
      continue;
    }
    const body = { field_name: f.field_name, type: f.type };
    if (f.property) body.property = f.property;
    const res = await feishuReq("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/fields`, body);
    if (res) console.log(`  ✅ 添加字段: ${f.field_name}`);
    else     console.log(`  ❌ 添加失败: ${f.field_name}`);
  }
  console.log("\n  迁移完成。\n");
}

// ─── 发货：生成快递单号并通知 ─────────────────────────────────────────────

async function ship() {
  console.log("\n📦 生成快递单并标记发货...\n");

  // 查找"生产中"且无快递单号的记录
  let filter = `CurrentValue.[订单状态]="生产中" OR CurrentValue.[订单状态]="打标签"`;
  if (ORDER_NO) filter += `&&CurrentValue.[订单编号]="${ORDER_NO}"`;

  const records = await listRecords(filter);
  if (!records.length) { console.log("  没有待发货订单。"); return; }

  // 按订单号分组
  const orderMap = {};
  for (const r of records) {
    const f = r.fields;
    const no = rawVal(f["订单编号"]);
    if (!no) continue;
    if (!orderMap[no]) orderMap[no] = { records: [], fields: f };
    orderMap[no].records.push(r);
  }

  console.log(`  共 ${Object.keys(orderMap).length} 个订单待发货\n`);

  for (const [orderNo, { records: recs, fields: f }] of Object.entries(orderMap)) {

    // 若已有快递单号，跳过
    const existing = rawVal(f["快递单号"]);
    if (existing) {
      console.log(`  ⏭  ${orderNo} 已有快递单 ${existing}，跳过`);
      continue;
    }

    const agentId    = rawVal(f["代理商ID"]);
    const courierKey = COURIER_ARG || autoSelectCourier(agentId);
    const courier    = COURIERS[courierKey];
    const trackingNo = genTrackingNo(courierKey);
    const now        = Date.now();

    // 批量更新每条记录
    for (const rec of recs) {
      await updateRecord(rec.record_id, {
        "物流公司": courier.name,
        "快递单号": trackingNo,
        "发货时间": now,
        "物流状态": "已发货",
        "订单状态": "已发货",
      });
    }

    const customerName = rawVal(f["顾客姓名"]);
    const sku          = rawVal(f["产品型号"]);
    const agentName    = rawVal(f["代理商名称"]);
    const promiseDate  = f["预计交期"] ? new Date(f["预计交期"]).toLocaleDateString("zh-CN") : "";

    console.log(`  ✅ ${orderNo}`);
    console.log(`     顾客: ${customerName}  SKU: ${sku}  镜片: ${recs.length} 片`);
    console.log(`     ${courier.icon} ${courier.name}  单号: ${trackingNo}`);

    // 发飞书通知
    await notify(shipCard({
      orderNo, customerName, sku, agentName,
      courierName: courier.name,
      trackingNo,
      trackingUrl: courier.url(trackingNo),
      promiseDate,
      lensCount: recs.length,
    }));
    console.log(`     📨 飞书通知已发送\n`);
  }
}

// ─── 合单发货（按代理商合并）────────────────────────────────────────────────

const DATE_ARG  = (() => { const i = ARGS.indexOf("--date");  return i !== -1 ? ARGS[i+1] : null; })();
const AGENT_ARG = (() => { const i = ARGS.indexOf("--agent"); return i !== -1 ? ARGS[i+1] : null; })();

function batchShipCard({ agentId, agentName, courierName, trackingNo, trackingUrl, orders, totalLens, shipDate }) {
  const orderLines = orders.map(o =>
    `· ${o.orderNo} — ${o.customerName}（${o.lensCount}片 ${o.sku}）`
  ).join("\n");
  return {
    header: { title: { tag: "plain_text", content: `🚚 合单发货 — ${agentName}` }, template: "blue" },
    elements: [
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName} (${agentId})` } },
          { is_short: true, text: { tag: "lark_md", content: `**发货日期**\n${shipDate}` } },
          { is_short: true, text: { tag: "lark_md", content: `**包裹订单数**\n${orders.length} 单` } },
          { is_short: true, text: { tag: "lark_md", content: `**镜片总数**\n${totalLens} 片` } },
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**物流公司**\n${courierName}` } },
          { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${trackingNo}\`` } },
        ],
      },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: `**包含订单**\n${orderLines}` } },
      {
        tag: "action",
        actions: [{ tag: "button", text: { tag: "plain_text", content: "📦 查询物流" }, type: "primary", url: trackingUrl }],
      },
      { tag: "note", elements: [{ tag: "plain_text", content: `发货时间：${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
    ],
  };
}

async function shipBatch() {
  console.log("\n📦 合单发货（按代理商分组）...\n");

  const records = await listRecords(`CurrentValue.[订单状态]="生产中"`);
  if (!records.length) { console.log("  没有待发货订单。"); return; }

  // 按代理商ID分组，每组内再按订单号聚合
  const agentMap = {};
  for (const r of records) {
    const f       = r.fields;
    const agentId = rawVal(f["代理商ID"]) || "UNKNOWN";
    if (!agentMap[agentId]) agentMap[agentId] = [];
    agentMap[agentId].push(r);
  }

  const agentCount = Object.keys(agentMap).length;
  const totalOrders = new Set(records.map(r => rawVal(r.fields["订单编号"]))).size;
  console.log(`  待发货：${totalOrders} 单 / ${records.length} 片  →  合并为 ${agentCount} 个包裹\n`);
  console.log(`  ${"代理商".padEnd(16)}${"订单数".padEnd(8)}${"镜片数".padEnd(8)}${"快递"}`);
  console.log("  " + "─".repeat(52));

  const shipDate = new Date().toLocaleDateString("zh-CN");
  const now = Date.now();

  for (const [agentId, recs] of Object.entries(agentMap)) {
    const f0         = recs[0].fields;
    const agentName  = rawVal(f0["代理商名称"]) || agentId;
    const courierKey = COURIER_ARG || autoSelectCourier(agentId);
    const courier    = COURIERS[courierKey];
    const trackingNo = genTrackingNo(courierKey);

    // 按订单号聚合，统计每单信息
    const orderMap = {};
    for (const r of recs) {
      const no = rawVal(r.fields["订单编号"]);
      if (!orderMap[no]) orderMap[no] = { records: [], fields: r.fields };
      orderMap[no].records.push(r);
    }

    const orders = Object.entries(orderMap).map(([orderNo, { records: orecs, fields: of_ }]) => ({
      orderNo,
      customerName: rawVal(of_["顾客姓名"]),
      sku:          rawVal(of_["产品型号"]),
      lensCount:    orecs.length,
    }));

    // 更新所有记录：共用同一快递单号
    for (const r of recs) {
      await updateRecord(r.record_id, {
        "物流公司": courier.name,
        "快递单号": trackingNo,
        "发货时间": now,
        "物流状态": "已发货",
        "订单状态": "已发货",
      });
    }

    console.log(`  ${courier.icon} ${agentName.padEnd(14)}${String(orders.length+" 单").padEnd(8)}${String(recs.length+" 片").padEnd(8)}${courier.name} ${trackingNo}`);
    for (const o of orders) {
      console.log(`    └ ${o.orderNo}  ${o.customerName}  ${o.sku}  ${o.lensCount}片`);
    }

    await notify(batchShipCard({
      agentId, agentName, courierName: courier.name,
      trackingNo, trackingUrl: courier.url(trackingNo),
      orders, totalLens: recs.length, shipDate,
    }));
    console.log(`    📨 飞书通知\n`);
  }

  console.log(`  ✅ 合单发货完成：${agentCount} 个包裹，${totalOrders} 单，${records.length} 片\n`);
}

// ─── 合单随货同行单（一代理商多订单）────────────────────────────────────────

function batchSlipHTML({ agentId, agentName, trackingNo, courierName, shipDate, orders }) {
  const allRows = [];
  for (const o of orders) {
    for (const r of o.rows) {
      allRows.push({ ...r, orderNo: o.orderNo, customerName: o.customerName });
    }
  }

  const eyeRow = (r) => {
    const lc = r.lensCode || "—";
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=56x56&ecc=M&data=${encodeURIComponent(SERVER_BASE + "/verify/" + lc)}`;
    const isR = r.eye?.includes("右");
    return `
    <tr>
      <td class="order-no">${r.orderNo}<br><span class="cname">${r.customerName}</span>${r.pairIndex > 1 ? '<br><span style="color:#e67e22;font-size:6pt">第' + r.pairIndex + '副</span>' : ''}</td>
      <td class="eye ${isR ? "eye-r" : "eye-l"}">${isR ? "R" : "L"}<br><span>${isR ? "右眼" : "左眼"}</span></td>
      <td class="sku">${r.sku || "—"}</td>
      <td class="rx">${r.sph || "—"}</td>
      <td class="rx">${r.cyl || "—"}</td>
      <td class="rx">${r.axis || "—"}</td>
      <td class="lc"><span class="lc-code">${lc}</span></td>
      <td class="qr-cell"><img src="${qr}" alt="QR" width="48" height="48"></td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>合单随货同行单 — ${agentName}</title>
<style>
  @page { size: A4; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 9.5pt; color: #1a1a2e; background:#fff; }
  .header { display:flex; align-items:flex-end; justify-content:space-between;
            border-bottom:1.5pt solid #c0392b; padding-bottom:3.5mm; margin-bottom:4mm; }
  .brand-name { font-size:17pt; font-weight:900; letter-spacing:3px; color:#c0392b; }
  .brand-sub  { font-size:7pt; color:#888; letter-spacing:1.5px; margin-top:0.8mm; }
  .doc-title h1 { font-size:15pt; font-weight:800; letter-spacing:4px; text-align:right; }
  .doc-title p  { font-size:6.5pt; color:#aaa; text-align:right; margin-top:0.8mm; }

  .meta { display:grid; grid-template-columns:repeat(5,1fr); gap:2.5mm;
          background:#fdf5f5; border:0.5pt solid #f0d0d0; border-radius:2mm;
          padding:3.5mm 5mm; margin-bottom:4mm; }
  .meta-label { font-size:5.5pt; color:#aaa; text-transform:uppercase; letter-spacing:1px; margin-bottom:0.5mm; }
  .meta-value { font-size:9.5pt; font-weight:700; }
  .meta-value.mono { font-family:"Courier New",monospace; font-size:8.5pt; }
  .meta-value.red  { color:#c0392b; }

  .rx-title { font-size:7.5pt; font-weight:700; letter-spacing:2px; text-transform:uppercase;
              color:#c0392b; margin-bottom:2mm; padding-left:2mm; border-left:2pt solid #c0392b; }
  table { width:100%; border-collapse:collapse; margin-bottom:5mm; font-size:8.5pt; }
  thead th { background:#1a1a2e; color:#fff; font-size:6.5pt; font-weight:600;
             padding:2mm 2.5mm; text-align:center; letter-spacing:0.5px; }
  thead th:first-child { text-align:left; padding-left:3mm; }
  tbody tr { border-bottom:0.4pt solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody tr:hover { background:#fef5f5; }

  td.order-no { padding:2.5mm 3mm; font-size:7pt; font-family:"Courier New",monospace; white-space:nowrap; }
  td.order-no .cname { font-family:"PingFang SC","Microsoft YaHei",sans-serif; font-size:8pt; font-weight:700; color:#1a1a2e; }
  td.eye { width:11mm; font-size:14pt; font-weight:900; text-align:center; padding:2mm 0; line-height:1; }
  td.eye span { font-size:5.5pt; font-weight:400; display:block; }
  td.eye-r { color:#c0392b; }
  td.eye-l { color:#2980b9; }
  td.sku  { padding:2.5mm; font-size:7.5pt; font-weight:600; }
  td.rx   { padding:2.5mm; text-align:center; font-family:"Courier New",monospace;
            font-size:10pt; font-weight:700; color:#c0392b; }
  td.lc   { padding:2.5mm; }
  .lc-code { font-family:"Courier New",monospace; font-size:6.5pt; font-weight:700;
             background:#1a1a2e; color:#fff; padding:0.8mm 1.5mm; border-radius:1mm; letter-spacing:1px; }
  td.qr-cell { padding:1.5mm; text-align:center; width:16mm; }

  .logistics { display:flex; gap:4mm; margin-bottom:5mm; }
  .logistics-box { flex:1; border:0.5pt solid #ddd; border-radius:2mm; padding:3.5mm; }
  .logistics-box h3 { font-size:6.5pt; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#888; margin-bottom:2.5mm; }
  .tracking-no { font-family:"Courier New",monospace; font-size:13pt; font-weight:900; color:#1a1a2e; letter-spacing:2px; }
  .courier-name { font-size:8.5pt; color:#555; margin-top:1mm; }

  .sign-section { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4mm; margin-bottom:5mm; }
  .sign-box { border:0.5pt solid #ddd; border-radius:2mm; padding:3.5mm; min-height:20mm; }
  .sign-box h3 { font-size:6.5pt; color:#aaa; letter-spacing:1px; text-transform:uppercase; margin-bottom:1.5mm; }
  .sign-box .sign-line { border-bottom:0.5pt solid #ccc; margin:8mm 2mm 1.5mm; }
  .sign-box .sign-hint { font-size:5.5pt; color:#ccc; text-align:center; }

  .footer { border-top:0.5pt solid #eee; padding-top:2.5mm; display:flex; justify-content:space-between; align-items:center; }
  .footer-left  { font-size:6pt; color:#bbb; }
  .footer-right { font-size:5.5pt; color:#ccc; font-family:"Courier New",monospace; }

  @media print { body{-webkit-print-color-adjust:exact;print-color-adjust:exact;} .no-print{display:none;} }
  .print-btn { position:fixed; bottom:20px; right:20px; padding:10px 20px; background:#c0392b;
               color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer;
               box-shadow:0 4px 12px rgba(0,0,0,.2); }
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
    <h1>合单随货同行单</h1>
    <p>CONSOLIDATED PACKING SLIP / DELIVERY NOTE</p>
  </div>
</div>

<div class="meta">
  <div><div class="meta-label">代理商 Agent</div><div class="meta-value red">${agentName}</div><div style="font-size:6pt;color:#aaa;margin-top:0.5mm">${agentId}</div></div>
  <div><div class="meta-label">发货日期 Ship Date</div><div class="meta-value">${shipDate}</div></div>
  <div><div class="meta-label">订单数 Orders</div><div class="meta-value red">${orders.length} 单</div></div>
  <div><div class="meta-label">镜片数量 Qty</div><div class="meta-value red">${allRows.length} 片</div></div>
  <div><div class="meta-label">快递单号 Tracking</div><div class="meta-value mono">${trackingNo || "—"}</div></div>
</div>

<div class="rx-title">处方明细 Prescription Details — 共 ${allRows.length} 片</div>
<table>
  <thead>
    <tr>
      <th>订单号 / 顾客</th><th>眼别</th><th>SKU</th>
      <th>SPH</th><th>CYL</th><th>AXIS</th>
      <th>镜片码</th><th>溯源</th>
    </tr>
  </thead>
  <tbody>
    ${allRows.map(eyeRow).join("\n")}
  </tbody>
</table>

<div class="logistics">
  <div class="logistics-box">
    <h3>物流信息 Shipping</h3>
    <div class="tracking-no">${trackingNo || "—"}</div>
    <div class="courier-name">${courierName || "—"}</div>
  </div>
  <div class="logistics-box" style="flex:3">
    <h3>订单汇总 Order Summary</h3>
    <table style="margin:0;font-size:7.5pt">
      <thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:1.5mm;color:#555;font-weight:600">订单号</th><th style="padding:1.5mm;color:#555;font-weight:600">顾客</th><th style="padding:1.5mm;color:#555;font-weight:600">SKU</th><th style="padding:1.5mm;color:#555;font-weight:600">片数</th></tr></thead>
      <tbody>
        ${orders.map(o => `<tr><td style="padding:1.5mm;font-family:monospace;font-size:6.5pt">${o.orderNo}</td><td style="padding:1.5mm;font-weight:600">${o.customerName}</td><td style="padding:1.5mm">${o.rows.map(r=>r.sku).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}</td><td style="padding:1.5mm;text-align:center;font-weight:700;color:#c0392b">${o.rows.length}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>
</div>

<div class="sign-section">
  <div class="sign-box">
    <h3>发货方签章 Shipper</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">高视星 / GAUSH CLEAR</div>
  </div>
  <div class="sign-box">
    <h3>代理商签收 Agent</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">${agentName}</div>
  </div>
  <div class="sign-box">
    <h3>签收日期 Date</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">　　年　　月　　日</div>
  </div>
</div>

<div class="footer">
  <div class="footer-left">高视星 GAUSH CLEAR Supply Chain v1.0 &nbsp;|&nbsp; 本单据随货附带，请妥善保存 &nbsp;|&nbsp; ${agentName} 专属包裹</div>
  <div class="footer-right">打印时间 ${new Date().toLocaleString("zh-CN")}</div>
</div>
</body>
</html>`;
}

async function slipBatch() {
  const dateStr = DATE_ARG || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  console.log(`\n📄 生成合单随货同行单${AGENT_ARG ? " — " + AGENT_ARG : "（全代理商）"}...\n`);

  let filter = `CurrentValue.[快递单号]!=""`;
  if (AGENT_ARG) filter += `&&CurrentValue.[代理商ID]="${AGENT_ARG}"`;

  const records = await listRecords(filter);
  if (!records.length) { console.log("  无已发货记录，请先运行 ship-batch。"); return; }

  // 按代理商 + 快递单号分组（一个代理商可能在不同批次有不同快递单）
  const agentMap = {};
  for (const r of records) {
    const f         = r.fields;
    const agentId   = rawVal(f["代理商ID"]) || "UNKNOWN";
    const trackingNo= rawVal(f["快递单号"]);
    const key       = `${agentId}__${trackingNo}`;
    if (!agentMap[key]) agentMap[key] = { agentId, agentName: rawVal(f["代理商名称"]) || agentId,
      trackingNo, courierName: rawVal(f["物流公司"]),
      shipDate: f["发货时间"] ? new Date(f["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
      records: [] };
    agentMap[key].records.push(r);
  }

  mkdirSync(resolve(__dirname, "docs"), { recursive: true });
  let count = 0;

  for (const [key, group] of Object.entries(agentMap)) {
    // 按订单号聚合，从镜片明细表获取处方数据
    const orderMap = {};
    for (const r of group.records) {
      const no = rawVal(r.fields["订单编号"]);
      const pi = r.fields["序号"] || 1;
      const key = `${no}|${pi}`;
      if (!orderMap[key]) orderMap[key] = { orderNo: no, customerName: rawVal(r.fields["顾客姓名"]), pairIndex: pi, rows: [] };
    }
    // 查每个订单的镜片明细
    for (const [key, order] of Object.entries(orderMap)) {
      const lensDetails = await getLensDetailsByOrder(order.orderNo);
      for (const ld of lensDetails) {
        const f = ld.fields;
        if ((f["序号"] || 1) !== order.pairIndex) continue;
        order.rows.push({
          eye:      rawVal(f["眼别"]) || "—",
          customerName: rawVal(f["顾客姓名"]) || "",
          sku:      rawVal(f["产品型号"]),
          sph:      f["球镜SPH"] ?? "",
          cyl:      f["柱镜CYL"] ?? "",
          axis:     f["轴位AXIS"] ?? "",
          lensCode: rawVal(f["镜片码（唯一）"]),
          pairIndex: f["序号"] || 1,
        });
      }
    }

    // 按序号+顾客+眼别排序（右眼在上，左眼在下）
    for (const o of Object.values(orderMap)) o.rows.sort((a, b) => {
      const pi = (a.pairIndex || 1) - (b.pairIndex || 1);
      if (pi !== 0) return pi;
      const nc = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
      if (nc !== 0) return nc;
      return a.eye.includes("右") ? -1 : 1;
    });

    const orders = Object.values(orderMap);
    const slipData = { agentId: group.agentId, agentName: group.agentName,
      trackingNo: group.trackingNo, courierName: group.courierName,
      shipDate: group.shipDate, orders };

    const fname = `docs/slip-batch-${group.agentId}-${group.trackingNo}.html`;
    writeFileSync(resolve(__dirname, fname), batchSlipHTML(slipData), "utf-8");
    console.log(`  ✅ ${group.agentName.padEnd(12)} ${group.trackingNo}  →  ${fname}`);
    count++;
  }

  console.log(`\n  共生成 ${count} 张合单通行单。\n`);
}

// ─── 模拟签收 ──────────────────────────────────────────────────────────────

async function simulateDelivery() {
  if (!ORDER_NO) { console.error("  请指定 --order ORD-xxx"); process.exit(1); }
  console.log(`\n✅ 模拟消费者签收: ${ORDER_NO}\n`);

  const records = await listRecords(`CurrentValue.[订单编号]="${ORDER_NO}"`);
  if (!records.length) { console.log("  未找到订单。"); return; }

  const now = Date.now();
  const f = records[0].fields;

  // 已签收状态已废弃，已发货为终态，此命令仅作记录用途
  const signedAt = new Date(now).toLocaleString("zh-CN");
  console.log(`  ℹ️  deliver 命令已废弃：已发货为终态，无需签收确认`);
  console.log(`  时间: ${signedAt}`);

  await notify(deliveredCard({
    orderNo:      ORDER_NO,
    customerName: rawVal(f["顾客姓名"]),
    sku:          rawVal(f["产品型号"]),
    agentName:    rawVal(f["代理商名称"]),
    courierName:  rawVal(f["物流公司"]),
    trackingNo:   rawVal(f["快递单号"]),
    signedAt,
    lensCount:    records.length,
  }));
  console.log(`  📨 飞书【已签收】通知已发送\n`);
}

// ─── 查看在途物流状态 ──────────────────────────────────────────────────────

async function showStatus() {
  console.log("\n📊 物流状态汇总\n");
  const records = await listRecords(`CurrentValue.[快递单号]!=""`);
  const orderMap = {};
  for (const r of records) {
    const no = rawVal(r.fields["订单编号"]);
    if (!orderMap[no]) orderMap[no] = r.fields;
  }

  if (!Object.keys(orderMap).length) { console.log("  暂无物流记录。"); return; }

  const statusEmoji = { "待发货": "⬜", "已发货": "🚚", "运输中": "📦", "已签收": "✅" };

  console.log(`${"订单号".padEnd(26)}${"顾客".padEnd(10)}${"快递单号".padEnd(20)}${"状态".padEnd(8)}${"发货时间"}`);
  console.log("─".repeat(80));

  for (const [no, f] of Object.entries(orderMap)) {
    const rawV = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");
    const status  = rawV(f["物流状态"]) || "待发货";
    const shipped = f["发货时间"] ? new Date(f["发货时间"]).toLocaleDateString("zh-CN") : "—";
    const tracking= rawV(f["快递单号"]);
    const customer= rawV(f["顾客姓名"]);
    console.log(`${(statusEmoji[status]||"") + " " + no.padEnd(24)}${customer.padEnd(10)}${tracking.padEnd(20)}${status.padEnd(8)}${shipped}`);
  }
  console.log();
}

// ─── Webhook 服务（接收快递公司回调）────────────────────────────────────

async function startWebhookServer() {
  const PORT = 3211;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // POST /webhook/delivered?orderNo=ORD-xxx
    if (req.method === "POST" && url.pathname === "/webhook/delivered") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        const data = JSON.parse(body || "{}");
        const orderNo = url.searchParams.get("orderNo") || data.orderNo;
        if (!orderNo) { res.writeHead(400); res.end('{"error":"missing orderNo"}'); return; }

        console.log(`\n📬 收到签收回调: ${orderNo}`);
        const records = await listRecords(`CurrentValue.[订单编号]="${orderNo}"`);
        if (!records.length) { res.writeHead(404); res.end('{"error":"not found"}'); return; }

        const now = Date.now();
        const f = records[0].fields;

        // 已签收状态已废弃，已发货为终态，仅发送飞书通知，不更新订单状态
        const signedAt = new Date(now).toLocaleString("zh-CN");
        await notify(deliveredCard({
          orderNo,
          customerName: rawVal(f["顾客姓名"]),
          sku:          rawVal(f["产品型号"]),
          agentName:    rawVal(f["代理商名称"]),
          courierName:  rawVal(f["物流公司"]) || "快递",
          trackingNo:   rawVal(f["快递单号"]) || "—",
          signedAt,
          lensCount:    records.length,
        }));

        console.log(`  ✅ ${orderNo} 已签收，飞书通知已发`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, orderNo, signedAt }));
      });
      return;
    }

    // GET /webhook/health
    if (url.pathname === "/webhook/health") {
      res.writeHead(200); res.end('{"status":"ok"}'); return;
    }

    res.writeHead(404); res.end('{"error":"not found"}');
  });

  server.listen(PORT, () => {
    console.log(`\n📡 物流 Webhook 服务启动: http://localhost:${PORT}`);
    console.log(`   签收回调: POST http://localhost:${PORT}/webhook/delivered?orderNo=ORD-xxx`);
    console.log(`   健康检查: GET  http://localhost:${PORT}/webhook/health`);
    console.log(`\n   等待快递公司回调... (Ctrl+C 停止)\n`);
  });
}

// ─── 随货同行单（模板已统一到 lib/templates.js::slipHTML）────────────────

async function generateSlip() {
  if (!ORDER_NO) { console.error("  请指定 --order ORD-xxx"); process.exit(1); }
  console.log(`\n📄 生成随货同行单: ${ORDER_NO}\n`);

  const records = await listRecords(`CurrentValue.[订单编号]="${ORDER_NO}"`);
  if (!records.length) { console.log("  未找到订单，请确认订单号。"); return; }
  const f0 = records[0].fields;

  // 从镜片明细表获取处方数据
  const lensDetails = await getLensDetailsByOrder(ORDER_NO);
  const rows = lensDetails.map(r => {
    const f = r.fields;
    return {
      eye:      rawVal(f["眼别"]) || (lensDetails.indexOf(r) === 0 ? "右眼" : "左眼"),
      customerName: rawVal(f["顾客姓名"]) || "",
      sku:      rawVal(f["产品型号"]),
      sph:      f["球镜SPH"] ?? "",
      cyl:      f["柱镜CYL"] ?? "",
      axis:     f["轴位AXIS"] ?? "",
      lensCode: rawVal(f["镜片码（唯一）"]),
      pairIndex: f["序号"] || 1,
    };
  });

  // 按序号+顾客+眼别排序（右眼在上，左眼在下）
  rows.sort((a, b) => {
    const pi = (a.pairIndex || 1) - (b.pairIndex || 1);
    if (pi !== 0) return pi;
    const nc = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
    if (nc !== 0) return nc;
    return a.eye.includes("右") ? -1 : 1;
  });

  const order = {
    orderNo:      ORDER_NO,
    customerName: rawVal(f0["顾客姓名"]),
    agentName:    rawVal(f0["代理商名称"]),
    agentId:      rawVal(f0["代理商ID"]),
    shipDate:     f0["发货时间"] ? new Date(f0["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
    promiseDate:  f0["预计交期"] ? new Date(f0["预计交期"]).toLocaleDateString("zh-CN") : "",
    courierName:  rawVal(f0["物流公司"]),
    trackingNo:   rawVal(f0["快递单号"]),
    rows,
  };

  mkdirSync(resolve(__dirname, "docs"), { recursive: true });
  const outPath = resolve(__dirname, `docs/slip-${ORDER_NO}.html`);
  writeFileSync(outPath, slipHTML(order), "utf-8");

  console.log(`  ✅ 随货同行单已生成: docs/slip-${ORDER_NO}.html`);
  console.log(`  顾客: ${order.customerName}  代理商: ${order.agentName}`);
  console.log(`  快递: ${order.courierName || "—"}  单号: ${order.trackingNo || "—"}`);
  console.log(`  镜片: ${rows.length} 片\n`);
  console.log(`  浏览器打开预览并打印：`);
  console.log(`  start docs/slip-${ORDER_NO}.html`);
}

// ─── 帮助 ──────────────────────────────────────────────────────────────────

function help() {
  console.log(`
高视星物流全链路管理

命令：
  node logistics.js migrate                    添加物流字段到飞书订单表（首次运行）
  node logistics.js ship                       为所有"生产中"订单生成快递单并发货通知
  node logistics.js ship --order ORD-xxx       指定订单发货
  node logistics.js ship --courier sf|zt|yd    指定快递公司（默认自动）
  node logistics.js deliver --order ORD-xxx    模拟消费者签收
  node logistics.js status                     查看在途物流汇总
  node logistics.js slip --order ORD-xxx       生成随货同行单（HTML，可打印）
  node logistics.js webhook                    启动 Webhook 服务（接收快递回调）

快递公司：
  sf  顺丰速运（默认，北方/成都）
  zt  中通快递（南方）
  yd  韵达快递

全流程示例：
  node logistics.js migrate
  node logistics.js ship --order ORD-20260413-SUNI3I
  node logistics.js slip --order ORD-20260413-SUNI3I
  node logistics.js status
  node logistics.js deliver --order ORD-20260413-SUNI3I
`);
}

// ─── 入口 ──────────────────────────────────────────────────────────────────

(async () => {
  switch (CMD) {
    case "migrate":  await migrate(); break;
    case "ship":     await ship(); break;
    case "deliver":  await simulateDelivery(); break;
    case "status":   await showStatus(); break;
    case "slip":       await generateSlip(); break;
    case "ship-batch": await shipBatch(); break;
    case "slip-batch": await slipBatch(); break;
    case "webhook":  await startWebhookServer(); break;
    default:         help();
  }
})().catch(err => { console.error("💥 错误:", err.message); process.exit(1); });
