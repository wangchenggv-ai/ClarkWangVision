/**
 * 用供应链应用查自己的bot能发给谁，或者通过创建群聊发送
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

// 用供应链应用获取token
const r1 = await fetch(BASE + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
});
const d1 = await r1.json();
const TOKEN = d1.tenant_access_token;
console.log("供应链应用 token:", TOKEN ? "OK" : "FAIL");

// 先用CRM应用获取用户信息，确认 open_id 对应谁
const r2 = await fetch(BASE + "/auth/v3/tenant_access_token/internal", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: env.CRM_APP_ID, app_secret: env.CRM_APP_SECRET }),
});
const CRM_TOKEN = (await r2.json()).tenant_access_token;
console.log("CRM应用 token:", CRM_TOKEN ? "OK" : "FAIL");

// 用CRM应用查用户信息
const r3 = await fetch(`${BASE}/contact/v3/users/${env.NOTIFY_OPEN_ID}?user_id_type=open_id`, {
  headers: { Authorization: "Bearer " + CRM_TOKEN },
});
const d3 = await r3.json();
console.log("CRM用户信息:", JSON.stringify(d3).slice(0, 300));

// 用供应链应用查自己的bot info
const r4 = await fetch(`${BASE}/bot/v3/info`, {
  headers: { Authorization: "Bearer " + TOKEN },
});
const d4 = await r4.json();
console.log("供应链bot信息:", JSON.stringify(d4).slice(0, 300));

// 用供应链应用查群聊列表
const r5 = await fetch(`${BASE}/im/v1/chats?page_size=20`, {
  headers: { Authorization: "Bearer " + TOKEN },
});
const d5 = await r5.json();
console.log("供应链群聊列表:", JSON.stringify(d5).slice(0, 500));
