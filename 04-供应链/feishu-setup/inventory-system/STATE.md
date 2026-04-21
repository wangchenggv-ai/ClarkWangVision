# STATE.md — 度数级库存项目进度快照

> 本文件是**当前状态快照**（易变），记录"现在走到哪了"。长期规则请看 [CLAUDE.md](CLAUDE.md)。
> 最后更新：**2026-04-21**

---

## 一、当前阶段

**第一阶段：度数级现货查询上线** — ✅ 已完成并通过端到端 API 测试

目标：代理商在下单页选产品 + 填度数时，立即看到该度数是否有现货、交期多久，每眼独立展示。

---

## 二、已完成清单（2026-04-21）

### 飞书 Bitable

- [x] 新建「度数级成品库存」表：`tbl7U79QGG4JtQev`（App `B3xQbbqicaome1sKdZbcwdk8nWg` 下）
- [x] 导入 **Ultra双效 + D8** 各 225 行度数组合，总 **450 行**
- [x] 两个 SKU 共用同一份度数分布（业务确认：目前两款库存结构一致）

### 代码

- [x] [migrate_stock_v2.js](migrate_stock_v2.js) — 建表 / 导入 / 预览三合一脚本
- [x] `../order-system/server.js`
  - [x] `TABLES.stock_detail` 常量
  - [x] `SKUS_WITH_DETAIL_STOCK` 精细 SKU 名单
  - [x] `STD_SPH_RANGE` / `STD_CYL_RANGE` 常规度数范围常量
  - [x] `getStockMap()` 度数级库存缓存（2 分钟 TTL）
  - [x] `estimateDeliveryByRx()` 三档交期判定
  - [x] `/api/delivery-estimate` 端点支持 `sph/cyl` 参数（向后兼容）
- [x] `../order-system/public/order.html`
  - [x] 删除患者卡片顶部的单一徽章容器
  - [x] 右眼/左眼下方各自加独立徽章容器
  - [x] `fetchEstimateForEye(id, side)` 每眼独立 fetch
  - [x] `onRxChange` 在 SKU / 数量 / SPH / CYL / 眼睛勾选变化时触发
  - [x] `LOW_STOCK_THRESHOLD = 5`，仅 ≤5 片显示"仅剩 N 片"

### 测试

端到端 API 测试（port 3299，已关），7/7 通过：

| # | 场景 | 输入 | 期望档位 | 实际 |
|---|------|------|---------|------|
| 1 | 现货充足 | Ultra双效 SPH=-1 CYL=-0.5 qty=1 | 有货1-2天 | ✅ stock=77 |
| 2 | 缺货常规度数 | Ultra双效 SPH=-5 CYL=0 qty=3 | 排产5-7天 | ✅ stock=2 |
| 3 | 超范围 | Ultra双效 SPH=-7 CYL=0 | 定制7-10天 | ✅ |
| 4 | D8 共用库存 | D8 SPH=-1.25 CYL=-0.5 qty=5 | 有货1-2天 | ✅ stock=82 |
| 5 | 非精细 SKU | 时空之眼A 无度数 | 有货3天 (fallback) | ✅ |
| 6 | 库存不足 | Ultra双效 库存 2 qty=5 | 排产5-7天 | ✅ |
| 7 | 度数精度 | SPH=-1.00 vs -1.0 | 同一行命中 | ✅ |

---

## 三、待办（下次继续）

### 下阶段（短期，下次会话优先做）

- [ ] **新增精细管理 SKU**：把硬编码列表里剩余 5 个按度数精细管理
  - `时空之眼A` / `时空之眼B` / `时空之眼PRO` / `时空之眼MAX`
  - `小旋风`
  - 每个需要业务方提供一份 Excel（同格式），或确认 SKU 间共用度数分布
- [ ] 验证完整下单闭环：代理商从门户选度数 → 看到徽章 → 提交订单 → 订单主表记录正确

### 第二阶段（未来，不急）

- [ ] 销售消耗分析（Excel 的 1月/2月/3月 sheet）
  - 输出月均消耗率 → 自动补货建议
  - Bitable 加"销售预测"字段
- [ ] 并发下单扣减库存（幂等设计）
- [ ] 安全库存告警（飞书 IM 通知）
- [ ] 在产量 / 毛坯量字段

---

## 四、关键事实速查

| 项 | 值 |
|----|----|
| 飞书 App Token | `B3xQbbqicaome1sKdZbcwdk8nWg` |
| 度数级库存表 ID | `tbl7U79QGG4JtQev` |
| 已录 SKU | `Ultra双效`、`D8`（各 225 行） |
| 当前库存总量 | 2340 片 × 2 SKU = 4680 片 |
| 度数范围 | SPH 0 ~ -6.00，CYL 0 ~ -2.00，步长 0.25 |
| 低库存阈值 | 5 片 |
| 缓存 TTL | 2 分钟 |
| Excel 源文件 | `C:/Users/wangc/Desktop/备库参数比例.xlsx` sheet=库存表 |
| 测试代理商 Token | `AG-002-zxkmgoryb6nprmv6`（代理商 AG-002 "测试代理商"） |
| 本地 order-system 端口 | 3210 |

---

## 五、启动指引（下次继续）

### 本地验证下单页

```bash
cd ../order-system
node server.js                    # 默认端口 3210
# 浏览器打开：
# http://localhost:3210/order?t=AG-002-zxkmgoryb6nprmv6
```

### 重新导入库存（如果改了 Excel）

```bash
cd ../inventory-system
node migrate_stock_v2.js preview                    # 先预览
node migrate_stock_v2.js import tbl7U79QGG4JtQev    # 清空 + 全量重导
```

### 新增 SKU 的操作顺序（记不清时照抄）

1. 决定：新 SKU 的度数分布 = 现有（复用 Excel）还是独立（新 Excel）
2. 若复用：改 [migrate_stock_v2.js](migrate_stock_v2.js) 的 `SKUS` 常量加名字
3. 若独立：改 `EXCEL_PATH` 或 `SHEET_NAME`，以及 `SKUS`
4. 跑 `node migrate_stock_v2.js preview` 确认数据无误
5. 跑 `node migrate_stock_v2.js import tbl7U79QGG4JtQev` 导入
6. 改 `../order-system/server.js` 的 `SKUS_WITH_DETAIL_STOCK.add("新SKU名")`
7. **重启** `server.js`（缓存是进程内的，不重启旧缓存还在最长 2 分钟）
8. 本地测试：选新 SKU + 各种度数，验证徽章正确

---

## 六、当前已知局限（不是 bug）

- **库存无并发扣减**：当前库存数是手工维护的静态数，下单时不会自动 -1。多代理商同时抢"仅剩 3 片"的度数会超卖。解决方案放第二阶段。
- **重启丢缓存**：`_stockCache` 是进程内存，重启后第一次请求会全表拉一次（450 行），延迟多约 500ms。可接受。
- **度数步长固定 0.25**：非 0.25 倍数的度数（如 -1.1）会找不到对应行，直接走"排产 5-7 天"档。实际业务里代理商几乎不会下 0.25 以外的度数，但要注意前端 `<input step="0.25">` 已限制。
