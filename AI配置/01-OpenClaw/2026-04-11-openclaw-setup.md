# OpenClaw 安装与飞书接入日志

**日期**：2026-04-11  
**操作人**：Clark Wang

---

## 背景

在 Mac Mini 上安装 OpenClaw，并将其与手机飞书打通，实现通过飞书 App 远程控制本机 AI Agent。

---

## 问题排查过程

### 1. Gateway 未启动

**现象**：运行 `openclaw tui` 后显示 `gateway disconnected: closed | idle`

**原因**：只启动了 TUI，没有先启动 Gateway 服务

**解决**：
```bash
openclaw gateway install   # 安装为 launchd 服务（开机自启）
openclaw gateway start     # 启动服务
openclaw tui               # 再开 TUI
```

---

### 2. 安全审计问题

运行 `openclaw security audit --deep`，发现 3 个 CRITICAL：

| 问题 | 风险 |
|------|------|
| `groupPolicy="open"` + 高权限工具 | 飞书群任何人可触发命令执行 |
| `groupPolicy="open"` + 文件读写权限 | 提示词注入可读写本机文件 |
| `controlUi.allowInsecureAuth=true` | 不安全认证开启 |

**解决**：
```bash
openclaw config set channels.feishu.groupPolicy allowlist
openclaw config set gateway.controlUi.allowInsecureAuth false
openclaw gateway restart
```

修复后：CRITICAL 从 3 个降为 0。

---

### 3. 飞书连接失败（根本原因）

**现象**：飞书 channel 状态 `probe failed`，日志持续报错：
```
feishu[default]: bot open_id resolved: unknown
feishu[default]: bot identity background retry 1/5 failed
[ws] Request failed with status code 400
```

**排查过程**：
- 飞书 API 凭证正常（`app_id`/`app_secret` 验证通过）
- Bot 已激活（`activate_status: 2`）
- 权限全部授权（`grant_status: 1`）
- 手动 curl 调用 `/open-apis/bot/v3/info` 完全正常
- 用 Node.js 原生 https 调用也正常
- 但 Lark SDK（Axios）调用时报 400

**根本原因**：

系统安装了 **FastStunnel**，在本地 `127.0.0.1:58319` 建了一个 HTTPS 隧道代理，并将其写入系统代理：

```
http_proxy=http://127.0.0.1:58319
https_proxy=http://127.0.0.1:58319
```

OpenClaw 的 LaunchAgent 继承了这两个环境变量。Lark SDK 使用 Axios 发 HTTP 请求时，尝试用 plain HTTP 连接 HTTPS 代理端口，导致代理返回：

```
400 Bad Request: The plain HTTP request was sent to HTTPS port
```

curl 能正常工作是因为它对 CONNECT 隧道的处理方式不同。

**解决**：在 LaunchAgent plist 中加入 `no_proxy`，让飞书 API 直连绕过代理：

```xml
<key>no_proxy</key>
<string>open.feishu.cn,feishu.cn,open.larksuite.com</string>
```

重载服务后，日志立即变为：
```
feishu[default]: bot open_id resolved: ou_77af573b6f415a14b012f978533ab40a
feishu[default]: WebSocket client started
```

---

### 4. 手机配对

从手机飞书向 Bot 发消息后，终端执行：

```bash
openclaw pairing approve feishu P3NZVJFJ
```

配对完成，手机 ↔ 电脑双向消息打通。

---

## 最终状态

```
Gateway:  running (pid xxxxx, state active)
RPC probe: ok
Feishu:   enabled, configured, running, works
```

- 手机飞书可以向 AI Agent 发消息并收到回复
- AI Agent 可以主动推送消息到手机飞书
- 开机自动启动，无需手动操作

---

## 关键命令速查

```bash
openclaw tui                    # 打开 TUI 界面
openclaw gateway status         # 查看 Gateway 状态
openclaw gateway restart        # 重启 Gateway
openclaw channels status --probe  # 检查飞书连接状态
openclaw doctor                 # 健康检查
openclaw security audit --deep  # 安全审计
```
