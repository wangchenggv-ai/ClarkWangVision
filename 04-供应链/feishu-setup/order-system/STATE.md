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
