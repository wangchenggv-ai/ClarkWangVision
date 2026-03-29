# Feishu Supply Chain System Summary (飞书眼镜供应链智能系统摘要)

## Project Location

`C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\`

## What It Does

A Node.js automation suite that builds and manages an **eyeglass lens supply chain system** on Feishu Bitable. It covers the full business cycle:

1. **SKU master data** — 100 real lens SKUs (model + SPH/CYL), with ABC-XYZ classification and differentiated safety stock
2. **Inventory tracking** — finished lens and blank lens inventory with real-time status (in-stock / low / out-of-stock)
3. **Mold lifecycle** — tracks usage count, remaining life, auto-increments on production completion, sends alerts when molds approach end-of-life
4. **Order processing** — validates order parameters, auto-determines delivery type (3-day for in-stock, 5-day for custom), tracks overdue orders
5. **Sales forecasting** — weekly forecast with seasonal adjustment coefficients (summer +30%, back-to-school +20%, CNY -20%)
6. **Production scheduling** — auto-generates production plans, routes to optimal factory based on specialty + queue
7. **Procurement automation** — auto-creates procurement orders for molds (4-week lead) and blanks (3-week lead)
8. **AI analysis** — calls Coze API to generate structured weekly reports (inventory alerts, mold warnings, after-sales analysis, action items)
9. **Visual dashboard** — ECharts dark-theme dashboard with 8 KPIs, 8 charts, production tables, and latest AI analysis
10. **Webhook notifications** — Feishu group bot alerts for inventory, molds, orders, procurement
11. **Config-driven rules** — 25 rule parameters editable directly in Feishu table by business users

## File Overview

| File | Purpose |
|------|---------|
| `setup_tables.js` | One-shot: creates Feishu Bitable app with tables + mock data |
| `automations.js` | 9 business rules engine (config-driven) |
| `rules_config.json` | Rule parameters — local defaults (25 params) |
| `seed_config.js` | Seeds rule config into Feishu "规则配置" table |
| `migrate_tables.js` | Idempotent migration framework (10 migrations) |
| `classify_skus.js` | ABC-XYZ SKU classification |
| `notify.js` | Feishu webhook notification module |
| `ai_analysis.js` | Collects data snapshot, calls Coze AI, writes report |
| `dashboard.js` | Pulls live data, generates `dashboard.html` |
| `import_history.js` | Analyzes historical orders from Excel |
| `import_real_skus.js` | Replaces mock data with real Top-100 SKUs |
| `seed_factories.js` | Seeds 3 factory records (欧陆/九次方/圣谱) |
| `fix_permission.js` | Opens Bitable document permissions |
| `test_rule1.js` | Inserts test orders to verify Rule 1 |
| `delivery_analysis.js` | Delivery performance analysis, simulation & self-improvement engine |
| `cache.js` | Local JSON cache for API responses (30min TTL, `--fresh` to bypass) |
| `full_test.js` | End-to-end integration test (32 assertions) |

## Tech Stack

- **Runtime:** Node.js 18+ (native fetch)
- **Dependencies:** `undici`, `xlsx` (only 2 packages)
- **APIs:** Feishu Open API (Bitable), Coze API (AI)
- **Visualization:** ECharts 5

## Key Data

- **Feishu Bitable App Token:** `B3xQbbqicaome1sKdZbcwdk8nWg`
- **Coze Bot ID:** `7622147528649392169`
- **Historical data source:** `C:/Users/wangc/Downloads/order/合并订单汇总.xlsx`
- **Real SKU models:** Ultra, Ultra双效, AB版, A版, B版, Max, PRO, D8, 小旋风, SP1
- **12 Bitable tables** including rule config table

## 9 Business Rules

| Rule | Name | Key Config Params |
|------|------|-------------------|
| Rule 1 | 订单处理 | delivery days (3/5), max qty (100) |
| Rule 2 | 库存预警 | alert threshold (3) |
| Rule 3 | 模芯预警 | critical remaining (50), warning threshold (500) |
| Rule 4 | 排产建议 | seasonal coefficients (summer 1.3, CNY 0.8) |
| Rule 5 | 毛坯预警 | safety multiplier (1.5), floor (2000) |
| Rule 6 | 超期预警 | warning hours (24) |
| Rule 7 | 采购触发 | lead times (mold 28d, blank 21d) |
| Rule 8 | 车房分配 | specialty bonus (10) |
| Rule 9 | 模芯累加 | (no config) |

All parameters configurable via Feishu "规则配置" table — no code changes needed.

## Delivery Performance Self-Improvement Engine

A 7-step closed-loop system that measures, diagnoses, simulates, and auto-evolves:

| Step | What | Output |
|------|------|--------|
| 1 | Measure actual delivery (fill rate, overdue rate) | 72.7% fill, 97.4% overdue |
| 2 | Measure predicted delivery (stock vs safety) | 39.0% predicted fill |
| 3 | Gap analysis (per-SKU, weighted by ABC class) | Top underperforming SKUs |
| 4 | Root cause diagnosis | zero_stock, below_safety, blank_low, etc. |
| 5 | Simulation (7 what-if scenarios) | Best: Safety+50% & +1wk → 85.7% |
| 6 | Generate prioritized recommendations | P1-P3 with config changes |
| 7 | Auto-apply config changes to Feishu | `--apply` flag |

```bash
node delivery_analysis.js              # Full analysis + simulation
node delivery_analysis.js --apply      # Auto-apply improvements
node delivery_analysis.js --report     # Analysis only
node delivery_analysis.js -q           # Quiet mode (1-line scorecard)
```

## Performance Optimization

| Feature | Flag | Effect |
|---------|------|--------|
| Quiet mode | `-q` | automations: 643→46 lines (-93%), delivery: 83→1 line (-99%) |
| Local cache | auto | 30min TTL, reads .cache/*.json instead of API |
| Fresh fetch | `--fresh` | Bypass cache, re-fetch from Feishu API |
| Global preload | auto | 9 tables loaded once (was 20 redundant calls) |

## Development History (8 Sprints)

- **Sprint 1:** Table creation + mock data seeding
- **Sprint 2:** 4 automated business rules
- **Sprint 3:** Coze AI weekly analysis + ECharts dashboard
- **Sprint 4:** Real data import pipeline + end-to-end testing
- **Sprint 5:** Supply chain upgrade — 5 new rules, 4 new tables, ABC-XYZ, notifications, dashboard upgrade
- **Sprint 6:** Rule config externalization — 25 params to Feishu table, business users self-service
- **Sprint 7:** Delivery performance analysis engine — actual vs predicted fill rate, gap analysis, simulation, auto-improvement recommendations, dashboard upgrade
- **Sprint 8:** Performance optimization — local JSON cache, quiet mode, global data preload, test data reduction (310→100 orders)

## Quick Start

```bash
cd feishu-setup
npm install
node setup_tables.js        # create tables + mock data
node migrate_tables.js      # add new tables + fields (10 migrations)
node seed_factories.js      # seed factory data
node seed_config.js         # seed rule config (25 params)
node automations.js all     # run all 9 business rules
node classify_skus.js       # ABC-XYZ classification
node delivery_analysis.js   # delivery performance analysis + simulation
node ai_analysis.js         # generate AI report
node dashboard.js           # generate dashboard HTML
node full_test.js           # verify (32/32 pass)

# Daily development (optimized)
node automations.js all -q          # cached + quiet
node delivery_analysis.js -q        # 1-line scorecard
node dashboard.js                   # cached ~1.6s
node automations.js all -q --fresh  # force API refresh
```
