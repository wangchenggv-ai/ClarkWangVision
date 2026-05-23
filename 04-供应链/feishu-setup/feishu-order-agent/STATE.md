# STATE.md — 飞书订单 Agent 状态

最后更新：2026-05-20

---

## 当前状态：测试通过，测试环境运行中

ECS 113.44.175.221，PM2 进程 `feishu-agent`，端口 3230，连接测试 Bitable（CtXObqwAHaCXYssBBfkcXmrlnUe）。

---

## 功能测试结果

| 功能 | 状态 | 备注 |
|------|------|------|
| /帮助 | ✅ 通过 | |
| /已下单 /待处理 等列表 | ✅ 通过 | /已发货等不显示确认按钮 |
| ORD-xxx 查询 | ✅ 通过 | |
| /确认 ORD-xxx | ✅ 通过 | 生成镜片码，写入 Bitable |
| /发货 ORD-xxx | ✅ 通过 | |
| /签收 ORD-xxx | ✅ 通过 | 进入终态 |
| /退回 ORD-xxx | 未测试 | 逻辑已实现 |
| /看板 | 未测试 | 逻辑已实现 |
| 卡片按钮（全部确认）| ✅ 通过 | |
| Excel 上传→预览→写入 | ✅ 通过 | |

---

## 已解决的主要 Bug

1. **cmdList 字段名**：API 返回 camelCase（`r.orderNo`），旧代码用中文字段名
2. **cmdConfirm 计数错误**：`okCount = succeeded.length || orderNos.length` 的回退逻辑导致误报
3. **卡片按钮无响应**：`open_chat_id` 在 `event.context.open_chat_id`，且 `action.value` 被双重 JSON 编码
4. **Excel 列名匹配失败**：改为动态找表头行 + 顾客姓名填充，与 order-system 逻辑一致
5. **Excel 写入格式错误**：API 期望 `{ orders: [{ patients: [] }] }`，改为 flat→nested 转换

---

## 下一步

- [ ] 接入生产环境（ORDER_API_BASE=127.0.0.1:3210，TOKEN=GaushOrderMock）
- [ ] 测试 /退回 和 /看板
- [ ] 考虑多群支持（目前绑定单一内部群）
