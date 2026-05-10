# 飞书供应链系统 — 全面代码审核报告

> 审查日期：2026-06-05
> 审查范围：`order-system/` 后端 JS（~5000 行）+ 前端 HTML（~6000 行）
> 方法：按关切维度分片 → 3 个并行子代理独立审查 → 人工合成

---

## 🚨 P0 — 必须立即修复

### 1. Bitable Filter 注入

**位置**：`server.js` 中所有使用 `encodeURIComponent` + 模板字符串拼接 Bitable filter 的位置（约 20+ 处）

**严重程度**：严重

**描述**：`encodeURIComponent` 不编码双引号 `"`（RFC 3986 保留字符）。攻击者控制 orderNo（从 URL 路径提取）时可注入额外 filter 条件越权查询。

**修复方案**：
1. 对 orderNo 做格式白名单：`/^ORD-\d{8}-[A-F0-9]{8}$/`
2. 对 filter 值转义双引号：`.replace(/"/g, '\\"')`
3. 逐步迁移到飞书 Search API 的 JSON body filter

### 2. withLock 异常导致永久死锁

**位置**：`server.js` 约行 193-201

**严重程度**：严重

**描述**：`prev.then(() => next)` 无 `.catch()` handler。前序操作抛出异常后链永久断裂，该 key 所有后续操作永远卡在 `await prev`。

**修复方案**：`const prev = (_locks.get(key) || Promise.resolve()).catch(() => {});`

### 3. batchCreateRecords 部分成功无回滚

**位置**：`lib/feishu.js` 约行 92-110

**严重程度**：严重

**描述**：每 500 条一批串行提交，批次 1 成功后批次 2 失败 → 批次 1 已写入不可回滚。

**修复方案**：确认草稿文件删除时机在 Bitable 写入_确认_之后。关键路径使用两阶段：先写草稿文件 → Bitable 写入成功 → 再删草稿。

### 4. withLock 链外 TOCTOU

**位置**：`lib/stock.js` 约行 96-118

**严重程度**：严重

**描述**：`getStockMap()` 在 `withLock` 外部调用，锁外 `map.get(key)` 到锁内回调之间，另一并发请求可能已修改该行状态。

**修复方案**：将 `map.get(key)` 移到 `withLock` 回调内。

### 5. 双库存体系漂移

**位置**：`automations.js` rule1（操作 SKU 级 `finished_inventory`） vs 发货（操作度数级 `stock_detail`）

**严重程度**：严重

**描述**：`finished_inventory` 已被架构文档标记为旧表，但 rule1 仍从中扣减。两个表在独立时间点更新，数值逐渐漂移。

**修复方案**：确认 `stock_detail` 为唯一库存真相源，rule1 改为只读检查或操作 `stock_detail`。

---

## ⚠️ P1 — 近期修复

### 6. .env 凭据明文存储

**位置**：`.env.production`、`.env.test` | **高** | 生产环境通过环境变量注入，.env 文件设 `chmod 600`

### 7. 预占库存未纳入交期预估

**位置**：`lib/stock.js` `estimateDeliveryByRx()` | **高** | 改为使用 `available`（库存-预占）而非 `stock`

### 8. rule13 重复创建工单

**位置**：`automations.js` rule13 | **高** | 去重索引使用 `Map<key, single record>`，改为 `Map<key, Set>`

### 9. idempotency 重启丢失

**位置**：`server.js` 约行 239-252 | **高** | 重启后扫描草稿文件重建幂等表

### 10. 草稿同步无跨进程文件锁

**位置**：`server.js` `processPendingDrafts` | **高** | 单实例够用，多实例需外部锁

### 11. Admin Token 通过 Query String 传递

**位置**：`public/labels-clean.html`、`public/control.html` | **中** | 改用 `Authorization: Bearer` header

---

## 🔶 P2 — 规划修复

### 12. fetch 错误吞没，无重试/断路器

**位置**：`lib/feishu.js` | **中** | 对限频和 5xx 自动重试（指数退避）

### 13. Printer TCP 配置可篡改 → SSRF

**位置**：`lib/printer.js` | **中** | 验证 host 为私有 IP，通过环境变量配置

### 14. rule4 `inProduction` 字段永远为 0

**位置**：`automations.js` rule4 | **中** | 从 `production` 表读活跃工单

### 15. 交期判定跳过中央库存 fallthrough

**位置**：`lib/stock.js` `estimateDeliveryByRx()` | **低** | 代理商库存不足时回退到中央库存

### 16. rule14 回补时错误标记"最近出库"

**位置**：`automations.js` rule14 | **低** | 使用 `"最近入库"`

---

## ✅ 做得好的

| 维度 | 评价 |
|------|------|
| 代理认证 | `timingSafeEqual` 防止时序攻击 |
| 模块化 | `lib/*` 用 `init()`, DI 模式，可测试性好 |
| 状态路由 | `lib/state-router.js` 纯函数，职责清晰 |
| 并发控制 | `withLock` per-key 锁 + 锁内 fresh read |
| 草稿机制 | 文件级草稿 + 后台异步同步 Bitable |
| 缓存 | 多级缓存（磁盘 + 内存 TTL） |
| Excel 导入 | 列名模糊匹配支持多别名 |
| 前端安全 | `escapeHtml()` / `jsAttr()` 工具函数 |
| 架构文档 | `ARCHITECTURE-OVERVIEW.md` 详尽 |

---

## 📋 汇总

| 优先级 | 数量 | 类别 |
|--------|------|------|
| P0-严重 | 5 | Filter 注入、withLock 死锁、batch 无回滚、TOCTOU、双库存 |
| P1-高 | 6 | 凭据泄露、预占忽略、rule13 重复工单、幂等丢失、草稿无锁、admin token |
| P2-中 | 4 | 错误吞没、SSRF、inProduction 为 0、fallthrough |
| 低 | 2 | 语义错误 |

### 核心建议

1. **立即修复 Filter 注入和 withLock deadlock** — 运行时会触发的严重问题
2. **统一库存真相源**到 `stock_detail`，退役 `finished_inventory`
3. **批处理写入接受"最终一致性"模式** — Bitable 无事务，用草稿幂等兜底
4. **建议 CI 接入** E2E 测试脚本（已有 `full_test.js` 和 `run_e2e_test.js`）
