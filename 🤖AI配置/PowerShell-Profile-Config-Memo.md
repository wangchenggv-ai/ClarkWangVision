# PowerShell Profile 配置备忘

## 文件位置

```
notepad $PROFILE
```

通常路径：`C:\Users\wangc\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`

## 三种模式切换

| 命令 | API | 代理 | 用途 |
|------|-----|------|------|
| `Use-Claude` | Anthropic 原生 | 开（127.0.0.1:58319） | Claude Code 官方订阅 |
| `Use-OpenRouter` | OpenRouter | 开（127.0.0.1:58319） | 第三方模型路由 |
| `Use-Mimo` | 小米 MiMo Token Plan | 关（国内直连） | 小米按量/订阅 |

## 关键配置逻辑

- **代理**：Anthropic / OpenRouter 走海外，需开代理；小米走国内，必须关代理
- **认证字段**：小米用 `ANTHROPIC_AUTH_TOKEN`（不是 `ANTHROPIC_API_KEY`）
- **模型指定**：小米需设置 `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` 均为 `mimo-v2-pro`
- **编码**：Profile 顶部加 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` 防中文乱码
- **注释语言**：Profile 内注释用英文，避免编码问题

## 使用流程

```powershell
# 切换模式
Use-Mimo       # 或 Use-Claude / Use-OpenRouter

# 启动 Claude Code
claude
```

## 注意事项

1. 切换后需**重新启动** `claude`，不能在已运行的会话中切换
2. 修改 Profile 后执行 `. $PROFILE` 重载，或重开终端
3. API Key 泄露时立即到对应平台重新生成
4. `settings.json` 位置：`%USERPROFILE%\.claude\settings.json`

## 验证代理是否可用

```powershell
Invoke-WebRequest -Uri "https://httpbin.org/ip" -Proxy "http://127.0.0.1:58319"
```

返回 200 且 IP 变化即代理正常。

---

*更新日期：2026-04-13*
