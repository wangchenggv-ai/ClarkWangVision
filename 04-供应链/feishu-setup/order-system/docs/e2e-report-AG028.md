# E2E 全流程测试报告

**日期：** 2026-04-15
**代理商：** 深圳视力康眼健康有限公司 (AG-028)
**服务器：** Mac mini (192.168.0.68:3212) + ngrok 公网

---

## 测试概览

| # | 步骤 | API | 状态 | 耗时 |
|---|------|-----|------|------|
| 1 | 代理商下单 | POST /api/submit | ✅ 通过 | <1s |
| 2 | 管理端确认 | POST /api/admin/confirm | ✅ 通过 | <1s |
| 3 | 导出工厂包 | GET /api/admin/batch-zip | ✅ 通过 | <1s |
| 4 | 生成标签 | GET /api/admin/labels/batch | ✅ 通过 | <1s |
| 5 | 发货 | POST /api/admin/ship | ✅ 通过 | <1s |
| 6 | 签收 | POST /api/admin/deliver | ✅ 通过 | <1s |
| 7 | 消费者验真 | GET /verify/{lensCode} | ✅ 通过 | ~2s |

**结果：7/7 全部通过**

---

## 订单详情

| 字段 | 值 |
|------|-----|
| 订单号 | ORD-20260415-H9WVUY |
| 代理商 | 深圳视力康眼健康有限公司 (AG-028) |
| 终端客户 | 深圳爱尔眼科医院 |
| 联系人 | 李医生 / 13800138001 |
| 收货地址 | 广东省深圳市南山区科技园南区深圳爱尔眼科医院 |
| 患者 | 王小花 |
| 产品 | Ultra双效 × 1 副 |
| 装配 | 是 |
| 备注 | 近视控制复查配镜 |

### 处方参数

| 眼别 | 球镜 SPH | 柱镜 CYL | 轴位 AXIS |
|------|----------|----------|-----------|
| 右眼 | -3.25 | -1.00 | 175° |
| 左眼 | -3.75 | -0.50 | 10° |

---

## 流程记录

### Step 1: 代理商下单

**请求：**
```
POST http://192.168.0.68:3212/api/submit?t=AG-028-b9bd93d8ec941280
Content-Type: application/json

{
  "terminalCustomer": { "name": "深圳爱尔眼科医院", "contact": "李医生", "phone": "13800138001" },
  "address": "广东省深圳市南山区科技园南区深圳爱尔眼科医院",
  "patients": [{
    "customerName": "王小花",
    "sku": "Ultra双效",
    "quantity": 1,
    "assembly": true,
    "remark": "近视控制复查配镜",
    "eyes": [
      { "side": "右眼", "sph": -3.25, "cyl": -1.00, "axis": 175 },
      { "side": "左眼", "sph": -3.75, "cyl": -0.50, "axis": 10 }
    ]
  }]
}
```

**响应：** HTTP 200
```json
{
  "success": true,
  "orderNo": "ORD-20260415-H9WVUY",
  "items": [{
    "sku": "Ultra双效",
    "quantity": 1,
    "lensCount": 2,
    "deliveryType": "标准",
    "promiseDateFormatted": "2026/04/20"
  }],
  "summary": { "totalPatients": 1, "totalLenses": 2 }
}
```

**状态变更：** → 待处理
**生成物：** 订单编号、飞书订单记录（主表+明细表）、飞书通知

---

### Step 2: 管理端确认

**请求：**
```
POST http://192.168.0.68:3212/api/admin/confirm?admin=gaoshixing
Content-Type: application/json

{ "orderNos": ["ORD-20260415-H9WVUY"] }
```

**响应：** HTTP 200
```json
{
  "results": [{
    "orderNo": "ORD-20260415-H9WVUY",
    "ok": true,
    "lensCodes": ["55DCA4FD7016DEBB", "93CB02B460849B14"]
  }]
}
```

**状态变更：** 待处理 → 生产中
**生成物：**
- 镜片码：`55DCA4FD7016DEBB`（右眼）、`93CB02B460849B14`（左眼）
- QR 码 PNG × 2（400×400，指向验真链接）

---

### Step 3: 导出工厂包

**请求：**
```
GET http://192.168.0.68:3212/api/admin/batch-zip?admin=gaoshixing&orderNos=ORD-20260415-H9WVUY
```

**响应：** HTTP 200，37,980 bytes

**ZIP 内容：**

| 文件 | 大小 | 说明 |
|------|------|------|
| 订单_ORD-20260415-H9WVUY.xlsx | 17,810 B | Excel 处方表 |
| qrcodes/55DCA4FD7016DEBB.png | 3,301 B | 右眼 QR 码 |
| qrcodes/93CB02B460849B14.png | 3,327 B | 左眼 QR 码 |
| labels/...右眼...html | 6,309 B | 右眼打印标签 |
| labels/...左眼...html | 6,309 B | 左眼打印标签 |
| 说明.txt | 45 B | 自述文件 |

---

### Step 4: 生成标签

**请求：**
```
GET http://192.168.0.68:3212/api/admin/labels/batch?admin=gaoshixing&orderNos=ORD-20260415-H9WVUY
```

**响应：** HTTP 200
```json
{
  "labels": [
    { "eye": "右眼", "lensCode": "55DCA4FD7016DEBB", "customer": "王小花", "html_len": 6230 },
    { "eye": "左眼", "lensCode": "93CB02B460849B14", "customer": "王小花", "html_len": 6259 }
  ],
  "count": 2
}
```

**标签规格：** 80mm × 50mm，含品牌 GAUSH|CLEAR、眼别色带（红/蓝）、处方、QR 码

---

### Step 5: 发货

**请求：**
```
POST http://192.168.0.68:3212/api/admin/ship?admin=gaoshixing
Content-Type: application/json

{ "orderNos": ["ORD-20260415-H9WVUY"] }
```

**响应：** HTTP 200
```json
{
  "results": [{
    "orderNo": "ORD-20260415-H9WVUY",
    "ok": true,
    "courier": "顺丰速运",
    "trackingNo": "SF216253279681"
  }]
}
```

**状态变更：** 生产中 → 已发货
**副作用：** 飞书发送"订单已发货"卡片通知

---

### Step 6: 签收

**请求：**
```
POST http://192.168.0.68:3212/api/admin/deliver?admin=gaoshixing
Content-Type: application/json

{ "orderNos": ["ORD-20260415-H9WVUY"] }
```

**响应：** HTTP 200
```json
{ "results": [{ "orderNo": "ORD-20260415-H9WVUY", "ok": true }] }
```

**状态变更：** 已发货 → 已签收
**副作用：** 飞书发送"消费者已签收"卡片通知

---

### Step 7: 消费者扫码验真

#### 7a. 右眼验真
```
GET https://villain-bacon-supervise.ngrok-free.dev/verify/55DCA4FD7016DEBB
```
- HTTP 200 ✅
- `hero-ok` 绿色验真通过
- 显示订单号 ORD-20260415-H9WVUY、产品 Ultra双效、处方参数

#### 7b. 左眼验真
```
GET https://villain-bacon-supervise.ngrok-free.dev/verify/93CB02B460849B14
```
- HTTP 200 ✅
- `hero-ok` 绿色验真通过

---

## 状态流转

```
待处理 ──确认──→ 生产中 ──发货──→ 已发货 ──签收──→ 已签收
  │                │               │               │
  │  镜片码生成    │  快递单号      │  签收时间      │
  │  QR码生成      │  飞书通知      │  飞书通知      │
```

---

## 结论

全流程 7 步均通过，覆盖：
- 代理商下单 → 数据落飞书双表
- 管理端确认 → 镜片码 + QR 码生成
- 工厂包导出 → Excel + QR + 标签 ZIP
- 标签生成 → 80×50mm 打印标签
- 发货 → 自动生成快递单号 + 飞书通知
- 签收 → 状态终态 + 飞书通知
- 验真 → 公网扫码验真通过
