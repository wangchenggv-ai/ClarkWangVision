// feishu.js — 飞书 API 封装（tenant_access_token + 文档/多维表格操作）
import 'dotenv/config';

const BASE_URL = 'https://open.feishu.cn/open-apis';
let _token = null;
let _tokenExpiry = 0;

async function getTenantToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.APP_ID, app_secret: process.env.APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 token 失败: ${data.msg}`);
  _token = data.tenant_access_token;
  _tokenExpiry = Date.now() + (data.expire - 60) * 1000;
  return _token;
}

export async function api(method, path, body) {
  const token = await getTenantToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`API ${path} 失败: ${data.msg} (code=${data.code})`);
  return data.data;
}

// wiki token → 真实 obj_token
export async function getWikiNode(wikiToken) {
  return api('GET', `/wiki/v2/spaces/get_node?token=${wikiToken}`);
}

// 获取文档所有 blocks（分页，最多 500 个）
export async function getDocBlocks(docToken) {
  const blocks = [];
  let pageToken = '';
  while (true) {
    const qs = `page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
    const data = await api('GET', `/docx/v1/documents/${docToken}/blocks?${qs}`);
    blocks.push(...(data.items || []));
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return blocks;
}

// 发送消息回复
export async function replyMessage(messageId, content) {
  return api('POST', `/im/v1/messages/${messageId}/reply`, {
    msg_type: 'text',
    content: JSON.stringify({ text: content }),
  });
}

// 写入多维表格记录
export async function createBitableRecord(appToken, tableId, fields) {
  return api('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields });
}

// 批量写入
export async function batchCreateRecords(appToken, tableId, records) {
  return api('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
    records: records.map(fields => ({ fields })),
  });
}
