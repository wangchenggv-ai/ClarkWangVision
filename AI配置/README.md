# AI 配置

## OpenClaw 配置

OpenClaw 是一个 AI agent 平台，支持多渠道（飞书等）交互。

### 配置文件

`openclaw.json` 是主配置文件，需放置于 `~/.openclaw/openclaw.json`。

使用前需替换以下占位符：

| 占位符 | 说明 |
|--------|------|
| `<YOUR_GATEWAY_TOKEN>` | Gateway 认证 token |
| `<YOUR_XIAOMI_API_KEY>` | 小米 MiMo Token Plan API Key |
| `<YOUR_XAI_API_KEY>` | xAI Grok API Key |
| `<YOUR_FEISHU_APP_ID>` | 飞书应用 App ID |
| `<YOUR_FEISHU_APP_SECRET>` | 飞书应用 App Secret |
| `<YOUR_XAI_WEBSEARCH_KEY>` | xAI Web Search API Key |

### MiMo Token Plan 配置要点

1. **Provider 名不能用 `xiaomi`**，需改名（如 `xiaomi-coding`），否则会与预设 gateway 冲突
2. **删除 `auth` 字段中的 `xiaomi:default` profile**，Token Plan 不需要
3. **API Key 直接写入配置**，不通过 `env.` 引用
4. **Plugin 名仍为 `xiaomi`**，不要改成 `xiaomi-coding`
5. Agent 默认模型格式为 `xiaomi-coding/mimo-v2-pro`（provider/model）

### 模型列表

| 模型 | 说明 | 上下文 |
|------|------|--------|
| xiaomi-coding/mimo-v2-pro | 推理模型，主力模型 | 1M |
| xiaomi-coding/mimo-v2-flash | 轻量模型，免费 | 262K |
| xiaomi-coding/mimo-v2-omni | 多模态推理模型 | 262K |
| xai/grok-4-fast | Grok 4 快速版 | 2M |
| xai/grok-4-1-fast | Grok 4.1 快速版 | 2M |

### 常见问题

- **402 Insufficient account balance**：API 余额不足，需充值
- **401 Invalid API Key**：API Key 错误或过期，检查配置
- **plugin not found**：插件名写错，`xiaomi` 插件名不能改为 `xiaomi-coding`
- **FailoverError**：检查 provider baseUrl 和 apiKey 配置
