# CLAUDE.md — 订单系统项目宪法

> 本文件是 Claude Code 在本目录工作时的第一手上下文。**详细架构看 [ARCHITECTURE.md](ARCHITECTURE.md)**，本文件只写约束与关键事实。

---

## 一、项目是什么

**三系统之一：订单系统**。代理商眼镜订单交付系统 — 从下单到消费者扫码验真的全链路闭环。

三系统架构：

| 系统 | 目录 | 职责 |
|------|------|------|
| **CRM** | `销售飞轮项目/`（独立飞书 Bitable） | 客户主数据、代理商、销售目标、会议 |
| **订单** | `order-system/`（本目录） | 代理商门户、下单、验真、物流、CRM同步 |
| **库存** | `inventory-system/` | 度数级库存、交期预估、14条业务规则 |

- **业务目标：** 6.30 前完成最小闭环
- **用户三端：** 代理商（下单/追踪） / 助理（管理后台） / 消费者（扫码验真）
- **后端存储：** 飞书多维表格 Bitable（无自建 DB）
- **核心状态机：** `待处理 → 生产中 → 已发货 → 待签收 → 已签收`（待签收=手动标记，已签收=快递回调自动）

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

### 表 ID

所有表 ID 从 `../shared/tables.js` 引用（单一真相源），**禁止硬编码表 ID**。

```js
import { TABLES } from "../shared/tables.js";
```

### 两表架构（必须理解）

**订单主表** `TABLES.order` — **一患者一条**（同订单号可有多行）
- 主键：`订单编号`（`ORD-YYYYMMDD-XXXXXX`）
- 承载：客户/产品/数量/物流/状态

**镜片明细表** `TABLES.lens_detail` — **一眼一条**（双眼两条）
- 主键：`镜片码(唯一)`（16 位大写 HEX）
- 承载：眼别 / SPH / CYL / AXIS / 镜片码 / QR

**关联：** 两表通过 `订单编号` 字段关联；消费者验真走 `镜片码 → 镜片明细表 → 订单编号 → 订单主表`。

### 辅助表

| 表 | Table ID (tables.js) | 用途 |
|----|----------------------|------|
| 代理商表 | `TABLES.agent` | 代理商认证（ID/Token），由 CRM 同步 |
| 终端客户表 | `TABLES.customer` | CRM 同步 + 门户下单自动创建的客户 |
| SKU 主数据 | `TABLES.sku` | 产品目录 |
| 度数级库存 | `TABLES.stock_detail` | 度数级（SKU/SPH/CYL）库存，交期判定数据源 |

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

## 四、库存与交期（统一走 stock_detail）

所有 SKU 的库存和交期判定统一走 `TABLES.stock_detail`（度数级库存表）。

### 产品目录

产品目录从 Bitable `TABLES.product_model` 表读取（按 `排序号` 排序），用于前端下拉选择。新增/停售产品直接在飞书表里改，不用改代码。

当前 SKU：Ultra双效、D8、时空之眼A/B/PRO/MAX、小旋风。

### 交期判定

`/api/delivery-estimate` 端点**必须传 `sph` 和 `cyl` 参数**，统一走 `estimateDeliveryByRx()`：

| 情况 | 档位文案 | 交期天数 |
|------|---------|---------|
| 库存 ≥ 下单量 | `有货1-2天` | 2 |
| 度数在常规范围但库存 < 下单量 | `排产5-7天` | 7 |
| 度数超出常规范围 (SPH < -6 或 CYL < -2) | `定制7-10天` | 10 |

**禁止在前端做档位计算** — 档位由后端返回，前端只渲染。

### 度数常规范围

- **SPH ∈ [-6.00, 0]**（近视，每 0.25D 一档，25 档）
- **CYL ∈ [-2.00, 0]**（散光，每 0.25D 一档，9 档）
- 单 SKU 完整覆盖 = 25 × 9 = 225 行

### 库存数量展示（UX 铁律）

- **默认不展示具体片数** — 防止代理商误判可拿量
- **仅在库存 ≤ 5 片时显示"仅剩 N 片"** — 提醒紧张
- **阈值常量：** `LOW_STOCK_THRESHOLD = 5`（见 `order.html`）

### 缓存

- 度数级库存缓存 TTL = **2 分钟**（`STOCK_TTL` in server.js）
- 缓存在 server 内存，多实例部署时各自独立（当前单实例无问题）

---

## 五、开发铁律

### 5.1 幂等性
- `POST /api/admin/confirm` 可以被多次调用 — 如镜片码已生成则跳过
- 任何写 Bitable 的端点都要假设会被重试，设计必须幂等
- 不要用"状态检查后再写"的朴素模式 — Bitable 无事务，并发会翻车

### 5.2 认证
- **代理商端：** URL 参数 `?t={token}`，token 存在代理商表
- **管理端：** URL 参数 `?admin={ADMIN_TOKEN}`（环境变量）
- 永远不要把 token 写进日志 / 错误消息 / 客户端 HTML
- `timingSafeEqual` 已引入，敏感比较必须用它

### 5.3 状态流转（单向，不可逆）
```
待处理 → 生产中 → 已发货 → 待签收 → 已签收
```
- **禁止回退状态** — 任何"从已发货回到生产中"的需求，用单独的订正流程处理，不能直接改字段
- 订单主表状态和镜片明细表状态必须同步（见 server.js 的 admin/* 端点）

### 5.4 Bitable 写入
- 批量操作用 `batch_create` / `batch_update`（上限 500 条/次），分页处理
- 写入前先读一次做去重 — Bitable 主键是系统 `record_id`，**不是**业务编号
- `订单编号`、`镜片码(唯一)` 的唯一性是**业务约定**，无数据库级约束，代码必须兜底

### 5.5 前端
- `public/order.html` / `labels.html` 是核心页面，体量大
- **历史坑：** `order.html` 出现过重复 `const` 声明导致 JS 崩溃、`/api/terminal-customers` 慢加载阻塞渲染 — 改这两个文件前先读完相关段落，终端客户列表务必**异步加载**
- 不要在 HTML 内联大段 JS 时重名变量 — 先 grep 确认

### 5.6 Excel 解析
- **已改为纯代码解析**（`xlsx` 库 + 列名模糊匹配），**不再走 MiMo AI**
- 不要再往 `/api/excel-parse` 里加 AI 调用 — 会把秒级响应拖到 10 秒+

### 5.7 代码风格
- ES Module（`import`/`export`），禁止 CommonJS
- 不要新增注释除非 WHY 不明显
- 不要为"未来扩展"抽象 — 按需求写最小实现
- 不要引入新依赖除非极必要（本项目刻意保持依赖最小）

---

## 六、CRM 同步

CRM 数据（代理商、客户）从独立飞书 Bitable `RlfTb6gykaEb3gsR1lwcGnShnAA` 同步到本系统。

| 脚本 | 方向 | 说明 |
|------|------|------|
| `sync_agents.js` | CRM 01表 → 代理商表 | 仅同步签约代理商，生成 AG-XXX + token |
| `sync_customers.js` | CRM 02表 → 终端客户表 | 按客户名称匹配，新建则生成 CUS-YYYYMMDD-XXXX |
| `sync_orders.js` | 旧订单表 → 订单表 | 增量同步 + 90天滚动清理 |
| `sync_all.js` | 入口 | 按序执行上述三个脚本 |

CRM 系统详情见 [CRM-CLAUDE.md](04-供应链/feishu-setup/order-system/CRM-CLAUDE.md)。

---

## 七、启动与部署

### 本地启动
```bash
node server.js            # 主服务，端口 3210
node logistics.js webhook # 快递回调，端口 3211（可选）
```

### 环境变量（`../shared/.env`）

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

## 八、目录导航

### 常改的
- [server.js](04-供应链/feishu-setup/order-system/server.js) — 主后端（所有 API 端点）
- [public/order.html](public/order.html) — 代理商下单页
- [public/labels.html](public/labels.html) — 助理管理页（确认/发货/签收/标签）
- [public/control.html](public/control.html) — Admin 控制中心（仪表盘/规则/AI，3 Tab）
- [public/track.html](public/track.html) — 代理商追踪页（只读）
- [public/verify.html](public/verify.html) — 消费者验真页
- [logistics.js](logistics.js) — 物流 CLI + 通行单生成

### 偶尔碰的
- [automations.js](04-供应链/feishu-setup/order-system/automations.js) — 14条业务规则引擎（含 rule12 度数级库存预警、rule13 自动排产、rule14 自动回补）
- [sync_*.js](.) — CRM/旧订单同步脚本
- [ai_analysis.js](ai_analysis.js) — AI 周分析（MiMo）
- [dashboard.js](dashboard.js) / [dashboard.html](dashboard.html) — KPI 看板
- [delivery_analysis.js](delivery_analysis.js) — 交期分析
- [print_labels.js](print_labels.js) — 标签生成（HTML 路径，工厂用）
- [pull-print.js](pull-print.js) — Mac 本地守护进程，轮询云端队列→TCP 发打印机
- [pull-print-config.json](pull-print-config.json) — 守护进程配置（服务器/打印机/轮询）

### 一次性脚本（谨慎动）
- `migrate_*.js`、`seed_*.js`、`import_*.js`、`setup_tables.js` — 初始化/迁移
- `test_*.js`、`run_*.js`、`e2e_*.mjs` — 测试脚本

### 文档
- [ARCHITECTURE.md](ARCHITECTURE.md) — 完整架构
- [CHANGELOG.md](04-供应链/feishu-setup/order-system/CHANGELOG.md) — 迭代记录
- [CRM-CLAUDE.md](04-供应链/feishu-setup/order-system/CRM-CLAUDE.md) — CRM 系统结构
- [docs/](docs/) — 设计稿 / 历史方案

---

## 九、常见任务的起点

| 任务 | 从哪开始 |
|------|----------|
| 加一个管理端操作 | server.js 找 `/api/admin/*` 端点，照抄现有模式；前端 `public/labels.html` 加按钮 |
| 改订单字段 | 同时改 server.js 的写入 + ARCHITECTURE.md 的字段表 |
| 改状态流转 | **先停下来问用户** — 状态机变动影响所有端，不能独断 |
| 改 Bitable 结构 | 写一个新的 `migrate_*.js` 脚本，不要手动改 Bitable UI |
| 前端样式调整 | `public/css/` 和对应 HTML 内联 style |
| 排查消费者扫码报错 | 看 server.js 的 `/verify/:lensCode` 端点 + 浏览器 Network |
| 新增/修改库存 | 看 `../inventory-system/CLAUDE.md` 的迁移脚本 |
| 调整业务规则参数 | 打开 `/control?admin=TOKEN`，在规则 Tab 直接改 |
| 手动触发规则 | `/control` 的执行 Tab，选规则点执行（支持预览） |
| 规则参数存储 | `rules_config.json`（本地文件，API 可读写） |
| 打印相关改动 | 标签/通行单走**队列拉模式**：server 入队 → Mac 守护进程轮询 → TCP 发打印机。不走服务端直连 |

---

## 十、历史坑与记忆

- **order.html 重复 const 声明** → JS 崩溃，白屏。改前 `grep` 确认变量名唯一
- **/api/terminal-customers 同步加载** → 阻塞首屏渲染。必须异步加载且不堵死下单流程
- **验真页同名混入** → 同名客户不同处方，按客户名过滤无法区分。修复：过滤条件加产品型号（`customerName + sku`），不能只按姓名

---

## 十一、与 Claude 协作的偏好

- 回答简短 — 不要在每次改完后写总结段落，用户会看 diff
- 改 `server.js` 这种大文件前，用 `grep` 或 `Read` 限定行范围定位，不要全量 read
- 新任务开新会话，不要在同一会话堆积
- 读过的文件记住内容，不要重复 read
- 动手前先想最少需要多少数据/API 调用
