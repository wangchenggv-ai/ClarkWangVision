# 随货通行单 E2E 测试报告

**日期：** 2026/4/22 23:38:55
**耗时：** 54.9s
**结果：** ❌ 有失败项
**环境：** 本地 server.js + 测试 Bitable

---

## 测试 1：单订单随货通行单

**订单信息：**

| 项目 | 值 |
|------|-----|
| 订单号 | `ORD-20260422-80399A7C` |
| 顾客 | 侴梓铮 |
| 代理商 | 武汉亿祥昊医疗有限公司 (AG-026) |
| 快递 | 顺丰速运 |
| 单号 | SF314096938286 |
| 镜片数 | 2 片 |

**处方明细：**

| 眼别 | SKU | SPH | CYL | AXIS | 镜片码 |
|------|-----|-----|-----|------|--------|
| 右眼 | Ultra双效 | -1.5 | -1 | 180 | `EF825A535AACC5D8` |
| 左眼 | Ultra双效 | -0.25 | -1 | 175 | `2DC7AA80B056AF80` |

**内容检查：**

| 检查项 | 结果 |
|--------|------|
| HTML 包含订单号 | ✅ |
| HTML 包含镜片码 | ✅ |
| HTML 包含 QR 码 | ✅ |
| HTML 包含处方参数 | ✅ |
| HTML 包含品牌标识 | ✅ |
| PDF 生成成功 | ❌ (N/A KB) |

---

## 测试 2：合单随货通行单（3 单同代理商）

**订单信息：**

| 项目 | 值 |
|------|-----|
| 订单号 | `ORD-20260422-80399A7C` |
| 顾客 | 罗绍文、郭骏腾、王柳雯 |
| 代理商 | 武汉亿祥昊医疗有限公司 (AG-026) |
| 分组数 | 1 个快递单号 |
| 总镜片数 | 6 片 |

**发货信息：**

| 项目 | 值 |
|------|-----|
| 快递公司 | 顺丰速运 |
| 快递单号 | SF128021240223 |
| 发货方式 | 3人同一次发货，共享快递单号 |

**内容检查：**

| 检查项 | 结果 |
|--------|------|
| HTML 包含代理商名 | ✅ |
| HTML 包含罗绍文 | ✅ |
| HTML 包含郭骏腾 | ✅ |
| HTML 包含王柳雯 | ✅ |
| HTML 包含明细数据 | ✅ |
| HTML 包含 QR 码 | ✅ |
| PDF 生成成功 | ❌ (N/A KB) |

---

## 生成文件

| 文件 | 大小 | 说明 |
|------|------|------|
| `docs/test-slip-single.html` | - | 单订单通行单 HTML |
| `docs/test-slip-single.pdf` | N/A KB | 单订单通行单 PDF |
| `docs/test-slip-batch.html` | 21.5 KB | 合单通行单 HTML |
| `docs/test-slip-batch.pdf` | N/A KB | 合单通行单 PDF |
| `docs/test-slip-summary.html` | - | 合单汇总页（含多个快递分组） |

## 失败项

- **single-pdf:** EBUSY: resource busy or locked, open 'C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system\docs\test-slip-single.pdf'
- **batch-pdf:** EBUSY: resource busy or locked, open 'C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system\docs\test-slip-batch.pdf'
