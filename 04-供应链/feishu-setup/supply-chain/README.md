# 供应链同步系统

**状态：暂停（6.30后启动）**

从 CRM 系统同步数据到供应链 Bitable。三个数据源：代理商、终端客户、订单。

## 文件说明

| 文件 | 用途 |
|------|------|
| `sync_agents.js` | CRM "01_代理商开发管理" → 代理商表 |
| `sync_customers.js` | CRM "02_终端开发和管理" → 终端客户表 |
| `sync_orders.js` | CRM 旧订单表 → 订单主表 |
| `sync_all.js` | 一键执行 3 步同步 |
| `field_mapping.json` | 旧订单表字段映射配置 |
| `migrate_split_tables.js` | 订单表拆分为主表+明细表 |
| `cache.js` | 本地 JSON 缓存模块 |
| `.sync_cursor.json` | 同步游标（增量同步标记） |

## 数据源

| CRM 表 | CRM App Token | 用途 |
|--------|---------------|------|
| 01_代理商开发管理 | `RlfTb6gykaEb3gsR1lwcGnShnAA` / `tblWmD23R4djdAlW` | 已签约代理商 |
| 02_终端开发和管理 | `RlfTb6gykaEb3gsR1lwcGnShnAA` / `tblQidjfbGA8DDkJ` | 终端客户 |

## 运行

```bash
node sync_agents.js        # 同步代理商
node sync_customers.js     # 同步终端客户
node sync_orders.js        # 同步订单
node sync_all.js           # 一键同步全部
```

## 双 Token 架构

- CRM App (`cli_a9492d9e44795cd6`) — 读取 CRM 数据
- 供应链 App (`cli_a94dfd3512f9dbd9`) — 写入供应链 Bitable

## 注意事项

- 改字段名前确认不影响订单系统（`order-system/`）
- CRM 缺少联系人/电话/地址字段，代码已预留，CRM 补齐后自动生效
- 同步结果以增量方式更新，已有记录不会覆盖手动修改的字段
