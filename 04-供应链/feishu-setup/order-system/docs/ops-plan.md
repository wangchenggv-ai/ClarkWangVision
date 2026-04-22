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
| **Phase 2** | 运维 API（/ops/*） | ✅ 已完成代码 |
| **Phase 3** | OpenClaw 接入 | 规划中 |

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

## Phase 2: 运维 API（/ops/*）

### 设计原则

**不给 SSH，只给 HTTP API。** OpenClaw / 飞书机器人只能调预定义端点，不能执行任意命令。即使 LLM 幻觉，也只能调这几个操作。

### API 列表

全部需 `?admin=TOKEN` 认证。

| 端点 | 方法 | 功能 | 安全级别 |
|------|------|------|---------|
| `/health` | GET | 健康检查（飞书/Bitable/代理商数） | 无需认证 |
| `/ops/logs?tail=N` | GET | 最近 N 条请求日志（上限 500） | 只读 |
| `/ops/check-token` | GET | 测试飞书 token + Bitable 连通性 | 只读 |
| `/ops/restart` | POST | 重启服务（process.exit + Docker restart policy） | 危险 |

### /ops/restart 机制

服务器以 `--restart=unless-stopped` 运行（Docker Compose）。`process.exit(1)` 触发 Docker 自动重启，等效于 `docker restart`，但不需要 SSH 权限。

### OpenClaw 接入方式

OpenClaw 配置一个 HTTP tool，指向 `https://lab.gaushclear.com/ops/*?admin=GaushOrderMock`。MiMo Pro 理解用户意图 → 选择对应端点 → 调用 → 返回结果给飞书。

### 日志缓冲

`logReq()` 会将最近 500 条请求记录存在内存 `_reqLog` 数组中，供 `/ops/logs` 读取。重启后清空（Docker 日志仍保留完整记录）。

---

## Phase 3: OpenClaw 接入（规划）

### 架构

```
同事在飞书群 @机器人："重启订单系统"
    ↓
OpenClaw（MiMo Pro）
    ↓ HTTP tool
/ops/restart?admin=TOKEN
    ↓
process.exit(1) → Docker 自动重启
    ↓
回复飞书："已重启，服务恢复正常"
```

### OpenClaw 配置要点

- HTTP tool 基地址: `https://lab.gaushclear.com`
- 认证: `?admin=GaushOrderMock` 附加到每个请求
- 只暴露 /health、/ops/* 端点，不暴露其他 API
- 重启等危险操作可在 OpenClaw 侧配置二次确认

### 定时巡检（可选）

- cron 每 5 分钟调 `/health`
- `agent_count == 0` 或 `ok == false` → 自动重启 → 飞书群告警
- 连续 3 次失败 → 停止自动重启，通知人工介入

---

## 当前运维手册（Phase 2 部署前）

部署前仍需 SSH。部署后可通过 API 或 OpenClaw 操作。

### HTTP API（部署后）

```bash
# 健康检查
curl https://lab.gaushclear.com/health

# 查看最近 50 条日志
curl "https://lab.gaushclear.com/ops/logs?tail=50&admin=GaushOrderMock"

# 检查飞书连接
curl "https://lab.gaushclear.com/ops/check-token?admin=GaushOrderMock"

# 重启服务
curl -X POST "https://lab.gaushclear.com/ops/restart?admin=GaushOrderMock"
```

### SSH（应急）

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
