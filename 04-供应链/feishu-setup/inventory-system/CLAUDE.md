# CLAUDE.md — 库存系统项目宪法

> 本文件是 Claude Code 在本目录工作时的第一手上下文。**当前进度看 [STATE.md](STATE.md)**，本文件只写长期稳定的约束与事实。

---

## 一、项目是什么

**三系统之一：库存系统**。代理商下单时的**实时现货查询 + 交期预估**模块。代理商选产品型号 + 填度数后，立即看到"有货 / 排产 / 定制"徽章。

三系统架构：

| 系统 | 目录 | 职责 |
|------|------|------|
| **CRM** | `销售飞轮项目/`（独立飞书 Bitable） | 客户主数据、代理商、销售目标、会议 |
| **订单** | `order-system/` | 代理商门户、下单、验真、物流、CRM同步 |
| **库存** | `inventory-system/`（本目录） | 度数级库存、交期预估、9条业务规则 |

- **业务目标：** 让代理商和终端客户对交期有明确预期
- **心智模型：** 现货 = 放心 = 愿意推荐 = 正向循环

---

## 二、架构地位

本目录存放：
1. **库存表迁移 / 维护脚本**（[migrate_stock_v2.js](migrate_stock_v2.js)）
2. **库存系统的文档**（CLAUDE.md、STATE.md）

运行时代码在 `../order-system/`：
- `server.js` — `getStockMap()` + `estimateDeliveryByRx()` + `/api/delivery-estimate`
- `automations.js` — 9条业务规则（库存告警、采购触发、排产等）

表 ID 从 `../shared/tables.js` 引用（单一真相源），APP_TOKEN 从 `../shared/.env` 读取。

---

## 三、数据模型

### 度数级成品库存表（核心）

- **Table ID：** `TABLES.stock_detail`（`tbl7U79QGG4JtQev`）
- **表名：** 度数级成品库存
- **粒度：** 一行 = `(SKU, SPH, CYL)` 唯一组合
- **AXIS 不入库存主键** — 散光毛坯通用，AXIS 后加工

| 字段 | 类型 | 说明 |
|------|------|------|
| `SKU_SPH_CYL` | TEXT | 业务去重主键，格式 `"SKU\|SPH\|CYL"`，例：`"Ultra双效\|-1.00\|-0.50"` |
| `SKU编号` | TEXT | 必须与 `server.js` 的 `SKU_CATALOG[].sku` 完全一致 |
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

### 4.1 交期三档（所有 SKU 统一）

| 情况 | 档位文案 | 交期天数 |
|------|---------|---------|
| 库存 ≥ 下单量 | `有货1-2天` | 2 |
| 度数在常规范围但库存 < 下单量 | `排产5-7天` | 7 |
| 度数超出常规范围 (SPH < -6 或 CYL < -2) | `定制7-10天` | 10 |

**所有 SKU 的库存判定都走 stock_detail 表**，不再区分精细/粗粒度。

**禁止在前端做档位计算** — 档位由后端返回，前端只渲染。

### 4.2 库存数量展示（UX 铁律）

- **默认不展示具体片数** — 防止代理商误判可拿量
- **仅在库存 ≤ 5 片时显示"仅剩 N 片"** — 提醒紧张
- **阈值常量：** `LOW_STOCK_THRESHOLD = 5`（见 `order.html`）

### 4.3 每眼独立判定

- **右眼和左眼各自一个徽章** — 库存是按"片"计算的，每片一个度数
- 勾掉某眼时徽章立即隐藏

### 4.4 缓存

- 度数级库存缓存 TTL = **2 分钟**（`STOCK_TTL` in server.js）
- 修改库存后最多 2 分钟生效

### 4.5 度数精度

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
| 新增 SKU（沿用现有度数分布） | 改 [migrate_stock_v2.js](migrate_stock_v2.js) 的 `SKUS` → 跑 `import <tid>` → 改 `server.js` 的 `SKU_CATALOG` |
| 新增 SKU（新度数分布） | 准备 Excel → 改 `EXCEL_PATH` 和 `SKUS` → 跑 `preview` → 跑 `import` |
| 调整交期档位天数 | `server.js:estimateDeliveryByRx` |
| 调整度数常规范围 | `server.js` 里 `STD_SPH_RANGE` / `STD_CYL_RANGE` 常量 |
| 调整低库存提醒阈值 | `order.html` 里 `LOW_STOCK_THRESHOLD` 常量 |
| 调整缓存 TTL | `server.js` 里 `STOCK_TTL` 常量 |
| 手动改库存数字 | 直接在飞书 Bitable 界面改 `tbl7U79QGG4JtQev` 的"当前库存"字段 |
| 清空 + 全量重导 | `node migrate_stock_v2.js import tbl7U79QGG4JtQev` — 脚本会先清空 |

---

## 七、下一阶段（暂未动手）

- **销售历史消耗分析** — Excel 的 `1月/2月/3月` 三张销售矩阵；可做月均消耗 → 自动补货建议
- **多维度库存告警** — 当前库存 < 安全库存 → 飞书 IM 通知
- **在产量 / 毛坯量字段** — 现在只有"当前库存"，不管在产
- **并发下单扣减** — 当前库存是手工维护的静态数，下单不扣减。已知局限，不是 bug

---

## 八、开发铁律

- 脚本与 order-system 共用同一个飞书 App Token，APP_TOKEN 从 `../shared/.env` 读，不硬编码
- 表 ID 从 `../shared/tables.js` 引用，不硬编码
- 不要把脚本的 Excel 路径改成绝对路径以外的形式 — 当前就是依赖本地 Excel
- **改库存表结构** = 数据迁移工程，必须写新的 `migrate_stock_v3.js`，不要手改 Bitable 字段（会丢数据）
- 新增字段时，旧数据的默认值策略要在 PR 里说清楚
