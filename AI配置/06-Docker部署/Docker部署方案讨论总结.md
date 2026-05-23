# Docker 本地云端部署方案 — 讨论总结

**日期：** 2026年4月19日

---

## 核心需求

1. 不让助理在本地装各种开发环境（难度太大）
2. 代码在 GitHub 上管理，更新后自动生效，不用反复下载
3. 全流程云端跑通：下单 → 多维表格 → 网页更新 → 二维码验证
4. 消费者扫码即可远程访问验证服务

## 关键认知

- 电脑通过 WiFi 上网 ≠ 外网可访问。电脑拿到的是 `192.168.x.x` 内网地址，外部无法直接连入
- 需要**内网穿透工具**（ngrok / cpolar）将本地服务映射到公网地址
- Docker 的核心价值：本地跑通的环境，原封不动搬到云服务器即可运行

## 确定方案：两步走

### 第一步：Mac Mini 本地 Docker 环境（本周）

**现有条件：**

- Mac Mini 24小时在线
- 已安装 Claude Code（命令行版），可操作本地终端
- 已安装 Tailscale，可远程控制

**架构通路：**

```
Clark（远程）→ Tailscale → Mac Mini → Claude Code 执行命令
→ Docker 容器跑服务 → ngrok 穿透到公网 → 助理/消费者访问
```

**待安装：**

- Docker Desktop for Mac
- ngrok 或 cpolar
- 从 GitHub clone 项目代码（Python + Node.js 技术栈）

**待完成：**

- 编写 Dockerfile 和 docker-compose.yml
- 构建并启动容器
- 配置 ngrok 穿透，获取公网访问地址

### 第二步：迁移到国内云服务器（下周起）

- 腾讯云或阿里云轻量服务器（约 50-80 元/月）
- Docker 镜像直接搬迁，助理无缝切换
- 配置 GitHub webhook 实现代码自动部署

## 风险提醒

| 风险项 | 说明 |
|--------|------|
| 稳定性 | 本地方案依赖电脑在线，断网/重启 = 服务中断 |
| 安全性 | 公网暴露需做好防火墙和 Docker 网络隔离 |
| SSL 证书 | 微信扫码要求 HTTPS，ngrok 免费版自带 |
| Claude Code 边界 | 能执行终端命令和 Docker 操作，但复杂报错需人工判断 |

## 下一步行动

1. Clark 提供 GitHub 仓库地址
2. Claude 分析项目结构，输出 Dockerfile + docker-compose.yml
3. Clark 通过 Tailscale 连接 Mac Mini，用 Claude Code 依次执行部署命令
4. 验证全流程跑通后，再迁移到云服务器
