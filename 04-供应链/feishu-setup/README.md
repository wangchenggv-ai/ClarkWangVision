# 高视星供应链系统

**飞书 Bitable App Token:** `B3xQbbqicaome1sKdZbcwdk8nWg`

## 系统拆分（2026-04-14）

三个独立系统，共享编码规则，不共享数据库。

| 目录 | 系统 | 状态 | 说明 |
|------|------|------|------|
| `order-system/` | 订单交付系统 | **开发中** | 代理商门户下单 → Bitable 落表 → QR码 → 物流全链路 |
| `supply-chain/` | 供应链同步 | 暂停 | CRM 同步（代理商/客户/订单），6.30 后启动 |
| `shared/` | 共享配置 | — | `.env`、`migrate_tables.js`、`package.json` |

## 目录结构

```
feishu-setup/
├── order-system/          订单交付系统
│   ├── server.js           门户后端（下单/查询/物流）
│   ├── public/             前端页面（order.html, track.html, labels.html, verify.html）
│   ├── logistics.js        物流全链路（ship/deliver/slip）
│   ├── migrate_split_tables.js  镜片明细表迁移
│   ├── *.js                工具脚本（setup, import, seed, dashboard...）
│   ├── qrcode-webhook/     Python QR码 webhook 服务
│   └── docs/               文档和报告
│
├── supply-chain/          供应链同步（6.30后启动）
│   ├── sync_agents.js      CRM 代理商同步
│   ├── sync_customers.js   CRM 客户同步
│   ├── sync_orders.js      CRM 订单同步
│   ├── sync_all.js         一键同步
│   └── migrate_split_tables.js  订单拆表迁移
│
├── shared/                共享配置
│   ├── .env                飞书 App 凭证
│   ├── .env.example        环境变量模板
│   ├── migrate_tables.js   Bitable schema 迁移框架
│   └── package.json        Node.js 依赖
│
└── node_modules/          依赖（共享）
```

## 12 个 Bitable 表

| 表名 | Table ID | 用途 |
|------|----------|------|
| 订单主表 | `tblk9Ch4gk2uQ1zG` | 订单记录（含终端客户、联系人、物流） |
| 镜片明细表 | `tblC7pve7ObFgIOl` | 每片镜片一行（处方、镜片码、是否装配） |
| 终端客户表 | `tbltXNNhF65EBl17` | 终端客户（联系人、电话、地址） |
| 代理商表 | `tblHsgGbJWkB31qu` | 代理商信息（ID、名称、Token） |
| SKU主数据 | `tblwQsvGAahoeoJV` | 产品目录 |
| 成品库存 | `tblUF49B6i53MV2O` | 成品镜片库存 |
| 毛坯片库存 | `tbladv6bQTXlNOlM` | 毛坯片库存 |
| 模芯管理 | `tblkZ4ODg3v63prW` | 模芯生命周期 |
| 排产计划 | `tbltSntfaR9KCI7B` | 周排产计划 |
| 销售预测 | `tblFLAHOXLSgWS6Q` | 周销售预测 |
| AI分析 | `tbl8W9F9K2RbaL0k` | AI 周分析报告 |
| 规则配置 | `tbl78V8wgziRs0pt` | 业务规则参数 |

## 快速启动

```bash
cd shared && npm install
cd ../order-system && node server.js    # 启动门户，端口 3210
```
