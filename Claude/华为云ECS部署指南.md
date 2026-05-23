# 华为云 ECS 部署完整指南

> 适用于：静态网站、营销页面、轻量 Web 服务
> 最后更新：2026-05-03

---

## 一、创建安全组（先做！）

**踩坑：安全组必须在创建实例前准备好，且必须绑定到实例，否则所有端口都不通。**

1. 控制台 → **网络** → **虚拟私有云 VPC** → **访问控制** → **安全组**
2. 点 **创建安全组**
   - 名称：`web-server`（或自定义）
   - 描述：Web 服务器
3. 进入安全组 → **入方向规则** → **添加规则**，加三条：

| 优先级 | 策略 | 类型 | 协议 | 端口 | 源 |
|-------|------|------|------|------|-----|
| 1 | 允许 | IPv4 | TCP | 22 | 0.0.0.0/0 |
| 1 | 允许 | IPv4 | TCP | 80 | 0.0.0.0/0 |
| 1 | 允许 | IPv4 | TCP | 443 | 0.0.0.0/0 |

**⚠️ 常见坑：**
- 系统预置安全组（如 `Sys-WebServer`）通常只开 80/443，不含 22
- 安全组创建了但没绑定到实例 = 所有端口不通
- 改了安全组规则后可能需要重启实例才生效

---

## 二、创建 ECS 实例

控制台 → **弹性云服务器 ECS** → **购买弹性云服务器**

| 配置项 | 推荐值 | 备注 |
|-------|--------|------|
| 计费模式 | 按需计费 | 用多少付多少 |
| 区域 | 华南-广州 `cn-south-1` | 就近选择 |
| 规格 | 1核2GB | 静态网站够用 |
| 镜像 | Ubuntu 22.04 LTS | 软件源丰富 |
| 系统盘 | 40GB 高IO | 默认即可 |
| 网络 | 现有 VPC + 子网 | 没有就新建 |
| **安全组** | **选刚创建的那个** | **关键！别选错** |
| 弹性公网 IP | 现在购买，按流量计费，5M | 必须有公网 IP |
| 登录方式 | 密钥对 → 创建新密钥对 | 自动下载 .pem |
| 实例名称 | 自定义 | 方便识别 |

**⚠️ 常见坑：**
- 创建时就要选安全组，别漏了
- 弹性公网 IP 要在创建时购买，否则后面要手动绑定
- 密钥对 .pem 文件只下载一次，保存好

---

## 三、创建后的检查清单

### 3.1 验证公网 IP

ECS 实例列表 → 看 **弹性公网 IP** 列，确认有 IP 且不是"-"。

如果显示"-"：实例详情 → 网卡 → 绑定弹性公网 IP → 购买并绑定。

### 3.2 验证端口连通性

本地 PowerShell 执行：

```powershell
Test-NetConnection -ComputerName <公网IP> -Port 22
Test-NetConnection -ComputerName <公网IP> -Port 80
```

**TcpTestSucceeded 必须为 True。** 如果 False，99% 是安全组问题。

### 3.3 测试 SSH 连接

```bash
ssh -i "<密钥路径>.pem" -o ConnectTimeout=10 root@<公网IP> "echo connected"
```

首次连接会提示 host key verification，加 `-o StrictHostKeyChecking=no`：

```bash
ssh -i "<密钥路径>.pem" -o StrictHostKeyChecking=no root@<公网IP> "echo connected"
```

---

## 四、服务器初始化

SSH 连上后执行：

```bash
# 系统更新
apt update && apt upgrade -y

# 安装 nginx
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# 安装 certbot（HTTPS 证书）
apt install -y certbot python3-certbot-nginx

# 验证
nginx -v
certbot --version
```

---

## 五、部署静态页面

```bash
# 上传文件（本地执行）
scp -i "<密钥路径>.pem" -o StrictHostKeyChecking=no <本地文件> root@<公网IP>:/var/www/html/<文件名>

# 验证（本地执行）
curl -sI http://<公网IP>/<文件名>
# 预期：HTTP/1.1 200 OK
```

---

## 六、配置域名 + HTTPS

### 6.1 DNS 解析

在域名管理平台添加 A 记录：

| 主机记录 | 记录类型 | 记录值 |
|---------|---------|--------|
| `<子域名>` | A | `<ECS公网IP>` |

验证 DNS 生效：

```bash
nslookup <子域名>.<主域名>
```

### 6.2 配置 nginx

```bash
# 创建站点配置
cat > /etc/nginx/sites-available/<站点名> << 'EOF'
server {
    listen 80;
    server_name <域名>;
    root /var/www/html;
    index <入口文件>.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

# 启用站点，删除默认
ln -sf /etc/nginx/sites-available/<站点名> /etc/nginx/sites-enabled/<站点名>
rm -f /etc/nginx/sites-enabled/default

# 测试并重载
nginx -t && systemctl reload nginx
```

### 6.3 申请 HTTPS 证书

```bash
certbot --nginx -d <域名> --non-interactive --agree-tos --email admin@<主域名> --redirect
```

- 自动配置 HTTPS + HTTP 跳转
- 证书有效期 90 天，certbot 自动续期

验证：

```bash
curl -sI https://<域名>
# 预期：HTTP/1.1 200 OK
```

---

## 七、常用运维命令

```bash
# nginx 重载配置
nginx -t && systemctl reload nginx

# 查看 nginx 日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# 查看证书到期时间
certbot certificates

# 手动续期证书
certbot renew

# 查看端口监听
ss -tlnp | grep -E "80|443"

# 查看防火墙（一般不需要，安全组已控制）
ufw status
```

---

## 八、踩坑速查表

| 问题 | 现象 | 原因 | 解决 |
|------|------|------|------|
| SSH 连接超时 | Connection timed out | 安全组没开 22 端口或没绑定实例 | 检查安全组规则 + 绑定 |
| 所有端口都不通 | ping 通但 TCP 连不上 | 安全组未绑定到实例 | 实例详情→安全组→绑定 |
| 密钥文件权限报错 | WARNING: UNPROTECTED | .pem 权限太宽 | `chmod 400 key.pem` |
| nginx 403 Forbidden | 403 | 文件权限或目录不存在 | 检查 `/var/www/html/` |
| certbot 证书申请失败 | challenge failed | DNS 未生效或 80 端口不通 | 等 DNS 生效 + 检查安全组 |
| HTTP 不跳转 HTTPS | 访问 http 不跳转 | nginx 没配 redirect | certbot --redirect 重新配置 |

---

## 当前服务器清单

| 用途 | IP | 域名 | 密钥 |
|------|-----|------|------|
| 生产（订单系统） | 113.44.175.221 | lab.gaushclear.com | key-gaush-lab.pem |
| 个人（营销页面） | 113.44.177.107 | invite.gaushclear.com | web-invite.pem |
