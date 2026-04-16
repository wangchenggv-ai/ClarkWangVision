# CHANGELOG

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
