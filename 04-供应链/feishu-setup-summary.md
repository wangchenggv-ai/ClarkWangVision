# Feishu Supply Chain System Summary (飞书眼镜供应链智能系统摘要)

## Project Location

`C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\`

## What It Does

A Node.js automation suite that builds and manages an **eyeglass lens supply chain system** on Feishu Bitable. It covers the full business cycle:

1. **SKU master data** — 100 real lens SKUs (model + SPH/CYL), with safety stock and max stock auto-calculated from historical sales
2. **Inventory tracking** — finished lens and blank lens inventory with real-time status (in-stock / low / out-of-stock)
3. **Mold lifecycle** — tracks usage count, remaining life, and sends alerts when molds approach end-of-life (procurement cycle 3-4 weeks)
4. **Order processing** — auto-determines delivery type (3-day for in-stock, 5-day for custom/insufficient stock), decrements inventory, calculates promised delivery date
5. **Sales forecasting** — weekly forecast based on 4-week rolling average from historical orders
6. **Production scheduling** — auto-generates production plans when forecast demand exceeds (inventory + in-production)
7. **AI analysis** — calls Coze API to generate structured weekly reports (inventory alerts, mold warnings, production priorities, action items)
8. **Visual dashboard** — ECharts dark-theme dashboard with KPIs, charts, tables, and latest AI analysis

## File Overview

| File | Purpose |
|------|---------|
| `setup_tables.js` | One-shot: creates Feishu Bitable app with 8 tables + mock data |
| `automations.js` | 4 business rules engine (order/inventory/mold/production) |
| `ai_analysis.js` | Collects data snapshot, calls Coze AI, writes report to Feishu |
| `dashboard.js` | Pulls live data from Feishu, generates `dashboard.html` |
| `import_history.js` | Analyzes historical orders from Excel (date parsing, SKU normalization) |
| `import_real_skus.js` | Replaces mock data with real Top-100 SKUs from order history |
| `fix_permission.js` | Opens Bitable document permissions to organization |
| `test_rule1.js` | Inserts test orders to verify Rule 1 |
| `full_test.js` | End-to-end integration test (22 assertions) |

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

## Development History (4 Sprints)

- **Sprint 1:** Table creation + mock data seeding
- **Sprint 2:** 4 automated business rules
- **Sprint 3:** Coze AI weekly analysis + ECharts dashboard
- **Sprint 4:** Real data import pipeline + end-to-end testing

## Quick Start

```bash
cd feishu-setup
npm install
node setup_tables.js        # create tables + mock data
node automations.js all     # run all business rules
node ai_analysis.js         # generate AI report
node dashboard.js           # generate dashboard HTML
node import_real_skus.js    # switch to real data
```
