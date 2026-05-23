# Claude Code 多渠道切换备忘

> 配置文件路径：`C:\Users\wangc\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`

---

## 四个渠道对比

| 渠道 | 命令 | 模型 | 上下文 | 代理 | 场景 |
|------|------|------|--------|------|------|
| Anthropic 官方 | `Use-Claude` | Claude 原生 | 原生 | 需要（58319） | 最强能力，需VPN |
| 小米 MiMo | `Use-Mimo` | mimo-v2.5-pro | 1M（显示200k） | 不需要 | 国内直连，按套餐限量 |
| 火山引擎 Ark | `Use-Ark` | glm-5.1 | — | 不需要 | 国内直连，CodingPlan |
| DeepSeek | `Use-DeepSeek` | deepseek-v4-pro[1m] | 1M | 需要 | 长上下文，大任务 |

---

## 切换步骤

```powershell
# 切换到 Claude 官方（需VPN）
Use-Claude
claude

# 切换到 MiMo（无需VPN）
Use-Mimo
claude

# 切换到 Ark GLM（无需VPN）
Use-Ark
claude

# 切换到 DeepSeek（需VPN）
Use-DeepSeek
claude
```

---

## 关键配置细节

### Use-Claude
- 清空所有 env 字段，恢复默认
- 自动开启代理（127.0.0.1:58319）

### Use-Mimo
- BASE_URL：`https://token-plan-cn.xiaomimimo.com/anthropic`
- 认证字段：`ANTHROPIC_AUTH_TOKEN = "tp-xxx"`
- 模型名：`mimo-v2.5-pro`（注意是2.5，不是2）
- 实际1M上下文，界面显示200k（正常现象）
- 自动关闭代理

### Use-Ark
- BASE_URL：`https://ark.cn-beijing.volces.com/api/coding`
- 认证字段：`ANTHROPIC_AUTH_TOKEN = "ark-xxx"`
- 模型名：`glm-5.1`（ark-code-lastest 不可用）
- 自动关闭代理

### Use-DeepSeek
- BASE_URL：`https://api.deepseek.com/anthropic`
- 认证字段：`ANTHROPIC_AUTH_TOKEN = "你的key"`
- 主模型：`deepseek-v4-pro[1m]`，子Agent：`deepseek-v4-flash`
- `CLAUDE_CODE_EFFORT_LEVEL = "max"`
- 自动开启代理

---

## 故障排查

**连接超时/Retrying** → 检查代理状态
```powershell
echo $env:HTTPS_PROXY   # 应为空（Mimo/Ark）或有值（Claude/DeepSeek）
Proxy-Off               # 手动关闭代理
Proxy-On                # 手动开启代理
```

**model not exist** → 模型名写错，去对应平台控制台确认

**settings.json 被覆盖** → 正常现象，每次 Use-xxx 都会重写，改 profile 函数而非 settings.json

**API Key 泄露** → 立即去对应平台控制台重新生成

---

*最后更新：2026-04-27*
