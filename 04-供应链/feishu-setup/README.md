# 高视星供应链系统

**飞书 Bitable App Token:** `B3xQbbqicaome1sKdZbcwdk8nWg`

## 三系统架构（2026-04-22 重组）

| 目录 | 系统 | 状态 | 说明 |
|------|------|------|------|
| `order-system/` | 订单系统 | **开发中** | 代理商门户下单 → Bitable 落表 → QR码 → 物流全链路 |
| `inventory-system/` | 库存系统 | 规划中 | 度数级库存、交期预估、采购/生产/9条规则 |
| `shared/` | 共享配置 | — | `.env`、`tables.js`、`package.json` |

## 目录结构

```
feishu-setup/
├── order-system/          订单系统
│   ├── server.js           门户后端（下单/查询/物流）
│   ├── automations.js      9条业务规则引擎（库存/生产/采购）
│   ├── public/             前端页面（order.html, track.html, labels.html, verify.html）
│   ├── logistics.js        物流全链路
│   ├── sync_agents.js      CRM 代理商同步
│   ├── sync_customers.js   CRM 客户同步
│   ├── sync_orders.js      旧订单表增量同步
│   ├── sync_all.js         一键同步
│   ├── *.js                工具脚本（dashboard, analysis, labels...）
│   ├── qrcode-webhook/     Python QR码 webhook 服务
│   └── docs/               文档和报告
│
├── inventory-system/      库存系统
│   ├── CLAUDE.md           项目文档
│   ├── STATE.md            进度跟踪
│   └── migrate_stock_v2.js 度数级库存迁移脚本
│
├── shared/                共享配置
│   ├── .env                飞书 App 凭证
│   ├── tables.js           所有 Bitable 表 ID（单一真相源）
│   ├── migrate_tables.js   Bitable schema 迁移框架
│   └── package.json        Node.js 依赖
│
└── node_modules/          依赖（共享）
```

## 12 个 Bitable 表

表 ID 统一在 `shared/tables.js` 中维护，改 ID 只改一个文件。

| 表名 | Table ID | 用途 |
|------|----------|------|
| 订单主表 | `tblk9Ch4gk2uQ1zG` | 订单记录（含终端客户、联系人、物流） |
| 镜片明细表 | `tblC7pve7ObFgIOl` | 每片镜片一行（处方、镜片码、是否装配） |
| 终端客户表 | `tbltXNNhF65EBl17` | 终端客户（联系人、电话、地址） |
| 代理商表 | `tblHsgGbJWkB31qu` | 代理商信息（ID、名称、Token） |
| SKU主数据 | `tblwQsvGAahoeoJV` | 产品目录 |
| 成品库存 | `tblUF49B6i53MV2O` | 成品镜片库存 |
| 度数级库存 | `tbl7U79QGG4JtQev` | 度数级（SKU/SPH/CYL）库存 |
| 毛坯片库存 | `tbladv6bQTXlNOlM` | 毛坯片库存 |
| 模芯管理 | `tblkZ4ODg3v63prW` | 模芯生命周期 |
| 排产计划 | `tbltSntfaR9KCI7B` | 周排产计划 |
| 销售预测 | `tblFLAHOXLSgWS6Q` | 周销售预测 |
| 规则配置 | `tbl78V8wgziRs0pt` | 业务规则参数 |

## 快速启动

```bash
cd shared && npm install
cd ../order-system && node server.js    # 启动门户，端口 3210
```

## 数据流

```
CRM (RlfTb6gy...)
  ├── sync_agents.js    → 订单系统代理商表
  └── sync_customers.js → 订单系统终端客户表

旧订单表 (QrY0bFlW...)
  └── sync_orders.js    → 订单系统订单表（增量同步+90天清理）

代理商门户 → server.js → 订单系统 Bitable
  └── 交期预估 → stock_detail 表（度数级库存）
```
