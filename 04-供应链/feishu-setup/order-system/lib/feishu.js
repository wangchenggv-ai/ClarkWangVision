// lib/feishu.js — 飞书 API 封装

let BASE, APP_TOKEN, ENV;
let _feishuToken = "";
let _feishuTokenTime = 0;

export function init({ base, appToken, env }) {
  BASE = base;
  APP_TOKEN = appToken;
  ENV = env;
}

export async function getFeishuToken() {
  if (Date.now() - _feishuTokenTime < 5000 * 1000 && _feishuToken) return _feishuToken;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  let json;
  try { json = await res.json(); } catch { return _feishuToken; }
  if (json.tenant_access_token) {
    _feishuToken = json.tenant_access_token;
    _feishuTokenTime = Date.now();
  }
  return _feishuToken;
}

export async function feishuApi(method, path, body) {
  const token = await getFeishuToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    console.error(`  飞书 API 非 JSON 响应 [${method} ${path}]: HTTP ${res.status} ${text.slice(0, 200)}`);
    return null;
  }
  if (json.code !== 0) {
    console.error(`  飞书 API 错误 [${method} ${path}]: code=${json.code} msg=${json.msg}`);
    // token 相关错误一律清除缓存，下次调用会重新获取
    if (json.code === 99991663 || json.code === 99991664 ||
        /invalid access token|token.*expired|token.*revoked/i.test(json.msg || "")) {
      _feishuToken = "";
      _feishuTokenTime = 0;
      console.log(`  🔄 token 已清除，下次调用将重新获取`);
    }
    return null;
  }
  return json.data;
}

export async function listRecords(tableId, fieldNames) {
  const records = [];
  let pageToken = "";
  const fnParam = fieldNames ? `&field_names=${encodeURIComponent(JSON.stringify(fieldNames))}` : "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}${fnParam}` : `?page_size=100${fnParam}`;
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

export async function createRecord(tableId, fields) {
  return feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

export async function batchCreateRecords(tableId, records) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    if (!res) return false;
  }
  return true;
}

export async function updateRecord(tableId, recordId, fields) {
  return feishuApi("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

export async function batchUpdateRecords(tableId, records) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, { records: batch });
    if (!res) return false;
  }
  return true;
}

// 单条/少量记录查询（飞书 search API，~200ms，替代全表扫描）
export async function filterRecords(tableId, filter, fieldNames) {
  const body = { page_size: 100 };
  if (filter) body.filter = filter;
  if (fieldNames) body.field_names = fieldNames;
  const data = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/search`, body);
  return data?.items || [];
}
