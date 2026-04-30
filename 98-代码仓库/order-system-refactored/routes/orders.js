import express from 'express';
import { submitOrder, getOrders, getOrderDetail } from '../services/orderService.js';
import { deductStock } from '../services/stockService.js';

const router = express.Router();

// 代理商下单
router.post('/submit', async (req, res) => {
  const { agentId, items } = req.body;
  const result = await submitOrder(agentId, items);
  res.json(result);
});

// 获取订单列表
router.get('/', async (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  const orders = await getOrders(req.agent.id, { status, page, pageSize });
  res.json(orders);
});

// 订单详情
router.get('/:orderNo', async (req, res) => {
  const order = await getOrderDetail(req.params.orderNo, req.agent.id);
  res.json(order);
});

export default router;