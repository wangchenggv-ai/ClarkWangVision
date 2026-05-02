# 订单交付系统

> 详细架构见 [[ARCHITECTURE.md]]，当前状态见 [[STATE.md]]

**目标：** 6.30 前完成最小闭环。代理商门户下单 → 数据落表 → QR码 → 物流全链路。

## 核心流程

```
① 代理商下单（Web表单/Excel导入）→ 生成订单号 + 镜片码
② 助理确认 → 已下单 → 待处理
③ 助理导出Excel给工厂 → 自动变为生产中
④ 工厂生产加工 → 返回镜片
⑤ 助理打印标签（75×40mm 专业标签）
⑥ 助理发货 → 自动生成快递单号 → 飞书发货卡片
⑦ 助理签收 → 飞书签收卡片
⑧ 消费者扫码验真
```

**状态流转：** `已下单 → 待处理 → 生产中 → 已发货 → 待签收 → 已签收`

## 启动

```bash
node server.js          # 默认端口 3210
PORT=8080 node server.js
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `server.js` | 门户后端（下单/查询/物流/导出/AI接口） |
| `public/order.html` | 代理商下单页面 |
| `public/track.html` | 订单查询页 |
| `public/labels.html` | **助理订单管理中心**（确认/导出/打印/发货/签收 + AI功能） |
| `public/verify.html` | 镜片验真页 |
| `logistics.js` | 物流全链路（ship/deliver/slip/status） |
| `automations.js` | 业务规则引擎（9条规则） |
| `ai_analysis.js` | AI 周分析（Coze bot → 飞书多维表格） |
| `dashboard.js` | 供应链智能看板（KPI + ECharts） |
| `delivery_analysis.js` | 交期分析（实际/预测/模拟） |
| `classify_skus.js` | SKU ABC-XYZ 分类 |
| `print_labels.js` | 批量标签打印 |
| `notify.js` | 飞书通知模块 |
| `logistics.js` | 物流全链路 CLI |
| `setup_tables.js` | Bitable 表结构初始化 |
| `import_real_skus.js` | 导入真实 SKU 数据 |
| `import_history.js` | 导入历史订单 |
| `import_excel.js` | Excel 处方导入 CLI |
| `seed_factories.js` | 工厂产能种子数据 |
| `seed_config.js` | 规则配置种子数据 |
| `agents.json` | 代理商数据缓存 |
| `rules_config.json` | 业务规则参数 |
| `gen_tokens.js` | 生成代理商 Token |

## API 端点

### 代理商端

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 下单页面 |
| GET | `/track` | 查询页面 |
| GET | `/api/agent?t=xxx` | 代理商信息 |
| GET | `/api/skus?t=xxx` | SKU 列表 + 库存 |
| GET | `/api/delivery-estimate` | 交期预估 |
| POST | `/api/submit?t=xxx` | 提交订单 |
| GET | `/api/orders?t=xxx` | 订单列表 |
| GET | `/api/order/:orderNo?t=xxx` | 订单详情 |
| GET | `/api/orders/export?t=xxx` | CSV 导出 |
| GET | `/api/customers?t=xxx` | 历史客户列表 |
| GET | `/api/terminal-customers?t=xxx` | 终端客户列表 |
| POST | `/api/order/:orderNo/confirm` | 代理商确认订单 |
| GET | `/api/order/:orderNo/factory-zip` | 工厂包下载 |
| GET | `/api/order/:orderNo/slip` | 随货同行单 |

### 管理端（labels.html）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/orders` | 全部订单列表（支持筛选/分页） |
| GET | `/api/admin/order/:no/lens-details` | 订单镜片明细 |
| POST | `/api/admin/confirm` | 批量确认订单 |
| POST | `/api/admin/ship` | 批量发货（自动生成快递单号） |
| POST | `/api/admin/deliver` | 批量签收 |
| GET | `/api/admin/labels/batch` | 批量生成标签 HTML |
| GET | `/api/admin/batch-zip` | 批量导出 ZIP |
| POST | `/api/admin/ai-search` | **AI 自然语言搜索** |
| GET | `/api/admin/ai-anomaly` | **AI 异常检测** |
| POST | `/api/admin/ai-qa` | **AI 数据问答** |
| GET | `/api/admin/ai-suggest` | **AI 智能建议** |

## AI 能力

管理页集成了 4 个 AI 功能（均基于 MiMo 大模型）：

1. **自然语言搜索**：输入中文如"深圳视力康超期订单"，自动转换为筛选条件
2. **异常检测**：自动扫描超期订单、处方极端值、重复镜片码等异常
3. **数据问答**：右下角聊天窗，随时提问"本月订单量多少""哪个代理商下单最多"
4. **智能建议**：基于当前订单状态推荐下一步操作（批量确认超期订单等）

## 物流命令

```bash
node logistics.js ship          # 逐单发货
node logistics.js ship-batch    # 合单发货（按代理商合并）
node logistics.js deliver --order ORD-xxx   # 签收
node logistics.js status        # 物流汇总
node logistics.js slip --order ORD-xxx      # 单订单通行单
node logistics.js slip-batch    # 合单通行单
```
