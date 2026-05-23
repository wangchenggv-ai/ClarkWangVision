# CHANGELOG

## 2026-05-23 — 财务模块封存，改用飞书低代码

### 删除的代码
- **7天自动签收定时任务**：`server.js` 中 `setInterval` 定时任务（每天凌晨3点检查）
- **7天自动签收API**：`POST /api/admin/auto-receipt` 端点
- **对账单API**：`GET /api/admin/reconciliation` 端点

### 修改的文件
- `server.js`：删除上述三个代码段
- `shared/tables.js`：财务相关5个表ID置空（agent_pricing、agent_deposit_log、return_exchange、rebate_rule、rebate_record）

### 原因
- 避免过早耦合，财务功能用飞书低代码即可实现
- 飞书自动化可实现：定时签收、扣款流水、余额汇总
- 飞书筛选视图可实现：对账单导出
- 减少代码维护，降低系统复杂度

### 飞书低代码方案
| 功能 | 实现方式 |
|------|----------|
| 7天自动签收 | 飞书自动化（定时触发器） |
| 对账单 | 飞书筛选视图 + 汇总行 |
| 定价表 | 新建表 + 公式字段 |
| 预存款 | 新建表 + 汇总字段 + 自动化 |
| 退换货登记 | 新建表 |
| 返利 | 新建表 + 公式字段 |

## 2026-05-23 — OEM品牌验真暂不启用

### server.js
- **移除 `终端门店` 写入 lens_detail**：confirm 端点不再写入 `终端门店` 字段到镜片明细表（字段尚未维护）
- **移除 `镜片码状态` 写入 lens_detail**：confirm 端点和批量导入端点不再写入 `镜片码状态` 字段（字段不存在）
- **验真页面始终显示高视高清品牌**：由于 `终端门店` 字段未维护，`getBrandByStoreName("")` 返回默认品牌

### 原因
- 铂视控OEM品牌验真功能已完成代码，但终端门店字段尚未维护
- 写入不存在的字段导致 `FieldNameNotFound` 错误，镜片码无法生成
- 暂不启用该功能，等终端门店维护完成后恢复相关代码

### 测试结果
- ✅ 镜片码正常生成（16位HEX）
- ✅ 状态正确更新（已下单→打标签）
- ✅ 验真页面显示高视高清品牌
- ✅ E2E 测试通过

## 2026-05-22 — orders.html 四项优化 + 重复记录根因分析

### orders.html / server.js（已部署测试环境 :3211，待部署生产）
- **装配筛选器**：选项从"已装配"/"未装配" → "是"/"否"，与 Bitable 实际字段值一致
- **导出按钮**：移除 `ctx-btn`（始终显示），改名"导出Excel给打标签"
- **高清直达打标签**：`quickConfirm` 检测 supplier="高清" → targetStatus 直接设为"打标签"（前端）；`/api/admin/confirm` 端点新增 `existingSupplier === "高清"` 分支，设 confirmTargetStatus="打标签"/wfStep="labeled"（后端）
- **导出状态筛选器**：新增 `filterExport` 下拉（已导出工厂/未导出工厂/已导出打标签/未导出打标签），客户端利用 `exportStatusMap` 过滤

### 重复记录根因分析（生产 Bitable 订单主表）
- 根因：`processPendingDrafts` 无幂等检查 + `feishuApi` 原 10s 超时（已改 15s），大批次写入超时但数据实际已写入 → 重试 → 20 倍重复
- 影响范围：4/30–5/9 订单，488 unique 组合，实际 10000 条（需删 9512 条）
- 清理脚本 `dedup_orders.mjs` 已写好并上传生产容器，dry-run 验证正确
- **执行失败**：非 dry-run 全批次报 `RecordIdNotFound (1254043)`，共删 0 条，原因待诊断
- 诊断脚本 `C:\Users\wangc\diag_records.mjs` 已准备好，下次会话继续

## 2026-05-19 — 配货单（仓库拣货单）

仓库拣货用配货单，按货位路径排序，分区显示。

- `lib/templates.js` 新增 `binSortKey()` 和 `picklistHTML()` 两个导出函数
- `picklistHTML` 输出 A4 可打印 HTML，按 A/B/C 区分组，每区内按货架→层→列排序
- `server.js` 新增 `GET /api/admin/picklist?orderNos=ORD-xxx,ORD-yyy` 端点，拉取镜片明细 → 调 `lookupBySphCyl` 查序列号+货位 → 排序后返回 HTML
- `public/labels-print.html` 在操作栏新增「配货单」按钮（`picklistSelected()`），多选订单后在新标签页打开
- 非 Ultra双效 SKU 序列号/货位显示"—"（sku-serial.js 暂只覆盖 Ultra双效）

✅ 已部署 ECS（2026-05-19）

## 2026-05-19 — Phase 0 地基：SKU三层定义 + sku_location 数据完善

**不涉及 ECS 部署，均为文档/表结构/数据补全工作。**

- `shared/tables.js` 顶部插入 SKU 三层数据模型注释（Layer1 ProductSKU / Layer2 StockSKU / Layer3 LensItem），全局约定不得绕过
- `order-system/ARCHITECTURE.md` 末尾新增「状态机 × 库存操作对照表」，明确 reserveStock/releaseReservation/convertReservation 的触发时机和 server.js 行号
- `ARCHITECTURE-OVERVIEW.md` 末尾新增「数据 Master 方向约定」表，标明 CRM↔订单 各字段的写入源、消费方、同步方式及缺失状态
- `sku_location` 表（tblTbLuC3VI0ISKH）新建 `ProductSKU` 字段（文本），批量回填所有219条记录为"Ultra双效"
- `inventory-system/migrate_sku_location.js` 新增迁移脚本，支持 `--product-sku` 和 `--dry-run` 参数，供多产品场景重导使用

## 2026-05-14 — 标签导出Excel加仓位列

标签Excel导出（`/api/admin/labels/export-excel`）新增"仓位"列，位于"日期"和"数量"之间。仓位从收货地址通过`matchBin()`自动匹配。涉及文件：`server.js` + `lib/factory-export.js` ✅ 已部署 ECS

## 2026-05-14 — 暑期备库模拟器

独立网页工具，从订单系统解耦。

### 功能
- 输入备库总数 + A/B/C比例（默认75/20/5，A+B+C=100%校验，A+B<85%警告）
- 25×9 SPH×CYL热力图，最大余额法精确分配
- ABC颜色标注 + 行列合计
- 下载Excel：Sheet1备库订单（可编辑），Sheet2 ABC参考
- 无需登录，纯前端单HTML文件

### 文件
- `public/summer-stock-tool.html` — 前端页面
- `server.js` — 新增 `/summer-stock-tool` 路由

### 部署
- `https://lab.gaushclear.com/summer-stock-tool`

---

## 2026-05-14 — E2E 测试验证 + binCode bug 修复 + 测试文档

### E2E 测试（三个新功能）
- 测试订单：ORD-20260514-D5886B32
- **签收终态** ✅：已发货→已签收，状态机正确
- **标签SKU条码** ✅：格式 TKAP-250-075、TKAP-300-100
- **仓位自动赋码** ✅：orders API 返回 binCode
- 13/13 断言全部通过

### binCode bug 修复
- **问题**：orders API 不返回 binCode，labels-print 仓位列为空
- **修复**：server.js orders API 添加 `matchBin(address)` 计算仓位
- **部署**：已推送到 ECS 生产环境

### 测试文档
- 新增 `docs/新功能测试指引-2026-05-14.md`
- 包含三个功能的分步测试指引、对照表、完整流程测试

## 2026-05-12 — 仓位系统设计 + 本地生产代码同步

### 仓位系统设计（未部署）
- 设计文档：`docs/仓位系统设计-2026-05-12.md`
- **核心逻辑**：一个收货地址 = 一个仓位 = 一张通行单
- **流程**：导出 Excel 时按地址分组分配仓位号（A1, A2...）→ 标签印仓位号 → 配货扫码分拣 → 通行单按仓位分组
- **两阶段**：第一阶段仓位分配+通行单，第二阶段地址库校验
- 代码改动未部署，仅保存设计文档

### 对账单系统设计（未部署）
- 设计文档：`docs/对账单系统设计-2026-05-12.md`
- 导入顺丰签收明细 → 匹配快递单号 → 写入签收时间 → 状态改已签收
- 对账单导出增强：加签收日期、签收状态、交期天数列
- 状态机新增"已签收"终态

### 本地生产代码同步
- 从 ECS 生产容器下载 7 个关键文件覆盖本地，确保本地基线与生产一致
- 生产版新增：`loadBinMap()` + `matchBin()` 仓位匹配、标签 80% 缩放、`bin_map`/`export_log` 表引用、批量导入重构

## 2026-05-12 — 批量赋码重构 + 标签导出优化

### 批量赋码系统重构
- **最小输入**：只需 SKU + 度数（SPH/CYL/AXIS）+ 数量，无需顾客姓名、眼别、代理商
- **数量支持**：每行数量为 N 则生成 N 个独立镜片码（如数量=2生成2个码）
- **写入 lens_detail 表**：每个镜片生成唯一 16 位 HEX 码，写入镜片明细表，验真系统可直接查询
- **每镜片独立订单号**：每个镜片分配独立 `ORD-` 编号，验真页面独立显示
- **直接解析 Excel**：不依赖 `handleExcelUpload`，自行解析列头（模糊匹配）
- **前端精简**：`batch-import.html` 重写为拖拽上传+一键生成
- **涉及文件**：`public/batch-import.html` + `server.js` + `lib/batch-import.js`
- ✅ 已部署 ECS（2026-05-12）

### 标签打印导出自动流转
- `exportExcelSelected()` 批量导出后自动调 `update-field` 将订单状态改为「打标签」
- 与单条导出 `quickExportExcel()` 行为一致
- **涉及文件**：`public/labels-print.html`
- ✅ 已部署 ECS

### 工厂导出 Excel 列顺序调整
- `buildFactoryExcel` 列顺序改为：顾客→产品型号→眼别→球镜SPH→柱镜CYL→轴位AXIS→镜片码→验真网址→日期→数量→订单号→是否装配→联系人→联系电话→收货地址→备注
- **涉及文件**：`lib/factory-export.js`
- ✅ 已部署 ECS

---

## 2026-05-10 — 暑期支持政策页面

### 新增「支持政策」Tab
- **`public/summer.html`**：新增第三个 Tab「支持政策」，展示《2026暑期上量支持政策》完整内容
  - 标准支持（培训/物料/样片/市场会议/IP探店）
  - 资格制支持（CDSA挂牌/ECP游学/抗疲劳OK镜种子用户/返利）
  - 备库超量货款分担政策（>300副部分高视星承担50%）
- **代理商备注**：手动填写备注，点「保存备注」单独保存
- **政策确认**：点「我已阅读并知晓」后记录确认时间

### 后端 API
- **新增 `/api/summer-policy`**：
  - `POST` — 确认政策（写入 `policy_confirmed` 时间戳）+ 可选保存备注
  - `PATCH` — 仅保存备注（不更新确认状态）

### Bitable 字段
- **`summer_target` 表新增**：
  - `policy_confirmed`（数字）— 政策确认时间戳
  - `policy_remark`（文本）— 代理商备注

### 部署
- ✅ 已部署 ECS（2026-05-10）

---

## 2026-05-10 — 合并下单系统 + 导出记录系统

### 合并下单系统
- **新增 `lib/batch-merge.js`**：合并逻辑，状态写"已下单"，不生成镜片码
- **新增 `public/batch-merge.html`**：拖拽上传+可编辑预览+确认
- **新增 API**：`/api/admin/batch-merge/parse`（解析Excel）+ `/api/admin/batch-merge/confirm`（确认导入）
- **场景**：助理汇总多个代理商散单，每个Excel对应一个订单，支持多代理商

### 导出记录系统
- **新增 `lib/export-log.js`**：导出记录管理（检查/记录/查询/状态）
- **创建飞书导出记录表**：`tblBhxfut1XWWP0Q`（导出类型/批次号/订单号/镜片码/时间/操作人/文件名/备注）
- **改造 batch-zip 端点**：导出后记录日志
- **改造 print-queue 端点**：入队前防重复检查，打印完成后记录日志
- **改造 slip 端点**：生成通行单后记录日志
- **新增 API**：
  - `/api/admin/statement` — 代理商对账单（按代理商+时间范围查询已发货订单，生成Excel）
  - `/api/admin/export-logs` — 查询导出记录
  - `/api/admin/export-status` — 批量查询订单导出状态
- **前端改造**：`orders.html` 新增"导出状态"列，显示工厂/标签/通行单/对账单状态

### 测试
- 本地 Docker 测试通过

---

## 2026-05-10 — orders.html 三项修复（待部署）

### 删除"有无库存"显示
- 移除筛选栏"库存"下拉（`filterStock` select）
- 移除表头"是否有库存"列
- 移除表格行内"有库存/无库存"可编辑 select（`data-field="库存状态"`）
- colspan 16→15；resetFilter 清理残留引用

### 筛选 Bug 修复
- **Bug A**：查询按钮加 `currentPage=1`，防换筛选后停在空页
- **Bug B**：filterStatus 下拉加 `onchange` 重置 `activeStatusFilter` + 卡片高亮，解决统计卡与下拉互相残留的状态冲突
- **Bug C**：超期模式改发 `pageSize=9999`（全量拉取），解决分页下漏掉超期订单的 bug；server.js `/api/admin/orders` pageSize 上限从 100 改为 9999
- **Bug D**：删除 loadOrders 内 `today`/`week` 两个永远不执行的死代码 else-if 分支

### 确认性能体感优化
- 确认按钮文案改为 `确认中 (N 单)...`，让操作员看到处理数量，改善等待感知

### 根因说明（确认慢）
- resolveStock 走缓存（快）、generateQRPng 本地生成（快）
- 实际瓶颈：4 次 Feishu API 调用（2 并行读 + 2 批量写），受 Feishu 服务端限速，理论下限 ~1.5-2s/批次，代码层面已最优

## 2026-05-02 — 测试环境搭建 + 验真系统加固

### 基础设施
- **测试环境**：同 ECS 第二容器（端口 3211），独立测试 Bitable `CtXObqwAHaCXYssBBfkcXmrlnUe`
- **配置文件**：`docker-compose.test.yml` + `.env.test` + `shared/tables.js`（NODE_ENV=test 切换表 ID）
- **nginx 代理**：`/test/` 路径代理到 3211 容器

### 修复
- **portal.html 漏部署**：生产容器根路由 404，补部署 portal.html
- **/verify 路由缺失**：server.js 添加 `/verify` 和 `/verify.html` 静态路由
- **feishu.js 缺少 batchUpdateRecords**：测试容器旧镜像缺少该函数，已同步

### 优化
- **草稿同步时间**：DRAFT_AGE_MIN 从 15 分钟缩短到 3 分钟

### 验证
- 生产环境端到端验真测试通过（下单→同步→确认→赋码→验真）
- 测试环境端到端验真测试通过

---

## 2026-04-30 — 批量导入 + 自动赋码 + QR 验真码

### 新功能

- **批量导入系统**（3 个新文件）：
  - `lib/batch-import.js` — 核心引擎：Excel 解析（复用现有列名模糊匹配）、自动构建订单/镜片记录、lens code 生成、内容 hash 去重
  - `public/batch-import.html` — 拖拽上传 UI，自动从文件名识别代理商（`AG\d{3}`），进度条，结果汇总 CSV 下载
  - `public/qr-gallery.html` — QR 验真码展示页，搜索过滤，查看所有镜片码的 QR 图片

- **新增 API 端点**：
  - `POST /api/admin/batch-import?admin=TOKEN` — 接收多文件 base64 JSON，批量解析 → 赋码（16位 HEX lens code） → 写 Bitable → 生成 QR PNG
  - `GET /api/agents` — 代理商列表（前端下拉框用）
  - `GET /api/admin/lens-codes?admin=TOKEN` — 镜片码列表（QR 展示页用）
  - `GET /qr-gallery.html` — QR 验真码页面路由
  - `GET /batch-import.html` — 批量导入页面路由

- **server.js 改造**：
  - 批量导入端点支持 30MB body（默认 1MB）
  - 静态资源（qrcodes/css/js）取消速率限制
  - 通用限速从 60 提升到 120 次/分钟

### 状态变更
- 导入时订单状态直接设为「生产中」，跳过 confirm 步骤
- 5.1 期间助理每日流程：打开页面 → 拖文件 → 选代理商 → 点导入 → 打印发货

### 测试验证
- 8 个真实订单 Excel 文件全部导入成功（13 条订单 + 26 个镜片码）
- 54 个 QR 码 PNG 已生成并部署到 ECS
- 扫码验真页面正常返回

### 已部署 ECS ✅


### 变更
- **lens_detail 表字段迁移**：将"镜片码"替换为"镜片码（唯一）"，两字段数据已合并（2条记录）
- **代码同步**：server.js / lib/factory-export.js / lib/printer.js / lib/templates.js / logistics.js / print_labels.js / check_schema.js 共7个生产文件更新
- **ORDER 表"镜片码"字段不变**（该字段为逗号分隔的镜片码CSV，用途不同）
- **verify filter URL 更新**：`CurrentValue.[镜片码]` → `CurrentValue.[镜片码（唯一）]`
- **迁移脚本**：`migrate_lens_code_field.mjs` 已完成并删除
- **已部署 ECS** ✅

## 2026-04-28 — 打标签流程修复

### Bug 修复
- **labels-print.html 扫码输入无响应**：scanBuffer 150ms 超时为扫枪设计，手动输入太慢导致 Enter 时缓冲区已清空。修复：Enter 时 fallback 读 `input.value`
- **scan-print 镜片码未找到**：129条镜片码在订单主表有但 lens_detail 表无记录（旧迁移数据绕过 confirm 端点）。`migrate_lens_detail.js` 补建完成
- **labels-print.html 扫码后表格不刷新**：扫码成功后自动筛选到"打标签"状态 + 刷新队列统计
- **slip-batch 500 错误**：`adminToken` 未定义，补上 `url.searchParams.get("admin")`
- **slip/Excel 迁移空记录**：通行单和 Excel 导出混入无处方的迁移记录（无眼别+无SPH），加 filter 过滤
- **Excel 导出跨订单 bug**：选不同订单的客户时，`customer=Clark,1111` 传给 API 导致跨订单过滤错乱。前端按订单号分组传 `orderCustomers=ORD-A:Clark|ORD-B:1111`，后端按订单号分别过滤
- **selectedOrders 未清空**：切换筛选条件后旧选中项残留，导出混入旧数据。`loadOrders()` 开头加 `selectedOrders.clear()`

### 优化
- **labels.html 斑马打印 toast**：选了非打标签订单时提示"所选 X 个订单中没有打标签状态的"，而非笼统的"没有可打印的"

### 数据修复
- **废弃状态清理**：31条"待签收" + 1条"已签收" 全部改为"已发货"
- **lens_detail 补全**：`migrate_lens_detail.js` 为 129 条缺失的镜片码创建镜片明细记录

### 重构
- **labels.html → orders.html**：文件重命名消除歧义（labels.html 实为订单管理页）。server.js 路由兼容旧路径 /labels。admin-login.html、labels-print.html、portal.html 链接更新
- **采购表守卫**：tables.js 注释 procurement 表 ID，server.js 三个端点加 `if (!TABLES.procurement)` 守卫，启动不再报 TableIdNotFound
- **orders.html 操作列精简**：只保留"待确认+退回"，发货/同行单/打标签操作移到 labels-print 页面

### 性能
- **confirm 端点优化**：启动时预热库存缓存（`getStockMap()`），首次 confirm 从 18s 降到 5s

### UI 修复
- **详情表 AXIS 对齐**：`table-layout:auto` 替代 `fixed`，去掉 colgroup，浏览器自动按内容分配列宽
- **详情表过滤空记录**：迁移脚本创建的无处方记录（无眼别+无SPH）自动隐藏
- **备注列不换行**：td 加 `white-space:nowrap`，截断宽度收紧到 100px
- **stepper 已完成绿色**：已完成步骤显示绿色（done），当前步骤蓝色（pulse），未完成灰色

### 文档
- **打标签操作手册**：`docs/打标签操作手册.md`，两个页面定位+单张/批量场景+常见问题+检查清单

## 2026-04-28 — labels.html 表格列宽修复与字体统一

- **列宽 nth-child 修复**：序号列新增后 CSS nth-child 未更新，导致全表列宽错配（SKU 28px 塞不进中文名，订单号 70px 截断）
- **字体统一**：订单号、详情表 th/td 去掉 monospace，全表中英文统一用中文字体，消除混排列错位
- **订单号拆两行**：ORD-YYYYMMDD / -XXXXXX 上下两行，列宽从 130px 缩至 90px
- **紧凑布局**：16 列全部收紧，min-width 降至 860px，操作列放宽至 90px，一屏可见
- **详情表 colgroup**：改用百分比 colgroup 控制列宽，替代 CSS nth-child 方案
- **顾客列**：52px → 44px，仅容纳 3-4 中文字

## 2026-04-28 — 进销存闭环：预占→实扣→释放 + 采购入库

### 库存预占/实扣/释放
- **stock_detail 新增 `预占库存` 字段**：当前库存 - 预占 = 可用库存
- **下单预占**：`POST /api/submit` → `reserveStock(sku,sph,cyl,qty)`，withLock + fresh read + PATCH
- **发货实扣**：`POST /api/admin/ship` → `convertReservation()`，库存-1 预占-1 单次PATCH原子写入
- **退回释放**：`POST /api/admin/revert` → `releaseReservation()`，预占 -= qty，已0时no-op
- `getStockMap` / `queryStockByRx` 返回值新增 `reserved`、`available`

### 模块解耦
- **`lib/stock-resolver.js`**（新）：库存判定，`resolveStock(lenses)`，O(1)缓存查
- **`lib/state-router.js`**（新）：纯函数状态路由，`routeConfirm(results)` → `{targetStatus,wfStep,deliveryType}`
- confirm 端点重构：StockResolver.resolveStock → StateRouter.routeConfirm → 执行
- order-stock-check 不再逐眼 filter 查询，一次 resolveStock

### 采购入库
- `POST /api/admin/procurement` — 创建成品采购单（SPH/CYL/数量）
- `POST /api/admin/procurement/:id/receive` — 到货入库（withLock + stock+N + 流水）
- `GET /api/admin/procurements` — 采购单列表（类型/状态筛选）
- procurement 表新建（Bitable `tblOfnWZAMxvjZCQ`，SPH/CYL/成品类型字段）

### 前端
- **`public/flow-inventory.html`**（新）：进销存逻辑流程图（全链路/模块关系/数据表 三Tab）
- control.html 仪表盘加预占/可用指标，数据流Tab改为进销存
- inventory.html 库存明细加预占/可用列

### API
- `/api/admin/dashboard` 新增 `totalReserved`、`totalAvailable`
- `/api/admin/stock-detail` 新增 `reserved`、`available`

### 部署
- 华为云 ECS 已更新（server.js + lib/* + public/* + shared/tables.js）

## 2026-04-28 — 标签与发货环节优化

### Bug 修复
- **打标签退回失败**：labels.html `revertOrder` 的 `REVERT_MAP` 缺少 `"打标签": "已下单"`，导致打标签行退回按钮不可用（后端已支持）
- **ship 端点 packed 死代码**：`advanceWorkflow(wf, "packed")` 引用的 "packed" 不在 STEP_ORDER 中，静默失败，已移除

### 功能优化（labels.html）
- **Stepper 改为 5 步**：头部流程从 6 步改为 5 步，名称对齐实际状态（已下单→待处理→生产中→打标签→已发货）
- **快速操作栏加发货入口**：打标签/生产中行新增"发货"按钮，弹出快递选择弹窗，一键确认发货
- **批量操作栏重构**：新增 4 个上下文按钮，按选中订单状态动态显隐
  - 确认下单（仅全选已下单时显示）
  - 导出Excel给工厂（选中待处理时）
  - 斑马打印（选中打标签时，调用 print-queue API）
  - 确认发货（选中打标签/生产中时）
- **发货弹窗**：选快递公司 + 自动生成单号，支持单行和批量

### 标签与发货中心（labels-print.html）
- **清理旧状态**：筛选下拉/表格渲染删除已废弃的待签收/已签收，新增打标签
- **库存筛选**：新增库存状态下拉（有库存/无库存）
- **shipSelected 修复**：支持打标签状态发货（之前仅生产中）
- **扫码打印**：前端 handleScan 改为调 `/api/admin/scan-print`，显示成功/已打印/失败状态

### 扫码打印端点（server.js）
- **新增 `POST /api/admin/scan-print`**：扫码镜片码→查镜片明细表→找关联订单→入队打印→订单状态变打标签；已打印过的仅重新入队，返回 `alreadyLabeled: true`
- **print-queue 加重复检测**：返回 `alreadyLabeled` + `currentStatus`

### 标签格式变更
- **ZPL 标签**（lib/printer.js）：条形码从订单号改为镜片码；产品型号前加"高视星®"；删除底部代理商名称
- **HTML 标签**（lib/templates.js）：同上三处修改

### 文档同步（CLAUDE.md）
- §5.3 状态流转更新为 5 态 + 正确退回规则（打标签→已下单）
- §0 铁律修正退回规则
- §1 核心状态机更新
- 镜片码生成时机从"下单时"改为"助理点待确认时"

### 待部署
- 上述改动尚未推送到 ECS，部署命令见 STATE.md

---

## 2026-04-16 — 远程 MAC 部署修复：FEISHU_APP_ID/SECRET 配置错误

- **根因**：远程 `shared/.env` 中 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 错误写成了通知应用的凭证（`cli_a958c5e372b85cb0`），而非多维表格应用的凭证（`cli_a94dfd3512f9dbd9`），导致 `tenant_access_token` 获取失败（code 9499），`loadAgents()` 返回空数组，所有代理商 token 验证均返回"无效链接"
- **修复**：将 `FEISHU_APP_ID` 改为 `cli_a94dfd3512f9dbd9`，`FEISHU_APP_SECRET` 改为 `9oqRw6FermZa9KC34m7gKeHLYwiLICeA`
- **附注**：远程 MAC 的 `Downloads/` 目录受 macOS TCC 隐私保护，SSH 无法访问，需从有权限的终端重启 node 服务

---

## 2026-04-15 — 订单系统功能迭代（管理端+代理商端）

### 管理端 labels.html
- **新增"装配"列**：显示是否装配 badge（是=绿色/否=灰色）
- **新增"备注"列**：文本溢出省略，hover 显示完整内容
- **新增筛选器**：型号下拉（动态从订单数据提取）+ 装配状态下拉
- **ZIP 导出 Excel 增加列**：是否装配、备注

### 代理商端 order.html
- **新增 SKU**：时空之眼PRO、时空之眼MAX
- **删除预计交期显示**：成功页和表单中的交期预估移除（二期开发预留）
- **双眼颜色标注**：右眼红色边框+淡红底，左眼蓝色边框+淡蓝底，标签文字红/蓝

### 代理商端 track.html
- **删除镜片码 QR 展示**：详情弹窗中移除镜片码区块
- **删除预计交期 badge**：订单列表和详情中移除交期显示
- **备注逐行对应**：详情表格新增"备注"列，每个顾客行显示各自备注（替代原全局备注）
- **眼别颜色 badge**：详情表格眼别列用红蓝颜色标签（右红左蓝）

### 后端 server.js
- `GET /api/admin/orders` 返回 `assembly` + `remark` 字段，支持 `sku`/`assembly` 查询参数筛选
- `buildFactoryExcel()` Excel 新增"是否装配""备注"列
- `GET /api/order/:orderNo` items 每行带 `remark` 字段
- `HARDCODED_SKUS` 新增时空之眼PRO/MAX

### 延后项
- 订单确认规则校验（待用户提供具体规则）
- EXCEL 导入参数识别为"0" bug（待用户提供问题样本）

---

## 2026-04-15 — 修复二维码 localhost 问题

- **根因**：`shared/.env` 缺少 `SERVER_BASE_URL`，QR 码生成 fallback 到 `http://localhost:3210`，手机扫码无法访问
- **修复**：`.env` 添加 `SERVER_BASE_URL=https://villain-bacon-supervise.ngrok-free.dev`（ngrok 公网地址）
- **注意**：ngrok 重启后地址会变，需同步更新 `.env`；已生成的 localhost 二维码需重新下单生成

---

## 2026-04-15 — 安全加固 + UI 品牌化 + 验真修复 + Docker 部署

### 安全加固 (4caed49)
- **APP_TOKEN 环境变量化**：敏感配置移入 `.env`，不再硬编码
- **loadEnv 多路径查找**：支持 `shared/.env`、项目根目录、上级目录
- **timingSafeEqual**：管理员认证改用恒定时间比较，防时序攻击
- **crypto.randomBytes**：订单号、镜片码等 ID 改用密码学安全随机数
- **输入校验**：手机号、度数、轴位等参数范围验证
- **CORS 白名单**：仅允许已知域名跨域访问
- **请求限流**：API 添加速率限制，防暴力请求
- **请求体大小限制**：限制 POST body 防内存攻击
- **escapeHtml**：XSS 防护，HTML 输出转义
- **applyOrderFilters 重构**：订单查询过滤逻辑提取为独立函数

### UI 品牌化改造 (995c642)
- **统一设计系统**：CSS 变量体系（`--brand: #0066CC`、`--brand-dark: #1B3A5C`、`--gold: #E6B422`）
- **字体规范**：Montserrat 数字、SF Mono 等宽、PingFang SC 正文
- **4 个页面全部改造**：
  - `order.html` — 代理商下单页，品牌 header + 金色 CTA
  - `track.html` — 订单追踪页，品牌 header + 统一 badge
  - `labels.html` — 管理后台，品牌渐变 header + SVG 网格纹理 + 金色运营标签
  - `verify.html` — 消费者验真页，全品牌化重写（盾牌图标 + 磨砂玻璃 + 蓝金分割线）
- **common.css 全面重写**：361 行变更，卡片 16px 圆角、统一阴影、按钮系统、badge 色板

### 验真修复 (ccbcdf0 + 222d2c0)
- **验真接口改查镜片明细表**：从查订单表改为查 `lens_detail` 表，修复验真 404
- **HERO_CLASS 模板变量**：补充 `{{HERO_CLASS}}` 替换，验真页正确显示绿色/红色主题

### Docker 部署 (ac4424d)
- **Dockerfile + docker-compose.yml**：一键部署，端口 3212:3210
- **volumes**：`.env` 和 `qrcodes` 持久化

### E2E 测试 (4cb3dde)
- **e2e_full_sim.mjs**：完整端到端测试脚本（下单→确认→发货→签收→验真）
- **QR 码批量生成**：100+ 个镜片 QR PNG 自动落地到 `public/qrcodes/`

### 基础设施 (015dc9a)
- **Tailscale + VNC 远程桌面指南**：跨设备部署和调试文档

---

## 2026-04-15 — 订单管理中心 AI 全面升级

### 管理页 labels.html 优化
- **交期时效可视化**：新增"天数"列，超期行自动标红（待处理>3天/生产中>7天），统计卡片显示各状态平均天数
- **快捷筛选标签**：全部 / 超期 / 今日新增 / 7天内，pill 式按钮
- **智能提醒条增强**：显示超期订单警告、今日新增计数
- **状态 badge 圆点**：每个状态带颜色圆点指示器
- **键盘快捷键**：Ctrl+A 全选、Esc 清除、? 快捷键帮助
- **操作栏 sticky bottom**：滚动时固定底部可见
- **流程图面板**：8 步全链路流程（下单→确认→导出ZIP→工厂→打印标签→发货→签收→验真）
- **AI Agent 能力图谱**：5 个 Agent 的能力成熟度展示
- **响应式优化**：移动端卡片堆叠、表格横向滚动提示
- **流程修正**：操作栏按钮顺序对齐真实流程（确认→导出ZIP→预览标签→打印标签→发货→签收）
- **行内操作**：生产中显示"导出"+"发货"两个按钮

### AI 能力落地（后端 4 个新 API + 前端）
- **自然语言搜索** `POST /api/admin/ai-search`：中文输入转筛选参数，调 MiMo 大模型
- **异常检测** `GET /api/admin/ai-anomaly`：超期订单、处方极端值（SPH/CYL 超范围）、轴位缺失、重复镜片码
- **数据问答** `POST /api/admin/ai-qa`：右下角聊天窗，基于实时数据回答任意问题
- **智能建议** `GET /api/admin/ai-suggest`：基于当前状态推荐下一步操作

### Bug 修复
- **镜片码回写**：下单时异步生成镜片码到明细表后，回写到订单主表（此前只有确认/手动确认才回写）

---

## 2026-04-12 — 供应链智能看板 + 三系统架构评估
- `dashboard.js` / `dashboard.html`：8 KPI 卡片 + 8 ECharts 图表
- `delivery_analysis.js`：交付水平分析引擎（实际达成率 + 预测达成率 + 模拟器）
- `ai_analysis.js`：AI 周分析（Coze bot → 飞书多维表格）
- `automations.js`：9 条业务规则引擎

---

## 2026-04-11 — 飞书多维表格全流程打通（qrcode-webhook/）
- 镜片码自动分配（轮询线程每 60 秒）
- QR 码本地生成 `static/qrcodes/`
- 端到端验真测试
- 多项技术修复（InvalidFilter、飞书 Workflow HTTP、双线程竞争、字段格式解析）

---
## 历史会话归档（从 STATE.md 迁入，2026-04-27）
## 2026-04-16
今日开工，准备开始修复 1-2 级 bug。

## 2026-04-17
Day2 bug 修复完成：
- ④-1 (严重度1): XLSX write buffer 类型兼容修复
- ①-2 (严重度2): Excel 导入联系人/电话/地址/备注
- ①-1 (Day2): SPH/CYL/AXIS 列名匹配增强
- ①-3: 单眼勾选数量改用 lensCount
- ②-1: 确认页展开行按客户名过滤
- ④-2: 同 ④-1 根因
- ④-6: downloadZip 自动传 customer 过滤
- ④-3: 待验证（前端选择状态问题）

测试：26/26 断言全部通过 → `docs/day2_test_report.md`
已推送到 main（`12f8d9c`）

## 2026-04-18
代码审核后补修两处 must-fix：
- labels.html 新增 `jsAttr()`，修复 `onclick` 中含 `'` 的客户名导致 JS 字符串截断的崩溃风险
- server.js:1392 `lensCount: quantity * 2` → `quantity * lensCount`，与 1345 行单眼订单逻辑对齐

## 2026-04-19
A 系统迁云完成（学习+冷备演练，不接真流量）：

新建文件：
- `mock-shuang/` — Mock 溯源服务（模拟扫码回调 + 查询）
- `docker-compose.prod.yml` — 生产部署编排（order-app + mock-shuang）
- `.env.production` — 测试飞书 Bitable + Mock 配置

部署链路：Windows 构建 → SWR 推镜像 → ECS 拉取运行

华为云 ECS（gaush-lab）：
- IP: 113.44.175.221
- 域名: lab.gaushclear.com（HTTPS，证书到期 2026-07-18）
- 部署目录: /opt/gaush-lab/
- SSH 密钥: 04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem
- SWR 组织: gaushclear-clark
- ADMIN_TOKEN: GaushOrderMock
- 两容器: order-app(:3210) + mock-shuang(:3220)，仅 127.0.0.1

安全隔离：
- 出站已隔离，不访问生产 ECS
- 使用测试 Bitable（B3xQbbqicaome1sKdZbcwdk8nWg）
- SHUANG_API_URL 指向 Mock 容器
- READ_ONLY_MODE=true

踩坑记录：
- Docker BuildKit attestation manifest 不兼容 SWR → 构建需 `--provenance=false`
- server.js loadEnv() 读文件不读 process.env → .env 必须挂载到 /app/.env

## 接手指南

### 飞书测试应用凭证
- APP_ID: cli_a958c5e372b85cb0
- APP_SECRET: PWLWUZ3ZZZj3DnKb2nX0yhBWoQ5hzu0y
- 测试 Bitable: B3xQbbqicaome1sKdZbcwdk8nWg（飞书多维表格副本，非生产）

### SWR 镜像仓库
- 区域: 华北-北京四
- 组织: gaushclear-clark
- 地址: swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/
- 登录凭据: 见 `DEPLOY.md`

### 更新部署流程
详细步骤见 `DEPLOY.md`（包含 SWR 登录、构建、推送、ECS 更新全流程）。

### 本地开发
本地直接 `node server.js`，读 `../shared/.env` 或 `../.env` 里的飞书凭证。
不依赖 Docker 本地跑，Docker 只用于推镜像部署。

## 2026-04-19 续
全链路验证测试通过（详见 `docs/cloud_migration_verify_report.md`）：
- 测试订单：ORD-20260419-ADCDF2AC（Clark, Ultra双效, 双眼）
- 右眼镜片码：9A01D300D79856A0
- 左眼镜片码：C0CD088A880AE1FD
- 下单 → 镜片码生成 → QR 码生成 → 消费者验真，全部正常
- QR 码图片已下载本地扫码验证通过

A 系统迁云完成，停止优化，回到 B 脚本主线。

## 2026-04-19 华为云全量 Bug 回归
- 关闭 READ_ONLY_MODE，在 ECS 上跑 E2E 全流程（8 订单，79 断言）
- 74/79 通过，发现 ⑧-2 同名不混回归：验真页按客户名过滤，同名不同处方混入
- 修复 `server.js:1828`：过滤条件增加产品型号匹配（`sameCustomerLens` → `samePair`，加 `srcSku` 条件）
- 修复后验证通过：同名"张伟"的 Ultra双效组（2 码）和 D8 组（2 码）互不干扰
- 已恢复 READ_ONLY_MODE=true
- 报告：`docs/cloud_regression_report.md`

## 2026-04-20 内部同事测试启动

系统全部就绪，开放同事测试：
- 代理商登录：`https://lab.gaushclear.com/login?t={代理商Token}`（41 个代理商已启用）
- 管理后台：`https://lab.gaushclear.com/admin-login?admin=GaushOrderMock`
- 验真示例：`https://lab.gaushclear.com/verify/9A01D300D79856A0`
- 注：READ_ONLY_MODE=true 实际未在 server.js 中实现，写入操作不受限制

## 2026-04-21 同事测试反馈修复（第一批）

修复 2 个 bug（详见 BUGS.md）：
- ①-9：Excel 空行（仅眼别无度数）被误识别为零值 → `server.js` 跳过无度数行
- ①-10：追加导入 Excel 时第一个顾客被跳过 → `order.html` 追加模式移除空占位卡

## 2026-04-21 同事测试反馈修复（第二批）

修复 9 个 bug（详见 BUGS.md 4/21 第二批表格）：
- ①-1：Excel 20 行上限→去掉限制，支持任意人数
- ①-3：备注行被误创建为新客户→无产品/眼别的行备注附加到上一个 patient
- ②-1/④-2/⑧-2：眼别排序不一致（同根）→`getLensDetailsByOrder` 内部加排序 + `buildFactoryExcel` 二级排序
- ④-1：导出备注读错表→回退到 `orderRemark`
- ④-3：同订单选多人导出全订单→前端收集全部客户名，后端支持逗号分隔过滤
- ④-4：度数浮点精度→`.toFixed()` 格式化
- ④-5：`quickZip` key 格式错误→直接构建 URL 绕过自动检测
- ⑧-1：验证时间显示扫码时间→改为订单创建时间

涉及文件：`server.js`（6 处）、`labels.html`（2 处）、`BUGS.md`

## 2026-04-21 部署

第二批 bug 修复已部署到华为云 ECS：
- SWR 镜像: `swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1`
- ECS 容器: order-app 已重启，HTTP 200 正常
- 新 SWR 凭据已更新（旧 AK `HST3WE7E22JS62Z857O4` 已失效）

## 2026-04-22 飞书 Token 缓存 Bug 修复

**现象：** 全部 41 个代理商登录报"Token 无效"（401），日志大量 `Invalid access token for authorization`。

**根因：** `getFeishuToken()` 缓存逻辑有 bug — 飞书 API 抖动时获取失败，`_feishuToken` 被设为 `undefined`，但 `_feishuTokenTime` 仍刷新为 `Date.now()`，导致后续 7000 秒内所有请求都用无效 token，全部 Bitable API 失败。

**修复：** `server.js` 中 `getFeishuToken()` 和 `getNotifyToken()` 两个函数，只在获取成功时才更新缓存时间戳。
```js
// Before (bug)
_feishuToken = json.tenant_access_token;
_feishuTokenTime = Date.now();

// After (fix)
if (json.tenant_access_token) {
  _feishuToken = json.tenant_access_token;
  _feishuTokenTime = Date.now();
}
```

**部署：** SCP 热更新 server.js 到 ECS → docker cp 到容器 → restart。验证全部代理商 token 返回 200。

## 2026-04-22 运维自动化方案

Token 缓存 bug 暴露两个问题：系统缺自愈能力，缺低门槛运维入口。

制定了三阶段方案（详见 `docs/ops-plan.md`）：

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 服务端自愈 + 健康检查 | ✅ 已部署 |
| Phase 2 | 运维 API（/ops/*） | ✅ 已部署 |
| Phase 3 | OpenClaw 接入 | ✅ 已打通 |

### 部署内容

1. **`feishuApi()` token 自愈** — 收到 `code: 99991663` 或 `Invalid access token` 时自动清空缓存，下次请求立即刷新
2. **`GET /health`** — 飞书连通性 / Bitable 读写 / 代理商数 / uptime
3. **`GET /ops/logs?tail=N`** — 最近 N 条请求日志（内存缓冲 500 条）
4. **`GET /ops/check-token`** — 测试飞书 token + Bitable 连通性
5. **`POST /ops/restart`** — process.exit(1) → Docker 自动重启

### 部署步骤

- `server.js` / `automations.js` 的 TABLES 导入路径从 `../shared/tables.js` 改为 `./shared/tables.js`
- `shared/tables.js` 复制到 order-system 内，Dockerfile 新增 `COPY shared/`
- 安全组入方向添加 128.14.152.197/32:443（OpenClaw 服务器公网 IP）
- OpenClaw 已手动发送 SKILL.md 内容学习，无需重启 gateway

**注意：** TABLES 导入结构差异已统一，本地和 ECS 走同一个 `./shared/tables.js`。

## 2026-04-22 Bug 修复批次

修复 5 个 bug（详见 BUGS.md）：

| # | 描述 | 严重度 | 涉及文件 |
|---|------|--------|----------|
| 安-1 | admin-login?admin=xxx 自动跳转进管理后台 | 1 | `public/admin-login.html` |
| ①-11 | Excel 备注栏被识别为新客户 | 2 | `server.js` |
| ④-7 | 多订单导出 ZIP 无 Excel（加日志排查） | 2 | `server.js` |
| ④-8 | 同订单选 2 人导出备注错乱 | 3 | `server.js` |
| ④-9 | 多订单合并导出联系人/地址/备注全用第一个订单，数量为 1 | 2 | `server.js` |

核心改动：
- `buildFactoryExcel` 重构为按每条记录的订单号查找对应 info（联系人/地址/备注/数量），不再用合并的单一 info
- `orderInfoMap` key 改为纯 orderNo，每个订单独立存储信息
- 数量从订单主表读取，不再从镜片明细表默认 1
- Excel buffer 增加非空检查 + 详细错误日志

### E2E 测试结果

华为云全量回归：**11/11 通过**（详见 `docs/e2e_report_0422.md`）：
- ✅ 管理后台安全（安-1）
- ✅ 单/多订单导出含 Excel（④-7/④-9）
- ✅ 同订单选人导出（④-8）
- ✅ 验真时间字段（⑧-1）
- ✅ 健康检查 / 订单查询 / 镜片明细 / 验真页面

## 2026-04-22 ①-12 下单接口 500 修复 + 部署

**Bug ①-12：** `deductStockDetail` 调飞书 API 返回非 JSON 响应时 `res.json()` 直接崩溃，导致 `/api/submit` 返回 500。

**修复：**
- `feishuApi()` / `getFeishuToken()` / `getNotifyToken()` 三处 `res.json()` 加 try-catch
- `deductStockDetail` PATCH 失败返回 false 而非 true

**部署：**
- GitHub commit `224894a`
- SWR 镜像 `v1` 已推送
- ECS 容器已重启（docker compose pull && up -d）

**验证：**
- 下单接口：无效 token 返回 401 "无效链接"（不再 500）
- E2E 回归：11/11 通过（17:55）

## 2026-04-22 下单库存实时扣减 + 并发安全

核心目标：代理商下单时看到实时库存，下单后库存立即扣减，多代理商并发下单不超卖。

### 修复 3 个 P0 bug

| Bug | 现象 | 修复 |
|-----|------|------|
| 并发丢失更新 | 两并发读 stock=10 都写 9（应为 8） | `withLock()` per-key 异步锁 + 锁内 fresh read 单条记录 |
| 无幂等保护 | 双击提交按钮创建两个订单 | `clientRequestId` + 10min TTL 缓存 |
| 先扣库存后写订单 | Bitable 写入失败则库存丢失 | 预检(409) → 写订单 → 扣库存（失败标记人工） |

### 修复 1 个 bug

| Bug | 描述 |
|-----|------|
| `skuInfo?.name` 未定义 | `order.html` 的 `skuName` 变量引用不存在的 `skuInfo`，改为直接用 `sku` |

### 改动文件

- `server.js`：`withLock()` / `deductStockDetail` 重写 / `getStockMap(fresh)` / `/api/submit` 四阶段重构 / 幂等存储
- `public/order.html`：`clientRequestId` / 409 冲突弹窗 / `showStockConflict()` / `closeStockConflict()`

### 新流程

```
选产品+度数 → 交期徽章（只读，2分钟缓存）
  ↓ 确认提交
  ↓ 幂等检查 → 命中缓存直接返回
  ↓ 预检 fresh 库存（每眼 ~200ms）→ 不够 409 + 详情
  ↓ 写订单到飞书
  ↓ 锁内扣库存（GET fresh + PATCH ~400ms/眼）→ 极端被抢则标记人工
  ↓ 返回订单号
```

### 未覆盖

- 寄售库存扣减（`deductAgentStock`）同样有 lost-update bug，暂不处理

## 2026-04-22 标签打印系统 + 工作流可视化（Phase 1 完成）

### 目标

斑马 ZT230/ZT411 直连打印，扫码枪扫条形码自动出标签，全流程可视化驱动。

### 新增功能

**ZPL 标签直出（斑马打印机）：**
- `buildZpl(rec)` — ZPL II 纯字符串生成，Code128 条形码(订单号) + QR 验真码 + 处方数据
- `sendTcpZpl()` — TCP Socket 直连打印机 9100 端口（零依赖，内置 `net` 模块）
- `sendUsbZpl()` — USB 桥接转发（预留 Phase 2）
- `sendZplToPrinter()` — 统一入口，按 printer_config.json 选 TCP/USB

**扫码即打：**
- labels.html 顶部扫码栏，隐藏 input 持续聚焦
- 扫枪 = USB HID 键盘楔入，150ms 击键间隔检测，Enter 触发自动打印
- 每行快捷操作也有 🖨 按钮，选中多行可批量斑马打印

**工作流步骤系统（8 步，叠加在现有 4 状态之上）：**
- 已下单 → 已确认 → 生产中 → 质检完成 → 标签已打印 → 已打包 → 已发货 → 已签收
- 存储在订单主表 `流程步骤` 文本字段（JSON）
- `advanceWorkflow()` 防跳步、防回退、幂等
- 现有 confirm/ship/deliver 端点自动推进对应步骤
- 新增 `POST /api/admin/workflow/step` 手动推进（质检、打包）
- submit 时自动写入 `submitted` 步骤

**工作流可视化：**
- 订单行展开后水平 stepper，绿点=完成，蓝脉冲=当前，灰点=待办
- hover 显示时间戳

**打印机配置面板：**
- 可折叠面板，TCP/USB 切换，IP/端口/份数/自动打印开关
- 测试打印按钮、连接检测按钮
- 配置存储在 printer_config.json（仿 rules_config 模式）

### 新 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/admin/print-label` | 生成 ZPL → 发送打印机 |
| POST | `/api/admin/print-label/preview` | 返回 ZPL 文本 |
| POST | `/api/admin/printer/test` | 测试标签 |
| GET/POST | `/api/admin/printer/config` | 配置读写 |
| GET | `/api/admin/printer/status` | TCP 连通性检测 |
| GET | `/api/admin/workflow/:orderNo` | 查询工作流状态 |
| POST | `/api/admin/workflow/step` | 推进工作流步骤 |

### 改动文件

- `server.js`：+300 行（`Socket` import、`buildZpl`、`sendTcpZpl`、`loadPrinterConfig`、`STEP_ORDER`/`advanceWorkflow`、7 个新路由、confirm/ship/deliver/submit 集成工作流步骤）
- `public/labels.html`：+400 行（扫码栏 CSS/HTML/JS、stepper CSS/JS、打印机面板、`printZplLabels`/`quickZplPrint`、`renderDetail` 增强）
- `printer_config.json`：新建，默认 TCP 192.168.1.100:9100

### 待办

| 项目 | 状态 |
|------|------|
| Phase 1: ZPL + TCP 打印 + 扫码即打 + 工作流 | ✅ 完成 |
| Phase 2: USB 桥接 printer-bridge.js | 待建设 |
| Phase 3: auto_print_on_ship 自动化钩子 | 待建设 |
| 斑马打印机 IP 配置 | 需提供实际 IP |
| ZPL 标签物理定位调优 | 需实际打印测试 |
| E2E 回归测试 | 待跑 |

## 2026-04-22 随货通行单 Web 化完成

将 logistics.js 的通行单模板接入 web 端，实现发货前后全流程联动。

### 改动

**server.js（+250 行）：**
- `slipHTML()` — 单订单 A4 通行单 HTML 模板（从 logistics.js 复制，SERVER_BASE 改为 `getServerBaseUrl()`）
- `batchSlipHTML()` — 合单通行单模板
- `GET /api/admin/ship-preview` — 发货前预览清单（处方明细+收货信息 JSON）
- `GET /api/admin/slip/:orderNo` — 单订单通行单 HTML（浏览器直接打印）
- `GET /api/admin/slip-batch` — 按日期+代理商批量生成通行单（单分组返回 HTML，多分组返回汇总卡片页）

**labels.html（4 处 UI）：**
- `shipOrders()` 重构：点击"确认发货"先弹预览弹窗 → 确认后发货 → 完成后显示"生成随货通行单"按钮
- 已发货/已签收行增加 📄 按钮（`quickSlip()`），点击新窗口打开单张通行单
- 底部操作栏增加"通行单"按钮（`batchSlip()`），已发货选中时可见
- `updateActionVisibility()` 增加 act-slip-btn 可见性控制

### 数据流

```
选中"生产中"订单 → 点"确认发货"
  → GET /api/admin/ship-preview（预览处方+地址）
  → 弹窗确认 → POST /api/admin/ship
  → 结果弹窗出现"生成随货通行单"按钮
  → GET /api/admin/slip-batch?date=today → 浏览器打印

已发货订单随时：点 📄 → GET /api/admin/slip/:orderNo → 预览/打印
底部批量：选中已发货订单 → 点"通行单" → 批量通行单
```

### 待验证

- [x] 发货前预览弹窗显示完整处方数据
- [x] 单订单通行单 HTML 可打印
- [x] 合单通行单按代理商分组
- [x] 已发货行 📄 按钮打开正确
- [x] E2E 全流程回归

### 2026-04-22 随货通行单 Bug 修复

修复 3 个 bug：

**⑤-1 单订单通行单显示全订单镜片**：`GET /api/admin/slip/:orderNo` 没有 `customer` 参数，同订单多患者时返回全部镜片明细。
- 修复：路由加 `customer` 查询参数，按顾客名过滤镜片明细+订单记录
- `quickSlip(orderNo, customerName)` 传顾客名
- `test_slip_e2e.mjs` 加 `&customer=` 参数

**⑤-2 合单通行单不按人分组**：`batchSlipHTML` 的 `allRows` 未按顾客排序，同名"孙菁韩"导致所有人镜片混在一起。
- 修复：路由改用镜片明细表的 `顾客姓名` 字段按人分组（不再用订单表单一名字）
- `allRows` 按 `customerName` + `eye` 排序：同一人 R 在上 L 在下
- 每人名字只在第一行（R行）显示，L 行不重复

**⑤-3 合单订单汇总不应含顾客名**：对账只需 SKU+片数。
- 修复：订单汇总表改为按 SKU 聚合片数，去掉订单号和顾客列

**Simplify 清理：**
- `escapeHtml` → `jsAttr`（onclick 单引号客户名会崩溃）
- 批量通行单 N+1 → `Promise.all` 并行查询
- `indexOf` → map 回调 index（O(n²) → O(n)）

## 2026-04-22 库存实时扣减测试通过（17/17）

跑通 `test_stock_concurrency.mjs`，修复 2 个阻断 bug：

**Bug 1：`流程步骤` 字段不存在于测试 Bitable**
- `batch_create` 写订单主表时包含 `流程步骤` 字段，测试 Bitable 无此字段 → FieldNameNotFound
- 修复：从 `/api/submit` 的 orderRecords 中移除 `流程步骤`（工作流读取端已有 null-safe 处理）

**Bug 2：`最近出库` 日期格式错误**
- `deductStockDetail` 用 `new Date().toISOString()` 写 `最近出库` DATE 字段，Feishu 要求毫秒时间戳
- 修复：`new Date().toISOString()` → `Date.now()`

### 测试结果

| # | 场景 | 结果 |
|---|------|------|
| 1 | 正常下单→库存扣减 | ✅ 77→76 |
| 2 | 幂等保护 | ✅ 同 requestId 返回同一订单号，库存只扣一次 |
| 3 | 库存不足→409 | ✅ STOCK_INSUFFICIENT，不写订单不扣库存 |
| 4 | 并发下单 | ✅ 两单各扣3片，10→4（无 lost update） |
| 5 | 双眼同度数 | ✅ 两眼各扣1片，5→3 |

## 2026-04-22 库存不足不再拦截下单

业务澄清：库存不足时应照常下单走生产，库存只影响交期快慢，不阻止下单。

### 改动

**server.js：**
- 移除预检 409 逻辑（整段 fresh check + STOCK_INSUFFICIENT 返回删除）
- `deductStockDetail`：库存不够时扣除可用量（`Math.min(stock, qty)`），扣至 0 不再返回 insufficient
- 无库存时不写 `最近出库` 字段（跳过 PUT）

**order.html：**
- 删除 `stockConflictModal` 弹窗 HTML
- 删除 `showStockConflict()` / `closeStockConflict()` 函数
- 删除 `doSubmit()` 中 409 分支

**test_stock_concurrency.mjs：**
- Test 3 从"409拦截"改为"照常下单200+库存扣至0"

### 测试结果（17/17 通过）

| # | 场景 | 结果 |
|---|------|------|
| 1 | 正常下单→库存扣减 | ✅ 77→76 |
| 2 | 幂等保护 | ✅ 同 requestId 返回同一订单号，库存只扣一次 |
| 3 | 库存不足→照常下单 | ✅ 库存1片下单2片→200成功，库存扣至0，交期"定制7-10天" |
| 4 | 并发下单 | ✅ 两单各扣3片，10→4（无 lost update） |
| 5 | 双眼同度数 | ✅ 两眼各扣1片，5→3 |

## 2026-04-22 代码清理（simplify）

- `fmt`/`fmtAxis` 从 3 处内联提取为模块级函数（`buildZpl` / `buildLabelHtml` / `buildLabelHtmlFromFields`）
- `deductStockDetail` 移除未使用的 `orderNo` 参数
- 移除 `result.available` 死属性引用
- deductErrors 消息增加 `reason` 说明（not_found / write_failed）
- `buildZpl` 删除 4 行 WHAT 注释
- 测试移除 `oneOkOne409` 死分支 + 更新报告关键改动段落

## 2026-04-23 打印架构重构：直连 → 队列拉模式

**问题：** 服务器在华为云 ECS，打印机在本地 Mac 局域网。服务端 TCP 直连 `192.168.0.208:9100` 不通。

**方案：** 打印队列拉模式（pull pattern）。云端入队 → Mac 守护进程轮询 → 本地 TCP 发打印机。

### 新增文件
- `pull-print.js` — Mac 本地守护进程（nohup 常驻），轮询云端队列，ZPL→TCP 斑马打印机，slip→open 浏览器
- `pull-print-config.json` — 守护进程配置（服务器地址、admin token、打印机 IP、轮询间隔）

### 改动文件
- `server.js`（+100 行）：
  - `printQueue` Map + 序列号
  - `POST /api/admin/print-queue` — 入队（支持 zpl/slip/test 三种 type）
  - `GET /api/admin/print-queue/poll` — Mac 拉取待打印任务（FIFO，最多 20 个/次）
  - `POST /api/admin/print-queue/:id/done` — Mac 回写完成/失败，ZPL 类型全部完成后自动推进工作流→labeled
  - `GET /api/admin/print-queue` — 队列状态（UI 用）
- `public/labels.html`（6 处改动）：
  - `handleScan` / `quickZplPrint` / `printZplLabels` / `testPrinter` → 全部改为调 `/api/admin/print-queue`
  - `checkPrinterStatus` → 显示队列状态（待打印/已完成/失败）
  - UI 文案：斑马打印→入队打印，扫码栏 placeholder 更新

### 架构图
```
labels.html → POST /api/admin/print-queue → 内存队列
                                              ↑
pull-print.js ← GET /api/admin/print-queue/poll (每2s)
     ↓
  TCP:9100 → 斑马 ZT410
```

### 部署
斑马打印机连接在专用 Windows 打印电脑上，`pull-print.js` + `pull-print-config.json` 直接复制过去运行。
`openUrl()` 已改为跨平台（Windows `start` / Mac `open`）。

```bash
node pull-print.js
```

### Simplify 清理
- `buildTestZpl()` 提取为函数，消除 `/printer/test` 和 `/print-queue` test handler 的复制粘贴
- `printQueue` 内存泄漏修复：`/done` 后 60s 自动 `delete` 已完成任务
- `pull-print.js` `setInterval` → 自调度 `async pollLoop()`，防并发重叠轮询
- GET 状态端点 3 次全量遍历 → 单次遍历计数
- `/done` 工作流检查 `.filter().every()` → `.some()` 提前退出
- 删除 `pull-print.js` 死导入 `writeFileSync`
- 配置解析空 catch → 加 `console.warn`

### API 测试（本地，8/8 通过）
| # | 测试 | 结果 |
|---|------|------|
| T1 | 空队列状态 | ✅ total:0 |
| T2 | 测试入队 | ✅ 返回 jobId |
| T3 | 不存在的订单 | ✅ 404 |
| T4 | 轮询拉取 | ✅ 返回 1 个 pending |
| T5 | 回写完成 | ✅ ok |
| T6 | 完成后状态 | ✅ pending:0, done:1 |
| T7 | 假 ID 回写 | ✅ 404 |
| T8 | 再次拉取 | ✅ jobs=0 |

### 待验证
- [ ] 专用 Windows 打印电脑连接华为云 + 拉取任务
- [ ] ZPL 标签通过 TCP 打印到斑马 ZT410
- [ ] slip 类型自动打开浏览器
- [ ] E2E 全流程回归（下单→入库→打印→工作流→labeled）

## 2026-04-23 架构审查 + 控制中心升级

### 全景架构审查

Clark 要求整体审视三系统架构（CRM + 订单 + 库存），产出两份文档：
- `ARCHITECTURE.md` — 全面重写（4/15 → 4/23），新增度数级库存、14条规则引擎、打印队列拉模式、控制中心、寄售库存、工作流8步等模块
- `../ARCHITECTURE-OVERVIEW.md` — 新建，三系统全景分析（19张表、数据流、现状评估、下一步方向）

### Admin 控制中心升级（3 Tab → 4 Tab）

**Dashboard Tab（增强）：**
- 新增订单概览指标卡：总订单数 / 待处理 / 超24h未处理 / 今日订单 / 生产中 / 已发货
- 新增告警 feed：聚合超期订单、低库存、排产待回补，红/黄标签
- 新增打印队列状态卡：待打印 / 已完成 / 失败 / 总计
- 保留原有：库存指标、SKU达标率、TOP10缺口、排产单

**规则管理 Tab（增强）：**
- 新增执行历史面板：显示最近30条规则执行记录（✓/✗ + 耗时 + 时间）
- 执行后自动刷新历史

**库存管理 Tab（新增）：**
- 代理商库存概览：行数/代理商数/SKU数/自有/寄售/总计
- 代理商库存明细表：按 agent_id × SKU × SPH × CYL 展示自有/寄售分拆

**数据流 Tab（增强）：**
- 新增 CRM 同步流（sync_agents / sync_customers）
- 新增打印队列流（labels.html → 入队 → pull-print.js → TCP）

### 后端新增

| 端点 | 功能 |
|------|------|
| `GET /api/admin/alerts` | 完整告警 feed（超期订单详情 + 低库存 + 排产待回补 + 规则执行失败），上限50条 |
| `GET /api/admin/execution-history?limit=N` | 规则执行历史（内存200条） |
| `GET /api/admin/dashboard` | 扩展：新增 orderMetrics / printQueue / alerts 字段 |

### 改动文件
- `server.js`：+80 行（`_execLog` 数组、execute-rule 执行记录、dashboard 扩展、2个新端点、告警上限50）
- `public/control.html`：全面重写（+150 行，4 Tab、告警 feed、订单指标、执行历史、库存管理 Tab、CRM/打印数据流）

### Simplify 清理
- 提取 `mc()` helper，消除 5 处重复 metric card 渲染
- 删除 `doneCount` 未使用变量
- `/api/admin/alerts` 告警数组加 cap 50，防无限增长
- 删除 WHAT 注释

## 2026-04-23 库存管理系统前端 + API 完成

库存系统专属管理页面上线，单据式入库/出库操作，5 Tab 布局。

### 新建文件
- `public/inventory.html` — 库存管理页（仪表盘/出入库操作/库存总览/排产管理/寄售管理）
- `inventory-system/migrate_stock_movement.js` — 库存流水建表脚本

### 改动文件
- `server.js`（+225 行）：9 个 API 端点 + /inventory 静态路由
- `shared/tables.js` + `order-system/shared/tables.js`：各 +1 行 `stock_movement` 表 ID

### 新建表：库存流水（stock_movement）
- Table ID: `tblCoNeAbrz6tM9C`
- 12 个字段：单据号 / 类型（入库/出库）/ 来源去向（8 种）/ SKU编号 / SPH / CYL / 数量 / 变动前库存 / 变动后库存 / 关联单号 / 备注 / 操作人
- 格式：`MOV-YYYYMMDD-XXXX`，同一批次共享单据号

### 新增 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/admin/stock-movement` | 提交出入库单据（核心） |
| GET | `/api/admin/stock-movements` | 流水列表（按单据号聚合+分页） |
| GET | `/api/admin/stock-movement/:docNo` | 单据详情 |
| GET | `/api/admin/stock-detail` | 库存列表（筛选+分页+汇总） |
| GET | `/api/admin/production-orders` | 排产工单列表 |
| POST | `/api/admin/production-orders/update` | 更新工单状态 |
| GET | `/api/admin/blank-inventory` | 毛坯库存列表 |
| GET | `/api/admin/mold` | 模具台账列表 |
| GET | `/api/admin/agent-stock-admin` | 全代理商库存列表 |

### 出入库操作流程
```
选类型(入库/出库) → 选来源去向 → 关联单号(可选)
  → 添加行(SKU+SPH+CYL+数量) → 备注 → 提交
  → 批量更新 stock_detail + 写 stock_movement 流水
```

入库类型：采购到货/生产回补/退货退回/盘点补录
出库类型：订单发货/报废损耗/调拨出库/盘点差异
库存不足时照常扣至 0（与下单逻辑一致）。

### 踩坑 + 修复
- **两份 tables.js 未同步**：`shared/tables.js` 加了 `stock_movement` 但 `order-system/shared/tables.js` 没加 → `TABLES.stock_movement = undefined` → batch_create 请求路径含 `tables/undefined` → WrongRequestBody。根因：server.js 导入 `./shared/tables.js`（本目录副本），不是 `../shared/tables.js`
- **batchCreateRecords 静默失败**：返回 false 但 handler 未检查，库存已更新但流水未写入 → 加返回值检查 + HTTP 500
- **getStockMap(true) 锁内全表重读**：每行锁内调 `getStockMap(true)` 拉全表（~1575 行），10 行 = 10 次全表 → 改为锁内 single-record GET（同 `deductStockDetail` 模式）
- **clearStockCache() 每行都调**：移到循环外一次性清理

### Simplify 清理
- `clearStockCache()` 从锁内移到循环外
- batchCreateRecords 失败返回 `{ ok: false }` + HTTP 500
- 6 个 GET 端点删除冗余 `new URL(req.url, ...)`（复用外层 `url`）
- 提取 `parsePagination()` helper（3 处调用）
- 变量命名统一：`blankSku`/`moldSku`/`prodSku` → `sku`，`agentIdParam` → `agentId`

### 验证
- 10/10 API 端点测试通过（本地）

## 2026-04-23 告警 Feed + 执行历史 API + 打印守护进程 Windows 适配

### 新增端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/admin/alerts` | 告警 feed（超期订单/低库存/待回补/规则失败） |
| GET | `/api/admin/execution-history` | 规则执行历史（_execLog 分页） |

### 打印守护进程
- `pull-print.js` `openUrl()` 改为跨平台（Windows `start` / Mac `open`）
- 部署目标：专用 Windows 打印电脑（非远程 Mac）
- 配置清单 PDF 已生成：`docs/print-daemon-setup.html` → `Downloads/打印电脑配置清单.pdf`

### Simplify 清理
- alerts 端点 3 个 `catch {}` → `.catch()` 加 `console.error` + 降级返回空数组
- alerts 端点 3 个顺序 `listRecords` → `Promise.all` 并行
- 去掉中间变量 `overdueOrders`，直接内联
- 删除 execution-history 端点多余注释
- pull-print.js 注释 `macOS` → `跨平台`

### 待验证
- [ ] 专用 Windows 打印电脑连接华为云 + 拉取任务
- [ ] ZPL 标签通过 TCP 打印到斑马 ZT410
- [ ] slip 类型自动打开浏览器
- 入库/出库写入 stock_detail + stock_movement 双表成功
- 热力图 + 明细表数据正确

## 2026-04-23 架构审查 + 控制中心 + 工作流修复

### 全景架构审查
- 新建 `ARCHITECTURE-OVERVIEW.md`：三系统全景分析（19张表、数据流、14条规则、现状评估、Phase 1-3 下一步方向）
- `ARCHITECTURE.md` 全面更新（4/15→4/23）：新增度数级库存、规则引擎、打印队列拉模式、控制中心、寄售库存、工作流8步

### Admin 控制中心升级（3→4 Tab）
- **Dashboard Tab**：新增订单概览6指标卡、告警feed（红/黄）、打印队列4指标
- **规则管理 Tab**：新增执行历史面板（最近30条）
- **库存管理 Tab（新增）**：代理商库存概览+明细表
- **数据流 Tab**：新增CRM同步流+打印队列流图
- 后端：`/api/admin/alerts`、`/api/admin/execution-history`、`/api/admin/dashboard` 扩展

### 工作流可视化修复
- 问题：所有订单流程步骤全灰，无当前步骤指示
- 根因：`/api/submit` 创建订单时未写 `流程步骤` 字段
- 修复：下单时写入 `initWf`（submitted 步骤）；workflow API 增加兜底逻辑（从 `订单状态` 推断步骤）
- `STATUS_STEP_KEY` 映射表替代硬编码索引，数据驱动

### labels.html 导航
- 右上角新增"仪表盘"链接，跳转 `/control`

### ZPL 标签尺寸调整
- 80×50mm → 75×40mm（`buildZpl`、`buildTestZpl`、`buildLabelHtml`、`buildLabelHtmlFromFields` 全部同步）

### Simplify 清理
- `initWf` 从循环内提到循环外（避免重复 JSON.stringify）
- fallback if 链 → `STATUS_STEP_KEY` + `STEP_ORDER.indexOf()` 数据驱动
- 删除 `hover:opacity:1` 无效 inline CSS
- `mc()` helper 提取，消除 5 处 metric card 重复
- 删除未使用 `doneCount`、冗余注释
- alerts 循环增加 `>=50` 提前 break

### 改动文件
- `server.js`：+30 行（工作流init+兜底+STATUS_STEP_KEY+alerts cap）
- `public/labels.html`：仪表盘链接+ZPL尺寸描述
- `public/control.html`：mc()提取+注释清理
- `ARCHITECTURE.md`：全面重写
- `ARCHITECTURE-OVERVIEW.md`：新建

## 2026-04-23 标签尺寸 75×40mm 全量修复

同事确认打印正常后，要求改标签纸尺寸为 75×40mm，同时修复 HTML 预览和 ZPL 打印格式。

### 改动

**server.js：**
- `buildZpl()`：`PW636×LL400` → `PW600×LL320`，全部 ^FO 坐标重算（barcode/文字/处方/QR/镜片码/品牌/代理商）
- `buildTestZpl()`：同上
- `buildLabelHtml()` / `buildLabelHtmlFromFields()`：CSS `80mm×50mm` → `75mm×40mm`，字号/间距/QR尺寸全部缩小
- `loadPrinterConfig()` 回退默认值同步：`75×40` / `ZT410` / `192.168.0.208`
- 工厂 ZIP 说明文件：推荐标签纸 `6cm×3cm` → `7.5cm×4cm`

**print_labels.js：**
- 全部 CSS 从 80×50 改为 75×40（@page/body/label/header/rx-grid/QR/footer）
- A4 批量网格：`3×3(80mm×50mm)` → `2×5(75mm×40mm)`（A4 横向最多排 2 列 75mm）

**printer_config.json：**
- `label_width_mm: 80→75`, `label_height_mm: 50→40`

**labels.html：**
- 工作流步骤 5 描述：`80×50mm` → `75×40mm`

### Simplify 修复 2 个 bug

| Bug | 说明 | 修复 |
|-----|------|------|
| `STATUS_STEP_KEY` "已确认"→"producing" | 跳过 confirmed 步骤，工作流显示错误 | 改为 `"已确认"→"confirmed"` |
| `loadPrinterConfig()` 回退默认值过期 | JSON 读取失败时退回 80×50/ZT230/192.168.1.100 | 同步为 75×40/ZT410/192.168.0.208 |

### 改动文件
- `server.js`（ZPL 坐标重算 + HTML CSS + 回退默认值 + 工厂说明）
- `print_labels.js`（全量 CSS 更新 + A4 网格）
- `printer_config.json`（尺寸字段）
- `public/labels.html`（步骤描述文字）

## 2026-04-23 产品型号表外置

将产品目录从 server.js 硬编码改为 Bitable 表驱动：
- 新建表 `产品型号`（`tblU25NQ3RuaJJfc`）：产品型号(文本) + 排序号(数字)
- 写入 7 个现有产品，按 1-7 排序
- `getSkusWithInventory()` 改为从 Bitable 读取，按排序号排列，5分钟缓存
- 删除 `SKU_CATALOG` 硬编码数组
- `shared/tables.js`（2份同步）新增 `product_model`
- `CLAUDE.md` + `ARCHITECTURE.md` 同步更新

以后增删产品型号直接在飞书表里操作，不用改代码。

## 2026-04-23 随货同行单改造：统一命名 + 按地址合并

### 改名："随货通行单" → "随货同行单"

统一所有用户可见文本，历史文件（STATE.md/BUGS.md/docs/）不动。

改动文件：
- `public/labels.html` — 3 处（按钮/行操作 title/发货完成弹窗）
- `ARCHITECTURE.md` — 4 处
- `README.md` — 1 处
- `pull-print.js` — 2 处（注释/日志）
- `docs/slip_e2e_report.md`、`test_slip_e2e.mjs`、`run_full_e2e.js`、`test_e2e_5agents.js`

### 业务逻辑：按顾客+收货地址分组

**核心改动：**
- `slipHTML()` — 支持 `orderNos[]` 数组 + `address` 收货地址字段
- `batchSlipHTML()` — **删除**（死代码，被 slipHTML 替代）
- `GET /api/admin/slip-batch` — 分组从 `代理商+快递单号` 改为 `顾客+收货地址`，支持 `key` 查询参数精确跳转
- `GET /api/admin/slip/:orderNo` — 新增 `address` 传入
- `labels.html` — 简化 shipOrders 去掉 agentIds 收集

**新流程：**
```
点"同行单" → slip-batch?date=today
  → 多组：汇总卡片页（每顾客+地址一张卡）
  → 单组：直接渲染同行单
点击卡片 → slip-batch?date=...&key=顾客__地址
  → 渲染该顾客+地址的同行单（含所有订单号+镜片明细）
```

## 2026-04-23 状态链扩展：新增"待签收"

快递签收后自动变更为"已签收"，无需人工点击。

**新状态链：** `待处理 → 生产中 → 已发货 → 待签收 → 已签收`

### 改动

**server.js：**
- `POST /api/admin/deliver` — 写 "待签收"（订单表+镜片明细表）
- `STEP_LABELS` received → "待签收"
- `STATUS_STEP_KEY` — `"待签收": "received"`，移除 "已签收" 映射
- 仪表盘新增 `delivered` 计数器（已签收数）
- 查询/AI 区分"待签收"和"已签收"（"签收"关键词→待签收，"已签收"→已签收）

**logistics.js：**
- 新增 `updateLensRecord()` 函数
- `/webhook/delivered` 回调 — 写 "已签收" + 同步镜片明细表
- 模拟签收 — 同步镜片明细表

**labels.html：**
- 新增 "待签收" 统计卡（青色 #13c2c2）
- CSS：新增待签收行边框色+badge dot
- 行操作：
  - "已发货" → 点"待签收"按钮
  - "待签收" → 同行单+重打标签
  - "已签收" → 只读（仅同行单）
- 底部按钮："标记签收" → "标记待签收"
- 确认弹窗提示"快递签收后将自动变更为已签收"
- 流程图/状态分支更新
- `STEP_NAMES` "签收" → "待签收"
- 同行单按钮可见性：已发货/待签收/已签收均可见

**CLAUDE.md：**
- 核心状态机更新为 5 步
- 开发铁律 5.3 状态流转同步更新

## 2026-04-23 同事测试反馈修复（第三批）

同事反馈 3 个问题：眼别排序不对、备注混入系统信息、速度慢。

### 眼别排序根因修复

**根因：** track.html 第 330 行 `sort` 只按 eye 排序（`a.eye==="右" ? 0 : 1`），不按顾客分组。导致所有人的右眼排前面、所有人的左眼排后面，同一个人的双眼被打散。

**修复：** 所有眼别排序统一为**按顾客姓名分组 → 组内右眼在前、左眼在后**。

| 文件 | 位置 | 修复 |
|------|------|------|
| `track.html` | showDetail 排序 | 旧：只按 eye → 新：customerName + eye |
| `labels.html` | ship-preview 排序 | 同上 |
| `logistics.js` | generateSlip + batchSlip | 同上（行数据新增 customerName 字段） |
| `server.js` | ship-preview API rows | 同上 |
| `server.js` | slip/:orderNo rows | 同上 |

### 备注不再混入系统信息

- 移除 `/api/submit` 中库存扣减失败自动写入备注的逻辑（`[系统] 库存扣减失败: ...`）
- Excel 导出备注只取订单主表字段，不再拼接系统信息
- `buildFactoryExcel` key 改为 `"orderNo|customerName"` 按顾客维度查找

### SPH/CYL 格式化统一

所有显示 SPH/CYL 的位置统一使用 `fmt()` 函数（+/-前缀 + 2 位小数）：

| 位置 | 修复 |
|------|------|
| `slipHTML()` 随货同行单 | `r.sph \|\| "—"` → `fmt(r.sph)` |
| `batchSlipHTML()` 合单通行单 | 同上 |
| `/verify/:lensCode` 验真页 | `String(e.sph ?? "—")` → `fmt(e.sph)` |
| 验真页眼别排序 | 新增 `eyes.sort(右眼在前)` |

### 性能优化

| 优化 | 之前 | 之后 |
|------|------|------|
| 代理商缓存 TTL | 30 秒 | 5 分钟 |
| /api/order/:orderNo | 串行 2 次飞书调用 | Promise.all 并行 |
| order.html init | agent → skus 串行 | 并行加载 |
| track.html init | agent → skus → orders 串行 | agent+skus 并行，orders 不阻塞 |

### Excel 导出简化

- batch-zip 端点从 ZIP（Excel+QR+标签）简化为直接导出 Excel
- `orderInfoMap` key 从纯 orderNo 改为 `"orderNo|customerName"`，每顾客独立信息

### 涉及文件

- `server.js`：眼别排序（2处）+ 备注清理 + Excel导出重构 + SPH/CYL格式化 + 订单详情并行
- `public/track.html`：眼别排序修复 + 前端并行加载
- `public/order.html`：前端并行加载
- `public/labels.html`：眼别排序修复（ship-preview）
- `logistics.js`：眼别排序修复（2处）

## 2026-04-23 导出Excel + 标签预览 + 验真时间修复

### 导出Excel修复
- batch-zip 端点：移除 ZIP 打包（QR/标签/说明.txt），直接返回 `.xlsx`，Content-Type 改为 Excel MIME
- Content-Disposition 中文文件名导致 `ERR_INVALID_CHAR`：改用 RFC 5987 `filename*=UTF-8''...` 编码
- 导出数量固定为 1（按顾客维度，每行一个顾客）
- `buildFactoryExcel` 的 `getInfo()` 支持 `orderNo|customerName` 精确匹配
- 备注只取订单主表 `info.remark`，不再拼接镜片明细 `f["备注"]`
- `quickZip(orderNo)` → `quickZip(orderNo, customerName)`，单行导出也传顾客名

### 标签预览修复
- `buildLabelHtml` / `buildLabelHtmlFromFields`：body 和 .label 的 `height:40mm` + `overflow:hidden` 改为 `min-height:40mm`，预览完整展开
- `labels/batch` 端点新增 `customer` 参数过滤
- `previewSelected()` 改为传顾客名，选中一个顾客只预览她的标签

### 批量打印标签
- "打印标签" 按钮文案改为"批量打印标签"
- `printLabels()` 从浏览器打印改为逐个入队到打印队列（→ 斑马打印机）

### 验真时间修复
- `/verify/:lensCode` 验真时间从订单创建时间改为扫码当前时间

### 随货同行单
- 打印按钮放大：padding 13px 28px，字号 16px，加粗

### 库存扣减提醒
- 移除 `/api/submit` 中库存扣减失败写入订单备注的逻辑（`[系统] 库存扣减失败/异常需人工处理`），仅保留 console.error

## 2026-04-23 pairIndex 透传修复（Review 跟进）

Code review 发现 pairIndex 未透传到 3 处前端函数 + 2 处后端端点，导致多副订单在管理页操作全部作用于第 1 副。

### 修复

| 文件 | 问题 | 修复 |
|------|------|------|
| `server.js:2879` | `/api/admin/orders` mapper 缺 pairIndex | +`pairIndex: f["序号"] \|\| 1` |
| `server.js:2971-2984` | `/api/admin/batch-zip` 不接受 pairIndex | +pairFilter 参数 + 度数级过滤 |
| `server.js:3237-3270` | slip-batch 按 customer+address 分组，多副合并一张 | 改为 customer+pairIndex 分组，多副各自一张 |
| `server.js:3264` | slip 单分组不按 pairIndex 过滤镜片 | +`序号 !== g.pairIndex` 过滤 |
| `labels.html:1725` | quickZip 调用未传 pi | +`${pi}` |
| `labels.html:1938` | quickZip 签名缺 pairIndex | +pairIndex 参数 |
| `labels.html:1944` | quickSlip 签名缺 pairIndex | +pairIndex 参数 + URL 拼接 |
| `labels.html:1949` | quickZplPrint 签名缺 pairIndex | +pairIndex 参数 + POST body |

### 验证覆盖
- 单副全流程不退化
- 同名同型号 2 副独立确认/发货/打印
- 同行单按顾客+序号分组（多副各自一张）
- 工厂 Excel 导出按 pairIndex 过滤
- Dashboard fieldNames 投影不含序号（不依赖，正确）

## 2026-04-24 开发效率提升：Schema 守卫 + 测试整合 + CI

### /simplify 清理（7 项）

server.js 死代码清理：
- 移除未使用解构导入：`getNotifyToken`、`sendUsbZpl`、`clearAgentStockCache`
- 移除死常量 `STOCK_TTL`、死函数 `advanceOrderWorkflow`、死常量 `PRINTER_CONFIG_PATH`
- 移除 3 个占位注释 stub

stock.js 优化：
- `getAgentStockMap` 缓存新增 `recordId`，`deductAgentStock` 复用缓存消除冗余 API 调用

### Bitable 字段修复

- automations.js 模具表 4 个字段名修正：`模芯编号`→`模具编号`、`总寿命（次）`→`总寿命`、`已使用次数`→`已使用`、`剩余次数`→`剩余寿命`
- 订单主表补 5 个字段、镜片明细补序号（通过 API 添加）

### Schema 守卫（check_schema.js）

新增 `check_schema.js`：16 张表字段对比，缺失报错，exit code 1。覆盖订单/镜片/代理商/终端客户/SKU/库存/模具/毛坯/排产/流水等全部表。

### 测试整合（test.mjs）

新增 `test.mjs` 统一测试入口，7 个本地测试 + 2 个云端测试，支持按标签过滤：
```bash
node test.mjs           # 全部本地
node test.mjs schema    # 只跑字段守卫
node test.mjs e2e       # 只跑 E2E
node test.mjs --cloud   # 本地+云端
```
5 个过时测试脚本移入 `tests/archive/`。

### CI（GitHub Actions）

`.github/workflows/ci.yml`：push 触发 → checkout → node 20 → check_schema.js → 失败时飞书通知。
**状态：** ✅ 已推送，CI 首次通过。6 个 Secrets 全部配好（FEISHU_APP_ID/SECRET, NOTIFY_*, ADMIN_TOKEN）。

### E2E 测试

`e2e_full_sim.mjs` 添加 `clientRequestId`（幂等保护要求）。

### 测试结果

| 测试 | 结果 |
|------|------|
| 字段守卫 | ✅ 通过 |
| 库存并发 | ❌ 2/17 失败（测试数据耗尽，非代码问题） |
| E2E 全流程 | 待跑 |
| 统一入口 test.mjs | ✅ 5/7 通过 |

### 待办

- [ ] 推送 ci.yml 到 GitHub（网络恢复后）
- [ ] 验证 CI 触发
- [ ] 库存测试数据补充（SPH=-1 CYL=-0.5 已归零）

---

## 2026-04-23 测试设计 Bug 修复（静态分析 6+3）

测试设计静态分析发现 6 个确认 Bug + 3 个边界场景验证。

### 修复

| # | Bug | 代码位置 | 修复 |
|---|-----|---------|------|
| T5.2/5.3 | 验真页多副串号 | `server.js:2791` samePair | +`srcPi` 序号过滤 |
| T7.2 | deliver 预设签收时间 | `server.js:3445` | 删除"签收时间"字段，仅 webhook 已签收时写入 |
| T6.1/6.2 | 状态机无守卫 | `server.js:3309,3412` | confirm 仅"待处理"、ship 仅"生产中"、deliver 仅"已发货" |
| T1.6 | Rate limit 绕过 | `server.js:1899` | 仅 remoteAddress 为 localhost 时信任 x-forwarded-for |
| T3.2 | 幂等键写入时机 | `server.js:2299` | setIdempotent 移到 Bitable 写入成功后立即执行 |
| — | 幂等键必填 | `server.js:2077` | clientRequestId 缺失返回 400 |

### 边界场景验证（全部 PASS）
- T2: SPH=-6.00/CYL=-2.00 命中常规范围（inRange 闭区间）
- T8: slip-batch pairIndex=2 只含第 2 副处方（line 3279 过滤）
- T9: XSS 转义全覆盖、Bitable filter encodeURIComponent 防注入、异常眼别 fallback 不崩溃

## 2026-04-25 同事 bug 文档修复（飞书汇总）

同事通过飞书文档汇总 bug（https://gausheyetech.feishu.cn/wiki/SZatwFnHLixDCskrhqdcFZNXn7c），交叉对比 STATE.md 已修复记录，定位 4 个未解决 root cause 并修复。

### Root Cause 分析

| Bug | 描述 | 严重度 | Root Cause | 修复 |
|-----|------|--------|-----------|------|
| ④ Excel格式不对 | 有时导出excel格式不对，需手动修改 | 5 | `buildFactoryExcel` 第863行 `"数量": 1` 硬编码，不从订单主表读实际数量 | → `info.quantity \|\| 1` |
| ④ ZIP无Excel | 勾选不同订单号导出zip无excel | 2 | `getLensDetailsByOrder` 无分页（page_size=100 无 page_token 循环），极端情况丢失数据 | → 加分页循环 |
| ⑦-1 按钮没反应 | 点击按钮没反应 | — | `api()`/`adminApi()` 调 `r.json()` 不检查 `r.ok`，服务端 401 返回 HTML → JSON.parse 崩溃 → 批量操作无 try-catch 静默失败 | → adminApi 加 `r.ok` 检查 + confirm/ship/pack/deliver 全加 try-catch |
| ⑧-2 AXIS缺参数 | 手工拼接URL扫出无轴位 | 2 | verify.html 第249行 `getElementById('eyeTag')` 引用不存在元素 → JS TypeError 中断渲染 | → 移除死代码 |

### 涉及文件

- `server.js`：`buildFactoryExcel` 数量修复 + `getLensDetailsByOrder` 分页
- `public/labels.html`：`api()`/`adminApi()` 错误处理 + 4个批量操作 try-catch
- `public/verify.html`：移除 eyeTag 死代码
- `public/track.html`：`exportCsv()` 加 `res.ok` 检查
- `Dockerfile`：添加 `COPY lib/`（模块化重构新增 lib/ 目录）

### 部署

- GitHub commit `74c76eb` + `d98a552`（Dockerfile），网络不通未 push
- ECS SCP 热更新：server.js + lib/ + labels.html + verify.html + track.html → docker cp → restart
- 验证：`/health` 200（41 agents）、batch-zip 200（19KB Excel）、验真页 AXIS=90/85 正确

### 飞书文档中其他状态

| 项 | 状态 |
|----|------|
| ④ Excel格式 | ✅ 已修复（数量从订单主表读取） |
| ④ ZIP无Excel | ✅ 已修复（分页） |
| ⑦-1 按钮没反应 | ✅ 已修复（错误处理） |
| ⑦ 批量打印 | ✅ 已实现（打印队列），待同事验证 |
| ⑦ 标签格式 | ✅ 已实现（ZPL+Code128条形码），待确认是否匹配现用格式 |
| ⑧-1 验证时间 | ✅ 4/21 已修复（扫码当前时间），同事可能用旧版 |
| ⑧-2 AXIS | ✅ 已修复（移除死代码），AXIS 数据正常显示 |
| ⑧ 标签独立化 | 新需求，待讨论 |
| 库存筛选 | 新需求，待讨论 |
| 供应商厂家列 | 新需求，待讨论 |

## 2026-04-25 交期预估迁移：下单页 → 确认回写 + 追踪页显示

### 背景

代理商下单页（order.html）每次输入 SPH/CYL 都调 `/api/delivery-estimate`（双眼患者 = 4 次并发请求），导致页面卡顿。交期预估在下单时非必要信息，确认后才有意义。

### 改动

| 文件 | 改动 |
|------|------|
| `public/order.html` | 删除交期预估 JS + HTML（~50 行）：`onSkuChange`/`onRxChange`/`fetchEstimateForEye`、`delivery-${id}-right/left` div、draft restore 中的 `onSkuChange()` 调用 |
| `server.js` | confirm 端点 `assignLensCodes()` 后新增交期计算：按每个镜片调 `estimateDeliveryByRx()`，取最长天数，写入 `交期类型` + `预计交期` 字段 |
| `server.js` | `/api/orders` 和 `/api/order/:orderNo` mapper 增加 `promiseDate`/`deliveryType` 字段 |
| `public/track.html` | 新增 `deliveryBadge()` 函数，列表行 + 详情弹窗显示交期徽章（有货/排产/定制） |
| `public/css/common.css` | 新增 `.badge-produce` 样式 |

### Bitable 变更

订单主表新增 2 个字段：
- `预计交期`（日期类型）— 已存在
- `交期类型`（文本类型）— 通过 API 创建

### 部署

- SCP 4 个文件（server.js + order.html + track.html + common.css）→ ECS → docker cp → restart
- E2E 验证：提交订单 `ORD-20260425-6977FD3E` → 确认 → `deliveryType: "有货1-2天"`, `promiseDate: 2026-04-27`
- order.html 确认无交期预估代码残留（grep 0 matches）

### 交期判定逻辑（不变）

| 情况 | 文案 | 天数 |
|------|------|------|
| 库存 ≥ 下单量 | 有货1-2天 | 2 |
| 度数在常规范围但库存不足 | 排产5-7天 | 7 |
| 度数超出常规范围 | 定制7-10天 | 10 |

### 未改

- `/api/delivery-estimate` 端点保留（备用）
- `lib/stock.js` 的 `estimateDeliveryByRx()` 不动
- 库存扣减逻辑不动

## 2026-04-25 提交速度优化：封存库存扣减

### 问题

提交接口 `/api/submit` 耗时 ~14 秒，根因是 `getStockMap()` 读全表（~1575 条库存记录，16 页分页）耗时 10.6 秒。

### 改动

- `/api/submit` 移除库存相关调用：`getStockMap()`、`getAgentStockMap()`、`deductStockDetail()`、`deductAgentStock()`
- 移除 `deductionPlan` 收集和扣减逻辑
- 库存扣减代码保留在 `lib/stock.js`（封存，需要时重新启用）

### 效果

提交速度：**14 秒 → 3.5 秒**（缓存命中后）

### confirm 端点 simplify 修复

- 交期计算复用 `estimateDeliveryByRx` 返回的 `deliveryType`/`promiseDate`，不再手动重建映射
- CLAUDE.md 更新：产品目录改为硬编码说明

## 2026-04-25 业务简化 + 代码模块化

### Step 1: confirm 端点去掉实时交期计算

- 删除 confirm 端点中对每个镜片调 `estimateDeliveryByRx()` 的循环（~22 行）
- 确认后 `交期类型` 和 `预计交期` 字段留空，由每日批处理统一填充
- track.html 的 `deliveryBadge()` 对空 `deliveryType` 返回空字符串，安全

### Step 2: Excel 解析增强

- `findCol` 改为支持多别名（`findCol("顾客姓名", "姓名", "客户姓名", "配镜人")`）
- `get()` 函数同步支持多参数
- 表头行检测增加"客户姓名"、"姓名"、"眼别"关键词
- 新增列名别名：近视/度数(SPH)、散光(CYL)、轴(AXIS)、型号/产品/SKU(产品型号)、副数/片数(数量)、说明/特殊要求(备注)、收货人(联系人)、手机(电话)、送货地址(收货地址)

### Step 3: 创建 lib/helpers.js

提取纯工具函数（零外部依赖）：
- `rawVal` — Bitable 字段值解包
- `fmt` — SPH/CYL 格式化（+/-前缀 + 2位小数）
- `fmtAxis` — AXIS 格式化
- `parsePagination` — 分页参数解析

### Step 4: 创建 lib/templates.js

提取 3 个 HTML 模板函数（~320 行）：
- `slipHTML()` — 随货同行单 A4 模板
- `buildLabelHtml()` — 可打印标签 HTML（QR 内嵌 base64）
- `buildLabelHtmlFromFields()` — 从字段直接生成标签

使用 `init({ getServerBaseUrl })` 依赖注入模式。

### Step 5: 创建 lib/factory-export.js

提取工厂导出函数（~155 行）：
- `buildFactoryExcel()` — 生成工厂 Excel
- `buildZipBuffer()` — 最小 ZIP 实现（Store 模式）
- `crc32()` — CRC32 校验（内部函数）

`buildFactoryZip` 留在 server.js（跨模块依赖 templates + QR）。

### 改动文件

| 文件 | 操作 | 行数变化 |
|------|------|---------|
| `server.js` | 修改 | 4267 → 3757（-510 行） |
| `lib/helpers.js` | 新建 | 18 行 |
| `lib/templates.js` | 新建 | 337 行 |
| `lib/factory-export.js` | 新建 | 145 行 |
| `CLAUDE.md` | 更新 | lib/ 模块列表新增 3 个 |

### lib/ 模块全景（8 个）

| 模块 | 行数 | 职责 |
|------|------|------|
| `feishu.js` | 88 | 飞书 API 封装 |
| `stock.js` | 214 | 库存 + 交期判定 |
| `printer.js` | 136 | 打印队列 + ZPL |
| `notify.js` | 106 | 飞书通知 |
| `helpers.js` | 18 | 纯工具函数 |
| `templates.js` | 337 | HTML 模板 |
| `factory-export.js` | 145 | 工厂导出 |
| **合计** | **1044** | |

server.js 从 4267 行降到 3757 行，lib/ 从 544 行增到 1044 行。

## 2026-04-25 /simplify 代码审查 + Bug 修复

### templates.js 标签函数去重

`buildLabelHtml` 和 `buildLabelHtmlFromFields` 共享 ~70 行相同 HTML 模板。

修复：提取 `_renderLabelHtml(f, orderNo)` 内部函数，两个公开函数各 4 行委托调用。

```js
async function _renderLabelHtml(f, orderNo) { /* 共享逻辑 */ }
export async function buildLabelHtml(record, orderNo) {
  const r = await _renderLabelHtml(record.fields, orderNo);
  return r ? { name: `labels/...`, data: Buffer.from(r.html, "utf-8") } : null;
}
export async function buildLabelHtmlFromFields(f, orderNo) {
  const r = await _renderLabelHtml(f, orderNo);
  return r ? { orderNo, customer: r.customer, eye: r.eye, lensCode: r.lensCode, html: r.html } : null;
}
```

### buildFactoryZip 并行化

原代码逐条 `await buildLabelHtml`（每条含 QR 生成），改为 `Promise.all` 所有标签同时生成。

```js
// Before: sequential for loop
// After:
const labelEntries = await Promise.all(records.map(async (rec) => { ... }));
files.push(...labelEntries.flat());
```

### feishu.js getFeishuToken URL 修复

**Bug：** `BASE = "https://open.feishu.cn/open-apis"`，但 `getFeishuToken` 再拼 `${BASE}/open-apis/auth/v3/...`，导致双重 `/open-apis/open-apis/...` → 404 → token 获取失败 → 所有代理商 API 401。

**修复：** `${BASE}/open-apis/auth/v3/...` → `${BASE}/auth/v3/...`

**验证：** `curl /api/agent?t=AG-002-zxkmgoryb6nprmv6` → 200 `{"id":"AG-002","name":"测试代理商"}`

### E2E 测试结果

`e2e_full_sim.mjs` 6/7 步通过：

| 步骤 | 状态 | 涉及改动 |
|------|------|---------|
| 1. 下单 | ✅ | helpers.js |
| 2. 确认 | ✅ | confirm 去掉交期计算 |
| 3. ZIP 导出 (18.8KB) | ✅ | factory-export.js + 并行化 |
| 4. 发货 | ✅ | — |
| 5. 标签预览 (4张) | ✅ | templates.js 去重 |
| 6. 签收 | ✅ | — |
| 7. 最终状态 | ❌ | 预期"已签收"实为"待签收"（预置问题：deliver 设置待签收，已签收由快递回调触发） |

`check_schema.js` ✅ 通过。

### 华为云部署 + 全量回归

Docker 镜像构建 → SWR 推送 → ECS `docker compose pull && up -d`，容器重建成功。

`test_cloud_regression.mjs`（`https://lab.gaushclear.com`）：**65/79 通过，14 项失败**。

| 类别 | 数量 | 说明 |
|------|------|------|
| 核心流程 | ✅ 65 | 下单→确认→发货→签收→导出→标签 全部正常 |
| 验真单眼展示 | ❌ 5 | ⑧-1/⑧-2 验真页应只显示单眼（已知业务逻辑问题） |
| Excel 联系人 | ❌ 1 | ④-3 导出缺少联系人信息（已知问题） |
| 最终状态验证 | ❌ 8 | Part 8 "全部已签收"检查失败（Bitable 写入延迟，签收步骤本身 ✅） |

**结论：** 本次改动（模板去重、并行化、feishu URL 修复）未引入回归。14 项失败均为已知问题或测试时序问题。

## 2026-04-27 工厂导出修复 + 库存/供应商内联筛选

### Excel 格式修复

| Bug | 修复 |
|-----|------|
| `orderInfoMap` 回退到第一个值，多顾客拿到同一联系人 | 删除 `Object.values(orderInfoMap)[0]` 回退 |
| `Number()` 对空值产生 NaN 写入 Excel | 加 `isFinite()` 检查 |

### batch-zip 无数据提示

- 跳过的订单记录到 `skipped` 数组
- 404 返回 `"所选 N 个订单均无匹配镜片数据（可能未确认或已过滤）"` + skipped 详情

### 库存/供应商内联筛选

labels.html 表格新增两列（装配和状态之间）：
- **是否有库存** — 下拉：`-` / `有库存` / `无库存`，选中即保存
- **供应商** — 下拉：`-` / `九次方` / `圣谱` / `欧陆`，选中即保存

保存逻辑：`inlineFieldUpdate()` → `POST /api/admin/update-field` → 飞书 Bitable

### 供应商厂家字段

- 启动时自动创建 `供应商厂家` 单选字段（九次方/圣谱/欧陆）
- 合并 `ensureLensCodeField` + `ensureSupplierField` 为通用 `ensureField(name, def)`

### 交期类型常量化

`lib/stock.js` 导出 `DELIVERY_IN_STOCK` / `DELIVERY_PRODUCE` / `DELIVERY_CUSTOM` 常量，替代硬编码字符串。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `lib/factory-export.js` | orderInfoMap 回退修复 + NaN 防护 |
| `lib/helpers.js` | `fmt()` 增加 `isFinite` 检查 |
| `lib/stock.js` | 导出交期类型常量 |
| `server.js` | `POST /api/admin/update-field` 端点 + `ensureField` 通用化 + confirm 支持 stockStatus/supplier |
| `public/labels.html` | 表格新增库存/供应商内联下拉列 |

### 测试

| 场景 | 结果 |
|------|------|
| Excel 导出（空值不产生 NaN） | ✅ |
| batch-zip 无数据返回 skipped | ✅ |
| 内联下拉选中即保存 | ✅ |
| 筛选 `stock=yes` | ✅ 3 单 |
| 筛选 `supplier=圣谱` | ✅ 1 单 |
| 确认订单 + 写入交期类型/供应商 | ✅ |

## 2026-04-26 标签打印重构：双模式打印 + 格式重写

### 背景

助理反馈三个问题：
1. "入队打印"按钮无功能（依赖 pull-print.js 守护进程，未运行则任务永久滞留）
2. 标签打印和随货同行单需要可靠的批量打印
3. 标签格式需改为物理标签样式：每只眼独立一张，带条形码

### 方案：双模式打印

- **浏览器打印**（普通打印机 + 不干胶纸）→ HTML 标签 + `window.open()` + 浏览器 `print()`
- **斑马打印机**（ZPL + pull-print.js）→ 保留入队打印，改名"斑马打印"

### 改动文件

| 文件 | 改动 |
|------|------|
| `lib/templates.js` | 标签布局重写：`_buildLabelFragment()` 生成片段（条形码 SVG + 处方 + QR），`_renderLabelHtml()` 包装完整页面（含 JsBarcode CDN），`buildPrintPage()` 批量打印页。提取 `LABEL_CSS` 常量消除 CSS 重复 |
| `lib/printer.js` | `buildZpl()` 坐标重排匹配新格式：条形码 → 产品型号 → 客户名+眼别 → 处方 → QR → 镜片码 |
| `server.js` | 新增 `GET /api/admin/labels/print` 端点（并行查询 + 批量生成可打印 HTML） |
| `public/labels.html` | 按钮重构："打印标签"🖨（浏览器打印）、"斑马打印"🖨（ZPL 入队）。新增 `printSelectedLabels()`、`quickLabelPrint()`。`handleScan()` 复用 `quickLabelPrint()`。`testPrinter()` 改为浏览器测试标签 |

### 新 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/admin/labels/print` | 批量生成可打印标签 HTML 页面（支持 orderNos/customer/pairIndex 过滤） |

### 标签格式（75mm×40mm）

```
┌──────────────────────────────────────────────┐
│  ▮▮▮▮ Code128 条形码（订单号）▮▮▮▮▮▮▮▮▮▮▮   │
│  时空之眼PRO     顾客姓名       ┌─────────┐ │
│  R 右眼                          │ QR code  │ │
│  SPH     CYL     AXIS            └─────────┘ │
│  -3.00   -1.25    180                        │
│  ABCDEF1234567890       AG-001 测试代理商     │
└──────────────────────────────────────────────┘
```

每只眼独立一张标签（左眼/右眼分开包装）。

### /simplify 清理

- CSS 重复 ~25行 → 提取 `LABEL_CSS` 常量
- `handleScan` 复用 `quickLabelPrint()`
- `/labels/print` 端点 N+1 → `Promise.all` 并行查询
- `buildPrintPage` QR 顺序生成 → `Promise.all` 并行

### 本地测试（4/26）

服务器 `node server.js` 本地启动，所有端点验证通过：

| 测试 | 结果 | 耗时 |
|------|------|------|
| `/health` | 200 ✅ 飞书连通，41 代理商 | 706ms |
| `/api/admin/orders` | 200 ✅ 返回订单列表 | 657ms |
| `/api/admin/labels/print` 单订单 | 200 ✅ 1张标签（含条形码 SVG + QR base64 + JsBarcode CDN） | 1950ms |
| `/api/admin/labels/print` 双订单 | 200 ✅ 3张标签（Promise.all 并行查询） | 1277ms |
| `/labels` 管理页 | 200 ✅ 页面加载正常 | — |

标签 HTML 验证：
- Code128 条形码 SVG：`data-value="ORD-20260425-4AF80D28"` ✅
- QR 验真码：base64 data URL ✅
- 眼别标签：`R 右眼`（红色 #c0392b）✅
- JsBarcode CDN + `.init()` 调用 ✅

### 待验证（同事测试）

- [ ] 浏览器打印标签格式是否匹配物理标签
- [ ] 条形码扫码是否可识别（Code128 + JsBarcode）
- [ ] 批量打印分页是否正常
- [ ] 斑马打印（pull-print.js）是否正常
- [ ] 随货同行单批量打印是否正常

## 2026-04-26 订单管理中心空白修复 + Dashboard 数据修复

### Bug 1: Dashboard 控制中心无数据

**现象：** `/control` 页面仪表盘所有指标为 0（总库存、订单数、代理商数全部空）。

**根因：** `lib/feishu.js` 的 `listRecords()` 函数 `fieldNames` 参数格式错误。
- 错误：`field_names=当前库存,安全库存,SKU编号`（逗号分隔字符串）
- 正确：`field_names=["当前库存","安全库存","SKU编号"]`（JSON 数组）

飞书 Bitable API 要求 `field_names` 是 JSON 数组格式，错误格式导致 API 返回空结果。Dashboard 调用 `listRecords` 时传了 `fieldNames`，而 `/api/admin/stock-detail` 等端点不传 `fieldNames`，所以不受影响。

**修复：** `lib/feishu.js` 第 60 行，`fieldNames.map(encodeURIComponent).join(",")` → `encodeURIComponent(JSON.stringify(fieldNames))`

### Bug 2: labels.html 订单管理页空白

**现象：** `/labels?admin=xxx` 页面显示"共 0 笔订单"，所有统计为 0，但 API `/api/admin/orders` 返回 99 条数据正常。

**根因：** labels.html 内联 JS 有两个语法错误，导致整个 `<script>` 块解析失败，`loadOrders()` 等所有函数未定义。

1. **`packOrders()` 函数缺少闭合 `}`** — for 循环结束后直接开始 `shipOrders()`，函数未关闭（line 2063）
2. **模板字符串内 `</script>` 提前关闭外层 script 标签** — `testPrinter()` 函数的 HTML 模板包含 `<script>...</script>`，浏览器 HTML 解析器遇到 `</script>` 就关闭了外层 script 块，导致后续初始化代码（`loadOrders()`）全部失效（line 2624）

**修复：**
- `packOrders()` 补上闭合 `}` + showToast + loadOrders 调用
- 模板字符串 `</script>` → `<\/script>` 转义

### 改动文件

| 文件 | 改动 |
|------|------|
| `lib/feishu.js` | `listRecords` fieldNames 格式修复（1 行） |
| `public/labels.html` | `packOrders()` 闭合 + `testPrinter()` 转义（3 行） |

### 部署

- SCP 两个文件到 ECS → docker cp → restart
- 验证：dashboard 返回 5377 库存 / 99 订单 / 41 代理商；labels 页面正常显示订单列表

## 2026-04-27 库存×订单打通：自动查库存 + 发货扣库存

### 背景

订单管理流程中，助理需要手动判断"有库存/需生产"和选择供应商。库存与订单没有自动关联，扣减也完全手动。需要打通库存系统与订单系统。

### 设计决策

- 供应商分配：混合模式（系统推荐 + 助理可覆盖）
- 库存扣减：发货时扣减（确认只标记状态，发货才扣库存）
- 补货：规则自动（rule13/14）+ 手动补充

### 改动文件

| 文件 | 改动 |
|------|------|
| `lib/feishu.js` | 新增 `filterRecords()` 单条查询函数（飞书 search API，~200ms） |
| `lib/stock.js` | 新增 `queryStockByRx()` 单条库存查询；init 增加 `filterRecords` 参数 |
| `server.js` | 新增 `GET /api/admin/order-stock-check`（确认前自动查库存+推荐供应商） |
| `server.js` | 修改 `POST /api/admin/confirm` 保存"库存状态"字段 |
| `server.js` | 修改 `POST /api/admin/ship` 发货时自动扣库存+写流水（有库存订单） |
| `server.js` | `ensureFields` 增加"库存状态"单选字段（有库存/需生产/定制） |
| `server.js` | `/api/admin/orders` 返回 `stockStatus` 字段 |
| `server.js` | 新增 `inRange()` 辅助函数 |
| `public/labels.html` | 订单列表增加"库存"列（绿色=有库存，橙色=需生产，红色=定制） |
| `public/labels.html` | 展开详情增加每只眼库存量显示 |
| `public/labels.html` | 库存状态下拉改为"有库存/需生产/定制"（原"有库存/无库存"） |
| `public/labels.html` | 新增 `stockStatusBadge()` + `autoCheckStock()` 函数 |
| `public/labels.html` | 确认弹窗自动查库存，预填库存状态和供应商 |
| `rules_config.json` | 新增 `supplier_map` 段（7个SKU × 3个供应商映射） |

### 新 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/admin/order-stock-check` | 确认前自动查库存+推荐供应商（orderNo/customerName/pairIndex） |

### 核心流程

```
确认订单：
1. 助理展开订单详情 → 自动调用 /api/admin/order-stock-check
2. 系统查每只眼的库存量 → 显示在处方表格中
3. 预填"库存状态"（有库存/需生产/定制）+ 推荐供应商
4. 助理可修改预选值 → 点确认 → 保存到订单记录

发货订单：
1. 读订单的"库存状态"字段
2. 如果是"有库存" → 自动扣减 stock_detail + 写 stock_movement 出库流水
3. 扣库存失败不阻断发货（库存是记录，物流是核心）
4. 继续原有发货逻辑（快递单号、通知等）
```

### 供应商映射配置

```json
{
  "supplier_map": {
    "Ultra双效": { "in_stock": "九次方", "out_of_stock": "九次方" },
    "D8": { "in_stock": "圣谱", "out_of_stock": "圣谱" },
    "时空之眼A/B/PRO/MAX": { "in_stock": "欧陆", "out_of_stock": "欧陆" },
    "小旋风": { "in_stock": "九次方", "out_of_stock": "九次方" }
  }
}
```

助理可在 rules_config.json 修改，也可在飞书规则配置表覆盖。

### 部署

- SCP 5 个文件到 ECS → docker cp → restart
- 验证：health 200、stock-check API 正确返回库存+供应商推荐

### 测试结果

| 测试 | 结果 |
|------|------|
| stock-check API（Ultra双效 SPH=-2/-1.75） | ✅ 有库存(70/40)，推荐九次方 |
| stock-check API（Ultra双效 SPH=-3/-3.5） | ✅ 需生产(0/0)，推荐九次方 |
| labels.html 语法检查 | ✅ JS OK |

## 2026-04-27 工厂导出修复 + 库存/供应商内联筛选 + 验真修复

### Excel 格式修复（lib/factory-export.js）

| Bug | 修复 |
|-----|------|
| `orderInfoMap` 回退到 `Object.values(orderInfoMap)[0]`，多顾客拿到同一联系人 | 删除危险回退，匹配失败返回 `{}` |
| `Number()` 对空值产生 NaN 写入 Excel | 加 `isFinite()` 检查 |

### batch-zip 无数据提示（server.js）

- 跳过的订单记录到 `skipped` 数组
- 404 返回 `"所选 N 个订单均无匹配镜片数据（可能未确认或已过滤）"` + skipped 详情

### 库存/供应商内联筛选（labels.html + server.js）

labels.html 表格新增两列（装配和状态之间）：
- **是否有库存** — 下拉：`-` / `有库存` / `无库存`，选中即保存
- **供应商** — 下拉：`-` / `九次方` / `圣谱` / `欧陆`，选中即保存

保存逻辑：`inlineFieldUpdate()` → `POST /api/admin/update-field` → 飞书 Bitable

### 供应商厂家字段（server.js）

- 启动时自动创建 `供应商厂家` 单选字段（九次方/圣谱/欧陆）
- 合并 `ensureLensCodeField` + `ensureSupplierField` 为通用 `ensureField(name, def)`

### 交期类型常量化（lib/stock.js）

`lib/stock.js` 导出 `DELIVERY_IN_STOCK` / `DELIVERY_PRODUCE` / `DELIVERY_CUSTOM` 常量，替代硬编码字符串。

### fmt() isFinite 修复（lib/helpers.js）

`fmt()` 从 `isNaN` 改为 `isFinite`，`Infinity` 值现在返回 `"--"`。

### 验真页修复（server.js）

| 问题 | 修复 |
|------|------|
| 验证时间显示 UTC（差8小时） | `toLocaleString("zh-CN")` → 加 `{ timeZone: "Asia/Shanghai" }` |
| 双眼显示 | 代码已支持（同订单同客户同序号的双眼都会显示） |

### 测试

| 场景 | 结果 |
|------|------|
| Excel 导出（空值不产生 NaN） | ✅ |
| batch-zip 无数据返回 skipped | ✅ |
| 内联下拉选中即保存 | ✅ |
| 筛选 `stock=yes` | ✅ 3 单 |
| 筛选 `supplier=圣谱` | ✅ 1 单 |
| 确认订单 + 写入交期类型/供应商 | ✅ |
| 验真页时间（Asia/Shanghai） | ✅ `2026/4/27 00:55:23` |
| 验真页双眼（83668705B5817649） | ✅ 右眼+左眼 |

### 部署

- SCP server.js + lib/ + labels.html → ECS → docker cp → restart
- 验证：labels.html 新功能 7 处匹配、suppliers API 返回、验真时间正确

## 2026-04-27 订单状态流程重构

### 需求

助理要求在"已下单"和"待处理"之间增加审核环节，导出Excel时自动推进状态，支持逐级退回。

### 新状态机

```
已下单 → 待处理 → 生产中 → 已发货 → 待签收 → 已签收
  ↑         ↑         ↑
  └─────────┴─────────┘  退回（逐级，不可跨级）
```

操作栏映射：
| 订单状态 | 操作按钮 | 颜色 |
|---------|---------|------|
| 已下单 | 待确认 | 蓝色 #1677ff |
| 待处理 | 已确认（只读）| 紫色 #722ed1 |
| 生产中 | 已确认（只读）| 紫色 #722ed1 |

### 核心流程

```
1. 代理商下单 → 飞书写入"已下单" → 管理页显示蓝色"待确认"
2. 助理选库存/供应商 → 点"待确认" → confirm端点赋镜片码 → 状态变"待处理"
3. 助理筛选+全选 → 点"导出Excel给工厂" → 下载Excel + 状态自动变"生产中"
4. 退回：每行有退回按钮，逐级退回（生产中→待处理→已下单）
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `server.js` | STATUS_STEP_KEY新增"已下单"、submit状态改为"已下单"、confirm状态守卫改为"已下单"→"待处理"、新增revert端点、batch-zip导出自动变生产中、stats新增ordered |
| `public/labels.html` | 统计卡片新增已下单、getQuickAction适配新状态、confirmOrders适配、新增revertOrder函数、downloadExcel自动刷新、筛选栏适配 |
| `public/track.html` | 统计卡片+筛选栏新增已下单 |
| `public/control.html` | Dashboard新增已下单指标 |
| `public/css/common.css` | 新增badge-ordered样式 |
| `lib/notify.js` | 通知文案"待处理"→"待确认" |
| `CLAUDE.md` | 状态机更新为6步+可退回 |
| `ARCHITECTURE.md` | 状态机更新 |
| `README.md` | 核心流程+状态流转更新 |
| `e2e_test.mjs` | 订单状态→已下单 |
| `test_challenge.mjs` | 断言适配新状态 |
| `setup_tables.js` | 订单状态选项新增已下单 |
| `automations.js` | 规则引擎处理已下单状态 |
| `dashboard.js` | 新增ordered统计 |
| `qrcode-webhook/utils/feishu_api.py` | 状态文案适配 |
| `run_logistics_14.js` | 测试脚本适配 |

### 新增 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/admin/revert` | 退回上一步（生产中→待处理→已下单）|

### batch-zip 端点增强

导出Excel成功后，自动把"待处理"状态的订单改为"生产中"（同步订单主表+镜片明细表+工作流）。

### assignLensCodes 修复

镜片明细表状态从"生产中"改为"待处理"（与confirm端点逻辑对齐）。

### 测试结果

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | 提交订单 | ✅ 状态=已下单 |
| 2 | 确认订单 | ✅ 赋镜片码，状态→待处理，明细→待处理 |
| 3 | 导出Excel | ✅ 下载18KB文件，状态→生产中，明细→生产中 |
| 4 | 退回（生产中→待处理） | ✅ 成功退回 |
| 5 | 退回（待处理→已下单） | ✅ 成功退回 |
| 6 | 统计 | ✅ 已下单=1，待处理=77，生产中=7 |

### 部署

- SCP 17个文件到 ECS → docker cp → restart
- 验证：健康检查200、统计显示已下单=1、41个代理商正常

## 2026-04-27 状态机重构：引入「打标签」状态，移除废弃状态

### 背景

对照权威业务流程文件（核心业务流程完整的订单状态.md），发现代码状态机与业务不符，本次完整对齐。

### 权威状态机（最终版）

```
提交订单 → 已下单 → 待处理 → 生产中 ─┬→ 打标签 → 已发货
                  └→ 打标签（有库存）  └→ 已发货（供应商直发）
```

三条路径：
- **A 有库存**：已下单 → 打标签 → 已发货
- **B 无库存外发**：已下单 → 待处理 → 生产中 → 打标签 → 已发货
- **C 供应商直发**：已下单 → 待处理 → 生产中 → 已发货

### 废弃状态

| 废弃状态 | 原因 |
|---------|------|
| ~~待签收~~ | 不在权威业务流中 |
| ~~已签收~~ | 不在权威业务流中 |

### 改动文件（共4个，20处）

#### server.js
| 位置 | 改动 |
|------|------|
| STEP_ORDER/STEP_LABELS | 删除 qc_done/packed/received，加 labeled→"打标签" |
| STATUS_STEP_KEY | 加"打标签":"labeled"，删"待签收":"received" |
| /api/order/:no/confirm | 删除（废弃的代理商端confirm端点） |
| stats 两处 | labeled 替换 received/delivered |
| /api/admin/confirm | 新增：读记录中库存状态字段，有库存→打标签，无库存→待处理；工作流步骤动态(labeled/confirmed) |
| REVERT_MAP | 加"打标签":"已下单" |
| revert workflow | 退回到已下单时同时清除 confirmed/producing/labeled 步骤 |
| /api/admin/ship 守卫 | 接受"生产中"和"打标签"均可发货 |
| /api/admin/deliver | 废弃，已发货为终态，调用返回错误 |
| NL搜索 | 加打标签匹配，删待签收/已签收 |
| AI问答 | 问答文案更新，删已签收/待签收统计 |
| ensureFieldOption | 启动时自动注册"打标签"选项到Bitable |

#### public/labels.html
| 位置 | 改动 |
|------|------|
| CSS stat-card | 替换待签收/已签收样式为打标签（紫色 #531dab） |
| CSS data-row | 替换待签收/已签收行颜色为打标签 |
| stat卡片 HTML | 删待签收/已签收，加打标签（🏷 statLabeled） |
| 流程步骤描述 | "签收确认"→"确认发货"，文案更新 |
| 状态流显示 | 待处理→生产中→打标签→已发货 |
| dotMap/clsMap | 删待签收/已签收，加打标签:badge-labeled |
| STEP_KEYS/STEP_NAMES | 5步对齐新状态机 |
| avgDays | avgDaysLabeled 替换 avgDaysReceived |
| statLabeled | s.labeled 替换 s.received/s.delivered |
| getQuickAction | 打标签加退回按钮，生产中显示⚙️，加打标签🏷显示，删待签收/已签收条件 |

#### public/track.html
| 位置 | 改动 |
|------|------|
| stat栏 | 已签收→打标签（statLabeled） |
| 筛选器 | 已签收→打标签 |
| badge映射 | 加打标签:badge-labeled，删已签收 |
| stat更新JS | statLabeled 替换 statReceived |

#### logistics.js
| 位置 | 改动 |
|------|------|
| ship 筛选 | 加 OR CurrentValue.[订单状态]="打标签" |
| simulateDelivery | 去除已签收状态写入 |
| webhook签收回调 | 去除已签收状态写入，仅发飞书通知 |

### 新增文件

- `订单流程图-权威版.md` — 完整业务流程图文档（含三条路径时序、状态详情、API对照）

### 语法检查

`node --check server.js` → SYNTAX_OK

### 待部署

部署命令：
```bash
scp -i 密钥/key-gaush-lab.pem server.js public/labels.html public/track.html logistics.js 订单流程图-权威版.md root@113.44.175.221:/tmp/
ssh -i 密钥/key-gaush-lab.pem root@113.44.175.221 "docker cp /tmp/server.js order-app:/app/server.js && docker cp /tmp/public/labels.html order-app:/app/public/labels.html && docker cp /tmp/public/track.html order-app:/app/public/track.html && docker cp /tmp/logistics.js order-app:/app/logistics.js && docker restart order-app"
```

## 2026-04-28 标签Excel导出 + 验真地址修正

**新增功能：** labels-print.html 新增"导出Excel"功能，可导出供其他打印机识别的 Excel 文件。

**改动文件：**
- `lib/factory-export.js` — 新增 `buildLabelExportExcel()` 函数
- `server.js` — 新增 `GET /api/admin/labels/export-excel` 端点
- `public/labels-print.html` — 操作栏加"导出Excel"按钮 + 每行加单眼导出按钮

**Excel 格式：** 姓名 / 型号 / 眼别 / 球镜 / 柱镜 / 轴位 / 二维码 / 日期
- Sheet 名：`病人片数据_完美版`
- 二维码链接：`https://lab.gaushclear.com/verify/{lensCode}`

**使用方式：**
- 批量导出：勾选订单 → 点"导出Excel"
- 单眼导出：每行操作列点紫色导出按钮

**验真地址修正：** 从 `shuang.gaushclear.com/#/?barcode=` 改为 `lab.gaushclear.com/verify/`

**部署：** server.js + lib/factory-export.js 已推送 ECS，容器已重启。

## 2026-04-28 标签模板优化 + ZT410 600dpi 适配

**HTML标签模板（templates.js）：**
- 条形码高度 30→22，字体 10→8
- 处方间距 gap 0.8mm→0.3mm
- 客户名 9pt→8pt，眼别 8pt→7pt，处方值 9pt→8.5pt
- 整体更紧凑，接近斑马打印原始效果

**ZPL模板（printer.js）：**
- 画布从 600×320 dots（203dpi）→ 1776×945 dots（600dpi）
- 所有坐标按 2.96 倍放大
- 条形码 BY2→BY4，QR magnification 2→6
- 默认配置 DPI 203→600

**部署：** templates.js + printer.js 已推送 ECS。

## 2026-04-29 草稿缓冲系统（快速提交 + 编辑修改）

### 背景
代理商下单提交需要 3-5s（Bitable 写入 + 库存扣减），且提交后无法修改。改为本地草稿缓冲 + 后台异步同步。

### 改动

**服务端（server.js）：**
- `POST /api/submit` — 改为存本地 `drafts/{orderNo}.json`，即时返回（~50ms），不再直接写 Bitable
- `GET /api/drafts?t=xxx` — 代理商草稿列表
- `GET /api/draft/:orderNo?t=xxx` — 单个草稿详情
- `DELETE /api/draft/:orderNo?t=xxx` — 取消草稿
- `processPendingDrafts()` — 后台异步同步草稿→Bitable：写入订单主表+镜片明细表+预占库存+异步生成镜片码+飞书通知
- `POST /api/submit` 支持 `orderNo` 参数用于编辑模式
- `GET /api/orders` — 合并草稿与 Bitable 订单，新增 `stats.draft` 统计
- `GET /api/order/:no` — 找不到 Bitable 记录时回退到草稿
- 启动时创建 `drafts/` 目录 + 5s 后首次同步 + `setInterval` 每 2 分钟轮询

**前端（order.html）：**
- 支持 `?t=TOKEN&edit=ORDERNO` 编辑模式：加载草稿数据预填表单
- 提交时区分新建/编辑文案
- 编辑模式提交携带 `orderNo` 更新草稿

**前端（track.html）：**
- 新增「待同步」状态 badge + 筛选选项 + 统计
- 草稿订单显示「编辑」「取消」按钮
- `cancelDraft()` 函数

**样式（common.css）：**
- 新增 `.badge-draft` 样式（橙色）

### 部署说明
- 涉及文件：server.js, public/order.html, public/track.html, public/css/common.css
- 首次启动自动创建 `drafts/` 目录
- 草稿缓冲时间：30 分钟（DRAFT_AGE_MIN），轮询间隔：2 分钟（DRAFT_SYNC_INTERVAL）

## 2026-04-30 确认订单并行优化 + 批量确认

### 后端（server.js）
- 确认循环从 `for` 串行改为 `Promise.all` 并行，多条订单的镜片码生成/QR写入/Bitable更新同时进行
- 所有 `continue` 改为 `return`，适配 Promise.map 模式

### 前端（orders.html）
- `confirmOrders()` 改为一次性提交所有 orderNo，去掉逐条串行调用
- 点击后按钮显示"确认中..."，防重复点击，完成后恢复

### 部署说明
- 涉及文件：server.js, public/orders.html
- 已部署 ECS

## 2026-05-10 成品入库扫码系统

### 新功能
- 条码规则：`{型号缩写}-{SPH×100}-{CYL×100}`，如 `ULT-300-075`（Code128格式）
- 型号缩写表：ULT/D8/TKAA/TKAB/TKAP/TKAM/XFJ（硬编码，跟 SKU_CATALOG 同源）

### server.js
- 新增 `SKU_ABBR` 映射表 + `decodeBarcode()` + `encodeBarcode()` 函数
- 新增路由：`/inventory-barcode`、`/inventory-inbound`、`/inventory-outbound`
- 新增 `GET /api/inventory/sku/:barcode`：条码解码 → queryStockByRx → 返回库存
- 新增 `GET /api/inventory/outbound-requirements/:orderNo`：从 lens_detail 聚合出库需求（按 SKU+SPH+CYL 分组，不区分眼别）

### 新增页面
- `public/inventory-barcode.html`：条码标签打印页，JsBarcode CDN渲染，按型号筛选/只显示有库存，浏览器打印
- `public/inventory-inbound.html`：扫码入库，Enter触发，复用 `/api/admin/stock-movement`（type=入库/source=采购到货）
- `public/inventory-outbound.html`：出库验货，输入订单号→加载需求→逐条扫码→全部✅解锁出库，强制拦截不符条码；`extractOrderNo()` 支持URL格式/ORD-正则/手动三种录入方式（含扫码枪）

### 部署说明
- 涉及文件：server.js, public/inventory-barcode.html, public/inventory-inbound.html, public/inventory-outbound.html
- 不需要改 Bitable 结构，条码在运行时动态计算，不落库
- 已部署 ECS（2026-05-10）

## 2026-05-10 批量发货系统

### 设计原则
- 与常规订单（ORD-）完全隔离：批量单用 BLK- 前缀，不写 order 表
- 无客户名：代理商级别下单，lens_detail.顾客姓名 = 代理商名
- 部分发货：库存不足时只发可发数量，shortage 记录在JSON

### server.js
- 新增 `BULK_DIR`（drafts/bulk/）、`genBulkNo`、`saveBulk`、`loadBulk`、`listBulks`
- 新增路由：`/bulk-order`、`/bulk-labels`、`/bulk-statement`
- 新增 7 个 API：
  - `POST /api/bulk/preview` — 库存预检（不写数据）
  - `POST /api/bulk/submit` — 预占库存 + 赋码(randomBytes×8) + 写lens_detail + QR预生成
  - `POST /api/bulk/fulfill/:blkNo` — convertReservation扣库存 + 写stock_movement + 状态→已出库
  - `POST /api/bulk/ship/:blkNo` — 录快递单号 + 状态→已发货
  - `GET /api/bulk/list` — 列表（可按agentId/status筛选）
  - `GET /api/bulk/labels/:blkNo` — 调用buildPrintPage生成标签HTML
  - `GET /api/bulk/:blkNo` — 详情

### 验真页修复（verify.html + server.js）
- `isBulk = orderInfo.orderNo.startsWith("BLK-")`
- BLK-分支：隐藏订单号行（`display:none`）、隐藏顾客姓名、眼别列为空、单行处方展示
- ORD-分支：原有逻辑完全不变

### 新增页面
- `public/bulk-order.html`：手动/Excel两种录入，库存预检表格，部分发货提示
- `public/bulk-labels.html`：批量单列表，出库+自动打开标签页，快递单号录入发货
- `public/bulk-statement.html`：按代理商+月份查询，展开明细，导出Excel（XLSX CDN）

### 端到端测试（2026-05-10）
- BLK-20260510-969F14 / 镜片码 D6C3D399F82ED945 / Ultra双效 -3.00/-0.75
- 全流程通过：预检→提交→出库→验真页正常显示


## 2026-05-10 orders.html 三项修复 + 死代码清理

### 改动
- 删除「有无库存」列（表头+行内select+筛选栏 filterStock）
- 筛选 bug 修复：查询按钮重置页码、状态卡与下拉冲突（filterStatus onchange 补 activeQuickFilter）、超期分页 pageSize 9999
- 确认按钮显示处理单数
- server.js filterStock 死代码清理（参数读取+2行过滤逻辑）
- server.js 文件损坏恢复（286KB 空字节 git restore）

### 涉及文件
- public/orders.html
- server.js

## 2026-05-16 序列号映射系统 + 同行单货位列 + 异常处理三功能

### 变更概述
本次会话实现两大功能：①异常处理三功能（改单/发错货/退货）；②仓库序列号映射入系统并在同行单展示货位。

### 异常处理三功能（已实现，UI暂未启用）
- `POST /api/admin/modify-rx`：改单（改SPH/CYL/AXIS），若非已下单状态则先退回
- `POST /api/admin/wrong-shipment`：发错货标记（备注追加"【发错货 MM/DD】"）
- `POST /api/admin/return-order`：退货（已发货/已签收→已退货，备注追加原因）
- `labels-clean.html`：三个 JS 函数已实现（modifyRx/wrongShipment/returnOrder），getQuickAction 中按钮已注释，启用时取消注释即可
- 状态机新增：已退货（终态），`status-dot.returned` 红色样式

### 序列号映射系统
- 新建 `lib/sku-serial.js`：219条记录，双索引（序列号精确查/SPH+CYL反查）
  - 001-020：完整数据（SPH/CYL来自Top20确认 + 货位来自仓库设计文档）
  - 021-024, 026-061（A区）, 062-067, 075-104（B区）：货位已知，SPH/CYL待补录
  - 025, 068-074, 105-219：bin=null（待分配）
- 新增 `GET /api/admin/sku-serial-map`（支持 ?serial=, ?sph=&cyl=, 无参数返回全量）

### 同行单货位列
- `lib/templates.js` 同行单新增「序列号」「货位」两列
- lookupBySphCyl(sph, cyl) 查映射，Top20 SKU 直接显示序列号+货位，未映射显示"—"
- 新增 `td.serial`/`td.bin` CSS 样式

### 测试
- `test_serial_slip.mjs`：102/102 通过（总量/Top20/浮点容忍/B类货位/待分配/slipHTML列生成）

### 涉及文件
- server.js（新增import + 2个端点段 + GET /api/admin/sku-serial-map）
- lib/sku-serial.js（新建）
- lib/templates.js（新增import + 两列 + CSS）
- public/labels-clean.html（异常处理JS函数 + UI注释）
- test_serial_slip.mjs（新建）

## 2026-05-23 导出状态筛选器完整修复

### 问题
- filterExport 下拉选择后无反应（无 onchange），需手动点查询
- 导出状态筛选在客户端执行（分页后过滤），导致每页结果稀疏、翻页漏单、总页数错误
- 打标签导出后页面不刷新，助理不知道哪些已标记
- filterAssembly / filterSupplier 同样缺少 onchange

### 修复
- server.js orders-fast 端点：新增 exportFilter 参数，在 filterQ 之后、分页之前执行内存过滤，分页数据自动准确
- server.js：exportFilter 激活时跳过缓存路径，确保实时数据
- orders.html loadOrders()：将 exportFilter 传给 API，删除客户端过滤逻辑
- orders.html：filterExport / filterAssembly / filterSupplier 均加 onchange="currentPage=1;loadOrders()"
- orders.html exportExcelSelected()：补 setTimeout(() => loadOrders(), 2000)

### 新增快捷按钮
- "待发工厂"：一键设置 status=生产中 + exportFilter=factory-pending
- "待打标签"：一键设置 status=打标签 + exportFilter=label-pending
- setWorkflowFilter() 函数

### 涉及文件
- server.js
- public/orders.html
