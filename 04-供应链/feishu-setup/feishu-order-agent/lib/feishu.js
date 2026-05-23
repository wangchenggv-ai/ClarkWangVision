// 飞书 API 封装：Token 获取、发消息、下载文件

let _token = "", _tokenTime = 0;
let ENV = {};

export function init(env) { ENV = env; }

export async function getBotToken() {
  if (Date.now() - _tokenTime < 7000000 && _token) return _token;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.BOT_APP_ID, app_secret: ENV.BOT_APP_SECRET }),
  });
  const j = await r.json();
  _token = j.tenant_access_token || "";
  _tokenTime = _token ? Date.now() : 0;
  return _token;
}

// 发送卡片消息到指定群/用户
export async function sendCard(chatId, card) {
  const token = await getBotToken();
  const r = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    }),
  });
  return r.json();
}

// 发送纯文本消息
export async function sendText(chatId, text) {
  const token = await getBotToken();
  await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
}

// 回复消息（in-thread）
export async function replyCard(messageId, card) {
  const token = await getBotToken();
  await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", content: JSON.stringify(card) }),
  });
}

// 下载消息中的文件（Excel上传后获取内容）
export async function downloadFile(messageId, fileKey) {
  const token = await getBotToken();
  const r = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`下载文件失败 ${r.status}`);
  return r.arrayBuffer();
}
