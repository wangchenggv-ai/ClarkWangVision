/**
 * e2e_test.mjs — 完整E2E测试（直接用Bitable API）
 * 下单 → 确认 → 发货 → 签收 → 飞书通知
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(resolve(__dirname, "../shared/.env"), "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [k, ...v] = t.split("=");
  env[k.trim()] = v.join("=").trim();
}

const FEISHU = "https://open.feishu.cn/open-apis";
const APP = "B3xQbbqicaome1sKdZbcwdk8nWg";
const ORDER_TBL = "tblk9Ch4gk2uQ1zG";
const LENS_TBL = "tblC7pve7ObFgIOl";

// Bitable token
const r1 = await fetch(FEISHU + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
});
const TOKEN = (await r1.json()).tenant_access_token;
const h = { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN };

// Notify token
const r2 = await fetch(FEISHU + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.NOTIFY_APP_ID, app_secret: env.NOTIFY_APP_SECRET }),
});
const NOTIFY_TOKEN = (await r2.json()).tenant_access_token;

async function api(method, path, body) {
  const opts = { method, headers: h };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(FEISHU + path, opts);
  return r.json();
}

async function sendCard(title, template, content) {
  const r = await fetch(FEISHU + "/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + NOTIFY_TOKEN },
    body: JSON.stringify({
      receive_id: env.NOTIFY_CHAT_ID,
      msg_type: "interactive",
      content: JSON.stringify({
        header: { title: { tag: "plain_text", content: title }, template },
        elements: [
          { tag: "div", text: { tag: "lark_md", content } },
          { tag: "note", elements: [{ tag: "plain_text", content: new Date().toLocaleString("zh-CN") + " | 高视星供应链系统" }] },
        ],
      }),
    }),
  });
  const d = await r.json();
  return d.code === 0;
}

const now = Date.now();

const orders = [
  {
    orderNo: "ORD-E2E-" + randomBytes(3).toString("hex").toUpperCase(),
    customer: "E2E测试顾客A", sku: "Ultra双效", agent: "深圳视力康", agentId: "AG-028",
    terminal: "运城眼科医院", contact: "王主任", phone: "13800001234", address: "山西省运城市人民北路1号",
    eyes: [{ side: "右眼", sph: -3.00, cyl: -0.75, axis: 180 }, { side: "左眼", sph: -3.25, cyl: -0.50, axis: 170 }],
  },
  {
    orderNo: "ORD-E2E-" + randomBytes(3).toString("hex").toUpperCase(),
    customer: "E2E测试顾客B", sku: "D8", agent: "尧视共创", agentId: "AG-005",
    terminal: "北京大学人民医院", contact: "李医生", phone: "13900005678", address: "北京市西直门南大街11号",
    eyes: [{ side: "右眼", sph: -5.00, cyl: -1.00, axis: 90 }, { side: "左眼", sph: -4.75, cyl: -0.75, axis: 85 }],
  },
];

const recordIds = [];

for (const o of orders) {
  console.log("\n=== 下单: " + o.orderNo + " ===");

  const orderRes = await api("POST", "/bitable/v1/apps/" + APP + "/tables/" + ORDER_TBL + "/records", {
    fields: {
      "订单编号": o.orderNo, "终端客户": o.terminal, "顾客姓名": o.customer,
      "产品型号": o.sku, "数量": o.eyes.length, "是否装配": "是",
      "代理商名称": o.agent, "代理商ID": o.agentId,
      "收货地址": o.address, "联系人": o.contact, "联系电话": o.phone,
      "订单状态": "待处理", "订单来源": "代理商门户", "下单日期": now,
    },
  });
  if (orderRes.code !== 0) { console.log("主表写入失败:", JSON.stringify(orderRes)); process.exit(1); }
  recordIds.push(orderRes.data.record.record_id);
  console.log("  订单主表写入");

  const lensRecords = o.eyes.map(eye => ({
    fields: {
      "订单编号": o.orderNo,
      "镜片码": randomBytes(8).toString("hex").toUpperCase(),
      "镜片码（唯一）": randomBytes(8).toString("hex").toUpperCase(),
      "顾客姓名": o.customer, "产品型号": o.sku, "眼别": eye.side,
      "球镜SPH": eye.sph, "柱镜CYL": eye.cyl, "轴位AXIS": eye.axis,
      "是否装配": "是", "代理商名称": o.agent, "代理商ID": o.agentId, "订单状态": "待处理",
    },
  }));
  const lensRes = await api("POST", "/bitable/v1/apps/" + APP + "/tables/" + LENS_TBL + "/records/batch_create", { records: lensRecords });
  if (lensRes.code !== 0) { console.log("明细写入失败:", JSON.stringify(lensRes)); process.exit(1); }
  console.log("  镜片明细写入: " + o.eyes.length + " 片");

  const sent = await sendCard("新订单 " + o.orderNo, "blue",
    "**订单号：** " + o.orderNo + "\n**顾客：** " + o.customer + "\n**SKU：** " + o.sku + " x " + o.eyes.length + "片\n**代理商：** " + o.agent + "\n**终端客户：** " + o.terminal);
  console.log("  飞书下单通知: " + (sent ? "已发送" : "发送失败"));
}

// Step 2: 确认 -> 生产中
console.log("\n=== Step 2: 确认 -> 生产中 ===");
for (const rid of recordIds) {
  await api("PUT", "/bitable/v1/apps/" + APP + "/tables/" + ORDER_TBL + "/records/" + rid, {
    fields: { "订单状态": "生产中" },
  });
}
console.log(recordIds.length + " 单更新为生产中");

// Step 3: 发货
console.log("\n=== Step 3: 合单发货 ===");
const couriers = ["顺丰速运", "中通快递"];
for (let i = 0; i < orders.length; i++) {
  const courier = couriers[i];
  const trackingNo = courier === "顺丰速运"
    ? "SF" + String(Math.random()).slice(2, 14)
    : "75" + String(Math.random()).slice(2, 12);
  await api("PUT", "/bitable/v1/apps/" + APP + "/tables/" + ORDER_TBL + "/records/" + recordIds[i], {
    fields: {
      "订单状态": "已发货", "物流状态": "已发货",
      "物流公司": courier, "快递单号": trackingNo, "发货时间": now,
    },
  });
  console.log("  " + orders[i].orderNo + " -> " + courier + " " + trackingNo);

  const sent = await sendCard("已发货 " + orders[i].agent, "blue",
    "**订单号：** " + orders[i].orderNo + "\n**顾客：** " + orders[i].customer + "\n**物流：** " + courier + " " + trackingNo + "\n**代理商：** " + orders[i].agent);
  console.log("  飞书发货通知: " + (sent ? "已发送" : "发送失败"));
}

// Step 4: 签收
console.log("\n=== Step 4: 签收 ===");
for (let i = 0; i < orders.length; i++) {
  await api("PUT", "/bitable/v1/apps/" + APP + "/tables/" + ORDER_TBL + "/records/" + recordIds[i], {
    fields: { "订单状态": "已签收", "物流状态": "已签收", "签收时间": now },
  });
  console.log("  " + orders[i].orderNo + " -> 已签收");

  const sent = await sendCard("已签收 " + orders[i].customer, "green",
    "**订单号：** " + orders[i].orderNo + "\n**顾客：** " + orders[i].customer + "\n**产品：** " + orders[i].sku + "\n**终端客户：** " + orders[i].terminal + "\n\n全链路完成");
  console.log("  飞书签收通知: " + (sent ? "已发送" : "发送失败"));
}

console.log("\n========================================");
console.log("E2E 全链路完成");
console.log("========================================");
for (const o of orders) {
  console.log(o.orderNo + " | " + o.customer + " | " + o.sku + " | 已签收");
}
console.log("\n共 " + orders.length + " 单，" + (orders.length * 2) + " 片镜片");
