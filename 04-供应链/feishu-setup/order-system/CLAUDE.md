# CLAUDE.md — 订单交付系统项目宪法

> 本文件是 Claude Code 在本目录工作时的第一手上下文。**详细架构看 [ARCHITECTURE.md](ARCHITECTURE.md)**，本文件只写约束与关键事实。

---

## 一、项目是什么

代理商眼镜订单交付系统 — 从下单到消费者扫码验真的全链路闭环。

- **业务目标：** 6.30 前完成最小闭环
- **用户三端：** 代理商（下单/追踪） / 助理（管理后台） / 消费者（扫码验真）
- **后端存储：** 飞书多维表格 Bitable（无自建 DB）
- **核心状态机：** `待处理 → 生产中 → 已发货 → 已签收`

---

## 二、技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 运行时 | Node.js (ES Modules, `import` 语法) | **无 package.json**，依赖靠同级 `node_modules/` |
| HTTP | Node 内置 `http` 模块 | **不是 Express**，手写路由 |
| 依赖 | `qrcode`, `xlsx` | 生成二维码和解析 Excel |
| 前端 | 原生 HTML + JS | `public/` 下静态页，无框架无构建 |
| 存储 | 飞书 Bitable | App Token `B3xQbbqicaome1sKdZbcwdk8nWg` |
| 通知 | 飞书 IM Webhook + API | 发货/签收卡片 |
| 子服务 | `qrcode-webhook/`（Python） | QR 码回调服务（独立 Docker） |

**不要**引入 Express、TypeScript、打包工具、前端框架 — 维持零构建。

---

## 三、核心数据模型

### 两表架构（必须理解）

**订单主表** `tblk9Ch4gk2uQ1zG` — **一患者一条**（同订单号可有多行）
- 主键：`订单编号`（`ORD-YYYYMMDD-XXXXXX`）
- 承载：客户/产品/数量/物流/状态

**镜片明细表** `tblC7pve7ObFgIOl` — **一眼一条**（双眼两条）
- 主键：`镜片码(唯一)`（16 位大写 HEX）
- 承载：眼别 / SPH / CYL / AXIS / 镜片码 / QR

**关联：** 两表通过 `订单编号` 字段关联；消费者验真走 `镜片码 → 镜片明细表 → 订单编号 → 订单主表`。

### 辅助表

| 表 | Table ID | 用途 |
|----|----------|------|
| 代理商表 | `tblHsgGbJWkB31qu` | 代理商认证（ID/Token） |
| 终端客户表 | `tbltXNNhF65EBl17` | CRM 同步的客户 |
| SKU 主数据 | `tblwQsvGAahoeoJV` | 产品目录 |
| 成品库存 | `tblUF49B6i53MV2O` | 库存数量 |

**所有表 ID 在 [server.js:35](server.js:35) `TABLES` 常量中统一维护 — 其它脚本必须从此处引用，禁止硬编码。**

### 编号规则（改前先看 [ARCHITECTURE.md#编号规则](ARCHITECTURE.md)）

| 编号 | 格式 | 生成时机 |
|------|------|----------|
| 订单编号 | `ORD-YYYYMMDD-XXXXXX` | 下单时 |
| 镜片码 | 16 位大写 HEX（`randomBytes(8)`） | 下单时 |
| 代理商 ID | `AG-XXX` | CRM 签约时 |
| 客户 ID | `CUS-YYYYMMDD-XXXX` | 客户同步时 |
| 快递单号 | `{SF/75/YD/JD}{12 位数字}` | 发货时 |

**铁律：** 镜片码一旦生成，终生不变，绝不允许回写 / 重新生成。

---

## 四、开发铁律

### 4.1 幂等性
- `POST /api/admin/confirm` 可以被多次调用 — 如镜片码已生成则跳过
- 任何写 Bitable 的端点都要假设会被重试，设计必须幂等
- 不要用"状态检查后再写"的朴素模式 — Bitable 无事务，并发会翻车

### 4.2 认证
- **代理商端：** URL 参数 `?t={token}`，token 存在代理商表
- **管理端：** URL 参数 `?admin={ADMIN_TOKEN}`（环境变量）
- 永远不要把 token 写进日志 / 错误消息 / 客户端 HTML
- `timingSafeEqual` 已引入，敏感比较必须用它

### 4.3 状态流转（单向，不可逆）
```
待处理 → 生产中 → 已发货 → 已签收
```
- **禁止回退状态** — 任何"从已发货回到生产中"的需求，用单独的订正流程处理，不能直接改字段
- 订单主表状态和镜片明细表状态必须同步（见 [server.js](04-供应链/feishu-setup/order-system/server.js) 的 admin/* 端点）

### 4.4 Bitable 写入
- 批量操作用 `batch_create` / `batch_update`（上限 500 条/次），分页处理
- 写入前先读一次做去重 — Bitable 主键是系统 `record_id`，**不是**业务编号
- `订单编号`、`镜片码(唯一)` 的唯一性是**业务约定**，无数据库级约束，代码必须兜底

### 4.5 前端
- `public/order.html` / `labels.html` 是核心页面，体量大
- **历史坑：** `order.html` 出现过重复 `const` 声明导致 JS 崩溃、`/api/terminal-customers` 慢加载阻塞渲染 — 改这两个文件前先读完相关段落，终端客户列表务必**异步加载**
- 不要在 HTML 内联大段 JS 时重名变量 — 先 grep 确认

### 4.6 Excel 解析
- **已改为纯代码解析**（`xlsx` 库 + 列名模糊匹配），**不再走 MiMo AI**
- 不要再往 `/api/excel-parse` 里加 AI 调用 — 会把秒级响应拖到 10 秒+

### 4.7 代码风格
- ES Module（`import`/`export`），禁止 CommonJS
- 不要新增注释除非 WHY 不明显
- 不要为"未来扩展"抽象 — 按需求写最小实现
- 不要引入新依赖除非极必要（本项目刻意保持依赖最小）

---

## 五、启动与部署

### 本地启动
```bash
node server.js            # 主服务，端口 3210
node logistics.js webhook # 快递回调，端口 3211（可选）
```

### 环境变量（`../shared/.env` 或 `../.env`）

| 变量 | 用途 |
|------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Bitable 读写 |
| `NOTIFY_APP_ID` / `NOTIFY_APP_SECRET` / `NOTIFY_CHAT_ID` | 飞书通知 |
| `ADMIN_TOKEN` | 管理页密码 |
| `SERVER_BASE_URL` | QR 验真链接的外网地址 |
| `MIMO_API_URL` / `MIMO_API_KEY` | AI 功能（备用） |
| `PORT` | 覆盖默认 3210 |

### Docker
- 根目录 `Dockerfile` + `docker-compose.yml` 部署主服务
- `qrcode-webhook/` 有独立的 Dockerfile

---

## 六、目录导航

### 常改的
- [server.js](04-供应链/feishu-setup/order-system/server.js) — 主后端（112KB，所有 API 端点）
- [public/order.html](public/order.html) — 代理商下单页
- [public/labels.html](public/labels.html) — 助理管理页（确认/发货/签收/标签）
- [public/track.html](public/track.html) — 代理商追踪页（只读）
- [public/verify.html](public/verify.html) — 消费者验真页
- [logistics.js](logistics.js) — 物流 CLI + 通行单生成

### 偶尔碰的
- [automations.js](04-供应链/feishu-setup/order-system/automations.js) — 业务规则引擎
- [ai_analysis.js](ai_analysis.js) — AI 周分析（MiMo）
- [dashboard.js](dashboard.js) / [dashboard.html](dashboard.html) — KPI 看板
- [delivery_analysis.js](delivery_analysis.js) — 交期分析
- [print_labels.js](print_labels.js) — 标签生成

### 一次性脚本（谨慎动）
- `migrate_*.js`、`seed_*.js`、`import_*.js`、`setup_tables.js` — 初始化/迁移，改之前确认是否真的需要重跑
- `test_*.js`、`run_*.js`、`e2e_*.mjs` — 测试脚本

### 文档
- [ARCHITECTURE.md](ARCHITECTURE.md) — 完整架构（本文件的详细版）
- [CHANGELOG.md](04-供应链/feishu-setup/order-system/CHANGELOG.md) — 迭代记录
- [docs/](docs/) — E2E 报告 / 设计稿 / 历史方案

---

## 七、常见任务的起点

| 任务 | 从哪开始 |
|------|----------|
| 加一个管理端操作 | [server.js](04-供应链/feishu-setup/order-system/server.js) 找 `/api/admin/*` 端点，照抄现有模式；前端 [public/labels.html](public/labels.html) 加按钮 |
| 改订单字段 | 同时改 [server.js](04-供应链/feishu-setup/order-system/server.js) 的写入 + [ARCHITECTURE.md](ARCHITECTURE.md) 的字段表 |
| 改状态流转 | **先停下来问用户** — 状态机变动影响所有端，不能独断 |
| 改 Bitable 结构 | 写一个新的 `migrate_*.js` 脚本，不要手动改 Bitable UI |
| 前端样式调整 | `public/css/` 和对应 HTML 内联 style |
| 排查消费者扫码报错 | 看 [server.js](04-供应链/feishu-setup/order-system/server.js) 的 `/verify/:lensCode` 端点 + 浏览器 Network |

---

## 八、历史坑与记忆

- **order.html 重复 const 声明** → JS 崩溃，白屏。改前 `grep` 确认变量名唯一
- **/api/terminal-customers 同步加载** → 阻塞首屏渲染。必须异步加载且不堵死下单流程
- **⑧-2 验真页同名混入** → 同名客户不同处方，按客户名过滤无法区分。修复：过滤条件加产品型号（`customerName + sku`），不能只按姓名
- 详见 `~/.claude/projects/...memory/project_order_system_bugs.md`

---

## 九、与 Claude 协作的偏好

- 回答简短 — 不要在每次改完后写总结段落，用户会看 diff
- 改 `server.js` 这种大文件前，用 `grep` 或 `Read` 限定行范围定位，不要全量 read
- 新任务开新会话，不要在同一会话堆积
- 读过的文件记住内容，不要重复 read
- 动手前先想最少需要多少数据/API 调用
