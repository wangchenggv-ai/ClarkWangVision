# 系统当前状态

> 更新：2026-06-03 v18 | 完整历史见 CHANGELOG.md

---

## 部署

| 项目 | 内容 |
|------|------|
| 生产地址 | https://lab.gaushclear.com（华为云 ECS Docker） |
| 测试地址 | http://113.44.175.221:3211（同 ECS，独立 Bitable） |
| SSH | `ssh -i "04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem" root@113.44.175.221` |
| 生产容器 | order-app:3210（主服务）+ mock-shuang:3220 |
| 测试容器 | order-app-test:3211 + mock-shuang-test:3221 |
| 测试 Bitable | APP_TOKEN: `CtXObqwAHaCXYssBBfkcXmrlnUe` |
| 本次待部署 | 铂林眼科D8验真系统（bolin.html + server.js + bolin-codes.json） |
| 涉及文件 | server.js, public/bolin.html, bolin-codes.json |
| 2026-06-03已完成 | 铂林眼科D8独立验真：225镜片码预生成，/bolin/:code路由，bolin-codes.json本地查询，bolin-qr/ 225张PNG，bolin-manifest.xlsx，待部署ECS |
| 2026-05-23已部署 | feishu.js（searchRecords分页bug修复）+ server.js（orders-fast无筛选改listRecords+OEM品牌暂不启用）+ orders.html（522 Plan三项）✅ 全部已部署生产 |

部署命令：
```bash
KEY="04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem"

# 首次需重建容器加 drafts 卷（后续部署只需 scp + docker cp + restart）
scp -i "$KEY" docker-compose.prod.yml root@113.44.175.221:/tmp/
ssh -i "$KEY" root@113.44.175.221 "cp /tmp/docker-compose.prod.yml /opt/gaush-lab/docker-compose.yml && cd /opt/gaush-lab && docker compose down && docker compose up -d"

# 部署代码（每次更新执行）
scp -i "$KEY" server.js public/order.html public/track.html public/css/common.css lib/*.js root@113.44.175.221:/tmp/
ssh -i "$KEY" root@113.44.175.221 \
  "docker cp /tmp/server.js order-app:/app/server.js && \
   docker cp /tmp/order.html order-app:/app/public/order.html && \
   docker cp /tmp/track.html order-app:/app/public/track.html && \
   docker cp /tmp/common.css order-app:/app/public/css/common.css && \
   docker cp /tmp/lib/. order-app:/app/lib/ && \
   docker restart order-app"
```

> **注意**：`drafts/` 目录已通过 Docker volume 持久化（`/opt/gaush-lab/drafts`），容器重建不丢失。首次部署需重建容器，后续仅需 `docker cp` + `restart`。

---

## 当前状态机（2026-05-13 签收激活）

```
                          ┌─ 编辑/取消可改 ─┐
提交订单 → 存本地草稿 ────┤                ├→ 30min后台同步 → 已下单 → ...
   ~50ms                  └────────────────┘
                                                  ↓
                                        待处理 → 生产中 → ...
```

**Bitable 内状态流转**（草稿同步后，与原流程一致）：
```
已下单 → 待处理 → 生产中 ─┬→ 打标签 → 已发货 → 已签收（终态）
                  └→ 打标签（有库存）  └→ 已发货（供应商直发）↗
```

- **提交改为本地草稿**：~50ms 返回，不再阻塞 Bitable 写入
- **30 分钟编辑窗口**：代理商在追踪页可编辑/取消
- **后台自动同步**：写 Bitable(已下单) + 预占库存 + 生成镜片码
- **Docker volume 持久化**：`/opt/gaush-lab/drafts/` 挂载，重启不丢
- **镜片码**：点「待确认」时生成（不在提交时），确认异步化（立即返回，后台赋码+写入）
- **退回**：已下单/待处理/生产中/打标签均可退回；打标签统一退到已下单
- **签收**：已发货→已签收（顺丰 webhook 自动或助理手动），已签收即终态
- **有库存快路径**：行内设"有库存"→确认时直接跳到"打标签"，跳过待处理+生产中

详见 `订单流程图-权威版.md`

---

## 已知问题 / 待办

- [x] **✅ 导出状态筛选器完整修复（2026-05-23）**：修复4个Bug：①分页错乱（exportFilter移至服务端，orders-fast内存分页自动正确）；②filterExport无onchange（选了不触发，加onchange自动查询）；③filterAssembly/filterSupplier同样补onchange；④打标签导出后不刷新（补setTimeout loadOrders）。新增快捷按钮"待发工厂"（生产中+未导出工厂）和"待打标签"（打标签+未导出打标签），防漏单工作流一键直达。涉及文件：`server.js` + `public/orders.html` ✅ 已部署 ECS（2026-05-23），本地19/19测试通过
- [x] **✅ 财务模块封存（2026-05-23）**：财务结算功能（定价表、预存款、退换货、返利、对账单）改用飞书低代码实现，不编程。已删除：①7天自动签收定时任务，②对账单API（reconciliation），③tables.js中5个财务表ID置空。保留：换货赋码代码（封存不启用）。原因：避免过早耦合，飞书原生功能足够。涉及文件：`server.js` + `shared/tables.js` ✅ 已部署 ECS（2026-05-23）
- [x] **✅ OEM多品牌验真-暂不启用（2026-05-23）**：铂视控终端客户验真页显示铂视控品牌而非高视高清。新增 `lib/brand-config.js`（门店→品牌映射）；server.js 新增 `applyBrandToHtml()`，verify 三条路径（内存缓存/API fallback/void码）均注入品牌；verify.html 5处硬编码改为模板占位符。**当前暂不启用**：confirm 流程不写 `终端门店` 和 `镜片码状态` 到 lens_detail（字段尚未维护），验真页面始终显示高视高清品牌。等终端门店维护完成后，恢复相关代码即可启用。涉及文件：`server.js` ✅ 已部署 ECS（2026-05-23）✅ 生产环境测试通过
- [x] **✅ 草稿同步修复（2026-05-23）**：Fix1 幂等检查 URL 编码缺失；Fix2 同步成功后 invalidateOrdersCache；Fix3 重试耗尽不再静默删除→syncFailed标记+飞书告警；Fix4 searchRecords total守卫改软截断；Fix5 追踪页同步失败红色警示+`/api/admin/retry-draft` 端点。**根因：FieldNameNotFound（飞书API code=1254045），订单主表缺 "单价"/"金额" 字段，已移除写入**。涉及文件：`server.js` + `lib/feishu.js` + `public/track.html` ✅ 已部署 ECS，E2E 9步全通过（2026-05-23）
- [x] **✅ 订单管理UI显示5000条（2026-05-23）**：根因是飞书 POST /records/search 分页 bug（has_more 永不为 false，循环返回同一页），searchRecords 跑满 maxPages→假记录堆叠。Bitable 数据干净，真实 767 条。修复：lib/feishu.js searchRecords 加 total 守卫+record_id 去重；server.js orders-fast 无筛选时改用 listRecords(GET) 绕开 bug。✅ 已部署 ECS（2026-05-23）
- [x] **✅ 522 Plan 三项改动（2026-05-23）**：①装配筛选选项改"是"/"否"；②"导出Excel给打标签"按钮始终显示；③高清直达打标签——quickConfirm+confirmOrders均支持，批量全高清时弹窗动态提示"打标签"，乐观更新对应。涉及文件：`public/orders.html` + `server.js` ✅ 已部署 ECS（2026-05-23）
  - ⚠️ 导出状态筛选器（已导出工厂/未导出工厂/已导出打标签/未导出打标签）**未实现**，从 522 Plan 中拆出，下次单独做
- [x] **✅ lens_detail 无重复（2026-05-23确认）**：同 feishu.js 修复已覆盖，listRecords 返回 2527 条正常
- [x] **终端门店+仓位架构重构（2026-05-19）**：实体命名规范化（代理商/终端门店/顾客），Bitable字段`客户名称`→`门店名称`、`终端客户`→`终端门店`，customer表新增`仓位`单选字段（A1-D2），server.js新增`loadStores()`5分钟缓存+`/api/terminal-stores`端点，confirm Stage2按门店查`仓位`写入订单主表，orders API优先读存储`仓位`字段，slip-batch改为按门店名称分组（同门店一张单）。涉及文件：`server.js` + `check_schema.js` ✅ 已部署 ECS（2026-05-23）
- [x] **订单诊断工具**：`/diagnose?admin=GaushOrderMock` 输入订单号自动诊断：订单/镜片明细是否存在、镜片码是否生成、状态是否一致、QR 图片是否缺失、草稿是否待同步/失败、update-field 直接改状态跳过赋码。涉及文件：`server.js` + `public/diagnose.html` ✅ 已部署 ECS（2026-05-14）
- [x] **筛选性能优化**：新增 `/api/admin/orders-fast` 端点，用飞书 `records/search` API 带 filter（服务端筛选，不拉全表），首次筛选从 ~5s 降到 ~1s。`export-log.js` 给 `getOrderExportStatus` 加 60s 缓存。前端 orders.html 筛选默认走 fast 端点，超期走老端点，fast 失败自动 fallback。涉及文件：`server.js` + `lib/feishu.js` + `lib/export-log.js` + `public/orders.html` ✅ 已部署 ECS（2026-05-14）
- [x] **订单管理页精简**：orders.html 展开详情去掉镜片处方表和流程进度 stepper，只保留库存/供应商选择器。删除 stepper CSS ~50 行 + JS ~100 行。涉及文件：`public/orders.html` ✅ 已部署 ECS（2026-05-14）
- [x] **订单补码**：ORD-20260514-AAF16A70 状态被 update-field 直接改到"打标签"但未赋码，直接调飞书 API 生成镜片码 8355795E862C512E 并写入两表
- [x] **暑期备库模拟器**：独立网页工具，输入备库总数+A/B/C比例 → 25×9热力图建议（最大余额法精确分配）→ 下载Excel（备库订单+ABC参考两个Sheet）。纯前端单HTML文件，xlsx走CDN，无服务器依赖。路由 `/summer-stock-tool`。涉及文件：`public/summer-stock-tool.html` + `server.js` ✅ 已部署 ECS（2026-05-14）
- [x] **E2E 测试 — 三个新功能验证**：签收终态✅ + 仓位赋码✅ + 标签SKU条码✅，13/13 全部通过。修复 orders API 不返回 binCode 的 bug。涉及文件：`server.js` ✅ 已部署 ECS（2026-05-14）
- [x] **order.html 四项改造**：①AXIS/SPH/CYL/数量输入框禁用滚轮（`onwheel="this.blur()"`），②确认弹窗和Excel预览中SPH/CYL正度数显示+号（新增`fmt()`函数），③终端客户+地址改为可下拉+可手输模式（datalist，选中后自动填充联系人/电话/地址），④新增首单标签（`GET /api/agent-order-count`端点+前端橙色badge）。涉及文件：`public/order.html` + `server.js` + `public/css/common.css` ✅ 已部署 ECS（2026-05-13）
- [x] **签收功能激活**：状态机扩展为6态（已签收即终态），deliver端点恢复实际逻辑（写签收时间+状态+工作流+飞书卡片），logistics.js webhook/simulateDelivery恢复写入Bitable，labels-print.html已发货行加确认签收按钮。涉及文件：`server.js` + `logistics.js` + `public/labels-print.html` + `CLAUDE.md` + `ARCHITECTURE.md` ✅ 已部署 ECS（2026-05-13）
- [x] **标签加SKU条码**：标签左下角新增CODE128条形码，编码格式`TKAP-250-125`（型号缩写-SPH×100-CYL×100），工厂扫码可直接看型号+度数。factory-export.js两个Excel导出均新增"SKU条码"列。涉及文件：`lib/templates.js` + `lib/factory-export.js` ✅ 已部署 ECS（2026-05-13）
- [x] **订单管理5项优化**：①去掉stepper流程条，②confirm端点异步化（校验+读取后立即返回，赋码+写入后台执行~3s），③修复库存筛选（server补读stock参数+yes→有库存映射），④订单列表60s缓存（冷287ms→命中32ms），⑤有库存确认直接变打标签（quickConfirm/confirmOrders自动传stockStatus）。涉及文件：`server.js` + `public/labels-clean.html` ✅ 已部署 ECS（2026-05-13）
- [x] **批量赋码系统重构**：只需 SKU + 度数（SPH/CYL/AXIS）+ 数量，无需顾客姓名、眼别、代理商。上传 Excel → 识别 SKU → 每行按数量生成对应数量的镜片码 → 写入 `lens_detail` 表（验真可用）→ 导出 Excel。前端页面精简为拖拽上传+一键生成。涉及文件：`public/batch-import.html` + `server.js` + `lib/batch-import.js` ✅ 已部署 ECS（2026-05-12）
- [x] **标签打印导出自动流转**：`exportExcelSelected()` 批量导出后自动调 `update-field` 将订单状态改为「打标签」，与单条导出行为一致。涉及文件：`public/labels-print.html` ✅ 已部署 ECS（2026-05-12）
- [x] **工厂导出 Excel 列顺序调整**：`buildFactoryExcel` 列顺序改为「顾客→产品型号→眼别→球镜SPH→柱镜CYL→轴位AXIS→镜片码→验真网址→日期→数量→订单号→是否装配→联系人→联系电话→收货地址→备注」。涉及文件：`lib/factory-export.js` ✅ 已部署 ECS（2026-05-12）
- [x] **标签内容缩放80%**：标签纸 75×40mm 不变，内容用 `.label-inner` + `transform:scale(0.8)` 缩到 80%，整体右移 4mm，去除表格字体加粗。涉及文件：`lib/templates.js` + `public/labels-print.html` + `print_labels.js` + `lib/printer.js` ✅ 已部署 ECS（2026-05-11）
- [x] **仓位自动赋码系统**：取消扫码分仓，改为打标签时按收货地址自动匹配仓位编号（A1/A2/B1...）。新建 Bitable 仓位映射表 `tblTbiUtWHpjKfUm`（仓位编号+地址关键词+备注），启动时加载到内存，新增 `GET /api/admin/bin-map/reload` 刷新缓存。scan-print/confirm/print-queue-done 三个路径均自动赋仓位，labels-print.html 删除分仓模式、新增仓位列。涉及文件：`shared/tables.js` + `server.js` + `public/labels-print.html` + `ARCHITECTURE.md` ✅ 已部署 ECS（2026-05-11）
- [x] **导出记录系统**：新增导出记录表（export_log），记录工厂导出/标签打印/通行单/对账单的导出历史，防重复导出。新增 `lib/export-log.js` + 改造 batch-zip/print-queue/slip 端点 + 新增对账单 API + 前端导出状态列 ✅ 已部署 ECS（2026-05-10）
- [x] **合并下单系统**：助理汇总多个代理商散单 → 合并成一张大表 → 可编辑预览 → 确认后写入Bitable（状态"已下单"）。新增 `lib/batch-merge.js` + `public/batch-merge.html` + 2个API端点。与批量导入区别：多代理商、状态已下单、不生成镜片码、有预览确认环节 ✅ 已部署 ECS（2026-05-10）
- [x] **成品入库扫码系统**：条码格式 `ULT-300-075`（型号缩写-SPH-CYL），3个新页面（inventory-barcode/inbound/outbound），2个新API端点，复用现有 stock-movement 端点写库存 ✅ 已部署（2026-05-10）
- [x] **批量发货系统**：代理商级批量下单（无客户名）→ 库存预检 → 赋码 → 出库 → 发货 → 对账单。3个新页面（bulk-order/labels/statement），7个新API，BLK-前缀与ORD-完全隔离，验真页按BLK-分支隐藏代理商信息 ✅ 已部署（2026-05-10）
- [x] **orders.html 三项修复**：①删除"有无库存"列（表头+行内select+筛选栏），②筛选 bug 修复（查询重置页码/状态卡与下拉冲突+activeQuickFilter/超期分页pageSize 9999/filterStock死代码清理），③确认按钮显示处理单数。涉及文件：`public/orders.html` + `server.js` ✅ 已部署 ECS（2026-05-10）

- [x] **部署**：状态机改动已于 2026-04-27 推送 ECS ✅
- [x] **性能优化**：confirm 端点从 ~9s 优化到 ~4.5s（并行读取 + batchUpdate + 计时日志）✅
- [x] **标签与发货全面优化**：labels.html 发货入口+批量按钮、labels-print.html 扫码打印+分仓+同行单、slip 端点按地址分组、标签格式变更、packed 死代码清理、CLAUDE.md 同步 ✅ 已全部部署
- [x] **e2e 测试**：`e2e_full_sim.mjs` 断言改为"已发货" ✅
- [x] **track.html**：badge-labeled CSS 类已补到 common.css ✅
- [x] **control.html**：仪表盘待签收/已签收已清理（control.html + dashboard.js）✅
- [x] **labels.html 表格列宽修复**：nth-child 序号插入后未更新、列宽错配导致串行；字体统一为中文字体、订单号拆两行、紧凑布局 860px、详情表加 colgroup ✅
- [x] **打标签流程修复**：labels-print 扫码输入无响应 + lens_detail 数据补全（129条）+ 扫码后自动筛选打标签 ✅
- [x] **废弃状态清理**：待签收/已签收已清零（32条→已发货）✅
- [x] **采购表 tblZX1qW7RvcJieg**：tables.js 已注释，server.js 加守卫，启动不再报错 ✅
- [x] **labels.html → orders.html**：重命名消除歧义，旧路径 /labels 仍兼容 ✅
- [x] **打标签端到端测试**：单张+批量两种场景全部通过，操作手册已写 ✅
- [x] **orders.html 操作列精简**：只保留"待确认+退回"，发货/同行单/打标签移到 labels-print ✅
- [x] **confirm 性能优化**：启动时预热库存缓存，18s → 5s ✅
- [x] **详情表修复**：过滤迁移空记录、table-layout:auto 修 AXIS 对齐、备注不换行 ✅
- [x] **stepper 已完成绿色**：已完成步骤显示绿色（之前是灰色）✅
- [x] **部署**：以上改动已推送到 ECS ✅（2026-04-28 14:00）
- [x] **标签Excel导出**：labels-print 新增"导出Excel"按钮，支持单眼+批量导出，格式匹配打印机数据库模板（姓名/型号/眼别/球镜/柱镜/轴位/二维码/日期），验真地址改为 lab.gaushclear.com/verify/ ✅ 已部署
- [x] **镜片码字段迁移**：lens_detail 表"镜片码" → "镜片码（唯一）"，7个生产文件代码同步更新，数据迁移2条，旧字段已手动从 Bitable 删除 ✅ 已部署并验证（15/15 测试通过）
- [x] **标签模板优化**：HTML标签布局更紧凑（条形码/字体/间距缩小），ZPL适配ZT410 600dpi（坐标×2.96），printer.js默认DPI改为600 ✅ 已部署
- [x] **slip/Excel 迁移记录过滤**：通行单和 Excel 导出过滤无处方的迁移空记录 ✅ 已部署
- [x] **Excel 导出跨订单 bug**：选不同订单的客户时，按订单号分组传客户名，避免跨订单过滤错乱 ✅ 已部署
- [x] **selectedOrders 清空**：切换筛选条件时清空选中，防止导出混入旧数据 ✅ 已部署
- [x] **通行单模板统一**：logistics.js 删除自定义 slipHTML（~220行），统一使用 lib/templates.js::slipHTML；清理 8 处重复 rawVal 定义 + 修复重复 ENV 声明 bug ✅ 本地完成
- [x] **快递单号手动录入**：停用自动生成快递单号，发货后在已发货行显示输入框补录单号（server.js + labels-print.html）✅ 已部署
- [x] **标签预览选中修复**：toggleRow 点击复选框时因 tagName===INPUT 直接 return 导致单行无法选中，删除该守卫 ✅ 已部署
- [x] **导出Excel按钮恢复可见**：orders.html 重构时误加 ctx-btn 类导致按钮默认隐藏，改为始终显示 ✅ 已部署
- [x] **工厂导出排序修复**：序号缺失时所有右眼排一起；排序加产品型号分组+稳定排序+Number()防护 ✅ 已部署（详见 docs/工厂导出排序问题修复-2026-04-29.md）
- [x] **序号全局递增**：pairIndex 从按 customerName+SKU 计数改为只按 customerName，同一客户不同SKU序号连续 ✅ 已部署
- [x] **草稿缓冲系统**：提交订单改为存本地 JSON 草稿（~50ms），后台 2 分钟轮询，草稿满 30 分钟自动同步 Bitable。代理商可在追踪页编辑/取消草稿。涉及文件：server.js, order.html, track.html, common.css ✅ 已部署
- [x] **确认订单并行优化**：后端 for 循环改用 Promise.all 并行处理多条订单（镜片码生成/QR写入/Bitable更新并发进行）；前端 batch confirm 改为一次性提交所有 orderNo，去掉了逐条串行调用 ✅ 已部署（2026-04-30）
- [x] **批量导入系统**：`lib/batch-import.js` 批量解析+赋码+记录构建，`public/batch-import.html` 拖拽上传UI（自动识别代理商+进度条+CSV导出），`public/qr-gallery.html` 验真码展示页。导入即赋码（16位 HEX）+ 状态=生产中，跳过 confirm。已部署 ECS ✅
- [x] **测试环境搭建**：同 ECS 端口 3211，独立 Bitable `CtXObqwAHaCXYssBBfkcXmrlnUe`，`docker-compose.test.yml` + `.env.test` + `shared/tables.js` 环境切换。nginx 代理 `/test/` → 3211 ✅
- [x] **portal.html 漏部署**：生产容器缺少 portal.html 导致根路由 404，已补部署 ✅
- [x] **/verify 路由缺失**：server.js 缺少 `/verify` 静态路由（只有 `/verify/:lensCode`），已添加 ✅
- [x] **草稿同步时间缩短**：DRAFT_AGE_MIN 从 15 分钟改为 3 分钟 ✅
- [x] **端到端验真测试**：生产+测试环境全流程通过（下单→同步→确认→赋码→验真）✅
- [x] **暑期支持政策页面**：在 summer.html 添加「支持政策」Tab，展示《2026暑期上量支持政策》完整内容（标准支持/资格制支持/返利/备库超量货款分担），代理商可手动填写备注+确认知晓。新增 Bitable 字段 `policy_confirmed`（数字）+ `policy_remark`（文本），新增 `/api/summer-policy` 端点（POST 确认+PATCH 仅保存备注）。✅ 已部署 ECS（2026-05-10）
- [ ] **铂林眼科D8验真-待部署（2026-06-03）**：3个文件部署到ECS：`public/bolin.html` + `server.js`（新增/bolin/:code路由+loadBolinCodes懒加载）+ `bolin-codes.json`。交付物：`bolin-qr/`（225张PNG）+ `bolin-manifest.xlsx`（镜片码清单）交铂林眼科。文档见 `docs/铂林眼科D8验真系统-2026-06-03.md`
- [ ] **异常处理三功能（已实现，未启用）**：改单 `POST /api/admin/modify-rx`（自动退回已下单+更新SPH/CYL/AXIS）、发错货 `POST /api/admin/wrong-shipment`（备注打标）、退货 `POST /api/admin/return-order`（状态→已退货）。API已在server.js，JS函数已在labels-clean.html，UI按钮已注释。启用时只需取消labels-clean.html中getQuickAction的注释。（2026-05-16）
- [x] **序列号映射+标签货位+Excel同步（2026-05-16）**：`lib/sku-serial.js` 219条（xlsx权威，全量SPH/CYL+货位），多型号架构（ENTRIES_BY_SKU）。标签新增序列号+货位（深色badge+货架地址）。随货同行单简化为5列（眼别/SKU/SPH/CYL/AXIS），无镜片码/QR/快递信息。`lib/factory-export.js` 两个Excel导出均新增「序列号」「货位」列（SKU条码之后）。115/115测试全过。✅ 已部署 ECS（server.js/lib/sku-serial.js/lib/templates.js/lib/factory-export.js）

---

## 凭证速查

| 项目 | 值 |
|------|-----|
| 生产 Bitable App Token | B3xQbbqicaome1sKdZbcwdk8nWg |
| 测试 Bitable App Token | CtXObqwAHaCXYssBBfkcXmrlnUe |
| 飞书 APP_ID | cli_a958c5e372b85cb0 |
| ADMIN_TOKEN（生产） | GaushOrderMock |
| ADMIN_TOKEN（测试） | GaushOrderTest |
| 本地端口 | 3210（主服务）|

---

## 写 STATE 的规则

每次会话结束只更新本文件的「待办」和「已知问题」两节。
改动细节写入 CHANGELOG.md（append），格式：`## YYYY-MM-DD 标题`。
