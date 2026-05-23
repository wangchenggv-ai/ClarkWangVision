# 高视星供应链系统

**飞书 Bitable App Token:** `B3xQbbqicaome1sKdZbcwdk8nWg`（生产）/ `CtXObqwAHaCXYssBBfkcXmrlnUe`（测试）

## 三系统架构（2026-04-22 重组）

| 目录 | 系统 | 状态 | 说明 |
|------|------|------|------|
| `order-system/` | 订单系统 | **已上线** | 代理商门户下单 → Bitable 落表 → QR码 → 物流全链路 |
| `inventory-system/` | 库存系统 | 规划中 | 度数级库存、交期预估、采购/生产/14条规则 |
| `shared/` | 共享配置 | — | `.env`、`tables.js`、`package.json` |

## 目录结构

```
feishu-setup/
├── order-system/          订单系统
│   ├── server.js           门户后端（下单/查询/物流）
│   ├── automations.js      14条业务规则引擎（订单/库存/生产/采购）
│   ├── public/             前端页面（portal.html, order.html, track.html, verify.html）
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
│   ├── tables.js           所有 Bitable 表 ID（支持 NODE_ENV=test 切换）
│   ├── migrate_tables.js   Bitable schema 迁移框架
│   └── package.json        Node.js 依赖
│
└── node_modules/          依赖（共享）
```

## 19 个 Bitable 表

表 ID 统一在 `shared/tables.js` 中维护，改 ID 只改一个文件。通过 `NODE_ENV=test` 可切换到测试 Bitable。

### 订单系统（4 张）

| 表名 | Table ID | 用途 |
|------|----------|------|
| 订单主表 | `tblk9Ch4gk2uQ1zG` | 订单记录（含终端客户、联系人、物流） |
| 镜片明细表 | `tblC7pve7ObFgIOl` | 每片镜片一行（处方、镜片码、是否装配） |
| 终端客户表 | `tbltXNNhF65EBl17` | 终端客户（联系人、电话、地址） |
| 代理商表 | `tblHsgGbJWkB31qu` | 代理商信息（ID、名称、Token） |

### 产品（1 张）

| 表名 | Table ID | 用途 |
|------|----------|------|
| 产品型号 | `tblU25NQ3RuaJJfc` | 产品目录 |

### 库存系统（8 张）

| 表名 | Table ID | 用途 |
|------|----------|------|
| SKU主数据 | `tblwQsvGAahoeoJV` | SKU 编码 |
| 成品库存 | `tblUF49B6i53MV2O` | 成品镜片库存 |
| 度数级库存 | `tbl7U79QGG4JtQev` | 度数级（SKU/SPH/CYL）库存 |
| 排产计划 | `tbluUfuETzwGdW1E` | 排产计划 |
| 毛坯片库存 | `tblrFIGHFVhTB16p` | 毛坯片库存 |
| 模芯管理 | `tblfnVzOA2yFzbjs` | 模芯生命周期 |
| 生产记录 | `tblWu5QwGPK1zYMl` | 生产记录 |
| 销售预测 | `tblK2YNUZ3RM3Zta` | 周销售预测 |

### 寄售库存（4 张）

| 表名 | Table ID | 用途 |
|------|----------|------|
| 代理商库存 | `tblIEYUemBGIquVs` | 寄售库存 |
| 寄售流水 | `tblP9VObYpOMh1gD` | 寄售出入库流水 |
| 月度对账单 | `tblvEIQ7IBCJw2iY` | 月度对账 |
| 库存流水 | `tblCoNeAbrz6tM9C` | 库存变动流水 |

### 其他（2 张）

| 表名 | Table ID | 用途 |
|------|----------|------|
| 规则配置 | `tbl78V8wgziRs0pt` | 业务规则参数 |
| AI分析 | `tbl8W9F9K2RbaL0k` | AI 周分析 |

## 快速启动

```bash
cd shared && npm install
cd ../order-system && node server.js          # 启动门户，端口 3210
cd ../order-system && NODE_ENV=test node server.js  # 连测试 Bitable
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
