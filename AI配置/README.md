# AI 配置

本目录集中管理 Clark Wang 工作环境中的 AI 代理、模型、环境相关配置文档。

## 目录结构

```
AI配置/
├── 01-OpenClaw/           # OpenClaw 平台配置（主配置JSON + 接入排错日志 + OpenCode配置）
├── 02-Claude/             # Claude Code 配置（切换指南 + Karpathy原则 + Memory指南 + Session关闭协议 + 权限白名单）
├── 03-模型切换/            # 多模型（Claude/MiMo/Ark/DeepSeek）PowerShell Profile 配置
├── 04-环境安装/            # 环境搭建指南（助理电脑安装 + PowerShell Profile 配置）
├── 05-网络与远程/          # 网络与远程桌面（Tailscale + VNC 方案）
├── 06-Docker部署/          # Docker 部署方案讨论总结
├── 07-项目管理方法论/       # 单人多项目编程管理顶层设计 + 上下文管理最佳实践
├── README.md              ← 本文件
└── 同时4个窗口AI工作.png   # 参考图
```

## 各目录说明

### 01-OpenClaw
OpenClaw AI Agent 平台配置：`openclaw.json` 主配置（小米MiMo + xAI Grok + 飞书渠道 + Gateway），安装排错日志，OpenCode 工作配置。

### 02-Claude
Claude Code 相关配置：四渠道切换指南（Anthropic/小米MiMo/火山引擎/DeepSeek）、Karpathy 编码通用原则、Memory 系统使用指南、Session 关闭 5 步协议、本地命令权限白名单。

### 03-模型切换
PowerShell Profile 中定义的 4 个模型切换函数（Use-Claude / Use-Mimo / Use-Ark / Use-DeepSeek），管理代理开关和环境变量。

### 04-环境安装
环境搭建指南：高视星供应链系统助理电脑安装（30-45分钟六步流程）、PowerShell Profile 路径及配置备忘。

### 05-网络与远程
Tailscale + VNC 远程桌面方案，Windows → Mac Mini 的连接配置与故障排查。

### 06-Docker部署
两步走部署方案讨论：本地 Mac Mini Docker + ngrok → 迁移云服务器。

### 07-项目管理方法论
顶层设计文档：单人 6 项目串行管理（4 周一周期）、三层文件体系（CLAUDE.md / STATE.md / 按需加载）、AI 协作 4 角色升级机制。

## 移出的项目文档

以下文件已归入对应项目目录：
- `CLAUDE_订单系统_modified.md` → `04-供应链/02-高视星订单系统/`
- `供应链参数自动优化研究报告_2026-04-25.md` → `04-供应链/`
- `小米MiMo大模型申请.md` → `04-供应链/`
- `oklens-system.md` → `98-代码仓库/OK镜验配软件/`
