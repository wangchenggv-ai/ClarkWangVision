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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let res;
  try {
    res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.error(`  飞书 token 获取超时: ${e.message}`);
    return _feishuToken;
  }
  clearTimeout(timer);
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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.error(`  飞书 API 超时/网络错误 [${method} ${path}]: ${e.message}`);
    return null;
  }
  clearTimeout(timer);
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

export async function listRecords(tableId, fieldNames, maxPages = 50) {
  const records = [];
  let pageToken = "";
  let pages = 0;
  const fnParam = fieldNames ? `&field_names=${encodeURIComponent(JSON.stringify(fieldNames))}` : "";
  while (pages < maxPages) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}${fnParam}` : `?page_size=100${fnParam}`;
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    pages++;
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

export async function searchRecords(tableId, { filter, sort, fieldNames, pageSize = 500, maxPages = 10 } = {}) {
  const records = [];
  let pageToken = "";
  let pages = 0;
  let totalCount = null;
  let passedTotal = false; // 允许超出 total 一页，兼容并发写入场景
  while (pages < maxPages) {
    const body = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sort) body.sort = sort;
    if (fieldNames) body.field_names = fieldNames;
    if (pageToken) body.page_token = pageToken;
    const data = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/search`, body);
    if (!data) break;
    if (totalCount === null && data.total != null) totalCount = data.total;
    if (data.items) records.push(...data.items);
    pages++;
    if (!data.has_more) break;
    // 飞书 POST /records/search 分页 bug：has_more 可能一直为 true 但实际已返回全部数据
    // 允许超出 total 一页（兼容刚写入的新记录 total 还未更新的情况），第二次超出才截断
    if (totalCount !== null && records.length >= totalCount) {
      if (passedTotal) break;
      passedTotal = true;
    }
    pageToken = data.page_token;
  }
  if (pages >= maxPages && pageToken) {
    console.warn(`  searchRecords 达到最大页数 ${maxPages}，已获取 ${records.length} 条`);
  }
  // 按 record_id 去重，防止分页 bug 导致重复记录
  const seen = new Set();
  return records.filter(r => {
    if (!r.record_id || seen.has(r.record_id)) return false;
    seen.add(r.record_id);
    return true;
  });
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
