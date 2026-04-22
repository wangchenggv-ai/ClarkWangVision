# STATE.md — 库存系统进度快照

> 本文件是**当前状态快照**（易变），记录"现在走到哪了"。长期规则请看 [CLAUDE.md](CLAUDE.md)。
> 最后更新：**2026-04-22（v5 — 理论备库参数系统脚本完成）**

---

## 一、当前阶段

**第一阶段：度数级现货查询上线** — ✅ 已完成并通过端到端 API 测试

目标：代理商在下单页选产品 + 填度数时，立即看到该度数是否有现货、交期多久，每眼独立展示。

---

## 二、已完成清单

### 飞书 Bitable

- [x] 新建「度数级成品库存」表：`tbl7U79QGG4JtQev`（App `B3xQbbqicaome1sKdZbcwdk8nWg` 下）
- [x] 导入 **Ultra双效 + D8** 各 225 行度数组合，总 **450 行**
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
- [x] `shared/tables.js` — 新增 `stock_plan`（`tbluUfuETzwGdW1E`）
- [x] 备库参数表已建：225 行（版本 2026-04）
- [x] stock_detail 安全库存已填入（Ultra双效 + D8 各 225 行）
- [x] `automations.js` — rule12 度数级库存预警（当前库存 vs 理论备库）
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

### 架构重组（2026-04-22）

- [x] `TABLES` 常量合并到 `../shared/tables.js`，消除 server.js + automations.js 重复定义
- [x] 删除 `HARDCODED_SKUS`（写死库存100/50），改为 `SKU_CATALOG`（静态产品列表）
- [x] 删除 `SKUS_WITH_DETAIL_STOCK`，不再区分精细/粗粒度 SKU
- [x] 删除 `estimateDelivery()`（粗粒度交期），统一走 `estimateDeliveryByRx()`
- [x] 删除 `supply-chain/` 目录，sync 脚本搬到 `../order-system/`

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

- [ ] **理论备库植入**：`node migrate_stock_plan.js create` → `import` → `apply_stock_plan.js --dry-run` → 实际写入
- [ ] **创建飞书 Bitable 表**：运行 `node migrate_consignment.js create-tables` 创建三张表
- [ ] **agent 表加字段**：运行 `node migrate_consignment.js add-agent-fields`
- [ ] **更新 tables.js**：把 create-tables 打印的 ID 填入
- [ ] **选 1 家试点代理商**：录入初始库存数据
- [ ] **跑通端到端流程**：入库 → 下单 → 消耗 → 月度结算 → 到期转收入
- [ ] **新增5个 SKU 的度数库存**：时空之眼A/B/PRO/MAX + 小旋风
- [ ] **上游物料表录入数据**：同事通过表单视图开始填毛坯批次和模具台账
- [ ] **上游物料表确认字段**：业务同事用表单试填，反馈是否需要加减字段

### 第二阶段（未来，不急）

- [ ] **交期逻辑改造**：无现货时联动 blank_inventory + mold 判定排产 vs 定制
- [ ] 销售消耗分析（Excel 的 1月/2月/3月 sheet）
- [ ] 并发下单扣减库存（幂等设计）
- [ ] 安全库存告警（飞书 IM 通知）

---

## 四、关键事实速查

| 项 | 值 |
|----|----|
| 飞书 App Token | `B3xQbbqicaome1sKdZbcwdk8nWg` |
| 度数级库存表 ID | `tbl7U79QGG4JtQev` |
| 毛坯库存表 ID | `tblrFIGHFVhTB16p` |
| 模具台账表 ID | `tblfnVzOA2yFzbjs` |
| 已录 SKU | `Ultra双效`、`D8`（各 225 行） |
| 待录 SKU | 时空之眼A/B/PRO/MAX、小旋风（需要 Excel 数据） |
| 当前库存总量 | 2340 片 × 2 SKU = 4680 片 |
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

- **库存无并发扣减**：当前库存数是手工维护的静态数，下单时不会自动 -1。多代理商同时抢"仅剩 3 片"的度数会超卖。解决方案放第二阶段。
- **重启丢缓存**：`_stockCache` 是进程内存，重启后第一次请求会全表拉一次（450 行），延迟多约 500ms。可接受。
- **度数步长固定 0.25**：非 0.25 倍数的度数（如 -1.1）会找不到对应行，直接走"排产 5-7 天"档。前端 `<input step="0.25">` 已限制。
