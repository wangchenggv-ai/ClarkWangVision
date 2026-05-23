# 订单交付系统 — 架构说明

**最后更新：2026-05-02**

> 本文件描述 order-system/ 的技术架构。三系统全景见 [../ARCHITECTURE-OVERVIEW.md](../ARCHITECTURE-OVERVIEW.md)。

---

## 一、E2E 全链路

完整一笔订单从下单到签收的 8 步流程：

```
步骤  角色                    服务端                          Bitable
────  ────                    ──────                          ───────
 ①   代理商/Excel导入 ──→    POST /api/submit
                                ├→ 幂等检查（clientRequestId + 10min TTL）
                                ├→ 生成订单号 ORD-XXXX
                                ├→ 写订单主表 (一患者一条，状态=待处理)
                                ├→ 写镜片明细表 (一眼一条，生成16位HEX镜片码)
                                ├→ QR图片 → public/qrcodes/
                                ├→ 库存扣减（withLock 锁内 fresh read + PATCH）
                                └→ 自动写入流程步骤=submitted

 ②   助理 管理页确认 ──→     POST /api/admin/confirm
                                ├→ 镜片码如已生成则跳过（幂等）
                                └→ 状态：已下单 → 待处理

 ③   助理 管理页质检 ──→     POST /api/admin/workflow/step
                                └→ 工作流推进：生产中 → 质检完成

 ④   助理 打印标签 ────→     扫码枪扫条形码 / 手动打印
                                ├→ POST /api/admin/print-queue（入队）
                                ├→ pull-print.js 轮询拉取（每2s）
                                ├→ TCP:9100 → 斑马 ZT410
                                └→ 工作流推进：→ 标签已打印

 ⑤   助理 管理页打包 ──→     POST /api/admin/workflow/step
                                └→ 工作流推进：标签已打印 → 已打包

 ⑥   助理 管理页发货 ──→     POST /api/admin/ship
                                ├→ 自动生成快递单号
                                ├→ 写入物流公司/快递单号/发货时间
                                ├→ 状态：生产中 → 已发货
                                ├→ 工作流推进：→ 已发货
                                └→ 飞书发货卡片

 ⑦   助理 管理页签收 ──→     POST /api/admin/deliver
                                ├→ 状态：已发货 → 已签收
                                ├→ 工作流推进：→ 已签收
                                └→ 飞书签收卡片

 ⑧   消费者扫码验真 ────→    GET /verify/:lensCode
                                ├→ 镜片码 → 镜片明细表
                                ├→ 订单编号 → 订单主表
                                └→ 显示验真结果+处方信息
```

**订单状态流转（单向，可逐级退回）：** `已下单 → 待处理 → 生产中 → 打标签 → 已发货 → 已签收`

**工作流步骤（8步，叠加在4状态之上）：** `已下单 → 已确认 → 生产中 → 质检完成 → 标签已打印 → 已打包 → 已发货 → 已签收`

- 工作流步骤存储在订单主表 `流程步骤` 文本字段（JSON）
- `advanceWorkflow()` 防跳步、防回退、幂等
- 现有 confirm/ship/deliver 端点自动推进对应步骤

---

## 二、系统全景

```
代理商浏览器                       服务端 (server.js)                飞书 Bitable (B3xQbb...)
─────────────                   ──────────────────               ─────────────────────────
  order.html ──POST /api/submit──→ 幂等检查 → 写订单主表
                                   写镜片明细表 + 生成镜片码 + QR
                                   锁内扣减度数级库存(stock_detail)

  Excel文件 ──POST /api/excel-parse→ 代码解析列名 → 返回 patients[]
                 ↓ 导入表单
               POST /api/submit (同上)

  track.html ──GET /api/orders──→ 查看订单列表+详情（只读）

助理管理页 (labels.html)           服务端 API                      飞书 IM 通知
─────────────────────            ────────────                    ──────────
  确认订单 ──→ POST /api/admin/confirm → 状态→生产中
  质检完成 ──→ POST /api/admin/workflow/step
  扫码打印 ──→ POST /api/admin/print-queue → 入队 → pull-print.js 拉取→TCP
  批量打印 ──→ POST /api/admin/print-queue → 入队
  确认发货 ──→ POST /api/admin/ship → 状态→已发货 → 发货卡片
  标记签收 ──→ POST /api/admin/deliver → 状态→已签收 → 签收卡片
  导出ZIP  ──→ GET /api/admin/batch-zip → 多订单合并ZIP
  随货同行单──→ GET /api/admin/slip/:orderNo → A4 HTML
               GET /api/admin/slip-batch → 合单通行单

Admin 控制中心 (control.html)      服务端 API
──────────────────────────        ────────────
  仪表盘 Tab  ──→ GET /api/admin/dashboard → KPI + 图表
  规则 Tab    ──→ GET/POST /api/admin/rules → 读写规则参数
  执行 Tab    ──→ POST /api/admin/execute-rule → 手动触发规则（支持预览）
  AI 助手     ──→ MiMo Agent，内置规则知识

消费者验真
  verify.html ──GET /verify/:lensCode──→ 镜片码→镜片明细→订单主表→验真结果
```

---

## 三、数据模型

### 本系统表（共 14 张，全部在 Bitable `B3xQbbqicaome1sKdZbcwdk8nWg`）

表 ID 统一从 `../shared/tables.js` 引用（单一真相源），**禁止硬编码表 ID**。

```js
import { TABLES } from "../shared/tables.js";
```

#### 两张核心表

**订单主表** (`TABLES.order` / `tblk9Ch4gk2uQ1zG`) — 一患者一条

| 字段 | 类型 | 说明 |
|------|------|------|
| 订单编号 | 文本(主键) | `ORD-YYYYMMDD-XXXXXX`，下单时自动生成 |
| 终端客户 | 文本 | 终端客户机构名称 |
| 客户ID | 文本 | 终端客户在 Bitable 中的 ID |
| 下单日期 | 日期时间 | 下单时间戳 |
| 顾客姓名 | 文本 | 配镜顾客 |
| 产品型号 | 文本 | SKU 名称 |
| 序号 | 数字 | 第几副（同名同型号多副时区分），默认 1 |
| 数量 | 数字 | 镜片数量（片） |
| 是否装配 | 单选 | "是" / "否" |
| 代理商名称 | 单选 | 代理商全称 |
| 代理商ID | 文本 | `AG-XXX` |
| 备注 | 文本 | 每个顾客的特殊要求 |
| 收货地址 | 文本 | 终端客户收货地址 |
| 联系人 | 文本 | 收货联系人 |
| 联系电话 | 电话 | 联系电话 |
| 镜片码 | 文本 | 该订单的镜片码汇总 |
| 订单状态 | 单选 | 已下单→待处理→生产中→打标签→已发货→已签收 |
| 流程步骤 | 文本 | JSON，8步工作流状态+时间戳 |
| 预计交期 | 日期时间 | 系统估算的交货日期 |
| 订单来源 | 单选 | "代理商门户" |
| 物流公司 | 文本 | 顺丰/中通/韵达 |
| 快递单号 | 文本 | 物流单号 |
| 发货时间 | 日期时间 | 发货时间戳 |
| 签收时间 | 日期时间 | 签收时间戳 |
| 物流状态 | 单选 | 待处理/已发货/运输中/已签收 |
| 仓位 | 文本 | 自动匹配仓位编号（A1/A2/B1...），按收货地址匹配仓位映射表 |

**镜片明细表** (`TABLES.lens_detail` / `tblC7pve7ObFgIOl`) — 一眼一条

| 字段 | 类型 | 说明 |
|------|------|------|
| 镜片码(唯一) | 文本 | 16位HEX，唯一标识，终生不变 |
| 订单编号 | 文本 | 关联订单主表 |
| 镜片码 | 文本 | 与"镜片码(唯一)"相同 |
| 顾客姓名 | 文本 | 配镜顾客 |
| 产品型号 | 文本 | SKU |
| 序号 | 数字 | 第几副（同名同型号多副时区分），默认 1 |
| 眼别 | 单选 | "右眼" / "左眼" |
| 球镜SPH | 数字 | 处方球镜 |
| 柱镜CYL | 数字 | 处方柱镜 |
| 轴位AXIS | 数字 | 处方轴位 |
| 是否装配 | 单选 | "是" / "否" |
| 代理商名称 | 文本 | |
| 代理商ID | 文本 | |
| 订单状态 | 单选 | 与主表同步 |

**关联：** 两表通过 `订单编号` 关联；消费者验真走 `镜片码 → 镜片明细表 → 订单编号 → 订单主表`。

**铁律：镜片码一旦生成，终生不变，绝不允许回写/重新生成。**

#### 辅助表

| 表 | TABLES key | Table ID | 用途 |
|----|-----------|----------|------|
| 代理商表 | `agent` | `tblHsgGbJWkB31qu` | 代理商认证（ID/Token），CRM 同步来 |
| 终端客户表 | `customer` | `tbltXNNhF65EBl17` | CRM 同步 + 门户自动创建 |
| 产品型号 | `product_model` | `tblU25NQ3RuaJJfc` | 下单下拉选项，按排序号排列 |
| SKU 主数据 | `sku` | `tblwQsvGAahoeoJV` | 产品目录 |
| 规则配置 | `rule_config` | `tbl78V8wgziRs0pt` | 运行时规则参数覆盖 |

#### 度数级库存表（由 automations.js + server.js 共用）

| 表 | TABLES key | Table ID | 用途 |
|----|-----------|----------|------|
| 度数级成品库存 | `stock_detail` | `tbl7U79QGG4JtQev` | 核心！SKU×SPH×CYL → 片数+安全库存 |
| 备库参数表 | `stock_plan` | `tbluUfuETzwGdW1E` | 度数分布占比，理论备库计算源 |
| 排产计划 | `production` | `tblWu5QwGPK1zYMl` | 度数级工单（rule13/14 驱动） |
| 预测表 | `forecast` | `tblK2YNUZ3RM3Zta` | 周度销售预测 |
| 成品库存(旧) | `finished_inventory` | `tblUF49B6i53MV2O` | SKU级库存（已被度数级替代） |
| 毛坯库存 | `blank_inventory` | `tblrFIGHFVhTB16p` | 上游物料，批次级 |
| 模具台账 | `mold` | `tblfnVzOA2yFzbjs` | 单模独立寿命 |
| 采购表 | `procurement` | `tblZX1qW7RvcJieg` | 采购记录 |
| 车房表 | `factory` | `tblJ6RXFENJFQe9A` | 生产车间分配 |

#### 寄售库存表

| 表 | TABLES key | Table ID | 用途 |
|----|-----------|----------|------|
| 代理商库存 | `agent_stock` | `tblIEYUemBGIquVs` | 自有/寄售分拆 |
| 寄售流水 | `consignment_ledger` | `tblP9VObYpOMh1gD` | 入库/消耗/到期转收入 |
| 月度对账单 | `monthly_statement` | `tblvEIQ7IBCJw2iY` | 自动生成月度结算 |
| 库存流水 | `stock_movement` | `tblCoNeAbrz6tM9C` | 库存变动记录 |

#### 分析表

| 表 | TABLES key | Table ID | 用途 |
|----|-----------|----------|------|
| AI 分析记录 | `ai_analysis` | `tbl8W9F9K2RbaL0k` | MiMo 周分析输出 |

### 编号规则

| 编号 | 格式 | 生成时机 | 说明 |
|------|------|----------|------|
| 订单编号 | `ORD-YYYYMMDD-XXXXXX` | 下单时 | 日期 + 6位随机hex |
| 镜片码 | 16位大写HEX | 下单时 | `randomBytes(8)`，每片全球唯一 |
| 代理商ID | `AG-XXX` | CRM 签约时 | 与 CRM 的 D001-D045 编号对应 |
| 客户ID | `CUS-YYYYMMDD-XXXX` | 客户同步时 | 日期 + 4位随机hex |
| 快递单号 | `{前缀}{12位数字}` | 发货时 | SF顺丰/75中通/YD韵达/JD京东 |

---

## 四、库存与交期

### 度数级库存（统一走 stock_detail）

所有 SKU 的库存和交期判定统一走 `TABLES.stock_detail`（度数级成品库存表）。

- **粒度：** 一行 = `(SKU, SPH, CYL)` 唯一组合
- **AXIS 不入库存主键** — 散光毛坯通用，AXIS 后加工
- **度数常规范围：** SPH ∈ [-6.00, 0]（25档），CYL ∈ [-2.00, 0]（9档）
- **单 SKU 覆盖：** 25 × 9 = 225 行
- **当前 SKU：** Ultra双效、D8、时空之眼A/B/PRO/MAX、小旋风（共 7 个，1575 行）

### 交期三档

`/api/delivery-estimate` 端点**必须传 `sph` 和 `cyl` 参数**，统一走 `estimateDeliveryByRx()`：

| 情况 | 档位文案 | 交期天数 |
|------|---------|---------|
| 库存 ≥ 下单量 | `有货1-2天` | 2 |
| 度数在常规范围但库存 < 下单量 | `排产5-7天` | 7 |
| 度数超出常规范围 (SPH < -6 或 CYL < -2) | `定制7-10天` | 10 |

**铁律：禁止在前端做档位计算** — 档位由后端返回，前端只渲染。

### 库存扣减

- **下单即扣减** — withLock per-key 异步锁 + 锁内 fresh read + PATCH
- **库存不足不拦截下单** — 扣至 0 不阻断，照常走生产
- **幂等保护** — clientRequestId + 10min TTL 缓存，双击不重复扣
- **并发安全** — 两并发写同一度数不会 lost update

### 库存数量展示（UX 铁律）

- **默认不展示具体片数** — 防止代理商误判可拿量
- **仅在库存 ≤ 5 片时显示"仅剩 N 片"** — 提醒紧张
- **阈值常量：** `LOW_STOCK_THRESHOLD = 5`（见 `order.html`）

### 缓存

- 度数级库存缓存 TTL = **2 分钟**（`STOCK_TTL` in server.js）
- 缓存在 server 内存，多实例部署时各自独立（当前单实例无问题）

### 理论备库

公式：`理论备库 = max(ceil(月预测 × 季节系数 × 2 × 度数占比), 1)`

- 数据源：stock_plan 备库参数表（度数分布占比，每月一版本）
- 数据飞轮：`calc_stock_plan.js --months 3 --auto-apply` 从订单数据自动测算

---

## 五、模块划分

### 5.1 下单模块 (server.js — POST /api/submit)

```
前端表单(order.html) 或 Excel导入结果
  ↓ 提交 { requestId, token, terminalCustomer, patients[] }
  ↓
幂等检查（clientRequestId + 10min TTL 缓存）→ 命中直接返回
  ↓
验证代理商token + 必填字段
  ↓
生成订单号 ORD-YYYYMMDD-XXXXXX
  ↓
┌─ 订单主表：每个patient写1行（含流程步骤=submitted）
├─ 镜片明细表：每个patient的每只眼写1行（生成16位HEX镜片码）
├─ QR码图片 → public/qrcodes/
└─ 锁内扣减度数级库存（withLock → fresh read → PATCH）
    库存不够时扣至0，不阻断下单
```

### 5.2 查询模块 (server.js — GET /api/orders, /api/order/:no)

- `/api/orders?t=token` — 订单列表（从订单主表读，按状态/日期筛选）
- `/api/order/:no?t=token` — 订单详情（主表+镜片明细表联合）
- `track.html` — 代理商订单追踪页，只读

### 5.3 验真模块 (server.js — GET /verify/:lensCode)

**公开访问，无需登录。**

```
消费者扫码 → GET /verify/ABCDEF1234567890
  ↓
镜片明细表查找镜片码 → 订单编号 → 订单主表
  ↓
渲染验真页面（处方信息 + 订单信息 + 创建时间）
```

**已知坑：** 同名客户不同处方，过滤条件必须加产品型号（`customerName + sku`），不能只按姓名。

### 5.4 物流模块 (Web API + CLI 双入口)

**Web API：**

| 端点 | 功能 |
|------|------|
| `POST /api/admin/confirm` | 批量确认，状态→生产中，生成镜片码 |
| `POST /api/admin/ship` | 批量发货，自动生成快递单号，状态→已发货 |
| `POST /api/admin/deliver` | 批量签收，状态→已签收 |
| `GET /api/admin/ship-preview` | 发货前预览（处方+收货信息） |
| `GET /api/admin/slip/:orderNo` | 单订单随货同行单 HTML |
| `GET /api/admin/slip-batch` | 按日期+代理商批量通行单 |

**CLI 工具（备用）：** `node logistics.js ship / ship-batch / deliver / slip / slip-batch / status / webhook`

### 5.5 工厂导出模块

| 端点 | 功能 |
|------|------|
| `GET /api/order/:no/factory-zip` | 单订单 ZIP（Excel + QR + 标签） |
| `GET /api/admin/batch-zip?orderNos=X,Y,Z` | 多订单合并 ZIP |

### 5.6 标签打印模块 — 队列拉模式

**架构：** 服务器在华为云 ECS，打印机在本地局域网 → 云端入队 → 本地守护进程轮询 → TCP 发送

```
labels.html / 扫码枪
  ↓ POST /api/admin/print-queue（入队，支持 zpl/slip/test）
server.js printQueue（内存队列）
  ↑ GET /api/admin/print-queue/poll（每2s拉取）
pull-print.js（本地守护进程）
  ↓ TCP:9100 → 斑马 ZT410/ZT411
  ↓ POST /api/admin/print-queue/:id/done（回写完成）
  ↓ 全部完成后自动推进工作流→labeled
```

**打印内容：**
- ZPL 标签（Code128条形码 + QR验真码 + 处方数据）
- 随货同行单（自动打开浏览器打印）

**配置：** `pull-print-config.json`（服务器地址、admin token、打印机 IP、轮询间隔）

**队列管理 API：**

| 端点 | 功能 |
|------|------|
| `POST /api/admin/print-queue` | 入队 |
| `GET /api/admin/print-queue/poll` | 拉取待打印任务 |
| `POST /api/admin/print-queue/:id/done` | 回写完成/失败 |
| `GET /api/admin/print-queue` | 队列状态（UI用） |

### 5.7 Excel 解析模块 (POST /api/excel-parse)

纯代码解析（`xlsx` 库），列名模糊匹配，**不再走 AI**。

```
上传 Excel → XLSX 解析 → 模糊匹配列名 → 提取患者+处方
→ 同一顾客多行合并 → SKU 校验 → 返回 patients[]
```

### 5.8 规则引擎 (automations.js — 14条规则)

| # | 名称 | 类别 | 说明 |
|---|------|------|------|
| 1 | 订单处理 | 订单 | 交期判定+数量校验 |
| 2 | 成品库存预警 | 库存 | 低库存告警 |
| 3 | 模芯寿命预警 | 生产 | 剩余寿命告警 |
| 4 | 销售预测→排产 | 生产 | 周度预测+季节系数→工单 |
| 5 | 毛坯库存预警 | 库存 | 上游物料告警 |
| 6 | 订单超期预警 | 订单 | 超时未处理告警 |
| 7 | 采购自动触发 | 生产 | 毛坯/模芯低于安全线→采购 |
| 8 | 排产分配车房 | 生产 | 按专长分配生产任务 |
| 9 | 模芯使用累加 | 生产 | 完成→模芯已使用+1 |
| 10 | 寄售到期预警 | 库存 | 60天黄/90天红+写流水 |
| 11 | 月度对账单 | 库存 | 每月1-3日自动生成 |
| 12 | 度数级库存预警 | 库存 | 当前 vs 安全库存差额 |
| 13 | 度数级自动排产 | 生产 | 缺口→工单→分配车房 |
| 14 | 度数级库存回补 | 库存 | 完成→库存+产量→模芯累加 |

**参数存储双层设计：** `rules_config.json`（本地默认） + 飞书"规则配置"表（运行时覆盖，业务用户可直接改）

**执行方式：** CLI (`node automations.js rule1 / all / all -q --fresh`) + Admin 控制中心可视化执行

**数据飞轮：** `lens_detail(订单) → calc_stock_plan → stock_plan → apply → stock_detail.安全库存 → rule13 自动排产 → production → rule14 回补 → stock_detail += 产量 → 循环`

### 5.9 Admin 控制中心 (public/control.html)

4 Tab 单页应用：

| Tab | 功能 |
|-----|------|
| 仪表盘 | 告警 feed + 订单概览（待处理/超期/今日）+ 库存指标 + SKU达标率 + 打印队列 + TOP10缺口 + 排产单，2min缓存 |
| 规则管理 | 14条规则卡片（按订单蓝/库存绿/生产橙分组），参数可编辑，执行历史，预览执行 |
| 库存管理 | 代理商库存概览 + 自有/寄售分拆明细表 |
| 数据流 | 订单→库存→排产→回补飞轮 + CRM同步流 + 打印队列流 |

**API 端点：**
- `GET /api/admin/dashboard` — 仪表盘数据（订单+库存+排产+打印队列+告警，2min缓存）
- `GET /api/admin/alerts` — 完整告警 feed（超期订单/低库存/排产待回补/规则执行失败）
- `GET /api/admin/execution-history?limit=N` — 规则执行历史（内存，最多200条）

### 5.10 工作流可视化

订单行展开后水平 stepper（绿点=完成，蓝脉冲=当前，灰点=待办），hover 显示时间戳。

### 5.11 通知模块

- **下单通知：** 飞书 Webhook 发卡片
- **发货通知：** 飞书 IM API 发私信卡片
- **签收通知：** 绿色签收卡片

### 5.12 运维 API

| 端点 | 功能 |
|------|------|
| `GET /health` | 飞书连通性 / Bitable读写 / 代理商数 / uptime |
| `GET /ops/logs?tail=N` | 最近 N 条请求日志（内存缓冲 500 条） |
| `GET /ops/check-token` | 测试飞书 token + Bitable 连通性 |
| `POST /ops/restart` | process.exit(1) → Docker 自动重启 |

**自愈：** feishuApi() 收到 `code: 99991663` 或 `Invalid access token` 时自动清空缓存，下次请求立即刷新。

---

## 六、模块间关联图

```
              Excel 上传
                ↓
          Excel解析模块 ──导入表单──→ 下单模块 ──→ 订单主表 ──→ 物流模块(状态写入)
          (代码解析,xlsx)                        │  镜片明细表 ← 生成镜片码+QR
                                                 │       │
                                                 │       │ 订单编号(关联)
                                                 │       ↓
                                         批量导出模块   标签打印(队列拉模式)
                                         (batch-zip)  (入队→pull-print→TCP)
                                                 │       │
                                                 ↓       ↓
                                            工厂生产  斑马打印机
                                                 │
                                                 ↓
                                            物流模块(ship/deliver)
                                                 │
                                                 ↓
                                            飞书通知(发货/签收)
                                                 │
                                                 ↓
                                            验真模块(消费者扫码)

                              ┌──────────────────────────────────┐
                              │         度数级库存系统            │
                              │                                  │
                              │  stock_detail ←─ 下单扣减        │
                              │       ↑↓                         │
                              │  stock_plan  ←─ calc_stock_plan  │
                              │       ↓        (数据飞轮)         │
                              │  rule12 预警 → rule13 排产        │
                              │       ↓                          │
                              │  production → rule14 回补         │
                              │       ↓                          │
                              │  stock_detail += 产量 → 循环      │
                              │                                  │
                              │  blank_inventory ← rule5/7 预警   │
                              │  mold ← rule3/9 预警/累加         │
                              │  agent_stock ← rule10/11 寄售管理  │
                              └──────────────────────────────────┘
                                              ↑
                                     control.html
                                   (仪表盘/规则/AI)
```

---

## 七、管理页导航

### labels.html — 助理日常操作

| 功能 | 操作 | 说明 |
|------|------|------|
| 查看订单 | 打开页面自动加载 | 按状态/代理商/日期筛选 |
| 确认订单 | 勾选 → 点「确认订单」 | 状态→生产中，生成镜片码 |
| 导出工厂包 | 勾选 → 点「导出ZIP」 | 多订单合并为一个ZIP |
| 扫码打印 | 扫码栏扫条形码 | 自动入队打印标签 |
| 批量打印 | 勾选 → 点「斑马打印」 | 入队批量打印 |
| 确认发货 | 勾选 → 点「确认发货」 | 预览→确认→发货→通行单 |
| 随货同行单 | 已发货行点 📄 / 底部批量 | 单张或合单通行单 |
| 标记签收 | 勾选 → 点「标记签收」 | 状态→已签收 |

### control.html — Admin 控制中心

仪表盘（订单+库存+打印队列+告警） / 规则管理（参数+执行+历史） / 库存管理（代理商库存） / 数据流可视化（订单→排产→回补+CRM+打印）。

---

## 八、技术约束（铁律）

### 8.1 幂等性
- `POST /api/admin/confirm` 可以被多次调用 — 如镜片码已生成则跳过
- 任何写 Bitable 的端点都要假设会被重试，设计必须幂等
- 不要用"状态检查后再写"的朴素模式 — Bitable 无事务，并发会翻车

### 8.2 认证
- **代理商端：** URL 参数 `?t={token}`，token 存在代理商表
- **管理端：** URL 参数 `?admin={ADMIN_TOKEN}`（环境变量）
- 永远不要把 token 写进日志 / 错误消息 / 客户端 HTML
- `timingSafeEqual` 已引入，敏感比较必须用它

### 8.3 状态流转（单向，可逐级退回）
```
已下单 → 待处理 → 生产中 → 打标签 → 已发货 → 已签收（终态）
  ↑         ↑         ↑
  └─────────┴─────────┘  退回（逐级，不可跨级）
```
- **可退回状态** — 已下单/待处理/生产中可逐级退回上一步
- **不可退回** — 已发货、已签收（终态）
- **签收触发** — 顺丰回传自动触发（webhook）或助理手动确认

---

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
- **禁止跨级退回** — 不能从生产中直接退到已下单
- 订单主表状态和镜片明细表状态必须同步

### 8.4 Bitable 写入
- 批量操作用 `batch_create` / `batch_update`（上限 500 条/次），分页处理
- 写入前先读一次做去重 — Bitable 主键是系统 `record_id`，**不是**业务编号
- `订单编号`、`镜片码(唯一)` 的唯一性是**业务约定**，无数据库级约束，代码必须兜底
- 区分同订单多患者的复合键为 `订单编号 + 顾客姓名 + 序号`，全链路 filter/sort 必须包含这三个维度

### 8.5 前端
- `public/order.html` / `labels.html` 是核心页面，体量大
- **历史坑：** `order.html` 出现过重复 `const` 声明导致 JS 崩溃、`/api/terminal-customers` 慢加载阻塞渲染 — 改前先读完相关段落
- 不要在 HTML 内联大段 JS 时重名变量 — 先 grep 确认

### 8.6 Excel 解析
- 纯代码解析（`xlsx` 库 + 列名模糊匹配），**不再走 AI**
- 不要再往 `/api/excel-parse` 里加 AI 调用

### 8.7 代码风格
- ES Module（`import`/`export`），禁止 CommonJS
- 不要新增注释除非 WHY 不明显
- 不要为"未来扩展"抽象 — 按需求写最小实现
- 不要引入新依赖除非极必要（本项目刻意保持依赖最小）
- 不引入 Express、TypeScript、打包工具、前端框架 — 维持零构建

### 8.8 打印
- 标签/通行单走**队列拉模式**：server 入队 → 本地守护进程轮询 → TCP 发打印机
- 不走服务端直连（华为云 ECS 无法访问本地局域网打印机）

---

## 九、启动与部署

### 本地启动

```bash
node server.js            # 主服务，端口 3210
NODE_ENV=test node server.js  # 连测试 Bitable
node logistics.js webhook # 快递回调，端口 3211（可选）
node pull-print.js        # 打印守护进程（需在本地打印电脑运行）
```

### 环境变量（`../shared/.env`）

| 变量 | 用途 |
|------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Bitable 读写 |
| `NOTIFY_APP_ID` / `NOTIFY_APP_SECRET` / `NOTIFY_CHAT_ID` | 飞书通知 |
| `ADMIN_TOKEN` | 管理页密码 |
| `SERVER_BASE_URL` | QR 验真链接的外网地址 |
| `MIMO_API_URL` / `MIMO_API_KEY` | AI 功能（MiMo Agent） |
| `PORT` | 覆盖默认 3210 |
| `NODE_ENV` | 设为 `test` 切换 `shared/tables.js` 到测试 Bitable |

### Docker 部署

- 华为云 ECS（gaush-lab）：`lab.gaushclear.com`（HTTPS，证书到期 2026-07-18）
- SWR 镜像：`swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1`
- 生产容器：order-app(:3210) + mock-shuang(:3220)，仅 127.0.0.1
- 测试容器：order-app-test(:3211) + mock-shuang-test(:3221)，nginx `/test/` 代理
- 测试 Bitable App Token：`CtXObqwAHaCXYssBBfkcXmrlnUe`
- 构建需 `--provenance=false`（SWR 不兼容 BuildKit attestation）

### 部署流程

详细步骤见 `DEPLOY.md`（SWR 登录、构建、推送、ECS 更新全流程）。

---

## 十、目录导航

### 常改的
- [server.js](server.js) — 主后端（所有 API 端点，~2500行）
- [automations.js](automations.js) — 14条业务规则引擎
- [public/order.html](public/order.html) — 代理商下单页
- [public/labels.html](public/labels.html) — 助理管理页（确认/发货/签收/标签/通行单）
- [public/control.html](public/control.html) — Admin 控制中心（仪表盘/规则/库存/数据流，4 Tab）
- [public/track.html](public/track.html) — 代理商追踪页（只读）
- [public/verify.html](public/verify.html) — 消费者验真页
- [logistics.js](logistics.js) — 物流 CLI + 通行单模板
- [pull-print.js](pull-print.js) — 打印守护进程（本地运行）
- [rules_config.json](rules_config.json) — 规则参数本地默认值

### 偶尔碰的
- [sync_*.js](.) — CRM/旧订单同步脚本
- [ai_analysis.js](ai_analysis.js) — AI 周分析
- [dashboard.js](dashboard.js) — KPI 看板
- [print_labels.js](print_labels.js) — 标签生成（HTML 路径，工厂用）

### 一次性脚本（谨慎动）
- `migrate_*.js`、`seed_*.js`、`import_*.js`、`setup_tables.js` — 初始化/迁移
- `test_*.js`、`run_*.js`、`e2e_*.mjs` — 测试脚本

### 文档
- [CRM-CLAUDE.md](CRM-CLAUDE.md) — CRM 系统结构
- [../inventory-system/CLAUDE.md](../inventory-system/CLAUDE.md) — 库存系统结构
- [../ARCHITECTURE-OVERVIEW.md](../ARCHITECTURE-OVERVIEW.md) — 三系统全景
- [docs/](docs/) — 设计稿 / 历史方案 / 部署报告

---

## 十一、常见任务的起点

| 任务 | 从哪开始 |
|------|----------|
| 加一个管理端操作 | server.js 找 `/api/admin/*` 端点，照抄现有模式；前端 `labels.html` 加按钮 |
| 改订单字段 | 同时改 server.js 的写入 + 本文件的字段表 |
| 改状态流转 | **先停下来问用户** — 状态机变动影响所有端 |
| 改 Bitable 结构 | 写一个新的 `migrate_*.js` 脚本，不要手动改 Bitable UI |
| 排查消费者扫码报错 | server.js 的 `/verify/:lensCode` 端点 + 浏览器 Network |
| 新增/修改库存 | 看 `../inventory-system/CLAUDE.md` 的迁移脚本 |
| 调整业务规则参数 | 打开 `/control?admin=TOKEN`，在规则 Tab 直接改 |
| 手动触发规则 | `/control` 的执行 Tab，选规则点执行（支持预览） |
| 打印相关改动 | 标签/通行单走**队列拉模式**：server 入队 → pull-print.js 轮询 → TCP |
| 调整交期档位 | `server.js:estimateDeliveryByRx` |
| 新增/停售 SKU | 直接在 Bitable `产品型号` 表增删记录，不用改代码 |

---

## 十二、历史坑与记忆

- **order.html 重复 const 声明** → JS 崩溃，白屏。改前 `grep` 确认变量名唯一
- **/api/terminal-customers 同步加载** → 阻塞首屏渲染。必须异步加载且不堵死下单流程
- **验真页同名混入** → 同名客户不同处方，过滤条件加产品型号（`customerName + sku`），不能只按姓名
- **飞书 Token 缓存 bug** → 获取失败时 `_feishuToken` 为 undefined 但时间戳已刷新，导致 7000 秒内全部请求失败。修复：只在获取成功时更新时间戳
- **Docker BuildKit attestation** → 不兼容 SWR，构建需 `--provenance=false`
- **server.js loadEnv()** → 读文件不读 process.env，.env 必须挂载到 /app/.env
- **标签打印** → 华为云 ECS 无法直连本地打印机，必须走队列拉模式

---

## 十三、与 Claude 协作的偏好

- 回答简短 — 不要在每次改完后写总结段落，用户会看 diff
- 改 `server.js` 这种大文件前，用 `grep` 或 `Read` 限定行范围定位，不要全量 read
- 新任务开新会话，不要在同一会话堆积
- 读过的文件记住内容，不要重复 read
- 动手前先想最少需要多少数据/API 调用
