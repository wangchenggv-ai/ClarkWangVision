# Changelog

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