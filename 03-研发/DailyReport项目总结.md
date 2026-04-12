# DailyReport 每日订单报告推送

## 项目背景

基于飞书多维表格中的销售订单数据，自动提取每日接单和每日发货信息，通过飞书机器人推送到指定群聊。

## 项目位置

`C:\Users\wangc\DailyReport\`

## 核心文件

| 文件 | 用途 |
|------|------|
| `openclaw_daily_report.js` | 供 openclaw 定时执行的独立脚本（主要使用这个） |
| `daily_report.js` | 本地可运行的报告脚本（模块化版本） |
| `server.js` | HTTP 服务版本（webhook 触发） |
| `explore_tables.js` | 多维表格结构探查工具 |

## 数据源

- **飞书多维表格**：`Kmqbb48c5aAzXpsRq4ycvFzAnmf`
- **数据表**：销售订单（`tbl0nnAm1HCWvqIB`）
- **筛选字段**：`接单日期` = 今天 → 今日接单；`发货日期` = 今天 → 今日发货

## 推送消息示例

```
📊 每日订单报告 (2026-03-28)

📥 今日接单: 6 单
  - | 谢东言 | 双效镜片 x1 [特急]
  - | 夏薇 | 微透镜离焦镜片 x1 [加急]
  - | 刘知润 | 微透镜离焦镜片 x1
  ...

📦 今日发货: 0 单
  无
```

## 涉及的飞书应用

| 应用 | App ID |
|------|--------|
| 多维表格读取 + 消息推送 | `cli_a94dfd3512f9dbd9` |
| openclaw（定时调度） | `cli_a9380818fab8dcb2` |

## 飞书权限要求

- `bitable:app:readonly` — 读取多维表格
- `im:message:send_as_bot` — 以机器人身份发消息

## 推送目标

飞书群 chat_id: `oc_27f1ea0481718ce1575c7f0a5f995989`

## 定时任务

通过 openclaw 配置 cron `0 9 * * *`，每天早上 9 点执行 `openclaw_daily_report.js`

## 技术栈

- Node.js（纯原生 `https` 模块，无第三方依赖）
- 飞书开放 API（认证、多维表格查询、消息发送）
