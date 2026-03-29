# Feishu Supply Chain System (飞书眼镜供应链智能系统)

## Overview

A Node.js automation suite that creates and manages a **smart eyeglass lens supply chain system** on Feishu (飞书) Bitable (多维表格). The system covers the full cycle: SKU master data, inventory tracking (finished + blank), mold lifecycle management, sales forecasting with seasonal adjustment, production scheduling with factory routing, order processing with validation, automated procurement, ABC-XYZ classification, AI-powered analysis, webhook notifications, and a visual dashboard.

**Feishu Bitable App Token:** `B3xQbbqicaome1sKdZbcwdk8nWg`

---

## Architecture

```
.env                    # Feishu App credentials + Coze PAT + Webhook URL
setup_tables.js         # Sprint 1: One-shot table creation + mock data seeding
automations.js          # Sprint 2+5: 9 business rules engine (config-driven)
rules_config.json       # Sprint 6: Rule parameters — local defaults
seed_config.js          # Sprint 6: Seed rule config into Feishu table
ai_analysis.js          # Sprint 3+5: Coze AI weekly analysis (with after-sales data)
dashboard.js / .html    # Sprint 3+5: ECharts dashboard (12 KPIs + 8 charts)
import_history.js       # Sprint 4: Historical order analysis from Excel
import_real_skus.js     # Sprint 4: Replace mock SKUs with real Top-100 SKUs
migrate_tables.js       # Sprint 5+6: Idempotent migration framework (10 migrations)
classify_skus.js        # Sprint 5: ABC-XYZ SKU classification
notify.js               # Sprint 5: Feishu webhook notification module
seed_factories.js       # Sprint 5: Factory capacity seed data
delivery_analysis.js    # Sprint 7: Delivery performance analysis + self-improvement
cache.js                # Sprint 8: Local JSON cache module (30min TTL)
fix_permission.js       # Utility: Open Bitable permissions to org
test_rule1.js           # Test: Insert blank orders to verify Rule 1
test_10_orders.js       # Test: Insert 10 diverse simulated orders
full_test.js            # Sprint 4+5: End-to-end integration test (32 assertions)
```

---

## 12 Bitable Tables

| Table Key            | Table Name     | Table ID             | Purpose |
|----------------------|----------------|----------------------|---------|
| `sku`                | SKU主数据表     | `tblwQsvGAahoeoJV`  | Master catalog (type, safety stock, ABC/XYZ class, strategy) |
| `finished_inventory` | 成品库存表      | `tblUF49B6i53MV2O`  | Current finished lens inventory + in-production qty |
| `blank_inventory`    | 毛坯片库存表    | `tbladv6bQTXlNOlM`  | Blank lens inventory with status alerts |
| `mold`               | 模芯管理表      | `tblkZ4ODg3v63prW`  | Mold core lifecycle (usage count, remaining life, alerts) |
| `production`         | 排产计划表      | `tbltSntfaR9KCI7B`  | Weekly production schedule with factory assignment |
| `forecast`           | 销售预测表      | `tblFLAHOXLSgWS6Q`  | Weekly sales forecast vs historical average |
| `ai_analysis`        | AI分析记录表    | `tbl8W9F9K2RbaL0k`  | AI-generated weekly analysis reports |
| `order`              | 订单表          | `tblk9Ch4gk2uQ1zG`  | Customer orders with validation + overdue alerts |
| `procurement`        | 采购跟踪表      | `tblZX1qW7RvcJieg`  | Auto-triggered procurement (mold + blank) |
| `factory`            | 车房产能表      | `tblJ6RXFENJFQe9A`  | Factory capacity, specialty, queue status |
| `after_sales`        | 售后记录表      | `tblzr1b8kH9yERZt`  | After-sales tracking (issue type, resolution) |
| `rule_config`        | 规则配置表      | `tbl78V8wgziRs0pt`  | Rule parameters (business users edit here) |

---

## 9 Business Rules (automations.js)

```bash
node automations.js rule1   # Order validation + delivery type
node automations.js rule2   # Finished inventory alerts
node automations.js rule3   # Mold life alerts
node automations.js rule4   # Seasonal forecast → production suggestions
node automations.js rule5   # Blank inventory alerts
node automations.js rule6   # Order overdue alerts
node automations.js rule7   # Auto-procurement trigger
node automations.js rule8   # Factory routing for production plans
node automations.js rule9   # Mold usage auto-increment
node automations.js all     # Run all 9 rules sequentially
```

### Rule 1: Order Validation → Inventory Check → Delivery Type
- Validates each new order: quantity > 0, quantity <= 100, no positive diopter anomaly
- Invalid orders → status "待人工审核" with issues in remarks field
- **Stock items** with sufficient inventory → "有货3天" (3-day delivery), stock decremented
- **Custom items** or insufficient stock → "定制5天" (5-day delivery)
- Sends batch notification card via Feishu webhook

### Rule 2: Finished Inventory Alert
- Compares current inventory against safety stock (from SKU master)
- Updates status: ✅有货 / ⚠️低库存 / ❌缺货
- Sends red/orange alert card to Feishu group

### Rule 3: Mold Life Alert
- Checks remaining usage count vs threshold (default 500)
- Status: 🟢正常 / 🟡预警 / 🔴需更换
- Sends batch alert to Feishu group

### Rule 4: Seasonal Forecast → Production Plan
- Applies seasonal coefficients: summer +30%, back-to-school +20%, CNY -20%
- Compares adjusted forecast against (current stock + in-production)
- If gap > 0, creates production suggestion with reason
- Prevents duplicate plans for same week+SKU

### Rule 5: Blank Inventory Alert (NEW)
- Compares blank lens stock against safety level (SKU safety × 1.5) and 2000-piece floor
- Status: ✅充足 / ⚠️低库存 / ❌缺货
- Sends batch notification when alerts found

### Rule 6: Order Overdue Alert (NEW)
- Scans active orders against promised delivery date
- Red alert: already overdue (with days count)
- Yellow alert: within 24 hours of deadline
- Sends urgency-grouped notification card

### Rule 7: Auto-Procurement Trigger (NEW)
- Scans molds approaching end-of-life → creates mold procurement record
- Scans blank inventory below 2000 pieces → creates blank procurement record
- Deduplicates against existing open purchase orders
- Sets expected delivery: molds 4 weeks, blanks 3 weeks

### Rule 8: Factory Routing (NEW)
- Assigns unallocated production plans to optimal factory
- Scoring: specialty match (+10 points) minus queue days
- 3 factories: 欧陆 (3000片/日), 九次方 (200片/日), 圣谱 (90片/日)
- Updates factory queue after assignment

### Rule 9: Mold Usage Auto-Increment (NEW)
- Scans completed production plans not yet counted for mold usage
- Increments mold usage count by production quantity
- Marks production record as "已计模芯" to prevent double-counting

---

## ABC-XYZ Classification (classify_skus.js)

Classifies 100 SKUs based on historical order data:

| Dimension | Criteria | Classes |
|-----------|----------|---------|
| **ABC** (Volume) | Cumulative volume: top 70% = A, next 20% = B, bottom 10% = C | A, B, C |
| **XYZ** (Variability) | Coefficient of variation: < 0.5 = X, < 1.0 = Y, >= 1.0 = Z | X, Y, Z |

**Strategy mapping:**

| Class | Strategy | Safety Multiplier |
|-------|----------|-------------------|
| AX, AY | 推式备库 (Push) | 3.0, 2.5 |
| BX, BY, BZ, AZ | 混合 (Hybrid) | 2.0, 1.5, 1.0, 2.0 |
| CZ | 纯按单 (Pull/MTO) | 0 → min 1 |

```bash
node classify_skus.js   # Reads orders, classifies, writes back to SKU table
```

---

## Webhook Notifications (notify.js)

Sends interactive card messages to a Feishu group bot:
- Supports red/orange/green card headers
- Batch mode for multiple alert items in one card
- Gracefully skips if `FEISHU_WEBHOOK_URL` not configured

All 9 rules integrate with notifications:
- Rule 1: Green card — order processing summary
- Rule 2: Red/orange card — inventory alerts
- Rule 3: Red card — mold life warnings
- Rule 4: Orange card — new production suggestions
- Rule 5: Red/orange card — blank inventory alerts
- Rule 6: Red card — order overdue warnings
- Rule 7: Red card — new procurement orders
- Rule 8-9: Console output only

---

## Migration Framework (migrate_tables.js)

Idempotent migration script — safe to re-run:

| # | Migration | Target |
|---|-----------|--------|
| 1 | Add 状态 field | blank_inventory |
| 2 | Add 安全毛坯库存 field | blank_inventory |
| 3 | Create 采购跟踪 table | (new table) |
| 4 | Create 车房产能 table | (new table) |
| 5 | Add 分配车房 field | production |
| 6 | Add ABC分类 + XYZ分类 + 备库策略 | sku |
| 7 | Add 已计模芯 field | production |
| 8 | Create 售后记录 table | (new table) |
| 9 | Add 备注 field | order |
| 10 | Create 规则配置 table | (new table) |

```bash
node migrate_tables.js    # Run all migrations (idempotent)
node seed_factories.js    # Seed 3 factory records (欧陆/九次方/圣谱)
node seed_config.js       # Seed 25 rule config rows with defaults
```

---

## Rule Configuration (规则配置)

All rule parameters are externalized into a **three-layer config system**:

```
Feishu "规则配置" table  >  rules_config.json  >  code fallback
      (business users)       (developers)         (hardcoded)
```

**How it works:** On startup, `automations.js` loads `rules_config.json` as defaults, then queries the Feishu config table for overrides. Business users change values in Feishu; developers change `rules_config.json`; code fallbacks are never touched.

### How to modify a rule parameter

1. Open Feishu Bitable → find the **规则配置** table
2. Locate the row (e.g. `rule1` / `instock_delivery_days`)
3. Change the **参数值** column (e.g. `3` → `2`)
4. Next run of `node automations.js` picks it up automatically

### 25 Configurable Parameters

| Rule | Parameter | Default | Description |
|------|-----------|---------|-------------|
| rule1 | `instock_delivery_days` | 3 | In-stock order delivery (days) |
| rule1 | `custom_delivery_days` | 5 | Custom order delivery (days) |
| rule1 | `max_order_qty` | 100 | Max qty per order, exceeding requires manual review |
| rule1 | `custom_product_type` | 定制品 | Custom product type name |
| rule2 | `high_alert_threshold` | 3 | Alert count threshold for red notification |
| rule3 | `critical_remaining` | 50 | Mold remaining count for "needs replacement" |
| rule3 | `default_warning_threshold` | 500 | Mold default warning threshold |
| rule4 | `seasonal_summer` | 1.3 | Summer coefficient (+30%) |
| rule4 | `seasonal_summer_months` | [6,7,8] | Summer months |
| rule4 | `seasonal_school` | 1.2 | Back-to-school coefficient (+20%) |
| rule4 | `seasonal_school_months` | [9] | Back-to-school months |
| rule4 | `seasonal_cny` | 0.8 | Chinese New Year coefficient (-20%) |
| rule4 | `seasonal_cny_months` | [1,2] | CNY months |
| rule4 | `seasonal_default` | 1.0 | Default seasonal coefficient |
| rule5 | `blank_safety_multiplier` | 1.5 | Blank safety = SKU safety x multiplier |
| rule5 | `blank_floor` | 2000 | Absolute blank inventory floor (pcs) |
| rule5 | `high_alert_threshold` | 2 | Alert count threshold for red notification |
| rule6 | `warning_hours` | 24 | Hours before deadline to trigger warning |
| rule6 | `skip_statuses` | ["已发货","完成","已签收"] | Order statuses to skip |
| rule7 | `mold_lead_days` | 28 | Mold procurement lead time (days) |
| rule7 | `blank_lead_days` | 21 | Blank procurement lead time (days) |
| rule7 | `blank_reorder_point` | 2000 | Blank reorder trigger (pcs) |
| rule7 | `blank_replenish_target` | 5000 | Blank replenishment target (pcs) |
| rule7 | `blank_min_order_qty` | 3000 | Minimum blank order quantity (pcs) |
| rule8 | `specialty_bonus` | 10 | Factory specialty match bonus score |

### Config table format (Feishu)

| 规则编号 | 参数名 | 参数值 | 说明 |
|---------|--------|--------|------|
| rule1 | instock_delivery_days | 3 | 有货订单交期（天） |
| rule4 | seasonal_summer | 1.3 | 夏季系数（6-8月） |
| ... | ... | ... | ... |

Values are auto-parsed: numbers become `Number`, `[...]` becomes arrays, everything else stays as string.

---

## AI Analysis (ai_analysis.js)

- Collects a full data snapshot from all 11 tables (including after-sales)
- Sends to **Coze API** (Bot ID: `7622147528649392169`) via streaming SSE
- AI generates a structured weekly report covering:
  - Inventory alerts (urgency-ranked)
  - Mold replacement warnings
  - Production priority recommendations
  - After-sales issue analysis
  - Trend observations
  - Top 5 action items
- Writes the report back to the AI分析记录表

---

## Dashboard (dashboard.js → dashboard.html)

Generates a dark-themed ECharts dashboard with:

**8 KPI cards:**
- Total orders, normal SKUs, low-stock count, out-of-stock count
- Blank inventory total, mold avg utilization rate, order overdue rate, pending procurement count

**8 charts:**
1. Inventory health donut (normal/low/out-of-stock)
2. SKU inventory vs safety line stacked bar + line
3. Mold lifecycle horizontal stacked bar
4. Orders by SKU bar chart
5. Blank inventory levels bar chart
6. Factory queue vs capacity horizontal bar
7. After-sales issue type pie chart
8. Procurement pipeline status bar

Plus: production plan table, mold details with progress bars, latest AI analysis text

---

## Full Test Suite (full_test.js)

32 assertions across 12 test groups:

| Group | Tests | Coverage |
|-------|-------|----------|
| 1. Data integrity | 6 | All tables have expected data |
| 2. Order delivery | 4 | Rule 1 — delivery type + date |
| 3. Inventory status | 3 | Rule 2 — low/out-of-stock |
| 4. Mold alerts | 3 | Rule 3 — status levels |
| 5. Production plans | 3 | Rule 4 — SKU, qty, factory |
| 6. Data consistency | 3 | Cross-table SKU references |
| 7. Blank inventory | 2 | Rule 5 — status + alerts |
| 8. Order overdue | 1 | Rule 6 — status presence |
| 9. Procurement | 2 | Rule 7 — records + dates |
| 10. Factory routing | 2 | Rule 8 — 3 factories + assignments |
| 11. ABC-XYZ | 2 | Classification + strategy |
| 12. After-sales | 1 | Table accessible |

```bash
node full_test.js   # Run all 32 assertions
```

---

## Setup & Configuration

### Prerequisites
- Node.js 18+
- Feishu self-built app with `bitable:app` permission

### .env file
```
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
COZE_PAT=pat_xxx
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_WEBHOOK_ID
```

### First-time setup
```bash
cd feishu-setup
npm install                 # installs undici, xlsx
node setup_tables.js        # creates Bitable + 8 tables + mock data
node fix_permission.js      # opens document permissions
node migrate_tables.js      # adds 4 new tables + new fields (10 migrations)
node seed_factories.js      # seeds 3 factory records
node seed_config.js         # seeds 25 rule config parameters
node automations.js all     # runs all 9 business rules (reads config)
node classify_skus.js       # ABC-XYZ classification
node delivery_analysis.js   # delivery performance analysis + simulation
node ai_analysis.js         # generates AI report
node dashboard.js           # generates dashboard HTML
node full_test.js           # verify everything works (32 assertions)
```

### Daily development (with cache + quiet mode)
```bash
node automations.js all -q          # quiet: 46 lines (vs 643 normal)
node delivery_analysis.js -q        # quiet: 1 line scorecard
node dashboard.js                   # cached: ~1.6s (vs ~8s fresh)

# When data changes, bypass cache:
node automations.js all --fresh     # skip cache, re-fetch from API
node automations.js all -q --fresh  # quiet + fresh
node dashboard.js --fresh           # fresh dashboard data
```

### Migrate to real data
```bash
node import_real_skus.js    # replaces mock with real Top-100 SKUs
node migrate_tables.js      # ensure new fields exist
node seed_factories.js      # seed factory data
node automations.js all     # re-run all rules on real data
node classify_skus.js       # classify real SKUs
node dashboard.js           # regenerate dashboard
node full_test.js           # verify (expect 32/32 pass)
```

---

## Development History

| Sprint | Dates | Deliverable | Status |
|--------|-------|-------------|--------|
| Sprint 1 | 2026-03 | Table creation + mock data | ✅ Done |
| Sprint 2 | 2026-03 | 4 business rules engine | ✅ Done |
| Sprint 3 | 2026-03 | AI analysis + dashboard | ✅ Done |
| Sprint 4 | 2026-03 | Real data import + E2E test | ✅ Done |
| Sprint 5 | 2026-03-29 | Phase 1-3 supply chain upgrade | ✅ Done |
| Sprint 6 | 2026-03-29 | Rule config externalization | ✅ Done |
| Sprint 7 | 2026-03-29 | Delivery performance analysis engine | ✅ Done |
| Sprint 8 | 2026-03-29 | Performance optimization (cache + quiet mode) | ✅ Done |

### Sprint 8 Changelog (Performance Optimization)

- Created `cache.js` — local JSON cache for Feishu API responses (30min TTL)
- Integrated cache into `automations.js`, `delivery_analysis.js`, `dashboard.js`
- Added `-q` quiet mode: `automations.js` output 643 → 46 lines (-93%), `delivery_analysis.js` 83 → 1 line (-99%)
- Added `--fresh` flag to bypass cache when data has changed
- Global data preload in `automations.js`: 9 tables loaded once (was 20 redundant API calls)
- `notify.js`: webhook warning printed once instead of per-rule
- Reduced test data from 310 → 100 orders (1 API page instead of 4)

### Sprint 7 Changelog (Delivery Performance Self-Improvement)

- Created `delivery_analysis.js` — 7-step closed-loop self-improvement engine
- Step 1-2: Measure actual vs predicted delivery performance (fill rate, overdue rate)
- Step 3: Per-SKU gap analysis weighted by ABC classification
- Step 4: Root cause diagnosis (zero stock, below safety, blank low, mold critical, capacity bottleneck)
- Step 5: Simulation engine — 7 what-if scenarios (safety stock ×, buffer weeks)
- Step 6: Prioritized recommendations with specific config changes
- Step 7: Auto-apply mode (`--apply`) updates Feishu config table directly
- Dashboard upgraded with delivery performance section (4 KPIs, simulation chart, gap table)

### Sprint 6 Changelog (Rule Configuration)

- Extracted 25 hardcoded parameters from 9 rules into config layer
- Created `rules_config.json` (local defaults with documentation)
- Created Feishu "规则配置" table (12th table, runtime overrides)
- Added `seed_config.js` to populate config table with defaults + descriptions
- Config loading: Feishu table > JSON file > code fallback
- Business users can modify rule thresholds directly in Feishu without touching code

### Sprint 5 Changelog (Supply Chain Upgrade)

**Phase 1 — Stop the Bleeding (止血)**
- Feishu webhook notification module (`notify.js`)
- Blank inventory automation (Rule 5)
- Order overdue alerts (Rule 6)
- Notifications integrated into all rules

**Phase 2 — Build Systems (建体系)**
- Procurement tracking table + auto-trigger (Rule 7)
- Factory capacity table + production routing (Rule 8)
- ABC-XYZ SKU classification with differentiated safety stock
- Mold usage auto-increment on production completion (Rule 9)

**Phase 3 — Stress Test (压测)**
- After-sales tracking table
- Dashboard upgrade: 8 KPI cards + 8 charts
- Seasonal forecast adjustment
- Order validation (quantity, diopter anomaly)
- Test suite expanded: 22 → 32 assertions

---

## Dependencies

```json
{
  "undici": "^7.24.6",
  "xlsx": "^0.18.5"
}
```

No other dependencies. Uses native `fetch` (Node 18+).
