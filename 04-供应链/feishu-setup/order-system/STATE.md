# 系统当前状态

> 更新：2026-04-29 | 完整历史见 CHANGELOG.md

---

## 部署

| 项目 | 内容 |
|------|------|
| 生产地址 | https://lab.gaushclear.com（华为云 ECS Docker） |
| SSH | `ssh -i "04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem" root@113.44.175.221` |
| 容器 | order-app:3210（主服务）+ mock-shuang:3220 |
| 本次待部署 | ✅ 草稿缓冲系统（本地提交+后台同步+编辑修改）— 已部署 |
| 涉及文件 | server.js, public/order.html, public/track.html, public/css/common.css |

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

## 当前状态机（2026-04-29 草稿缓冲）

```
                          ┌─ 编辑/取消可改 ─┐
提交订单 → 存本地草稿 ────┤                ├→ 30min后台同步 → 已下单 → ...
   ~50ms                  └────────────────┘
                                                  ↓
                                        待处理 → 生产中 → ...
```

**Bitable 内状态流转**（草稿同步后，与原流程一致）：
```
已下单 → 待处理 → 生产中 ─┬→ 打标签 → 已发货（终态）
                  └→ 打标签（有库存）  └→ 已发货（供应商直发）
```

- **提交改为本地草稿**：~50ms 返回，不再阻塞 Bitable 写入
- **30 分钟编辑窗口**：代理商在追踪页可编辑/取消
- **后台自动同步**：写 Bitable(已下单) + 预占库存 + 生成镜片码
- **Docker volume 持久化**：`/opt/gaush-lab/drafts/` 挂载，重启不丢
- **镜片码**：点「待确认」时生成（不在提交时）
- **退回**：已下单/待处理/生产中/打标签均可退回；打标签统一退到已下单
- **废弃**：~~待签收~~ ~~已签收~~（已从所有代码、前端、API移除）

详见 `订单流程图-权威版.md`

---

## 已知问题 / 待办

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

---

## 凭证速查

| 项目 | 值 |
|------|-----|
| Bitable App Token | B3xQbbqicaome1sKdZbcwdk8nWg |
| 飞书 APP_ID | cli_a958c5e372b85cb0 |
| ADMIN_TOKEN（本地/测试） | GaushOrderMock |
| 本地端口 | 3210（主服务）|

---

## 写 STATE 的规则

每次会话结束只更新本文件的「待办」和「已知问题」两节。
改动细节写入 CHANGELOG.md（append），格式：`## YYYY-MM-DD 标题`。
