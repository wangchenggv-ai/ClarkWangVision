# CLAUDE.md — 老花OK镜产品落地页

> 高视全球首款老花OK镜的产品官网。独立部署，与订单系统物理隔离。

## 基本信息

| 项目 | 值 |
|------|-----|
| 访问地址 | https://ok.gaushclear.com |
| ECS IP | 113.44.175.221 |
| 部署目录 | /opt/gaush-lab/landing/ |
| 本地源文件 | C:\Users\wangc\landing-page\index.html |
| nginx 配置 | /etc/nginx/sites-enabled/ok-landing |
| HTTPS 证书 | Let's Encrypt，自动续期，到期 2026-07-20 |
| SSH 密钥 | `order-system/密钥/key-gaush-lab.pem`（相对于 04-供应链/feishu-setup/） |
| DNS | 华为云 DNS，A 记录 `ok` → `113.44.175.221` |

## 技术栈

- 单文件 HTML，零依赖，无构建步骤
- 字体：Cormorant Garamond + Noto Sans SC + JetBrains Mono（Google Fonts CDN）
- 深色主题，青绿主色 #4af0c8 + 金色点缀 #d4a853
- CSS-only 动画，IntersectionObserver 滚动渐入

## 部署流程

### 更新页面内容

```bash
# 1. 编辑本地源文件
# C:\Users\wangc\landing-page\index.html

# 2. 上传到服务器
scp -i "密钥/key-gaush-lab.pem" C:/Users/wangc/landing-page/index.html root@113.44.175.221:/opt/gaush-lab/landing/
```

### nginx 操作

```bash
ssh -i "密钥/key-gaush-lab.pem" root@113.44.175.221

# 测试配置
nginx -t

# 重载
systemctl reload nginx
```

## 隔离原则

- 独立 nginx server block（`ok-landing`），不碰订单系统的 `default` 配置
- 独立目录 `/opt/gaush-lab/landing/`，与 `/opt/gaush-lab/` 下的订单容器互不影响
- 独立域名 `ok.gaushclear.com`，与 `lab.gaushclear.com` 完全分离
- HTTPS 证书也是独立的，不共享

## 目录导航

- `STATE.md` — 项目状态与进度
- `index.html` — 页面源文件备份（服务器上是权威版本）
