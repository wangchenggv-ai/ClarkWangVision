# 订单交付系统

**目标：** 6.30 前完成最小闭环。代理商门户下单 → 数据落表 → QR码 → 物流全链路。

## 核心流程

```
代理商登录(浏览器) → 下单页(order.html) → POST /api/submit
    → 订单主表(tblk9Ch4gk2uQ1zG)  一单一条
    → 镜片明细表(tblC7pve7ObFgIOl)  一眼一条
    → 镜片码生成(16位HEX + QR)
    → 待处理 → 生产中 → 已发货 → 已签收
    → 随货通行单(A4打印)
```

## 启动

```bash
node server.js          # 默认端口 3210
PORT=8080 node server.js
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `server.js` | 门户后端（下单/查询/物流/导出） |
| `public/order.html` | 下单页面 |
| `public/track.html` | 订单查询页 |
| `public/labels.html` | 标签打印页 |
| `public/verify.html` | 镜片验真页 |
| `logistics.js` | 物流全链路（ship/deliver/slip/status） |
| `migrate_split_tables.js` | 镜片明细表创建+数据迁移 |
| `setup_tables.js` | Bitable 表结构初始化 |
| `import_real_skus.js` | 导入真实 SKU 数据 |
| `import_history.js` | 导入历史订单 |
| `dashboard.js` | 仪表盘数据 |
| `automations.js` | 业务规则引擎（9条规则） |
| `classify_skus.js` | SKU ABC-XYZ 分类 |
| `print_labels.js` | 批量标签打印 |
| `notify.js` | 飞书通知模块 |
| `delivery_analysis.js` | 交期分析 |
| `seed_factories.js` | 工厂产能种子数据 |
| `seed_config.js` | 规则配置种子数据 |
| `agents.json` | 代理商数据缓存 |
| `rules_config.json` | 业务规则参数 |
| `gen_tokens.js` | 生成代理商 Token |

## API 端点

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
| POST | `/api/order/:orderNo/confirm` | 确认订单 |
| GET | `/api/order/:orderNo/factory-zip` | 工厂包下载 |
| GET | `/api/order/:orderNo/slip` | 随货通行单 |

## 下单表单字段

**收货信息（必填）：**
- 终端客户（datalist，选中自动带出联系人/电话/地址）
- 联系人 / 联系电话 / 收货地址

**每个顾客：**
- 顾客姓名、产品型号、数量
- 右/左眼：球镜SPH + 柱镜CYL + 轴位AXIS
- 是否装配（复选框）
- 备注（选填）

## 物流命令

```bash
node logistics.js ship          # 逐单发货
node logistics.js ship-batch    # 合单发货（按代理商合并）
node logistics.js deliver --order ORD-xxx   # 模拟签收
node logistics.js status        # 物流汇总
node logistics.js slip --order ORD-xxx      # 单订单通行单
node logistics.js slip-batch    # 合单通行单
```
