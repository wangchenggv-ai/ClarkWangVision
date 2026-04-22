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
1. **库存表迁移 / 维护脚本**（[migrate_stock_v2.js](migrate_stock_v2.js)、[migrate_stock_plan.js](migrate_stock_plan.js) 等）
2. **库存系统的文档**（CLAUDE.md、STATE.md）

运行时代码在 `../order-system/`：
- `server.js` — `getStockMap()` + `estimateDeliveryByRx()` + `/api/delivery-estimate`
- `automations.js` — 12条业务规则（库存告警、采购触发、排产等，含 rule12 度数级预警）

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
| `安全库存` | NUMBER (0) | 低于此值触发低库存告警 |
| `最近出库` | DATE | 未来下单扣减时自动写入 |
| `更新时间` | MODIFIED_TIME | 飞书自动维护 |

### 度数标准范围（常规备货）

- **SPH ∈ [-6.00, 0]**（近视，每 0.25D 一档，25 档）
- **CYL ∈ [-2.00, 0]**（散光，每 0.25D 一档，9 档）
- **超出范围 = 自动走定制档位**（不查库存表）

单 SKU 完整覆盖度数组合数 = 25 × 9 = **225 行**

### 备库参数表（理论备库）

- **Table ID：** `TABLES.stock_plan`（`tbluUfuETzwGdW1E`）
- **表名：** 备库参数表
- **粒度：** 一行 = 一个 `(SPH, CYL)` 组合 × 一个版本月份
- **可追溯：** 每月一个版本，不覆盖历史

| 字段 | 类型 | 说明 |
|------|------|------|
| `SPH_CYL` | TEXT | 去重键 `"SPH\|CYL"` |
| `SPH` | NUMBER | 球镜值 |
| `CYL` | NUMBER | 柱镜值 |
| `备库数量` | NUMBER | 该组合的原始统计数量（来自 CSV 或订单测算） |
| `占比` | NUMBER | 归一化比例（0~1），= 备库数量 / 总和 |
| `版本月份` | TEXT | 如 `"2026-04"`，标识数据来源月份 |

**公式：** `理论备库 = max(ceil(月预测 × 季节系数 × 2 × 占比), 1)`

- 月预测 = forecast 表本月各周预测销量之和（周→月 × 4.33）
- 季节系数 = summer 1.3 / school 1.2 / CNY 0.8 / default 1.0（复用 rule4 配置）
- 2 = 2 个月库存周转目标
- 占比 = 备库参数表中该 SPH/CYL 组合的归一化比例

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

## 五、迁移脚本

### [migrate_stock_v2.js](migrate_stock_v2.js) — 成品库存

```bash
node migrate_stock_v2.js preview              # 仅解析 Excel，不写飞书
node migrate_stock_v2.js create               # 新建一张度数级库存表，打印 table_id
node migrate_stock_v2.js import <tableId>     # 向指定表导入数据（先清空再全量写）
```

### [migrate_upstream.js](migrate_upstream.js) — 上游物料 + stock_detail 加字段 + 表单视图

```bash
node migrate_upstream.js create-tables    # 新建毛坯库存表 + 模具台账表，打印 table_id
node migrate_upstream.js add-fields       # stock_detail 新增 安全库存 + 最近出库
node migrate_upstream.js create-forms     # 三张表各配一个表单视图
node migrate_upstream.js all              # 以上全做
```

### [migrate_stock_plan.js](migrate_stock_plan.js) — 备库参数表

```bash
node migrate_stock_plan.js preview                # 预览 CSV + 归一化
node migrate_stock_plan.js create                 # 建表，打印 table_id
node migrate_stock_plan.js import <tid> [month]   # 导入（默认当前月）
```

### [apply_stock_plan.js](apply_stock_plan.js) — 理论备库计算 + 回填

```bash
node apply_stock_plan.js --dry-run                                    # 预览计算结果
node apply_stock_plan.js                                              # 写入 stock_detail 安全库存
node apply_stock_plan.js --targets "Ultra双效=6000,D8=6000"          # 手动指定 SKU 总目标（forecast 不可用时）
```

### [calc_stock_plan.js](calc_stock_plan.js) — 数据飞轮（从订单自动测算）

```bash
node calc_stock_plan.js --months 3 --auto-apply   # 近3月订单 → 更新参数表 → 回填安全库存
node calc_stock_plan.js --months 6 --dry-run      # 预览近6月分布
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
| 更新理论备库参数 | 更新 CSV → `node migrate_stock_plan.js import <tid>` → `node apply_stock_plan.js` |
| 从订单自动测算备库分布 | `node calc_stock_plan.js --months 3 --auto-apply` |
| 手动指定 SKU 备库目标 | `node apply_stock_plan.js --targets "SKU=数量"` （forecast 表不可用时） |

---

## 七、寄售库存方案（备库合作）

代理商备库 = **自有库存(50%) + 厂家寄售库存(50%)**，物理库存全在代理商处。

### 核心规则

| 规则 | 说明 |
|------|------|
| 自有库存 | 代理商已购买，无时间压力 |
| 寄售库存 | 厂家所有权，90 天账期到期转代理商应付款 |
| 消耗顺序 | **先消耗自有，再消耗寄售**（系统强制） |
| 月度结算 | 每月 1 日自动生成寄售消耗对账单 |
| 超龄预警 | 60 天黄色预警，90 天红色预警 + 写到期流水 |

### 数据模型

| 表 | 说明 |
|----|------|
| `agent_stock` | 代理商库存表（agent_id × SKU × SPH × CYL，自有/寄售分拆） |
| `consignment_ledger` | 寄售流水表（入库/消耗/到期转收入/退货） |
| `monthly_statement` | 月度对账单 |
| agent 表新增 | 寄售账期天数、结算方式、备库比例 |

### 新增 API

| 端点 | 说明 |
|------|------|
| `GET /api/agent-stock` | 代理商看自己的库存明细（自有/寄售分拆） |
| `GET /api/admin/consignment-report` | 管理端看寄售账龄报告 |
| `GET /api/admin/monthly-statement?month=2026-04` | 生成/查看月度对账单 |

### 新增自动化规则

| 规则 | 说明 |
|------|------|
| rule10 | 寄售到期预警（60天黄 / 90天红 + 写流水） |
| rule11 | 月度对账单自动生成（每月 1-3 日） |

### 下一阶段（暂未动手）

- **寄售建表** — `migrate_consignment.js` 建三张表 + agent 表新增字段
- **寄售 API** — `/api/agent-stock`、`/api/admin/consignment-report`、月度对账单
- **寄售规则** — rule10（到期预警）、rule11（月度对账单生成）

---

## 八、上游物料表（已建表）

库存系统不只是成品，上游物料直接影响产能和交期。生产在外部，只管状态管理。

### 毛坯库存表（`blank_inventory`，`tblrFIGHFVhTB16p`）

- **粒度：批次级** — 一行 = 一个到货批次
- **主键逻辑：** 同一 `SKU × CYL` 可有多条（不同批次，AXIS 后加工所以毛坯只到 CYL）

| 字段 | 类型 | 说明 |
|------|------|------|
| `批次号` | TEXT | 业务主键，例 `"BLK-2026-04-001"` |
| `SKU编号` | TEXT | 必须与 `SKU_CATALOG[].sku` 一致 |
| `CYL档位` | NUMBER (0.00) | 柱镜档位，范围 [-2.00, 0]，步长 0.25 |
| `数量` | NUMBER (0) | 本批次初始到货片数 |
| `已消耗` | NUMBER (0) | 已用于生产的片数 |
| `到货日期` | DATE | 供应商到货日期 |
| `保质期至` | DATE | 材料有效期限（可选） |
| `状态` | SINGLE_SELECT | 在库 / 已用完 / 已过期 / 质检中 |
| `供应商` | TEXT | 来源供应商（可选） |
| `备注` | TEXT | 自由文本 |
| `更新时间` | MODIFIED_TIME | 飞书自动维护 |

### 模具台账表（`mold`，`tblfnVzOA2yFzbjs`）

- **粒度：单模** — 一个物理模具 = 一行，独立编号 + 独立寿命

| 字段 | 类型 | 说明 |
|------|------|------|
| `模具编号` | TEXT | 物理唯一编号，例 `"MD-UC-001"` |
| `SKU编号` | TEXT | 该模具用于哪个 SKU |
| `总寿命` | NUMBER (0) | 最大可注塑次数 |
| `已使用` | NUMBER (0) | 已注塑次数 |
| `剩余寿命` | NUMBER (0) | 待迁移为公式字段（当前手动） |
| `状态` | SINGLE_SELECT | 正常 / 预警 / 需更换 / 已报废 |
| `投入使用日` | DATE | 首次投产日期 |
| `最近使用日` | DATE | 最近一次注塑日期 |
| `供应商` | TEXT | 模具供应商（可选） |
| `备注` | TEXT | 自由文本 |
| `更新时间` | MODIFIED_TIME | 飞书自动维护 |

### 表单视图（同事录入入口）

三张表各配了一个表单视图，同事扫码/点链接直接填数据，不用进 Bitable 后台找表。

### 表间关系

```
SKU_CATALOG (server.js 静态常量)
  ├── stock_detail     (SKU × SPH × CYL → 成品片数 / 安全库存)
  ├── stock_plan       (SPH × CYL × 月份 → 占比，理论备库计算源)
  ├── blank_inventory  (SKU × CYL × 批次 → 毛坯片数)
  └── mold             (SKU × 模具编号 → 剩余寿命)

数据飞轮：lens_detail(订单) → calc_stock_plan → stock_plan → apply → stock_detail.安全库存 → rule12 度数级预警
```

---

## 九、开发铁律

- 脚本与 order-system 共用同一个飞书 App Token，APP_TOKEN 从 `../shared/.env` 读，不硬编码
- 表 ID 从 `../shared/tables.js` 引用，不硬编码
- 不要把脚本的 Excel 路径改成绝对路径以外的形式 — 当前就是依赖本地 Excel
- **改库存表结构** = 数据迁移工程，必须写新的 `migrate_stock_v3.js`，不要手改 Bitable 字段（会丢数据）
- 新增字段时，旧数据的默认值策略要在 PR 里说清楚
