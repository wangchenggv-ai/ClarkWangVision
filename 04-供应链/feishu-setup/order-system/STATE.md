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
