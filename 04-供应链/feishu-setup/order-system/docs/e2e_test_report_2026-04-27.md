# E2E 全量测试报告

> 测试时间：2026-04-27
> 测试服务器：`https://lab.gaushclear.com`
> 测试订单：`ORD-20260426-1362D705`
> 测试代理：`AG-002`（测试代理商）
> 测试患者：E2E测试患者 · Ultra双效 · SPH=-2.00 CYL=-0.75 AXIS=180

---

## 测试结果一览

| # | 测试项 | 结果 | 关键数据 |
|---|--------|------|----------|
| T1 | 健康检查 + 基础设施 | ✅ PASS | agents=41, orders=103, stock=1575 rows |
| T2 | 订单提交 | ✅ PASS | 1 patient, 1 lens, lensCode generated |
| T3 | 库存查询 | ✅ PASS | stock=35, suggested=有库存, supplier=(empty) |
| T4 | 确认订单 | ✅ PASS | status→生产中, stockStatus=有库存 |
| T5 | 发货+库存扣减 | ✅ PASS | status→已发货, stock_movement written |
| T6 | 签收 | ✅ PASS | status→待签收 |
| T7 | Excel导出+标签+同行单 | ✅ PASS | Excel 17.7KB, Labels 6.7KB, Slip 8.2KB |
| T8 | 消费者验真 | ✅ PASS | lensCode verified, 处方数据正确 |

---

## T1: 健康检查 + 基础设施

| 检查项 | 结果 | 数据 |
|--------|------|------|
| 服务器健康 | ✅ | ok=true, feishu_token=true |
| 代理商数 | ✅ | 41 agents |
| 订单总数 | ✅ | 103（49 pending, 4 producing, 19 shipped, 30 received） |
| 库存总行数 | ✅ | 1,575 rows（7 SKUs × 225 degrees） |
| 总库存量 | ✅ | 5,377 片 |
| 低于安全库存 | ✅ | 1,488 行 |
| Dashboard | ✅ | 告警3条 |

---

## T2: 订单提交

**操作：** `POST /api/submit`

**请求参数：**
```json
{
  "clientRequestId": "e2e-test-xxx",
  "terminalCustomer": { "name": "E2E测试机构", "contact": "李测试", "phone": "13800138000" },
  "address": "北京市海淀区测试路100号",
  "patients": [{
    "customerName": "E2E测试患者", "sku": "Ultra双效", "quantity": 1,
    "eyes": [{ "side": "右眼", "sph": -2.0, "cyl": -0.75, "axis": 180 }],
    "assembly": true, "remark": "E2E全量测试"
  }]
}
```

**检查：**
- [x] 返回 `success: true`
- [x] 生成订单号 `ORD-20260426-1362D705`
- [x] 镜片码生成
- [x] QR 码图片生成

---

## T3: 库存查询

**API：** `GET /api/admin/order-stock-check`

**以刚才下的订单为例：**

| 场景 | 库存量 | 推荐库存状态 | 推荐供应商 | 结果 |
|------|--------|------------|-----------|------|
| 有库存（SPH=-2 CYL=-0.75） | 35 | 有库存 | （空） | ✅ |
| 不存在订单 | — | 需生产 | 需生产 | ✅ |

**规则验证：**
- [x] 有库存 → 不推荐供应商
- [x] 不存在订单 → 返回无镜片明细

---

## T4: 确认订单

**API：** `POST /api/admin/confirm`

**操作：** 传入 `stockStatus: "有库存"`, `supplier: ""`

**检查：**
- [x] 状态从"待处理"→"生产中"
- [x] 镜片码写入订单主表
- [x] 镜片码写入镜片明细表（`FE3BD4BC6099E130`）
- [x] 库存状态写入（`有库存`）
- [x] 供应商未写入（有库存不指定）

---

## T5: 发货 + 库存扣减

**API：** `POST /api/admin/ship`

**操作：** 传入快递 `sf`（顺丰）

**检查：**
- [x] 状态从"生产中"→"已发货"
- [x] 快递单号生成：`SF139881490806`
- [x] 物流公司写入：顺丰速运
- [x] 库存扣减：stock_movement 表记录 `MOV-20260426-981F type=出库 source=订单发货`
- [x] 飞书发货通知（如有配置）

---

## T6: 签收

**API：** `POST /api/admin/deliver`

**操作：** 标记待签收

**检查：**
- [x] 状态从"已发货"→"待签收"
- [x] 仅"已发货"可签收（状态守卫）
- [x] 飞书签收通知（如有配置）

---

## T7: Excel 导出 + 标签 + 同行单

### 7.1 工厂 Excel 导出

**API：** `GET /api/admin/batch-zip`

| 检查项 | 结果 |
|--------|------|
| HTTP 200 | ✅ |
| 文件大小 | ✅ 17,710 bytes |
| 可下载 .xlsx | ✅ |
| 包含处方数据 | ✅ |

### 7.2 标签打印 HTML

**API：** `GET /api/admin/labels/print`

| 检查项 | 结果 |
|--------|------|
| HTTP 200 | ✅ |
| 文件大小 | ✅ 6,747 bytes |
| 标签尺寸 75×40mm | ✅ |
| 条形码 Code128 | ✅ |
| 处方数据 | ✅ |
| QR 验真码 | ✅ |

### 7.3 随货同行单

**API：** `GET /api/admin/slip/:orderNo`

| 检查项 | 结果 |
|--------|------|
| HTTP 200 | ✅ |
| 文件大小 | ✅ 8,212 bytes |
| 收货信息 | ✅ |
| 处方表格 | ✅ |

---

## T8: 消费者验真

**URL：** `GET /verify/{lensCode}`

**测试镜片码：** `FE3BD4BC6099E130`

| 检查项 | 结果 | 数据 |
|--------|------|------|
| HTTP 200 | ✅ | verify page loaded |
| 验真结果 | ✅ | 显示验真结果页面 |
| 产品型号 | ✅ | Ultra双效 |
| 处方 SPH | ✅ | -2.00 |
| 处方 CYL | ✅ | -0.75 |
| 镜片码 | ✅ | FE3BD4BC6099E130 |

---

## 总结

**8/8 全部通过。** 完整的订单全链路闭环验证：

```
下单 → 查库存 → 确认 → 发货(扣库存) → 签收 → 导出/标签/同行单 → 验真
 ✅      ✅      ✅        ✅         ✅       ✅             ✅
```

**下载的文件：**
- `e2e_test_excel.xlsx` — 工厂导出 Excel
- `e2e_test_labels.html` — 标签打印页
- `e2e_test_slip.html` — 随货同行单
- `e2e_test_verify2.html` — 消费者验真页

**清理：** 测试产生的订单 `ORD-20260426-1362D705` 可在管理后台查看/处理。
