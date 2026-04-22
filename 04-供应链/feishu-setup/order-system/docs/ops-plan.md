# 运维自动化方案

> 订单系统无人值守运维方案。最后更新: 2026-04-22

## 背景

2026-04-22 发生全量代理商登录失败（401），根因是 `getFeishuToken()` 缓存 bug — 飞书 API 抖动时获取失败，缓存被污染为 `undefined`，7000 秒内所有 Bitable 请求都失败。

暴露两个问题：
1. 系统缺自愈能力 — 已知故障（token 过期）需要人工 SSH 介入
2. 缺低门槛运维入口 — 非技术同事无法自行排查

---

## 方案总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| **Phase 1** | 服务端自愈 + 健康检查 | ✅ 已完成代码 |
| **Phase 2** | 飞书机器人运维入口 | 规划中 |
| **Phase 3** | 定时巡检 + 自动重启 | 规划中 |

---

## Phase 1: 服务端自愈 + 健康检查

### 1.1 飞书 Token 自愈

**改造内容：** `feishuApi()` 收到飞书 token 失效错误时，自动清空缓存，下次请求立即刷新。

**原理：** 飞书 API 返回 `code: 99991663` 或 msg 包含 `Invalid access token` 时，说明当前 token 已失效。将 `_feishuToken` 清空 + `_feishuTokenTime` 归零，`getFeishuToken()` 下次被调用时会重新获取。

**覆盖场景：**
- token 自然过期（2小时 TTL）
- token 被飞书服务端提前回收
- 网络抖动导致首次获取失败 → 缓存污染（今天的 bug）

**不覆盖场景：**
- APP_ID / APP_SECRET 配置错误（需要换 .env）
- 飞书应用被删除/禁用（需要去飞书后台）
- 网络完全不通（需要检查网络）

### 1.2 健康检查端点 `GET /health`

**响应格式：**
```json
{
  "ok": true,                    // 全部检查通过
  "checks": {
    "feishu_token": true,        // 飞书 token 可获取
    "bitable_read": true,        // Bitable 可读
    "agent_count": 40,           // 代理商数量（0 = 异常）
    "uptime_seconds": 86400
  }
}
```

**用途：**
- 定时巡检脚本调用
- 飞书机器人 `健康检查` 命令
- 监控系统接入

### 1.3 代码改动清单

| 文件 | 改动 |
|------|------|
| `server.js` | `feishuApi()` 增加 token 失效自动清空逻辑 |
| `server.js` | 新增 `/health` 端点 |

---

## Phase 2: 飞书机器人运维入口（规划）

### 架构

```
同事在飞书群 @运维机器人
    ↓
飞书事件订阅（WebSocket）
    ↓
运维 Agent（Node.js 服务）
    ├─ 健康检查 → 调 /health
    ├─ 重启服务 → SSH docker restart
    ├─ 查看日志 → SSH docker logs
    ├─ 检查 Token → 调飞书 API 验证
    └─ 回复结果 → 飞书 IM
```

### 命令列表

| 命令 | 功能 | 权限 |
|------|------|------|
| `健康检查` | 调 /health 返回系统状态 | 所有人 |
| `重启订单系统` | docker restart order-app | 管理员 |
| `查看最近日志` | docker logs --tail 50 | 管理员 |
| `检查飞书连接` | 测试 tenant_access_token | 管理员 |
| `查看代理商` | 列出代理商表状态 | 所有人 |

### 安全考虑

- SSH 密钥不暴露给机器人，通过 ECS 上的本地 agent 通信
- 重启等危险操作需要管理员确认（飞书卡片确认按钮）
- 所有操作写审计日志

---

## Phase 3: 定时巡检（规划）

- cron 每 5 分钟调 `/health`
- `agent_count == 0` 或 `ok == false` → 自动重启 → 飞书群告警
- 连续 3 次失败 → 停止自动重启，通知人工介入

---

## 当前运维手册（临时）

直到 Phase 2 完成前，运维仍需 SSH：

```bash
# SSH 登录
ssh -i "密钥/key-gaush-lab.pem" root@113.44.175.221

# 重启订单系统
docker restart order-app

# 查看日志
docker logs order-app --tail 50

# 测试飞书连接
curl -s http://127.0.0.1:3210/health

# 测试代理商登录
curl -s http://127.0.0.1:3210/api/agent?t=AG-005-fab4f4f676813bbf
```
