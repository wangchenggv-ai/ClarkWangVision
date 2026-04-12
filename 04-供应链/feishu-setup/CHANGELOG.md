# Changelog

## [2026-04-12] Sprint 11：QR 溯源验真系统整合

**修改文件**
- `agent-portal/server.js` — 新增 5 个 API 端点 + QR/ZIP 生成函数 + 路由修复
- `agent-portal/public/track.html` — 订单详情增加确认/QR/导出按钮
- `package.json` — 新增 `qrcode` 依赖

**新增文件**
- `agent-portal/public/verify.html` — 消费者扫码验真页面
- `agent-portal/public/qrcodes/` — QR PNG 存储目录

### 新增 API 端点

| 端点 | 说明 |
|------|------|
| `POST /api/order/:orderNo/confirm` | 确认订单 → 生成镜片码 → 写入飞书 → 生成 QR PNG |
| `GET /api/order/:orderNo/lens-codes` | 查询订单的镜片码列表 |
| `GET /api/order/:orderNo/qrcode` | 下载订单 QR 码 PNG |
| `GET /api/order/:orderNo/factory-zip` | 导出工厂打印包 ZIP（labels + QR） |
| `GET /verify/:lensCode` | 无认证消费者验真页面 |

### 核心流程

1. 代理商下单 → 订单状态 `待处理`
2. 助理在追踪页点击「确认订单」→ 为每个镜片生成 16 位 hex 码 → 状态变为 `生产中`
3. 自动生成 QR PNG（内容指向验真 URL），可下载单张或导出工厂 ZIP 包
4. 消费者扫描镜片上的 QR → 打开验真页面 → 显示订单信息 + 处方参数 + 正品标识

### 技术实现

- 镜片码：`crypto.randomBytes(8)` → 16 位大写十六进制
- QR 生成：`qrcode` npm 包（纯 JS，零 native 依赖）
- 工厂 ZIP：手写 ZIP 格式（Store 模式 + CRC32），无外部依赖
- 验真路由：动态渲染 verify.html 模板（`{{FOUND}}` 控制正品/未找到状态）
- 路由修复：`/api/order/:orderNo` 改为精确匹配（`split.length === 4`），避免拦截子路径

### 验证结果
- 确认订单 → 生成 2 个镜片码 ✅
- 查询镜片码 ✅
- 下载 QR PNG (3.3KB) ✅
- 导出工厂 ZIP (14.5KB) ✅
- 消费者验真 → 正品验证通过 ✅
- 无效码 → 未找到记录 ✅
- 订单状态 待处理 → 生产中 ✅

---

## [2026-04-12] Sprint 10 v2：代理商订单门户生产级升级

**修改文件**
- `agent-portal/server.js` — 重写，新增 5 个 API 端点，集成 Rule 1 交期逻辑
- `agent-portal/public/order.html` — 重写，动态 SKU + 交期预估 + 订单摘要
- `agent-portal/public/track.html` — 重写，分组展示 + 详情弹窗 + CSV 导出

**新增文件**
- `agent-portal/public/css/common.css` — 共享样式（badge、modal、toast、分页等）

### 新增 API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/skus` | SKU 列表 + 实时库存状态（5 分钟缓存，从飞书 SKU 主数据 + 成品库存表 join） |
| `GET /api/delivery-estimate` | Rule 1 交期预估：定制品→定制5天，备货品库存充足→有货3天，不足→定制5天 |
| `GET /api/order/:orderNo` | 单个订单详情（按来源订单号查询，含权限校验） |
| `GET /api/orders/export` | CSV 导出（BOM 头，Excel 兼容中文，支持筛选参数透传） |
| `GET /api/customers` | 代理商历史客户名列表（10 分钟缓存，用于下单页自动补全） |

### 增强功能

**下单页 (order.html)**
- SKU 从飞书动态加载，按备货品/定制品分组，显示库存状态标签 [有货✓] [低库存⚠] [缺货✗] [定制●]
- 选择 SKU+数量后实时交期预估（本地即时 + API 精确校验，debounce 300ms）
- 顾客姓名自动补全（基于历史下单记录）
- 订单摘要卡片（实时更新总患者数、总镜片数、各品交期）
- 提交确认弹窗 → 成功页（展示订单号 + 每品交期详情）
- 复制右眼处方到左眼
- CYL≠0 时自动显示 AXIS 字段
- 移动端优化：font-size 16px 防 iOS 缩放、inputmode、sticky 提交栏

**追踪页 (track.html)**
- 统计栏：总订单 / 待处理 / 有货 / 定制 / 已发货
- 筛选增强：状态 + SKU + 日期范围
- 订单按来源订单号分组展示
- 点击订单组弹出详情弹窗（完整处方信息、交期、收货地址）
- CSV 导出（带当前筛选参数）
- 分页控件

**后端 (server.js)**
- SKU + 库存缓存（5 分钟 TTL），客户名缓存（10 分钟 TTL）
- 代理商缓存（30 秒 TTL），飞书 token 自动刷新（~2 小时）
- 提交订单时自动扣减库存（有货情况）
- 订单列表支持 status / sku / from / to / page / pageSize 筛选分页 + 汇总统计
- 请求日志：`METHOD PATH → STATUS (ms)`
- 静态资源路由修复（/css/ 前导斜杠导致 path.resolve 错误）

### 验证结果（本地，无 .env 环境）
- 静态页面 `/order` `/track` 200 ✅
- CSS `/css/common.css` 200 ✅
- 无效 token → 401 ✅
- 缺参数 → 400 校验提示 ✅
- 未知路径 → 404 ✅
- 请求日志输出 ✅
- 飞书 API 功能（SKU/提交/订单）需配置 .env 后完整测试

### [2026-04-12 后续] 产品型号简化

**修改文件**
- `agent-portal/public/order.html` — 产品下拉从动态加载 100 个 SKU 改为 4 个硬编码选项

**变更内容**
- 产品型号下拉框固定为 4 个选项：Ultra、时空之眼A、时空之眼B、小旋风
- 移除 `/api/skus` 接口调用（下单页不再依赖 SKU 列表加载）
- 交期预估改为纯 API 查询（移除基于 option data 的即时估算）
- 移除 `skuList` 全局变量及相关 `skuInfo` 查找逻辑
- 代码量减少 ~30 行

**验证结果**
- 4 个产品选项正常显示 ✅
- 交期预估 API 正常（Ultra → 有货3天）✅
- 订单提交 + 飞书写入正常 ✅
- 追踪页订单详情正常 ✅

---

## [2026-04-12] Sprint 10：代理商订单门户（Agent Portal）

**新增文件**
- `agent-portal/server.js` — HTTP 后端，5 个接口（agent info / submit / orders / 静态页）
- `agent-portal/gen_tokens.js` — Token 管理 CLI（add / list / add-batch）
- `agent-portal/agents.json` — 代理商配置（token + ID + 名称）
- `agent-portal/public/order.html` — 代理商下单页（患者处方 + 多眼别 + 批量提交）
- `agent-portal/public/track.html` — 订单查询页（按状态筛选，实时拉取飞书数据）
- `migrate_portal_fields.js` — Migration 13：订单表新增 12 个门户专用字段

**架构说明**
- 每个代理商拥有唯一不可猜测 token，通过 URL 参数 `?t=<token>` 验证身份
- 提交订单：按患者组织→每眼一条记录写入飞书订单表，批量 batch_create（≤500条/次）
- 同步创建终端客户记录（去重，以代理商名称为 key），写入客户表 `tbltXNNhF65EBl17`
- 订单来源字段自动标记为 `"代理商门户"`，与旧系统同步记录区分
- 飞书 webhook 通知（`FEISHU_WEBHOOK_URL`）：有新订单时推送蓝色 card 给内部群

**Bug 修复（验证过程中）**
- `状态` → `订单状态`（字段名与飞书表不符导致 FieldNameNotFound）
- Feishu 查询 sort 参数 GET 方式不支持，移除（`InvalidSort` 错误）
- curl 本地测试需绕过系统代理（`--noproxy "*"`）

**Migration 13 字段清单**
| 字段 | 类型 | 说明 |
|------|------|------|
| 顾客姓名 | 文本 | 患者姓名 |
| 眼别 | 单选 | 右眼 / 左眼 |
| 球镜SPH | 数字 | |
| 柱镜CYL | 数字 | |
| 轴位AXIS | 数字 | |
| 瞳距 | 数字 | 单眼瞳距 |
| 瞳高 | 数字 | 单眼瞳高 |
| 代理商ID | 文本 | gen_tokens 生成的 AG-xxx |
| 订单来源 | 单选 | 代理商门户 / 旧系统同步 |
| （镜框型号、代理商名称、收货地址已存在，跳过） | | |

**验证结果（全部通过）**
- Migration 13 幂等运行 ✅
- `gen_tokens.js add` 生成 token ✅
- `GET /api/agent` 返回代理商信息 ✅
- `POST /api/submit` 写入飞书 2 条记录（张三左右眼）✅
- `GET /api/orders` 返回该代理商所有订单 ✅
- 静态页 `/order` `/track` 200 ✅

---

## [2026-04-11] Sprint 9：三系统架构 + 增量同步框架

**文件**: `sync_orders.js`, `sync_customers.js`, `sync_all.js`, `docs/2026-04-11-three-system-architecture-design.md`

### 架构决策
- 三系统独立：旧订单表（唯一数据源）→ CRM + 供应链各自消费，不迁移历史数据
- 增量同步：90天滑动窗口，`同步时间` 字段记录最后更新戳，避免全量扫描
- `sync_all.js` 串行编排：先同步客户，再同步订单

### 新增字段（Migration 12）
- `order.客户ID` — 关联终端客户表
- `order.来源订单号` — 旧系统订单编号透传
- `order.同步时间` — 增量同步时间戳

### 验证
- Rule1-9 用 10 条模拟订单全部通过 ✅
- 同步脚本框架完成（待沈锋填写 field_mapping.json 后端到端测试）

---

## [2026-04-06] 仪表板浅色风格优化

**文件**: `dashboard.html`

### 变更内容
- 整体切换为浅色现代主题（背景 #f8f9fc，卡片纯白，文字深灰）
- 更新主色调为 #0066cc 和 #00b4d8
- 优化排产计划表格（去除重复记录，简化原因文字）
- 美化KPI卡片、模芯管理表、交付差距区域
- 增强卡片阴影、hover动画和整体间距
- 彻底清理所有残留暗黑样式（交付引擎、表格、AI分析区域）

**效果**: 清新专业，阅读体验大幅提升。

---

**历史版本**
- 2026-04-04: 初始暗黑风格仪表板（ECharts + 交付分析引擎 + AI报告）