// services/orderService.js (最小可用版)
export async function submitOrder(agentId, items) {
  return {
    success: true,
    orderNo: 'ORD' + Date.now(),
    message: '订单提交成功（Mock）'
  };
}

export async function getOrders(agentId, filters) {
  return {
    orders: [],
    total: 0,
    page: filters.page || 1,
    pageSize: filters.pageSize || 20
  };
}

export async function getOrderDetail(orderNo, agentId) {
  return {
    orderNo,
    status: '待处理',
    message: '订单详情（Mock）'
  };
}