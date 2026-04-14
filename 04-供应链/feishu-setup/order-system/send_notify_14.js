/**
 * send_notify_14.js — 发飞书卡片通知：14笔测试订单物流完成
 */
import { readFileSync } from "fs";

const env = {};
for (const line of readFileSync("../shared/.env", "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [k, ...v] = t.split("=");
  env[k.trim()] = v.join("=").trim();
}

const WEBHOOK = env.FEISHU_WEBHOOK_URL;
if (!WEBHOOK) { console.error("未配置 FEISHU_WEBHOOK_URL"); process.exit(1); }

async function sendCard(title, template, elements) {
  const r = await fetch(WEBHOOK, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        header: { title: { tag: "plain_text", content: title }, template },
        elements,
      },
    }),
  });
  const d = await r.json();
  console.log(d.code === 0 ? `✅ ${title}` : `❌ ${title}: ${JSON.stringify(d)}`);
}

// 发3张卡片，每个代理商一张
await sendCard("📦 物流完成 — 深圳视力康（10单）", "blue", [
  { tag: "div", fields: [
    { is_short: true, text: { tag: "lark_md", content: "**代理商**\n深圳视力康眼健康有限公司" } },
    { is_short: true, text: { tag: "lark_md", content: "**订单数**\n10 单" } },
    { is_short: true, text: { tag: "lark_md", content: "**镜片总数**\n20 片" } },
    { is_short: true, text: { tag: "lark_md", content: "**状态**\n✅ 全部已签收" } },
  ]},
  { tag: "hr" },
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 王小明 | Ultra双效 | 运城眼科医院 | 中通 758594664436\n· 李红 | Ultra | 深圳华夏眼科 | 顺丰 SF274109436928\n· 张建国 | D8 | 珠海星系眼科 | 顺丰 SF296538600990\n· 刘洋 | A版 | 广州中慧眼科 | 顺丰 SF960545532166\n· 陈思远 | B版 | 佛山北医眼科 | 韵达 YD150939963941\n· 赵雪 | Ultra双效 | 东莞康华医院 | 中通 759829992470\n· 孙浩然 | Ultra | 惠州爱尔眼科 | 韵达 YD071057103628\n· 周美玲 | D8 | 中山大学眼科中心 | 韵达 YD113095991556\n· 吴鹏飞 | A版 | 汕头国际眼科中心 | 中通 757479688896\n· 郑雅文 | B版 | 湛江中心医院眼科 | 韵达 YD983195489286" } },
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
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 陈晓东 | Ultra双效 | 北京大学人民医院 | 顺丰 SF323003675052\n· 林小燕 | D8 | 首都医科大学附属北京同仁医院 | 顺丰 SF650874613996" } },
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
  { tag: "div", text: { tag: "lark_md", content: "**订单明细**\n· 黄磊 | Ultra | 上海和平眼科 | 顺丰 SF154800960666\n· 谢婷婷 | A版 | 复旦大学附属眼耳鼻喉科医院 | 顺丰 SF273061916861" } },
  { tag: "note", elements: [{ tag: "plain_text", content: `${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
]);

console.log("\n全部飞书卡片已发送");
