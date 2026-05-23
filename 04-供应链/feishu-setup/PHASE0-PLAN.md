# 三维一体系统 Phase 0 计划

> 生成日期：2026-05-17  
> 目标：锁定 SKU 语言基础、物理仓库与数字库存打通、状态机文档化、CRM 数据流规范  
> 下次会话：直接按本文件逐项执行，无需重新分析

---

## 背景：今天发现的核心问题

通读了以下文件后得出：
- `ARCHITECTURE-OVERVIEW.md`（全景架构）
- `order-system/STATE.md` + `CLAUDE.md` + `server.js`
- `inventory-system/STATE.md`
- `仓库设计/仓库设计-镜片备库方案.md`
- `仓库全流程质控手册.md`

### 问题1：SKU 三层语义混乱（最危险）

系统里"SKU"在不同地方指不同的东西：
- 架构文档说"7 SKU"→ 指产品型号
- 库存系统操作的是 SPH+CYL 组合
- 仓库设计用序列号 001-219
- 质控手册反复提"SKU编码"，无明确定义

**风险：** 每加一个新模块（配货单、Agent3、对账单）都会重新发明一套命名，最终积累成数据不一致。

### 问题2：物理仓库与数字库存是两张皮

- `sku_location` 表（`tblTbLuC3VI0ISKH`）已在 `tables.js` 里，但字段和数据状态不明
- 仓库设计里的 219 个序列号→货位映射没有进系统
- 当前配货单没有序列号、没有货位，仓库员工配货靠记忆

### 问题3：状态机×库存操作关系没有文档

通过读 `server.js` 才发现：
- **确认时**：后台预占 `reserveStock`（server.js ~3267）
- **退回时**：释放预占 `releaseReservation`（server.js ~3609）
- **发货时**：`convertReservation` 预占转实扣 + 写 `stock_movement` 流水（server.js ~4131）
- **签收时**：无库存操作

这个关系没有写在任何文档里，改状态机时容易引入库存 bug。

### 问题4：质控 Agent1-5 只实现了 Agent2

质控手册定义了 5 个 Agent，但实际系统只有 Agent2（库存核验）落地了：
- Agent1（订单字段校验）：飞书表单有部分校验，但没有系统级拦截
- Agent3（入库扫码绑定）：未实现
- Agent4（波次播种比对）：未实现
- Agent5（复核双码核验）：未实现

差错率目标 ≤0.1% 在 Agent3-5 上线前无法达到。

### 问题5：CRM→订单单向同步，销售分析无数据源

- 已有：`sync_agents.js` / `sync_customers.js`（CRM → 订单，单向）
- 缺失：订单发货量/签收量/SKU消耗分布 → CRM（反向）
- 影响：CRM §05 销售目标达成率没有数据支撑，代理商维度的销售分析无法做

---

## Phase 0 执行计划（明天写代码）

### 任务1：SKU 三层定义注释写入 `shared/tables.js`

**文件：** `C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\shared\tables.js`

在文件顶部（第1行之前）插入以下注释块：

```js
/**
 * ══════════════════════════════════════════════════════════
 * SKU 三层数据模型（全局约定，所有模块统一遵守，不得绕过）
 * ══════════════════════════════════════════════════════════
 *
 * Layer 1 — ProductSKU（产品型号）
 *   存储：TABLES.sku（tblwQsvGAahoeoJV）
 *   标识：SKU编号字段（如 OK-A、OK-B），目前共 7 个
 *   用途：采购、模具台账、毛坯库存、定价
 *   写法：代码里变量名用 productSku / sku
 *
 * Layer 2 — StockSKU（备库度数单元）
 *   存储：TABLES.sku_location（tblTbLuC3VI0ISKH）
 *   标识：序列号 001-219，由 ProductSKU + SPH + CYL 唯一确定
 *   用途：仓库货位管理、配货单生成、度数级库存扣减
 *   写法：代码里变量名用 serialNo / skuSerial
 *
 * Layer 3 — LensItem（镜片个体）
 *   存储：TABLES.lens_detail（tblC7pve7ObFgIOl）
 *   标识：16位 HEX 镜片码（如 8355795E862C512E），一眼一码
 *   用途：消费者扫码验真、一眼一镜追踪、防伪
 *   写法：代码里变量名用 lensCode / hexCode
 *
 * 跨层引用规则：
 *   下单时    → 代理商填 ProductSKU + SPH + CYL（Layer1+2输入）
 *   库存扣减  → 通过 ProductSKU+SPH+CYL 定位 StockSKU，更新 stock_detail
 *   配货单    → 通过 ProductSKU+SPH+CYL 查 sku_location → 拿序列号+货位编号
 *   验真      → 用 LensItem 16位HEX 查 lens_detail
 * ══════════════════════════════════════════════════════════
 */
```

**验收：** 注释加完后不影响任何现有 import，运行 `node server.js` 无报错。

---

### 任务2：状态机×库存操作关系 写入 `order-system/ARCHITECTURE.md`

**文件：** `C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system\ARCHITECTURE.md`

在文件末尾追加一节：

```markdown
## 状态机 × 库存操作对照表

> 此表是维护安全约定。改状态机前必须确认不破坏库存操作的时序。

| 状态转移 | 库存操作 | server.js 位置 | 幂等保护 |
|---------|---------|--------------|---------|
| 已下单 → 确认（有库存路径） | `reserveStock` 预占库存 | ~3267 后台阶段2 | clientRequestId |
| 已下单 → 确认（无库存路径） | 仅标记"无库存"，不预占 | ~3251 | -- |
| 任意可退状态 → 退回 | `releaseReservation` 释放预占 | ~3609 | 幂等：多次释放=释放一次 |
| 打标签/生产中 → 发货 | `convertReservation` 预占→实扣 | ~4131 | -- |
| | + 写 `stock_movement` 出库流水 | ~4137 | docNo 唯一 |
| 已发货 → 已签收 | 无库存操作 | -- | -- |

**铁律：**
- 库存扣减只在发货时发生（convertReservation），不在打标签时
- 供应商直发路径（生产中→发货）也走同一扣减逻辑，但 stockStatusField 为"无库存"时跳过扣减（line 4115）
- 退回清镜片码后必须同时调 releaseReservation，两者是原子操作（当前靠串行保证）
```

---

### 任务3：sku_location 表建字段 + 导入219行数据

#### 3-A：检查现有表字段

用 lark-base 技能查 `tblTbLuC3VI0ISKH`（APP_TOKEN `B3xQbbqicaome1sKdZbcwdk8nWg`）现有字段。

**目标字段清单（必须全部存在）：**

| 字段名 | 类型 | 说明 |
|--------|------|------|
| 序列号 | 文本 | `001`-`219`，主键语义 |
| ProductSKU | 文本 | 产品型号（如 OK-A） |
| SPH | 数字 | 球镜度数 |
| CYL | 数字 | 柱镜度数 |
| ABC分类 | 单选 | A/B/C |
| 货位编号 | 文本 | 格式 `A-01-3-03` |
| 料盒类型 | 单选 | 大盒/中盒/小盒 |
| 安全库存片数 | 数字 | 补货触发点 |
| 总备库片数 | 数字 | 当前设计备库量 |

缺少的字段用 lark-base 创建。

#### 3-B：写数据导入脚本

**文件：** `inventory-system/migrate_sku_location.js`

脚本逻辑：
1. 用 `xlsx` 库解析 `仓库设计/仓库SKU地址映射表.xlsx`
2. 读「序列号速查」Sheet
3. 批量写入 `sku_location` 表（每批 50 条，飞书 API 限制）
4. 写入前先清空表已有数据（防重复）
5. 完成后打印"已写入 N 条"

**依赖：** `xlsx`（shared/package.json 已有）

**运行方式：**
```bash
cd inventory-system
node migrate_sku_location.js
```

#### 3-C：验证

用 lark-base 查询表前5条，确认序列号+货位字段有值。

---

### 任务4：CRM↔订单 数据流规范写入 `ARCHITECTURE-OVERVIEW.md`

**文件：** `C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\ARCHITECTURE-OVERVIEW.md`

在"数据流全景"章节末尾追加：

```markdown
## 数据 Master 方向约定

> 每个字段只有一个 Master（写入源），其他系统只读。违反此规则会产生数据冲突。

| 字段/数据 | Master | 消费方 | 同步方式 | 状态 |
|----------|--------|--------|---------|------|
| 代理商基础信息（名称/联系人/区域） | CRM | 订单 | `sync_agents.js` 脚本 | ✅ 已实现 |
| 终端客户信息 | CRM | 订单 | `sync_customers.js` 脚本 | ✅ 已实现 |
| 订单量/发货量（按代理商/月） | 订单 | CRM | 待实现 → `sync_order_stats.js` | ❌ 缺失 |
| SKU消耗分布（按代理商） | 订单 | CRM | 待实现 → 同上 | ❌ 缺失 |
| 签收时间/签收率 | 订单 | CRM | 待实现 → 同上 | ❌ 缺失 |
| 销售目标（年度/季度） | CRM | -- | -- | CRM自持 |
| 会议/签到记录 | CRM | -- | -- | CRM自持 |

**下一阶段（Phase 1）任务：** 实现 `sync_order_stats.js`，每天定时汇总订单数据→写入 CRM 代理商表。
字段设计：CRM 代理商表需新增「本月发货副数」「本季发货副数」「累计发货副数」「主力SKU」四个字段。
```

---

### 任务5：配货单改造设计（本次不写代码，只出规范）

> 配货单改造依赖任务3完成（sku_location有数据）后才能实现，但设计可以先锁定。

**改造目标：** `labels-print.html` 中的配货单模板加入序列号+货位

**数据获取方式：**
```
镜片明细记录（ProductSKU + SPH + CYL）
         ↓
查 sku_location 表（WHERE ProductSKU=x AND SPH=y AND CYL=z）
         ↓
取「序列号」+「货位编号」
         ↓
写入配货单每行
```

**新增 API：** `GET /api/sku-location?sku=OK-A&sph=-1.25&cyl=-0.50`
- 返回：`{ serialNo: "008", binCode: "A-02-3-02", boxType: "大盒" }`

**配货单新增列：**

| 原有列 | 新增列 |
|--------|--------|
| 顾客姓名 | 序列号（大字） |
| 左/右眼 | 货位编号 |
| SPH/CYL | 路径排序键（不显示，用于排序） |
| 镜片码 | 保留 |

**排序规则：** 先 A区→B区→C区，同区按货架号→层号→位号升序，减少来回走动。

---

## 执行顺序与时间估算

| # | 任务 | 预计时间 | 依赖 |
|---|------|---------|------|
| 1 | SKU三层定义注释 | 5 min | 无 |
| 2 | 状态机×库存图 | 10 min | 无 |
| 3-A | sku_location 表字段检查+补全 | 15 min | 无 |
| 3-B | 导入脚本编写+运行 | 20 min | 3-A |
| 3-C | 数据验证 | 5 min | 3-B |
| 4 | CRM数据流规范 | 5 min | 无 |
| 5 | 配货单改造规范（不写代码） | 0 min（已在本文）| 3-C |
| **合计** | | **~60 min** | |

---

## 下次会话启动提示词

> 复制以下内容作为第一条消息发给 Claude：

```
读 C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\PHASE0-PLAN.md
按里面的计划逐项执行 任务1→2→3-A→3-B→3-C→4
任务5（配货单）不在本次范围，规范已在文档里，等下次会话
```

---

## 年度目标对照

| 目标 | 数字 | Phase 0 的意义 |
|------|------|---------------|
| 2026年底 | 26,500副 / 50,000片 | 仓库物理系统必须在7月前就绪 |
| 2027年 | 50,000副 | sku_location + 配货单是仓库效率基础，届时靠这套跑5万 |

质控手册里程碑：
- 7月底：Agent1+5上线，差错率 ≤1.0%
- 8月底：波次制度稳定，≤0.5%
- 9月底：Agent2-4补充，≤0.2%
- 10月8日：全系统满2个月，≤0.1%

**Phase 0（本文件）是这条路的地基。地基不稳，上面全是沙。**
