/**
 * send_notify_crm.js — 用CRM应用凭证发飞书卡片通知
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
const OPEN_ID = env.NOTIFY_OPEN_ID; // ou_436cb656a968038106a6df7e1ea17b62

// 用CRM应用获取token
const r1 = await fetch(BASE + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.CRM_APP_ID, app_secret: env.CRM_APP_SECRET }),
});
const d1 = await r1.json();
if (d1.code !== 0) { console.error("获取CRM token失败:", JSON.stringify(d1)); process.exit(1); }
const TOKEN = d1.tenant_access_token;
console.log("✅ CRM token 获取成功");

async function sendCard(title, template, elements) {
  // 先获取 chat_id
  const msgRes = await fetch(`${BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({
      receive_id: OPEN_ID,
      msg_type: "interactive",
      content: JSON.stringify({
        header: { title: { tag: "plain_text", content: title }, template },
        elements,
      }),
    }),
  });
  const d = await msgRes.json();
  if (d.code === 0) {
    console.log(`✅ ${title}`);
  } else {
    console.error(`❌ ${title}: code=${d.code} msg=${d.msg}`);
  }
  return d.code === 0;
}

// 发3张卡片
await sendCard("📦 物流完成 — 深圳视力康（10单）", "blue", [
  { tag: "div", fields: [
    { is_short: true, text: { tag: "lark_md", content: "**代理商**\n深圳视力康眼健康有限公司" } },
    { is_short: true, text: { tag: "lark_md", content: "**订单数**\n10 单" } },
    { is_short: true, text: { tag: "lark_md", content: "**镜片总数**\n20 片" } },
    { is_short: true, text: { tag: "lark_md", content: "**状态**\n✅ 全部已签收" } },
  ]},
  { tag: "hr" },
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 王小明 | Ultra双效 | 运城眼科医院\n· 李红 | Ultra | 深圳华夏眼科\n· 张建国 | D8 | 珠海星系眼科\n· 刘洋 | A版 | 广州中慧眼科\n· 陈思远 | B版 | 佛山北医眼科\n· 赵雪 | Ultra双效 | 东莞康华医院\n· 孙浩然 | Ultra | 惠州爱尔眼科\n· 周美玲 | D8 | 中山大学眼科中心\n· 吴鹏飞 | A版 | 汕头国际眼科中心\n· 郑雅文 | B版 | 湛江中心医院眼科" } },
  { tag: "note", elements: [{ tag: "plain_text", content: `${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
]);

await sendCard("📦 物流完成 — 尧视共创（2单）", "blue", [
  { tag: "div", fields: [
    { is_short: true, text: { tag: "lark_md", content: "**代理商**\n尧视共创（北京）科技有限公司" } },
    { is_short: true, text: { tag: "lark_md", content: "**订单数**\n2 单" } },
    { is_short: true, text: { tag: "lark_md", content: "**镜片总数**\n4 片" } },
    { is_short: true, text: { tag: "lark_md", content: "**状态**\n✅ 全部已签收" } },
  ]},
  { tag: "hr" },
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 陈晓东 | Ultra双效 | 北京大学人民医院\n· 林小燕 | D8 | 首都医科大学附属北京同仁医院" } },
  { tag: "note", elements: [{ tag: "plain_text", content: `${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
]);

await sendCard("📦 物流完成 — 上海聚势（2单）", "blue", [
  { tag: "div", fields: [
    { is_short: true, text: { tag: "lark_md", content: "**代理商**\n上海聚势医药科技有限公司" } },
    { is_short: true, text: { tag: "lark_md", content: "**订单数**\n2 单" } },
    { is_short: true, text: { tag: "lark_md", content: "**镜片总数**\n4 片" } },
    { is_short: true, text: { tag: "lark_md", content: "**状态**\n✅ 全部已签收" } },
  ]},
  { tag: "hr" },
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 黄磊 | Ultra | 上海和平眼科\n· 谢婷婷 | A版 | 复旦大学附属眼耳鼻喉科医院" } },
  { tag: "note", elements: [{ tag: "plain_text", content: `${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
]);

console.log("\n全部飞书卡片已发送（通过CRM应用）");
