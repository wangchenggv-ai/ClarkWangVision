// lib/notify.js — 飞书通知（Webhook + IM 卡片）

let ENV;
let _notifyToken = "", _notifyTokenTime = 0;

export function init({ env }) {
  ENV = env;
}

export async function getNotifyToken() {
  if (Date.now() - _notifyTokenTime < 7000000 && _notifyToken) return _notifyToken;
  if (!ENV.NOTIFY_APP_ID || !ENV.NOTIFY_APP_SECRET) return null;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.NOTIFY_APP_ID, app_secret: ENV.NOTIFY_APP_SECRET }),
  });
  let json;
  try { json = await r.json(); } catch { return null; }
  if (json.tenant_access_token) {
    _notifyToken = json.tenant_access_token;
    _notifyTokenTime = Date.now();
  }
  return _notifyToken;
}

export async function sendNotify(agentName, summary, orderNo) {
  if (!ENV.FEISHU_WEBHOOK_URL) return;
  try {
    await fetch(ENV.FEISHU_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          header: { title: { tag: "plain_text", content: "📋 新订单待确认" }, template: "blue" },
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

export async function sendFeishuCard(card) {
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

export function shipCard({ orderNo, customerName, sku, agentName, courierName, trackingNo, lensCount }) {
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

export function deliveredCard({ orderNo, customerName, sku, agentName, signedAt }) {
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
