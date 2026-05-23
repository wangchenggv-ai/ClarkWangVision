# STATE.md — 库存系统进度快照

> 本文件是**当前状态快照**（易变），记录"现在走到哪了"。长期规则请看 [CLAUDE.md](04-供应链/feishu-setup/inventory-system/CLAUDE.md)。
> 最后更新：**2026-05-19（v13 — 暑期备货模型 Excel）**

---

## 暑期备货模型（2026-05-19）

**状态**: Excel 已生成，参数可调，待导出订货清单给工厂

**文件路径**: `heat-map-tool/暑期备货模型.xlsx`（5个Tab）

### 模型参数（当前版本）

- 暑假目标：12,000 片（6,000 副）
- 历史总量：2,473 片，放大系数 4.85×
- 现片 MOQ：100 片，门槛：预测 ≥ 50 片
- 现片度数范围：SPH 0 ~ -4.00，CYL 0 ~ -1.00
- 残值率：50%（淡季消化）

### 结果摘要

| | 数量 |
|---|---|
| 现片 SKU | 45 个 |
| 现片订量（含安全库存） | 12,800 片 |
| 车房片 SKU | 177 个 |
| 车房片预测需求 | 2,744 片 |
| vs 全车房方案节省 | ~50.5% |

### 关键时间节点

- **2026-05-26**：现片订单提交工厂（锁定产线）⚠ 紧
- **2026-06-09**：现片下单截止（最迟）
- **2026-07-01**：暑假开始，现片到货目标日

### 下一步

- [ ] 确认工厂产能，提交现片订单（本周内）
- [ ] 车房片按周滚动下单（暑假期间）
- [ ] 暑假结束后盘点超备量

---

## Ultra 车房库存管理工具（2026-05-14）

**状态**: MVP 完成，已测试通过

### 完成内容

- [x] 飞书 Bitable Base：`O1Zwbdcnva1kZEsRdgjcuaEZnfc`（Ultra车房库存管理）
- [x] 库存表：`tblvYJw1LuXyaTeP`（225条，219条有序列号）
- [x] 出库表：`tblVqaFdATjb5jnq`（关联库存链接字段 + 公式自动扣减）
- [x] 公式：`实际库存 = 当前库存 - SUM(出库明细.数量)`
- [x] 序列号：001-219 按频率排序（来源 `仓库SKU地址映射表.xlsx`）
- [x] 五个 Tab：快速出库 / 快速入库 / 库存热力图(纯展示) / 出库记录 / 周报导出
- [x] 一键启动脚本：`启动库存工具.bat`（自动下载 Node.js + lark-cli）
- [x] 热力图默认显示，切 Tab 自动刷新数据
- [x] API 限流处理：改用 record-list 优先

### 测试结果

- 序列号出库/入库：✅ 扣减/增加正确
- 热力图展示：✅ 默认显示，刷新按钮可用
- 出库记录：✅ 正常显示
- 周报导出：✅ CSV 下载

### 启动方式

```bash
cd inventory-system/heat-map-tool
双击 启动库存工具.bat
# 或手动: node server.js → http://localhost:3456
```

---

## 一、当前阶段

**第二阶段：进销存闭环** — ✅ 已完成

目标：下单即预占库存，发货转实际扣减，退回释放预占，采购到货入库。补全进→销→存全链路。

---

## 二、本次完成（2026-04-28）

### 库存预占/实扣/释放

- [x] `lib/stock.js` 新增 `reserveStock` / `releaseReservation` / `convertReservation` 三函数
- [x] `getStockMap` / `queryStockByRx` 新增 `reserved`、`available` 字段
- [x] stock_detail 新增 `预占库存` 字段（通过 ensureField 幂等创建）
- [x] `POST /api/submit` → 聚合度数调 `reserveStock` 预占
- [x] `POST /api/admin/ship` → 调 `convertReservation` 库存-1 预占-1 原子写入
- [x] `POST /api/admin/revert` → 调 `releaseReservation` 释放预占

### 模块解耦

- [x] `lib/stock-resolver.js` — 库存判定（查缓存，O(1)，输出 `inStock: available>0`）
- [x] `lib/state-router.js` — 状态路由（纯函数，零 I/O，输出 `{targetStatus, wfStep, deliveryType}`）
- [x] confirm 端点重构：StockResolver → StateRouter → 执行
- [x] order-stock-check 端点重构：不再逐眼 `queryStockByRx`，一次 `resolveStock`

### 采购入库

- [x] `POST /api/admin/procurement` — 创建成品采购单
- [x] `POST /api/admin/procurement/:id/receive` — 到货入库（withLock + stock+N + 流水）
- [x] `GET /api/admin/procurements` — 采购单列表（筛选+分页）
- [x] procurement 表新建（Bitable `tblOfnWZAMxvjZCQ`，SPH/CYL/成品类型）
- [x] `shared/tables.js` procurement ID 更新

### 前端更新

- [x] `public/flow-inventory.html` — 进销存逻辑流程图（三 Tab：全链路/模块关系/数据表）
- [x] `control.html` — 仪表盘加预占/可用指标，SKU表加预占/可用列，数据流Tab改为进销存
- [x] `inventory.html` — 库存明细加预占/可用列，SKU达标率加预占/可用
- [x] 两页面互链（control ↔ flow-inventory）

### API 更新

- [x] `GET /api/admin/dashboard` 新增 `totalReserved`、`totalAvailable`、缺口表加 `reserved`/`available`
- [x] `GET /api/admin/stock-detail` 新增 `reserved`、`available` 字段+汇总

### 部署

- [x] 华为云 ECS 部署（server.js + lib/* + public/* + shared/tables.js）
- [x] procurement 表在飞书创建并关联

---

## 三、已弃用/封存

- ~~`deductStockDetail`~~ — 仍保留代码，不再被任何端点调用；已由 `convertReservation` 替代
- ~~control.html 旧数据流图~~ — 替换为新进销存流程

---

## 四、已知局限

- 预占库存不计入安全库存判定（`belowSafety` 仍基于物理库存）
- 采购单目前仅支持手动录入，rule7 仍只生成模具/毛坯采购
- `deductAgentStock` 仍无并发锁（低频场景，暂不处理）

---

## 一、当前阶段

**第一阶段：度数级现货查询上线** — ✅ 已完成并通过端到端 API 测试

目标：代理商在下单页选产品 + 填度数时，立即看到该度数是否有现货、交期多久，每眼独立展示。

---

## 二、已完成清单

### 飞书 Bitable

- [x] 新建「度数级成品库存」表：`tbl7U79QGG4JtQev`（App `B3xQbbqicaome1sKdZbcwdk8nWg` 下）
- [x] 导入 **7 个 SKU** 各 225 行度数组合，总 **1575 行**（Ultra双效/D8/时空之眼A/B/PRO/MAX/小旋风）
- [x] 两个 SKU 共用同一份度数分布（业务确认：目前两款库存结构一致）

### 代码（2026-04-22 架构重组后）

- [x] [migrate_stock_v2.js](migrate_stock_v2.js) — 建表 / 导入 / 预览三合一脚本
- [x] `../order-system/server.js`
  - [x] `TABLES` 从 `../shared/tables.js` 引用（单一真相源）
  - [x] `SKU_CATALOG` 静态产品目录（7个 SKU，不含库存数字）
  - [x] `STD_SPH_RANGE` / `STD_CYL_RANGE` 常规度数范围常量
  - [x] `getStockMap()` 度数级库存缓存（2 分钟 TTL）
  - [x] `estimateDeliveryByRx()` 三档交期判定（所有 SKU 统一走此处）
  - [x] `/api/delivery-estimate` 端点必须传 `sph/cyl`，无 fallback
  - [x] `/api/submit` 交期取双眼中最慢档
- [x] `../order-system/public/order.html`
  - [x] 右眼/左眼各自独立徽章容器
  - [x] `fetchEstimateForEye(id, side)` 每眼独立 fetch
  - [x] `onRxChange` 在 SKU / 数量 / SPH / CYL / 眼睛勾选变化时触发
  - [x] `LOW_STOCK_THRESHOLD = 5`，仅 ≤5 片显示"仅剩 N 片"

### 上游物料表（2026-04-22 建表完成）

- [x] 表结构设计方案（见 CLAUDE.md 第八节）
- [x] 毛坯库存表建表：`tblrFIGHFVhTB16p`，11 个字段
- [x] 模具台账表建表：`tblfnVzOA2yFzbjs`，11 个字段
- [x] stock_detail 新增字段：`安全库存`(NUMBER) + `最近出库`(DATE)
- [x] `shared/tables.js` 更新为真实表 ID
- [x] `migrate_upstream.js` 建表/加字段/配表单视图三合一脚本
- [x] 三张表各配表单视图（毛坯录入 / 模具录入 / 成品库存录入）

### 理论备库参数系统（2026-04-22）

- [x] `migrate_stock_plan.js` — 建表/导入 CSV/预览三合一脚本
- [x] `apply_stock_plan.js` — 理论备库计算 + 回填 stock_detail 安全库存
- [x] `calc_stock_plan.js` — 数据飞轮：从订单数据自动测算度数分布
- [x] `shared/tables.js` — 新增 `stock_plan`（`tbluUfuETzwGdW1E`）、更新 `forecast`（`tblK2YNUZ3RM3Zta`）
- [x] 备库参数表已建：225 行（版本 2026-04）
- [x] stock_detail 安全库存已填入（全部 7 个 SKU × 225 行 = 1575 行）
- [x] `automations.js` — rule12 度数级库存预警（当前库存 vs 理论备库）
- [x] `server.js` — 下单自动扣减度数级库存（`deductStockDetail`，幂等设计）
- [x] forecast 表已建（`tblK2YNUZ3RM3Zta`，待录入预测数据）
- [x] **运行建表**：`node migrate_stock_plan.js create`
- [x] **导入参数**：`node migrate_stock_plan.js import <tid>`
- [x] **回填安全库存**：`node apply_stock_plan.js --dry-run` → `node apply_stock_plan.js`
- [x] **验证告警**：度数级预警验证通过（213/213 低于安全库存，缺口最大 SPH=0/CYL=0 差 238 片）

公式：`理论备库 = max(ceil(月预测 × 季节系数 × 2 × 度数占比), 1)`

### 寄售库存方案（2026-04-22）

- [x] 方案设计：50/50 自有+寄售，90天账期到期转收入
- [x] `migrate_consignment.js` — 建表/导入/预览三合一脚本
- [x] `shared/tables.js` — 新增 agent_stock / consignment_ledger / monthly_statement 占位
- [x] `server.js` — `getAgentStockMap()` 代理商库存缓存（2分钟TTL）
- [x] `server.js` — `estimateDeliveryByRx()` 支持 agentId 优先查代理商库存
- [x] `server.js` — `deductAgentStock()` 先自有后寄售扣减 + 写流水
- [x] `server.js` — `/api/agent-stock` 代理商库存明细端点
- [x] `server.js` — `/api/admin/consignment-report` 寄售账龄报告
- [x] `server.js` — `/api/admin/monthly-statement` 月度对账单生成
- [x] `server.js` — `/api/submit` 改为扣减代理商库存 + 写寄售流水
- [x] `order.html` — 库存徽章显示"自有 N + 寄售 M"分拆
- [x] `automations.js` — rule10 寄售到期预警（60天黄/90天红）
- [x] `automations.js` — rule11 月度对账单自动生成

### 动态排产飞轮（2026-04-22）

- [x] `migrate_production.js` — 建排产表（含度数级字段），表 ID `tblWu5QwGPK1zYMl`
- [x] `shared/tables.js` — 更新 production 表 ID
- [x] `automations.js` — rule13 度数级自动排产（缺口→工单→自动分配车房→自动标记生产中）
- [x] `automations.js` — rule14 度数级库存自动回补（到期/人工完成→回补库存→累加模芯）
- [x] `rules_config.json` — rule13/rule14 配置已写入
- [x] `automations.js` — env 加载改为支持 `../shared/.env` 回退
- [x] 规则数从 12 → 14，CLAUDE.md 已更新
- [x] 飞书 production 表建 3 个视图（按SKU分组/按状态筛选/按预计完成日）
- [x] 端到端飞轮测试通过：rule13→1491张工单→改一条过期→rule14→库存+238→工单变完成
- [x] 寄售三张表建表：agent_stock(`tblIEYUemBGIquVs`) / consignment_ledger(`tblP9VObYpOMh1gD`) / monthly_statement(`tblvEIQ7IBCJw2iY`)
- [x] agent 表加字段：寄售账期天数 / 结算方式 / 备库比例
- [x] `shared/tables.js` — 寄售三张表 ID 已填入

### 架构重组（2026-04-22）

- [x] `TABLES` 常量合并到 `../shared/tables.js`，消除 server.js + automations.js 重复定义
- [x] 删除 `HARDCODED_SKUS`（写死库存100/50），改为 `SKU_CATALOG`（静态产品列表）
- [x] 删除 `SKUS_WITH_DETAIL_STOCK`，不再区分精细/粗粒度 SKU
- [x] 删除 `estimateDelivery()`（粗粒度交期），统一走 `estimateDeliveryByRx()`
- [x] 删除 `supply-chain/` 目录，sync 脚本搬到 `../order-system/`

### Admin 控制中心（2026-04-22）

- [x] `public/control.html` — 3 Tab 单页应用（仪表盘/规则+执行+AI/数据流）
- [x] `server.js` — 5 条 admin API 路由（rules 读写、execute-rule、dashboard、ai-chat）
- [x] `server.js` — RULE_MANIFEST 常量（14 条规则元数据）
- [x] 仪表盘：总库存/安全库存/排产状态/SKU达标率/TOP10缺口可视化
- [x] 规则 Tab：三大业务分组色块卡片（订单蓝/库存绿/生产橙），有参数的卡片自动双列
- [x] 执行+AI+操作按钮紧凑右侧面板，顶部对齐
- [x] AI 助手：MiMo Agent，内置完整规则知识 + 快捷问题芯片
- [x] 仪表盘 2 分钟缓存（首次 ~10s，后续 <100ms）
- [x] **UI 验收通过**：读取→修改→执行→恢复全链路测试完成（详见 [控制中心指南](docs/control-center-guide.md)）

### 下单库存实时扣减 + 并发安全（2026-04-22）

- [x] `server.js` — per-key 异步锁 `withLock()`，promise 链序列化同一 SKU/SPH/CYL 的并发写
- [x] `server.js` — `deductStockDetail` 重写：锁内 GET 单条 fresh 库存 → 检查 → PATCH，返回 `{success, reason}` 对象
- [x] `server.js` — `getStockMap(fresh)` 新增 `fresh` 参数强制刷新缓存
- [x] `server.js` — `/api/submit` 流程重组：预检 fresh 库存(409) → 写订单 → 扣库存(失败标记人工)
- [x] `server.js` — 幂等保护：`clientRequestId` + 10分钟 TTL 缓存
- [x] `order.html` — 409 库存冲突弹窗（显示具体度数+片数），关闭自动 reload
- [x] `order.html` — `crypto.randomUUID()` 防双击
- [x] 修复 `skuInfo?.name` → `sku`（未定义变量 bug）

### 测试

端到端 API 测试（port 3299，已关），7/7 通过：

| # | 场景 | 输入 | 期望档位 | 实际 |
|---|------|------|---------|------|
| 1 | 现货充足 | Ultra双效 SPH=-1 CYL=-0.5 qty=1 | 有货1-2天 | ✅ stock=77 |
| 2 | 缺货常规度数 | Ultra双效 SPH=-5 CYL=0 qty=3 | 排产5-7天 | ✅ stock=2 |
| 3 | 超范围 | Ultra双效 SPH=-7 CYL=0 | 定制7-10天 | ✅ |
| 4 | D8 共用库存 | D8 SPH=-1.25 CYL=-0.5 qty=5 | 有货1-2天 | ✅ stock=82 |
| 5 | 非精细 SKU | 时空之眼A 无度数 | 有货3天 (fallback) | ✅ |
| 6 | 库存不足 | Ultra双效 库存 2 qty=5 | 排产5-7天 | ✅ |
| 7 | 度数精度 | SPH=-1.00 vs -1.0 | 同一行命中 | ✅ |

注：测试5的 fallback 逻辑已移除，时空之眼A 现在也必须传度数走 stock_detail 判定。

---

## 三、待办

### 下阶段（短期，下次会话优先做）

- [ ] **选 1 家试点代理商**：录入初始库存数据（`node migrate_consignment.js import <agentId> <excel> ...`）
- [ ] **跑通端到端流程**：入库 → 下单 → 消耗 → 月度结算 → 到期转收入
- [ ] **上游物料表录入数据**：同事通过表单视图开始填毛坯批次和模具台账
- [ ] **上游物料表确认字段**：业务同事用表单试填，反馈是否需要加减字段

### 第二阶段（未来，不急）

- [ ] **交期逻辑改造**：无现货时联动 blank_inventory + mold 判定排产 vs 定制
- [ ] 销售消耗分析（Excel 的 1月/2月/3月 sheet）
- [x] ~~并发下单扣减库存（幂等设计）~~ → 已完成，per-key mutex + clientRequestId 幂等
- [ ] 安全库存告警（飞书 IM 通知）

---

## 四、关键事实速查

| 项 | 值 |
|----|----|
| 飞书 App Token | `B3xQbbqicaome1sKdZbcwdk8nWg` |
| 度数级库存表 ID | `tbl7U79QGG4JtQev` |
| 排产表 ID | `tblWu5QwGPK1zYMl` |
| 毛坯库存表 ID | `tblrFIGHFVhTB16p` |
| 模具台账表 ID | `tblfnVzOA2yFzbjs` |
| 代理商库存表 ID | `tblIEYUemBGIquVs` |
| 寄售流水表 ID | `tblP9VObYpOMh1gD` |
| 月度对账单表 ID | `tblvEIQ7IBCJw2iY` |
| 已录 SKU | 全部 7 个（各 225 行） |
| 待录 SKU | 无 |
| 当前库存总量 | 2340 片 × 2 SKU = 4680 片（新 SKU 库存=0 待补货） |
| 度数范围 | SPH 0 ~ -6.00，CYL 0 ~ -2.00，步长 0.25 |
| 低库存阈值 | 5 片 |
| 寄售账期 | 90 天 |
| 寄售比例 | 50/50（自有/寄售） |
| 缓存 TTL | 2 分钟 |
| Excel 源文件 | `C:/Users/wangc/Desktop/备库参数比例.xlsx` sheet=库存表 |
| CSV 源文件 | `C:/Users/wangc/Desktop/备库参数比例 - 理论备库表.csv` |
| 测试代理商 Token | `AG-002-zxkmgoryb6nprmv6`（代理商 AG-002 "测试代理商"） |
| 本地 order-system 端口 | 3210 |

---

## 五、启动指引

### 本地验证下单页

```bash
cd ../order-system
node server.js                    # 默认端口 3210
# 浏览器打开：
# http://localhost:3210/order?t=AG-002-zxkmgoryb6nprmv6
```

### 重新导入库存（如果改了 Excel）

```bash
cd ../inventory-system
node migrate_stock_v2.js preview                    # 先预览
node migrate_stock_v2.js import tbl7U79QGG4JtQev    # 清空 + 全量重导
```

### 理论备库植入操作

```bash
cd ../inventory-system
node migrate_stock_plan.js preview                # 预览 CSV + 归一化
node migrate_stock_plan.js create                 # 建表，记下 table_id
# 更新 shared/tables.js 的 stock_plan 字段为 table_id
node migrate_stock_plan.js import <tableId>       # 导入当月版本
node apply_stock_plan.js --dry-run                # 预览理论备库计算
node apply_stock_plan.js                          # 实际写入安全库存
```

### 数据飞轮（每月运行一次）

```bash
node calc_stock_plan.js --months 3 --auto-apply   # 从订单算分布 → 更新参数表 → 回填安全库存
```

### 新增 SKU 的操作顺序

1. 决定：新 SKU 的度数分布 = 现有（复用 Excel）还是独立（新 Excel）
2. 若复用：改 [migrate_stock_v2.js](migrate_stock_v2.js) 的 `SKUS` 常量加名字
3. 若独立：改 `EXCEL_PATH` 或 `SHEET_NAME`，以及 `SKUS`
4. 跑 `node migrate_stock_v2.js preview` 确认数据无误
5. 跑 `node migrate_stock_v2.js import tbl7U79QGG4JtQev` 导入
6. 改 `../order-system/server.js` 的 `SKU_CATALOG` 加新 SKU
7. **重启** `server.js`（缓存是进程内的）
8. 本地测试：选新 SKU + 各种度数，验证徽章正确

---

## 六、当前已知局限

- **库存不足不拦截下单**：库存只影响交期快慢。有货→有货1-2天，缺货→排产5-7天/定制7-10天，照常下单。
- **厂家总仓并发已修复**：per-key mutex + fresh read 解决 lost update。有货时扣库存，无货时扣至 0 不阻断。
- **代理商库存**（`deductAgentStock`）仍存在 lost-update bug，暂不处理（代理商库存并发概率极低）。
- **重启丢缓存**：`_stockCache` 是进程内存，重启后第一次请求会全表拉一次（450 行），延迟多约 500ms。可接受。
- **度数步长固定 0.25**：非 0.25 倍数的度数（如 -1.1）会找不到对应行，直接走"排产 5-7 天"档。前端 `<input step="0.25">` 已限制。
