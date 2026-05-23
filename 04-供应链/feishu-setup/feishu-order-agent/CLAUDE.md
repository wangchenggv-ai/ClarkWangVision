# CLAUDE.md — 飞书订单 Agent

内部运营用飞书机器人，替代 admin web UI，供助理在内部群操作订单。

---

## 一、项目定位

- **不替代代理商门户**（order.html / track.html / verify.html 继续服务代理商）
- **替代管理后台**（labels.html / orders.html 等助理操作界面）
- 调用 order-system 的 `/api/admin/*` 端点，需要 `?admin=TOKEN`

---

## 二、架构

```
飞书群 @机器人
  ↓ HTTPS
https://lab.gaushclear.com/bot/feishu/event
  ↓ nginx proxy_pass
feishu-agent（PM2, 127.0.0.1:3230）
  ↓ HTTP
order-app-test（Docker, 127.0.0.1:3211）  ← 测试环境
order-app（Docker, 127.0.0.1:3210）       ← 生产（未接入）
```

---

## 三、文件结构

| 文件 | 职责 |
|------|------|
| `server.js` | HTTP 入口，路由 /health 和 /feishu/event |
| `lib/bot.js` | 全部 bot 逻辑：命令路由、卡片模板、Excel 解析 |
| `lib/api.js` | order-system HTTP 客户端 |
| `lib/feishu.js` | 飞书 API：token、sendCard、sendText、downloadFile |
| `.env` | 环境变量（不提交） |

---

## 四、支持的命令

| 命令 | 说明 |
|------|------|
| `ORD-xxx` | 查询订单状态 |
| `/确认 ORD-xxx [...]` | 确认订单，生成镜片码 |
| `/发货 ORD-xxx [快递单号] [快递公司]` | 发货 |
| `/签收 ORD-xxx` | 签收（终态） |
| `/退回 ORD-xxx` | 退回上一步 |
| `/已下单` `/待处理` `/生产中` `/打标签` `/已发货` | 按状态列表 |
| `/看板` | 系统概览数字 |
| `/帮助` | 帮助卡片 |
| 上传 .xlsx | Excel 接单：解析→预览卡片→确认写入 |

---

## 五、关键技术细节

### 飞书事件格式（坑）
- 消息事件：`payload.header.event_type = "im.message.receive_v1"`，数据在 `payload.event`
- 卡片按钮点击：同时发两种格式：
  - **新格式** schema 2.0：`event_type = "card.action.trigger"`，`open_chat_id` 在 `event.context.open_chat_id`
  - **旧格式** schema 1.0：无 header，`open_chat_id` 在 payload 顶层
- `action.value` 被飞书**双重 JSON 编码**，需 parse 两次

### Excel 解析
- 动态找表头行（前10行找含"顾客姓名"/"眼别"的行，不假设第一行是表头）
- 顾客姓名支持"填充"（同一顾客多行只写第一行）
- flat records → `{ orders: [{ agentName, patients: [{ customerName, eyes: [] }] }] }` 传给 API

### 卡片按钮 value
- 不在 value 里塞大数据，用 `_pendingImports` Map 暂存（10分钟过期）
- key 格式：`imp_{timestamp}`

### /已下单 /待处理 的确认按钮
- 只在这两个状态显示"全部确认"按钮，其他状态纯列表

---

## 六、部署（ECS 测试环境）

```powershell
# 本地 → ECS
$KEY = "C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system\密钥\key-gaush-lab.pem"
scp -i $KEY lib\bot.js root@113.44.175.221:/opt/feishu-agent/lib/bot.js
ssh -i $KEY root@113.44.175.221 "pm2 restart feishu-agent"
```

- 进程管理：PM2，进程名 `feishu-agent`
- 工作目录：`/opt/feishu-agent/`
- 日志：`pm2 logs feishu-agent --lines 30 --nostream`

### nginx 配置（已在 ECS 配好）
```nginx
location /bot/ {
    proxy_pass http://127.0.0.1:3230/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

---

## 七、环境变量

| 变量 | 用途 |
|------|------|
| `BOT_APP_ID` | 飞书机器人 App ID |
| `BOT_APP_SECRET` | 飞书机器人 App Secret |
| `BOT_VERIFY_TOKEN` | 飞书事件验证 Token |
| `ORDER_API_BASE` | 订单系统地址（测试 127.0.0.1:3211） |
| `ORDER_API_TOKEN` | admin token（测试 GaushOrderTest） |
| `PORT` | Bot 监听端口（3230） |

---

## 八、飞书开放平台配置

- 应用：`cli_aa8cea6ac4b8dbcb`
- 事件回调 URL：`https://lab.gaushclear.com/bot/feishu/event`
- 订阅事件：`im.message.receive_v1`
- 机器人需加入内部工作群
