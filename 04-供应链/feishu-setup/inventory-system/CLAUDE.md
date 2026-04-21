# CLAUDE.md — 度数级库存管理项目宪法

> 本文件是 Claude Code 在本目录工作时的第一手上下文。**当前进度看 [STATE.md](STATE.md)**，本文件只写长期稳定的约束与事实。

---

## 一、项目是什么

代理商下单门户的**实时现货查询 + 交期预估**模块。代理商选产品型号 + 填度数后，立即看到"有货 / 排产 / 定制"徽章，给终端客户承诺时有底气。

- **业务目标：** 让代理商和终端客户对交期有明确预期，减少"能不能拿到货"的沟通成本
- **心智模型：** 现货 = 放心 = 愿意推荐 = 正向循环

---

## 二、架构地位（重要）

**本目录不是独立服务**。度数级库存查询的后端 API 和前端 UI 都在 `../order-system/` 里，本目录只存放：

1. **库存表迁移 / 维护脚本**（[migrate_stock_v2.js](migrate_stock_v2.js)）
2. **库存项目的文档**（CLAUDE.md、STATE.md）

**数据与代码的集成点：**

| 位置 | 作用 |
|------|------|
| 飞书 Bitable `tbl7U79QGG4JtQev` | 度数级成品库存表（450 行起步） |
| `../order-system/server.js:35-51` | `TABLES.stock_detail` + `SKUS_WITH_DETAIL_STOCK` + 度数范围常量 |
| `../order-system/server.js:408-455` | `getStockMap` 缓存 + `estimateDeliveryByRx` 交期判定 |
| `../order-system/server.js:1275-1294` | `/api/delivery-estimate` 端点支持 `sph/cyl` 参数 |
| `../order-system/public/order.html:220-260` | 前端 `fetchEstimateForEye` 每眼独立徽章 |

---

## 三、数据模型

### 度数级成品库存表（核心）

- **Table ID：** `tbl7U79QGG4JtQev`
- **表名：** 度数级成品库存
- **粒度：** 一行 = `(SKU, SPH, CYL)` 唯一组合
- **AXIS 不入库存主键** — 散光毛坯通用，AXIS 后加工

| 字段 | 类型 | 说明 |
|------|------|------|
| `SKU_SPH_CYL` | TEXT | 业务去重主键，格式 `"SKU\|SPH\|CYL"`，例：`"Ultra双效\|-1.00\|-0.50"` |
| `SKU编号` | TEXT | 匹配 `order-system` 的 `HARDCODED_SKUS.sku` 字段 |
| `SPH` | NUMBER (0.00) | 球镜值，负数或 0 |
| `CYL` | NUMBER (0.00) | 柱镜值，负数或 0 |
| `当前库存` | NUMBER (0) | 片数 |
| `更新时间` | MODIFIED_TIME | 飞书自动维护 |

### 度数标准范围（常规备货）

- **SPH ∈ [-6.00, 0]**（近视，每 0.25D 一档，25 档）
- **CYL ∈ [-2.00, 0]**（散光，每 0.25D 一档，9 档）
- **超出范围 = 自动走定制档位**（不查库存表）

单 SKU 完整覆盖度数组合数 = 25 × 9 = **225 行**

---

## 四、核心规则（铁律）

### 4.1 SKU 粒度分类

`order-system` 的 SKU 分两类：

- **精细管理 SKU**（`SKUS_WITH_DETAIL_STOCK` 集合）：查度数级库存表，走度数级交期判定
- **粗粒度 SKU**（其他）：沿用 `HARDCODED_SKUS[].currentStock` 的总量判定（旧逻辑）

**新增精细管理 SKU 必做三件事：**
1. 在 `SKUS_WITH_DETAIL_STOCK` 里加 SKU 名
2. 库存表导入该 SKU 的 225 行（或一部分）度数数据
3. 名字必须与 `HARDCODED_SKUS[].sku` 完全一致（否则前端选了后端匹配不到）

### 4.2 交期三档（硬编码）

| 情况 | 档位文案 | 交期天数 |
|------|---------|---------|
| 精细 SKU 且库存 ≥ 下单量 | `有货1-2天` | 2 |
| 精细 SKU 且度数在常规范围但库存 < 下单量 | `排产5-7天` | 7 |
| 度数超出常规范围 (SPH < -6 或 CYL < -2) | `定制7-10天` | 10 |
| 粗粒度 SKU 有库存 | `有货3天` | 3（fallback） |
| 粗粒度 SKU 缺货 / 定制品 | `定制5天` | 5（fallback） |

**禁止在前端做档位计算** — 档位由后端返回，前端只渲染。

### 4.3 库存数量展示（UX 铁律）

- **默认不展示具体片数** — 防止代理商误判可拿量
- **仅在库存 ≤ 5 片时显示"仅剩 N 片"** — 提醒紧张，代理商自己判断
- **阈值常量：** `LOW_STOCK_THRESHOLD = 5`（见 `order.html`）

### 4.4 每眼独立判定

- **右眼和左眼各自一个徽章** — 库存是按"片"计算的，每片一个度数
- 右眼 SPH=-1 有货、左眼 SPH=-5 缺货是常态，必须各自展示
- 勾掉某眼时徽章立即隐藏

### 4.5 缓存

- 度数级库存缓存 TTL = **2 分钟**（`STOCK_TTL` in server.js）
- 缓存在 server 内存，多实例部署时各自独立（当前单实例无问题）
- 修改库存后最多 2 分钟生效

### 4.6 度数精度

- Bitable 存储 `NUMBER` 类型，前端传 `-1` 或 `-1.0` 或 `-1.00` 都要命中
- 匹配 key 构造时统一 `toFixed(2)`，不要用字符串直接拼

---

## 五、迁移脚本（[migrate_stock_v2.js](migrate_stock_v2.js)）

### 三个子命令

```bash
node migrate_stock_v2.js preview              # 仅解析 Excel，不写飞书
node migrate_stock_v2.js create               # 新建一张度数级库存表，打印 table_id
node migrate_stock_v2.js import <tableId>     # 向指定表导入数据（先清空再全量写）
```

### 当前默认值

- **Excel 路径：** `C:/Users/wangc/Desktop/备库参数比例.xlsx`（sheet：`库存表`）
- **SKU 列表：** `["Ultra双效", "D8"]` 共用同一份度数分布（在脚本常量 `SKUS` 中）
- **环境变量依赖：** `FEISHU_APP_TOKEN` / `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（从 `../shared/.env` 读取）

### Excel 格式约定

库存表 sheet 是二维矩阵：

- 行首 = SPH（0 ~ -6.00，步长 0.25）
- 列首 = CYL（0 ~ -2.00，步长 0.25）
- 单元格 = 库存片数
- 空单元格跳过，合计行跳过（非数字 SPH 视为合计行）

**新增 SKU 时：** 若度数分布与已有 SKU 一致 → 改脚本里 `SKUS` 常量增加名字；若分布不同 → 准备一份新 Excel（同格式），改 `EXCEL_PATH` 和 `SHEET_NAME` 常量。

---

## 六、常见任务的起点

| 任务 | 从哪开始 |
|------|----------|
| 新增一个精细管理 SKU（沿用现有度数分布） | 改 [migrate_stock_v2.js](migrate_stock_v2.js) 的 `SKUS` 数组 → 跑 `import <tid>` → 改 `server.js` 的 `SKUS_WITH_DETAIL_STOCK` |
| 新增精细 SKU（新度数分布） | 准备 Excel → 改 `EXCEL_PATH` 和 `SKUS` → 跑 `preview` → 跑 `import` |
| 调整交期档位天数 | `server.js:estimateDeliveryByRx` / `estimateDelivery`；文案和天数同步改 |
| 调整度数常规范围 | `server.js` 里 `STD_SPH_RANGE` / `STD_CYL_RANGE` 常量 |
| 调整低库存提醒阈值 | `order.html` 里 `LOW_STOCK_THRESHOLD` 常量 |
| 调整缓存 TTL | `server.js` 里 `STOCK_TTL` 常量 |
| 手动改库存数字 | 直接在飞书 Bitable 界面改 `tbl7U79QGG4JtQev` 的"当前库存"字段 |
| 清空 + 全量重导 | `node migrate_stock_v2.js import tbl7U79QGG4JtQev` — 脚本会先清空 |

---

## 七、下一阶段（第二阶段，暂未动手）

这些是**已讨论但未实施**的功能，记录在此以免再次讨论：

- **销售历史消耗分析** — Excel 的 `1月/2月/3月` 三张销售矩阵；可做月均消耗 → 自动补货建议
- **多维度库存告警** — 当前库存 < 安全库存 → 飞书 IM 通知
- **在产量 / 毛坯量字段** — 现在只有"当前库存"，不管在产
- **并发下单扣减** — 当前库存是手工维护的静态数，下单不扣减；并发时"仅剩 5 片"可能被多代理商同时抢下。这个是**已知局限**，不是 bug

---

## 八、开发铁律

- 脚本与 order-system 共用同一个飞书 App Token，APP_TOKEN 从 `../shared/.env` 读，不硬编码
- 不要把脚本的 Excel 路径改成绝对路径以外的形式 — 当前就是依赖本地 Excel
- **改库存表结构** = 数据迁移工程，必须写新的 `migrate_stock_v3.js`，不要手改 Bitable 字段（会丢数据）
- 新增字段时，旧数据的默认值策略要在 PR 里说清楚
- **不要**把库存查询 API 从 `order-system/server.js` 拆到独立服务 — 当前没有业务必要性（违反 CLAUDE.md "不为未来抽象"）
