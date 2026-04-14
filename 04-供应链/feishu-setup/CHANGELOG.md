# Changelog

## [2026-04-14] Excel 处方自动解析下单（MiMo 大模型）

### 需求

代理商从医院拿到的处方单通常是 Excel，手动录入费时。上传 Excel → AI 自动提取患者+处方 → 一键导入表单。

### 交付物

| 模块 | 文件 | 说明 |
|------|------|------|
| 后端 API | `server.js` | `callMiMo()` + `handleExcelUpload()` + `POST /api/excel-parse` |
| 前端 | `order.html` | 上传Excel按钮 + 解析结果弹窗 + 一键导入表单 |
| 环境配置 | `shared/.env` | 新增 `MIMO_API_URL` + `MIMO_API_KEY` |

### 功能详情

**Excel 解析流程：**
1. 代理商点击「上传Excel」按钮（在"顾客订单"卡片标题旁）
2. 前端 FileReader 读取 base64 → POST /api/excel-parse
3. 后端 XLSX 解析原始行数据（前50行）
4. MiMo mimo-v2-pro 大模型提取结构化处方 JSON
5. 后处理：SKU 校验（对比产品目录）+ 数值归一化（SPH 0.25步长、AXIS 0-180）
6. 前端弹窗展示解析结果表格（患者名、SKU、左右眼 SPH/CYL/AXIS）
7. 点击「导入表单」→ 自动填充所有患者卡片 → 关闭弹窗

**技术选型：**
- LLM：小米 MiMo mimo-v2-pro（OpenAI 兼容格式，直接 fetch 调用）
- 文件传输：Base64 in JSON body（无 multipart，零新依赖）
- Excel 解析：复用已安装的 `xlsx` 库

### 测试结果

```
测试 Excel（3患者）:
  张三 | Ultra双效 | 右眼 -2.75/-1.00/90 | 左眼 -3.00/-0.75/85 ✅
  李四 | D8 | 右眼 -5.00/-1.25/180 | 左眼 -4.75/-1.00/170 ✅
  王五 | Ultra双效 | 右眼 -1.50/-0.50/45 | 左眼 -1.75/-0.50/50 ✅
  → 3位患者全部正确解析
  → SKU 匹配产品目录
  → 数值归一化正常
```

---

## [2026-04-14] 系统拆分：订单交付 + 供应链独立

### 决策

三系统解耦：订单交付系统（6.30前完成）、CRM系统（下半年）、供应链系统（下半年）。共享编码规则，不共享数据库。

### 拆分结构

```
feishu-setup/
├── order-system/     订单交付系统（立即开发）
├── supply-chain/     供应链同步（6.30后启动）
└── shared/           共享配置（.env、migrate_tables.js）
```

### 变更

| 操作 | 说明 |
|------|------|
| 移动文件 | agent-portal/ → order-system/，sync_*.js → supply-chain/ |
| 更新路径 | server.js 等 .env 引用从 `../.env` 改为 `../shared/.env` |
| 新增 README | order-system/README.md、supply-chain/README.md |
| 更新 README | 顶层 README.md 改为项目概览+目录索引 |

### 原则

- 改订单系统字段只动 `order-system/` 下的文件
- 供应链同步脚本 6.30 前不维护
- `migrate_tables.js` 保留在 shared/，迁移时两个系统都会用到

### 字段精简 + 关联统一

订单主表删除冗余字段（来源订单号/同步时间/眼别/球镜SPH等），保留纯订单级信息。处方数据只在镜片明细表。

- 镜片明细表关联字段 `来源订单号` 改名为 `订单编号`，与主表统一
- server.js / logistics.js 全部适配新字段名
- logistics.js 随货通行单改从镜片明细表读处方数据
- 验真页面改从镜片明细表获取处方

### 架构文档

新增 `order-system/ARCHITECTURE.md`，覆盖 E2E 全链路 7 步、数据模型、6 个模块说明、模块关联图

---

## [2026-04-14] Sprint 15：终端客户选择 + 下单表单改版

### 需求

代理商门户下单页面改版：增加终端客户选择功能（数据从CRM同步），支持联系人/电话/地址自动带出；调整表单字段结构。

### 交付物

| 模块 | 文件 | 说明 |
|------|------|------|
| Bitable字段 | `migrate_tables.js` Migration 14 | 终端客户表新增 联系人/联系电话/收货地址 |
| CRM同步 | `sync_customers.js` | 扩展同步省份/城市；CRM补联系人/电话/地址字段后自动读取；增量更新已有客户 |
| 后端API | `server.js` | 新增 `GET /api/terminal-customers`（含联系人/电话/地址）；submit 校验终端客户/联系人/电话必填；镜片明细写入轴位+是否装配 |
| 前端表单 | `order.html` | 终端客户选择→自动带出联系人/电话/地址；去掉镜框型号；每顾客独立备注；是否装配每顾客一个复选框 |

### 表单字段（最终版）

**收货信息（全部必填）：**
- 终端客户（datalist，选中自动带出联系人/电话/地址）
- 联系人
- 联系电话
- 收货地址（支持历史地址自动补全）

**每个顾客：**
- 顾客姓名、产品型号、数量
- 右眼：球镜 SPH + 柱镜 CYL + 轴位 AXIS
- 左眼：球镜 SPH + 柱镜 CYL + 轴位 AXIS
- 是否装配（复选框）
- 备注（选填）

### 同步结果

- Migration 14：3个字段创建成功
- sync_customers：439个客户更新省份/城市

---

## [2026-04-14] Sprint 14b：真实订单验证 + SKU 产品目录修复

### 问题

运城眼科医院真实订单（7顾客14片 Ultra双效）首次提交被拒："没有有效的订单数据"。

根因：前端 `order.html` 硬编码 4 个 SKU（Ultra/时空之眼A/B/小旋风），与 Bitable SKU 表的 100 条真实数据完全脱节。前端从未调用 `GET /api/skus`。旧版 submit handler 有 SKU 精确匹配校验，真实产品名"Ultra双效"在硬编码列表中不存在，导致全部订单项被跳过。

### 修复

| 文件 | 改动 | 说明 |
|------|------|------|
| `server.js` | 新增 `getModelSkus()` | 过滤产品级 SKU（无空格 = 产品级，有空格 = 处方级） |
| `server.js` | `/api/skus` 支持 `?models` | 前端调 `?models` 只返回 ~5 个产品级 SKU |
| `server.js` | submit handler 恢复完整逻辑 | `getSkusWithInventory()` + `estimateDelivery()` + 库存扣减 + 交期字段 |
| `server.js` | SKU 软校验 | 不匹配则 warn 日志，不拒绝订单 |
| `order.html` | 动态 SKU 下拉框 | 删除硬编码，从 `/api/skus?models` 加载真实产品目录 |
| `order.html` | 库存状态标识 | 下拉框显示 ✓有货 / 低库存 / 缺货 |

### 验证结果

```
运城眼科医院（AG-028 深圳视力康）
→ 7顾客 / 14片 Ultra双效
→ 下单即生成14个镜片码 ✅
→ SKU = "Ultra双效" 匹配 Bitable 产品目录 ✅
→ 交期估算正常（标准，预计 2026/04/19）✅
→ 订单主表 7条 + 镜片明细 14条 ✅
```

---

## [2026-04-14] Sprint 14：代理商管理迁入Bitable + 门户架构切换

### 架构决策

废弃旧订单表同步，门户下单为唯一订单源。代理商数据从 agents.json 迁入飞书多维表格，CRM自动同步。

### 今日交付物

| 模块 | 文件 | 说明 |
|------|------|------|
| 代理商表 | Bitable `tblHsgGbJWkB31qu` | 10字段，CRM同步+门户管理，41条记录 |
| CRM代理商同步 | `sync_agents.js` | 双token读CRM "01_代理商开发管理"，增量同步 |
| 门户改造 | `agent-portal/server.js` | loadAgents()从Bitable读取，异步化，30s缓存 |
| 数据迁移 | `migrate_agents_to_bitable.js` | 一次性脚本，agents.json→Bitable，保留token向后兼容 |
| 同步编排 | `sync_all.js` | 3步同步：1/3代理商→2/3客户→3/3订单 |
| 环境配置 | `.env` | 新增 CRM_AGENT_TABLE + AGENT_TABLE |

### 功能详情

#### 1. 代理商表（Bitable `tblHsgGbJWkB31qu`）

字段设计：
- 代理商ID（AG-XXX）、代理商名称、CRM_ID（D001-D045）
- 下单Token（门户认证）、手机号、地址
- 状态（启用/停用）、CRM同步时间、来源系统、备注

#### 2. CRM代理商同步（`sync_agents.js`）

- 数据源：CRM "01_代理商开发管理"（RlfTb6gykaEb3gsR1lwcGnShnAA / tblWmD23R4djdAlW）
- 筛选"是否签约=是"的代理商（41条）
- 已存在（按CRM_ID匹配）：更新名称+地址，**不覆盖**Token/手机/状态/备注
- 新代理商：生成AG-XXX ID + token，状态=启用
- CRM已删除：状态=停用（软删除）
- 无CRM_ID的代理商（如测试代理商）：跳过不动

#### 3. 门户改造（`server.js`）

- TABLES 新增 agent 表
- loadAgents() 改为 async，从 Bitable 读取，只加载状态=启用的代理商
- findAgent() 改为 async，12个调用点全部加 await
- 保持 `{ id, name, token, phone, address, crm_id }` 接口不变，下游零修改

#### 4. 旧数据处理

- 869条旧表同步订单保留在订单主表，不拆分镜片明细
- 门户新下单双写：订单主表 + 镜片明细表
- 旧订单表同步（sync_orders.js）标记为可停止

### 架构优化：下单即生成镜片码

镜片码生成从"确认环节"提前到"下单环节"，`POST /api/submit` 写完镜片明细后立即调用 `assignLensCodes()`，同步生成16位HEX码+QR。确认端点 `POST /api/order/:orderNo/confirm` 保留为幂等兜底（已有码自动跳过）。

- `assignLensCodes()` 提取为独立函数，下单+确认两处复用
- 确认端点删除旧模式兼容逻辑（直接写主表），统一走镜片明细表
- 下单端点新增镜片码汇总写入主表

### E2E测试结果

```
5代理商 × 2单 = 10单 / 20片镜片
→ 下单即生成20个16位hex镜片码+QR（不等确认）
→ 确认（幂等跳过已有码）
→ 合单发货（5代理商→5个包裹）
→ 签收（飞书通知）
全链路 ✅
```

### 管理方式

| 场景 | 方法 |
|------|------|
| CRM签约新代理商 | sync_agents.js 自动同步 |
| CRM解约代理商 | 状态→停用，token 30秒内失效 |
| 手动添加代理商 | Bitable UI 直接新建 |
| 修改代理信息 | Bitable UI 直接编辑 |
| 重新生成token | Bitable UI 修改"下单Token"字段 |

---

## [2026-04-14] Sprint 13：CRM真实数据同步 + 三系统数据打通

### 今日交付物

| 模块 | 文件 | 说明 |
|------|------|------|
| 代理商数据 | `agent-portal/agents.json` | 7个虚构代理商 → 40个CRM真实代理商（D001~D045，已签约） |
| CRM客户同步 | `sync_customers.js` | 双token模式（CRM App读+供应链App写），同步528个终端客户 |
| 订单同步 | `sync_orders.js` | Link字段文本提取、本地日期过滤，同步869条本月订单 |
| 字段映射 | `field_mapping.json` | 填入旧订单表token+6个字段名，正式生效 |
| 环境配置 | `.env` | 新增CRM_APP_ID/CRM_APP_SECRET（独立CRM应用凭证） |

### 功能详情

#### 1. CRM真实代理商导入（`agent-portal/agents.json`）

从CRM"01_代理商开发管理"表读取40个已签约代理商，替换原有虚构数据。
- ID格式：AG-xxx（与CRM的D###编号对应，如D007→AG-007）
- 字段：name（代理商名称）、address（省份）、crm_id（CRM编号）
- 保留AG-002测试代理商
- 未签约的D043/D044、无名称的D036/D040已排除

#### 2. CRM客户同步（`sync_customers.js`）

- 数据源：CRM "02_终端开发和管理"（RlfTb6gykaEb3gsR1lwcGnShnAA / tblQidjfbGA8DDkJ）
- 双token架构：用CRM App凭证读取CRM数据，用供应链App凭证写入供应链
- 客户性质→客户类型映射：医院→眼科医院，门诊/门店→眼镜门店
- 结果：新建528个客户，跳过9个已有
- 来源标记："CRM同步"

#### 3. 订单同步修复（`sync_orders.js`）

- 修复字段名：`状态` → `订单状态`（与Bitable实际字段名匹配）
- Link字段处理：飞书Link字段已包含text属性，直接提取无需额外API查询
- 日期过滤改为本地过滤（飞书filter语法对日期字段不可靠）
- 结果：写入869条本月订单，跳过205条重复，85条TextFieldConvFail（旧表数据质量问题）

#### 4. field_mapping.json 正式生效

```json
{
  "OLD_APP_TOKEN": "QrY0bFlW2abXjKsLYFtcBznkn1G",
  "OLD_TABLE_ID": "tblc9uHyRzrc6vu1",
  "fields": {
    "旧_订单号": "销售订单号",
    "旧_客户名": "客户名称",
    "旧_SKU": "产品料号",
    "旧_数量": "数量/副",
    "旧_下单日期": "接单日期",
    "旧_状态": "订单状态"
  }
}
```

### 验证结果

| 验证项 | 结果 |
|--------|------|
| CRM客户同步 | 528个客户写入供应链终端客户表 |
| 本月订单同步 | 869条订单写入供应链订单表 |
| 9条业务规则 | 全部运行正常，无报错 |
| 代理商数据 | 40个真实代理商，portal可用 |

### 遗留

- ~85条订单TextFieldConvFail（旧表订单号字段值格式异常，需单独清理）
- 供应链订单表中有一条测试记录（来源订单号TEST-ORDER-001），待删除

---

## [2026-04-13] Sprint 12：物流全链路 + 随货通行单 + 合单发货

### 今日交付物

| 模块 | 文件 | 说明 |
|------|------|------|
| 物流全链路 | `logistics.js` | ship / deliver / status / slip / ship-batch / slip-batch |
| 随货通行单 | `logistics.js → slipHTML()` | A4单眼/合单两种，含处方+镜片码+QR+签收栏 |
| 合单发货 | `logistics.js → shipBatch()` | 按代理商合并，一包一单号，飞书汇总通知 |
| 飞书私信 | `send_dm_test.js` + `logistics.js → notify()` | 改用 DM API，蓝色发货卡+绿色签收卡 |
| 标签预览 | `docs/label-preview.html` | 80mm×50mm，红/蓝双眼主题，3×屏幕预览 |
| 批量标签 | `print_labels.js` | A4批量打印，3列×2行，带@page CSS |
| 全流程E2E | `run_full_e2e.js` | 一键：下单→确认→合单发货→通行单→签收 |
| 批量测试 | `test_factory_batch.js` | 5代理商×2单=10单，Excel汇总 |
| 拆表迁移 | `migrate_split_tables.js` | 订单主表+镜片明细表，已 dry-run 验证 |

---

### 功能详情

#### 1. 物流全链路（`logistics.js`）

**命令列表：**
```bash
node logistics.js migrate          # 添加物流字段
node logistics.js ship             # 逐单发货（生产中→已发货，生成快递单号）
node logistics.js ship-batch       # 合单发货（按代理商合并，一包一单号）
node logistics.js deliver --order ORD-xxx   # 模拟签收
node logistics.js status           # 物流汇总表
node logistics.js slip --order ORD-xxx      # 单订单随货通行单
node logistics.js slip-batch [--agent AG-xxx]  # 合单随货通行单
node logistics.js webhook          # 快递回调服务（3211端口）
```

**快递自动分配规则：**
- AG-003（北京）/ AG-006（成都）→ 顺丰
- AG-005（广州）→ 中通
- 其余 → 顺丰（默认）

#### 2. 随货通行单设计

- **单订单版**（`slip`）：A4，含双眼处方行、QR溯源码、物流信息、三栏签收区
- **合单版**（`slip-batch`）：A4，表头显示代理商+包裹信息，表体按订单+顾客展开所有眼别，含订单汇总小表

#### 3. 合单发货逻辑

```
当日待发货（N单） → 按代理商ID分组 → 每组共用一个快递单号
5代理商 → 5个包裹 → 5条飞书发货通知（每条列出组内所有订单+顾客）
```

#### 4. 飞书私信通知

- 使用独立 App（`NOTIFY_APP_ID`）发私信，不依赖 Webhook
- 蓝色卡片：发货通知（订单号、快递单号、镜片码、预计到达）
- 绿色卡片：签收通知（签收时间、全链路完成提示）
- 接收人：`NOTIFY_OPEN_ID=ou_436cb656a968038106a6df7e1ea17b62`

#### 5. 数据模型讨论 → 拆表决策

分析一眼一条 vs 一人一条的优劣，结论：

| 约束 | 结论 |
|------|------|
| 飞书单表上限 ~5万行 | 任何方案都在1年内触顶 |
| 镜片追溯/标签/生产工单 | 一眼一条最直接 |
| 订单状态/物流管理 | 一单一条最清晰 |
| **最终方案** | **订单主表（一单一条）+ 镜片明细表（一眼一条）** |

`migrate_split_tables.js` 已 dry-run 验证（174条→31单）；实际迁移待执行。

---

### 今日 E2E 测试结果

```
9个订单 / 18片镜片 / 5个代理商
→ 5个包裹（顺丰×4 + 中通×1）
→ 5条飞书发货通知 + 9条飞书签收通知
→ 12张随货通行单 HTML（全含处方明细+QR+签收栏）
→ 全部状态：✅ 已签收
耗时：约 205 秒（含飞书API写入）
```

---

### 下一步（待办）

- [ ] 执行 `migrate_split_tables.js` 正式拆表
- [ ] 更新 `server.js` / `logistics.js` 使用新表 ID
- [ ] 订单主表按年分表策略（2026/2027）
- [ ] 代理商地址管理（`agents.json` 加 address 字段）

---

## [2026-04-12] 今日效率复盘

今天完成 Sprint 11 全部工作（QR 溯源整合 + 工厂包升级 + 端到端文档），3 个 commit，效率高的原因：

1. **迭代清晰，每轮一个闭环** — Sprint 10（下单门户）→ Sprint 11（QR 整合）→ 工厂包升级，每步都能跑通再进下一步，没有返工
2. **技术选型果断** — 不引入 Python/Canvas/native 依赖，全用纯 JS（qrcode + xlsx + 手写 ZIP），零安装成本，零兼容问题
3. **复用已有基础设施** — 飞书 API、token 认证、静态路由、ZIP builder 都是现成的，新功能直接往上加，不用重建地基
4. **问题定位快** — 路由冲突 bug 一次就找到根因（`startsWith` 拦截子路径），修一行代码解决
5. **即时验证** — 每改完一步立刻 curl 测试，不攒问题。确认→QR→ZIP→验真，每个环节独立验证通过才进下一个
6. **文档自动化** — 报告和 PDF 都是代码生成的，不需要手动整理
7. **上下文管理好** — 没有在无关事情上消耗 token，所有对话都围绕交付物

---

## [2026-04-12] Sprint 11 v2：工厂导出包升级（Excel + 可打印标签）

**修改文件**
- `agent-portal/server.js` — 新增 `buildFactoryExcel` + `buildLabelHtml`，重写 `buildFactoryZip`，删除死代码 `generateLabelPng`

### 变更内容

**Excel 导出**
- 工厂 ZIP 包内新增 `订单_<orderNo>.xlsx`（18KB，14列）
- 列：订单号、顾客、SKU、数量、眼别、SPH、CYL、AXIS、瞳距、瞳高、镜框型号、镜片码、交期类型、收货地址
- 使用已安装的 `xlsx` 库生成（无新依赖），工厂可直接导入排产系统

**可打印标签**
- 标签从简单 QR 图片升级为 HTML 格式（QR + 处方文字）
