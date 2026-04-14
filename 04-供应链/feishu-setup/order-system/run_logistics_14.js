/**
 * run_logistics_14.js — 把14笔测试订单走完物流全链路：待处理→生产中→已发货→已签收
 */
import { readFileSync } from "fs";

const env = {};
for (const line of readFileSync("../shared/.env", "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [k, ...v] = t.split("=");
  env[k.trim()] = v.join("=").trim();
}

const BASE = "https://open.feishu.cn/open-apis";
const APP = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TBL = "tblk9Ch4gk2uQ1zG";
const LENS_TBL = "tblC7pve7ObFgIOl";

// 获取两个token
const r1 = await fetch(BASE + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
});
const TOKEN = (await r1.json()).tenant_access_token;
const h = { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN };

async function listRecords(tableId, filter) {
  const records = [];
  let pageToken = "";
  while (true) {
    let qs = "?page_size=100";
    if (filter) qs += "&filter=" + encodeURIComponent(filter);
    if (pageToken) qs += "&page_token=" + pageToken;
    const r = await fetch(`${BASE}/bitable/v1/apps/${APP}/tables/${tableId}/records${qs}`, { headers: h });
    const d = await r.json();
    if (d.code !== 0) break;
    for (const item of d.data.items || []) records.push(item);
    if (!d.data.has_more) break;
    pageToken = d.data.page_token;
  }
  return records;
}

async function updateRecord(tableId, recordId, fields) {
  const r = await fetch(`${BASE}/bitable/v1/apps/${APP}/tables/${tableId}/records/${recordId}`, {
    method: "PUT", headers: h,
    body: JSON.stringify({ fields }),
  });
  return r.json();
}

async function sendWebhook(title, content) {
  if (!env.FEISHU_WEBHOOK_URL) { console.log("  ⚠️ 未配置 FEISHU_WEBHOOK_URL，跳过通知"); return; }
  await fetch(env.FEISHU_WEBHOOK_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: { title: { tag: "plain_text", content: title }, template: "blue" },
        elements: [{ tag: "markdown", content }],
      },
    }),
  });
}

function val(v) {
  if (Array.isArray(v)) return v[0]?.text ?? v[0] ?? "";
  return v ?? "";
}

const now = Date.now();

// ─── Step 1: 找到我们的14笔订单（深圳视力康+尧视共创+上海聚势的测试订单）───
console.log("=== Step 1: 查找14笔测试订单 ===\n");

const allOrders = await listRecords(ORDER_TBL);
const testAgents = ["AG-028", "AG-005", "AG-003"];
const todayOrders = allOrders.filter(r => {
  const agentId = val(r.fields["代理商ID"]);
  const status = val(r.fields["订单状态"]);
  const orderNo = val(r.fields["订单编号"]);
  return testAgents.includes(agentId) && status === "待处理" && orderNo.includes("20260414");
});

// 按订单号分组
const orderNos = [...new Set(testAgents.flatMap(() => todayOrders.map(r => val(r.fields["订单编号"]))))];
console.log(`找到 ${orderNos.length} 个订单号，共 ${todayOrders.length} 条记录\n`);

// ─── Step 2: 待处理 → 生产中 ─────────────────────────────────────────────────
console.log("=== Step 2: 待处理 → 生产中 ===\n");

for (const rec of todayOrders) {
  await updateRecord(ORDER_TBL, rec.record_id, { "订单状态": "生产中" });
}
console.log(`✅ ${todayOrders.length} 条记录更新为「生产中」\n`);

// ─── Step 3: 生产中 → 已发货（生成快递单号）─────────────────────────────────
console.log("=== Step 3: 生产中 → 已发货 ===\n");

const couriers = ["顺丰速运", "中通快递", "韵达快递"];
const shipResults = [];

for (const orderNo of orderNos) {
  const recs = todayOrders.filter(r => val(r.fields["订单编号"]) === orderNo);
  const f = recs[0].fields;
  const courierName = couriers[Math.floor(Math.random() * couriers.length)];
  const trackingNo = courierName === "顺丰速运" ? "SF" + String(Math.random()).slice(2, 14)
    : courierName === "中通快递" ? "75" + String(Math.random()).slice(2, 12)
    : "YD" + String(Math.random()).slice(2, 14);

  for (const rec of recs) {
    await updateRecord(ORDER_TBL, rec.record_id, {
      "订单状态": "已发货",
      "物流状态": "已发货",
      "物流公司": courierName,
      "快递单号": trackingNo,
      "发货时间": now,
    });
  }

  const agentName = val(f["代理商名称"]);
  const customerName = val(f["顾客姓名"]);
  const sku = val(f["产品型号"]);

  shipResults.push({ orderNo, customerName, sku, agentName, courierName, trackingNo, lensCount: recs.length });
  console.log(`✅ ${orderNo} → ${courierName} ${trackingNo}（${customerName} ${sku}）`);

  // 每个代理商发一次合单通知（同一个代理商的多个订单合并）
  await new Promise(r => setTimeout(r, 200));
}

// 按代理商分组发飞书通知
const agentGroups = {};
for (const s of shipResults) {
  if (!agentGroups[s.agentName]) agentGroups[s.agentName] = [];
  agentGroups[s.agentName].push(s);
}

for (const [agentName, orders] of Object.entries(agentGroups)) {
  const totalLens = orders.reduce((sum, o) => sum + o.lensCount, 0);
  const orderLines = orders.map(o => `· ${o.orderNo} — ${o.customerName}（${o.lensCount}片 ${o.sku}）`).join("\n");
  const courierInfo = orders.map(o => `${o.courierName} ${o.trackingNo}`).join("、");

  await sendWebhook(
    `🚚 已发货 — ${agentName}`,
    `**代理商：** ${agentName}\n**订单数：** ${orders.length} 单\n**镜片总数：** ${totalLens} 片\n**物流：** ${courierInfo}\n\n**包含订单：**\n${orderLines}\n\n发货时间：${new Date().toLocaleString("zh-CN")}`
  );
  console.log(`📨 飞书发货通知已发送 → ${agentName}`);
}

// ─── Step 4: 已发货 → 已签收 ─────────────────────────────────────────────────
console.log("\n=== Step 4: 已发货 → 已签收 ===\n");

// 重新查已发货的记录
const shippedRecords = await listRecords(ORDER_TBL, `CurrentValue.[订单状态]="已发货"`);
const shippedToday = shippedRecords.filter(r => {
  const agentId = val(r.fields["代理商ID"]);
  return testAgents.includes(agentId);
});

for (const rec of shippedToday) {
  await updateRecord(ORDER_TBL, rec.record_id, {
    "订单状态": "已签收",
    "物流状态": "已签收",
    "签收时间": now,
  });
}
console.log(`✅ ${shippedToday.length} 条记录更新为「已签收」\n`);

// 按代理商分组发签收通知
const deliveredGroups = {};
for (const rec of shippedToday) {
  const agentName = val(rec.fields["代理商名称"]);
  if (!deliveredGroups[agentName]) deliveredGroups[agentName] = {};
  const orderNo = val(rec.fields["订单编号"]);
  if (!deliveredGroups[agentName][orderNo]) deliveredGroups[agentName][orderNo] = { recs: [], fields: rec.fields };
  deliveredGroups[agentName][orderNo].recs.push(rec);
}

for (const [agentName, orders] of Object.entries(deliveredGroups)) {
  const totalLens = Object.values(orders).reduce((sum, o) => sum + o.recs.length, 0);
  const orderLines = Object.entries(orders).map(([no, o]) => {
    const f = o.fields;
    return `· ${no} — ${val(f["顾客姓名"])}（${o.recs.length}片 ${val(f["产品型号"])}）`;
  }).join("\n");

  await sendWebhook(
    `✅ 已签收 — ${agentName}`,
    `**代理商：** ${agentName}\n**订单数：** ${Object.keys(orders).length} 单\n**镜片总数：** ${totalLens} 片\n\n**包含订单：**\n${orderLines}\n\n签收时间：${new Date().toLocaleString("zh-CN")}`
  );
  console.log(`📨 飞书签收通知已发送 → ${agentName}`);
}

// ─── 汇总 ──────────────────────────────────────────────────────────────────
console.log("\n=== 物流全链路完成 ===\n");
for (const s of shipResults) {
  console.log(`${s.orderNo} | ${s.customerName} | ${s.sku} | ${s.courierName} ${s.trackingNo} | ✅已签收`);
}
console.log(`\n共 ${orderNos.length} 笔订单，${todayOrders.length} 片镜片，全部完成签收`);
