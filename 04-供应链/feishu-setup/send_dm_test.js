#!/usr/bin/env node
// send_dm_test.js — E2E 通知测试
// 支持两种模式：
//   1. Webhook 模式（优先）: FEISHU_WEBHOOK_URL 已配置，直接用群机器人发
//   2. 私信模式: node send_dm_test.js --open_id ou_xxxxxxx

import "dotenv/config";
import crypto from "crypto";

const APP_ID      = process.env.FEISHU_APP_ID;
const APP_SECRET  = process.env.FEISHU_APP_SECRET;
const WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL;
const BASE        = "https://open.feishu.cn/open-apis";

// CLI 参数：--open_id ou_xxx
const oidIdx = process.argv.indexOf("--open_id");
const CLI_OPEN_ID = oidIdx !== -1 ? process.argv[oidIdx + 1] : null;

// ── helpers ──────────────────────────────────────────────────────────
async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  }).then(r => r.json());
  if (!r.tenant_access_token) throw new Error("Token failed: " + JSON.stringify(r));
  return r.tenant_access_token;
}

// ── 模拟订单数据（使用 SUNI3I 批测订单）────────────────────────────────
const ORDER = {
  orderNo:      "ORD-20260413-SUNI3I",
  customerName: "张明辉",
  sku:          "Ultra -1.25",
  eye:          "右眼 (R)",
  lensCode:     crypto.randomBytes(8).toString("hex").toUpperCase(),
  courier:      "顺丰速运",
  trackingNo:   "SF" + Math.floor(100000000000 + Math.random() * 900000000000),
  eta:          "2026/04/16",
  agent:        "北京明视眼镜 (AG-003)",
};

// ── Webhook 模式：发货卡片 ────────────────────────────────────────────
function webhookShipCard(order) {
  return {
    msg_type: "interactive",
    card: JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "🚚 镜片已发货 — GAUSH CLEAR 溯源系统" },
      },
      elements: [
        {
          tag: "div",
          fields: [
            { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${order.orderNo}` } },
            { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${order.customerName}` } },
            { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${order.sku}` } },
            { is_short: true, text: { tag: "lark_md", content: `**眼别**\n${order.eye}` } },
          ],
        },
        { tag: "hr" },
        {
          tag: "div",
          fields: [
            { is_short: true, text: { tag: "lark_md", content: `**物流公司**\n${order.courier}` } },
            { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${order.trackingNo}\`` } },
            { is_short: true, text: { tag: "lark_md", content: `**镜片码**\n\`${order.lensCode}\`` } },
            { is_short: true, text: { tag: "lark_md", content: `**预计到达**\n${order.eta}` } },
          ],
        },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: `发货时间: ${new Date().toLocaleString("zh-CN")} | 代理商: ${order.agent}` },
          ],
        },
      ],
    }),
  };
}

// ── Webhook 模式：签收卡片 ────────────────────────────────────────────
function webhookDeliveredCard(order) {
  return {
    msg_type: "interactive",
    card: JSON.stringify({
      config: { wide_screen_mode: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: "✅ 顾客已签收 — 端到端闭环完成" },
      },
      elements: [
        {
          tag: "div",
          fields: [
            { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${order.orderNo}` } },
            { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${order.customerName}` } },
            { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${order.trackingNo}\`` } },
            { is_short: true, text: { tag: "lark_md", content: `**签收时间**\n${new Date().toLocaleString("zh-CN")}` } },
          ],
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "🎉 **全链路追溯完成**\n订单 → 生产 → 贴标 → 发货 → 签收，高视星供应链系统全程可追溯。",
          },
        },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: `镜片码: ${order.lensCode} | GAUSH CLEAR 高视星溯源系统 v1.0` },
          ],
        },
      ],
    }),
  };
}

// ── 私信模式卡片（open_id）──────────────────────────────────────────────
function dmShipCard(order) {
  const { card: _, ...rest } = webhookShipCard(order);
  return JSON.parse(webhookShipCard(order).card);
}
function dmDeliveredCard(order) {
  return JSON.parse(webhookDeliveredCard(order).card);
}

// ── 发送函数 ──────────────────────────────────────────────────────────
async function sendViaWebhook(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(r => r.json());
  return r;
}

async function sendViaDM(token, openId, card) {
  const r = await fetch(`${BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  }).then(r => r.json());
  return r;
}

// ── 主流程 ────────────────────────────────────────────────────────────
(async () => {
  console.log("=== 高视星供应链 · 飞书通知 E2E 测试 ===\n");
  console.log(`订单:      ${ORDER.orderNo}`);
  console.log(`顾客:      ${ORDER.customerName} | SKU: ${ORDER.sku}`);
  console.log(`镜片码:    ${ORDER.lensCode}`);
  console.log(`快递单号:  ${ORDER.trackingNo}\n`);

  const useWebhook = WEBHOOK_URL && WEBHOOK_URL.startsWith("http");
  const useOpenId  = CLI_OPEN_ID;

  if (!useWebhook && !useOpenId) {
    console.error("✗ 无法发送通知，请选择以下任一方式：");
    console.error("");
    console.error("  【方式 A — 推荐】飞书群 Webhook（30秒）:");
    console.error("  1. 飞书 → 某个群 → 群设置 → 群机器人 → 添加自定义机器人");
    console.error("  2. 复制 Webhook URL");
    console.error('  3. 在 .env 中设置: FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx');
    console.error("  4. 重新运行 node send_dm_test.js");
    console.error("");
    console.error("  【方式 B】私信（需要 open_id）:");
    console.error("  node send_dm_test.js --open_id ou_xxxxxxxxxxxxxxxx");
    process.exit(1);
  }

  try {
    if (useWebhook) {
      console.log("模式: Webhook 群消息\n");

      // 发货通知
      console.log("1. 发送「发货」卡片...");
      const r1 = await sendViaWebhook(WEBHOOK_URL, webhookShipCard(ORDER));
      console.log("   结果:", r1.StatusCode === 0 || r1.code === 0 ? "✓ 成功" : "✗ " + JSON.stringify(r1));

      // 等 3 秒
      console.log("\n2. 等待 3 秒模拟配送...");
      await new Promise(r => setTimeout(r, 3000));

      // 签收通知
      console.log("\n3. 发送「签收」卡片...");
      const r2 = await sendViaWebhook(WEBHOOK_URL, webhookDeliveredCard(ORDER));
      console.log("   结果:", r2.StatusCode === 0 || r2.code === 0 ? "✓ 成功" : "✗ " + JSON.stringify(r2));

    } else {
      console.log("模式: 私信 open_id =", useOpenId, "\n");

      console.log("0. 获取 tenant_access_token...");
      const token = await getToken();
      console.log("   ✓", token.slice(0, 20) + "...");

      console.log("\n1. 发送「发货」卡片...");
      const r1 = await sendViaDM(token, useOpenId, dmShipCard(ORDER));
      console.log("   结果:", r1.code === 0 ? "✓ 成功 msg_id=" + r1.data?.message_id : "✗ " + JSON.stringify(r1));

      console.log("\n2. 等待 3 秒...");
      await new Promise(r => setTimeout(r, 3000));

      console.log("\n3. 发送「签收」卡片...");
      const r2 = await sendViaDM(token, useOpenId, dmDeliveredCard(ORDER));
      console.log("   结果:", r2.code === 0 ? "✓ 成功 msg_id=" + r2.data?.message_id : "✗ " + JSON.stringify(r2));
    }

    console.log("\n=== 端到端测试完成 ✓ ===");
    console.log("飞书收到: 🚚发货卡片 + ✅签收卡片（蓝色+绿色，全字段）");

  } catch (err) {
    console.error("✗ 错误:", err.message);
  }
})();
