// 订单系统 API 客户端（调测试环境 http://113.44.175.221:3211）

let BASE = "", TOKEN = "";

export function init({ apiBase, apiToken }) {
  BASE = apiBase;
  TOKEN = apiToken;
}

async function call(method, path, body, extraParams = {}) {
  const params = new URLSearchParams({ admin: TOKEN, ...extraParams });
  const url = `${BASE}${path}?${params}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ error: "非JSON响应" }));
}

// 查询单个订单
export async function getOrder(orderNo) {
  return call("GET", "/api/admin/orders", null, { search: orderNo, pageSize: 5 });
}

// 查询指定状态的订单列表
export async function listOrders(status, limit = 10) {
  return call("GET", "/api/admin/orders", null, { status, pageSize: limit });
}

// 确认订单（生成镜片码）
export async function confirmOrders(orderNos) {
  return call("POST", "/api/admin/confirm", { orderNos });
}

// 发货
export async function shipOrder(orderNo, courier, trackingNo) {
  const body = { orderNos: [orderNo] };
  if (courier) body.courier = courier;
  if (trackingNo) body.trackingNo = trackingNo;
  return call("POST", "/api/admin/ship", body);
}

// 签收
export async function deliverOrder(orderNo) {
  return call("POST", "/api/admin/deliver", { orderNos: [orderNo] });
}

// 退回上一步
export async function revertOrder(orderNo) {
  return call("POST", "/api/admin/revert", { orderNos: [orderNo] });
}

// 写入批量订单（Excel接单后提交）
export async function mergeBatch(orders) {
  return call("POST", "/api/admin/batch-merge/confirm", { orders });
}

// 仪表盘摘要
export async function getDashboard() {
  return call("GET", "/api/admin/dashboard", null);
}
