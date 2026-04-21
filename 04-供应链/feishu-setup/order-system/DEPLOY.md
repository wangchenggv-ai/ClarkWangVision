# 部署指南

> 订单系统完整部署流程。最后更新: 2026-04-21

## 环境信息

| 项目 | 值 |
|------|-----|
| ECS IP | 113.44.175.221 |
| 域名 | lab.gaushclear.com（HTTPS，证书到期 2026-07-18） |
| 部署目录 | /opt/gaush-lab/ |
| SSH 密钥 | `密钥/key-gaush-lab.pem` |
| SWR 组织 | gaushclear-clark |
| ADMIN_TOKEN | GaushOrderMock |
| 容器 | order-app(:3210) + mock-shuang(:3220)，仅 127.0.0.1 |

## SWR 登录

> 凭证来源：华为云控制台 → 容器镜像服务 SWR → 登录指令

```bash
docker login -u cn-north-4@HPUAY8XFKCVNUW5ZP96W -p 546306393360cc4e3966e16532597ecfc84b2c278f021e5c785e3c57f3a34dd4 swr.cn-north-4.myhuaweicloud.com
```

## 标准部署流程（4 步）

### 1. 本地构建 + 推送

```bash
cd C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system

# 登录 SWR（用上面的凭据）
docker login swr.cn-north-4.myhuaweicloud.com

# 构建（必须 --provenance=false，否则 SWR 不兼容）
docker build --platform linux/amd64 --provenance=false -t swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1 .

# 推送
docker push swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1
```

### 2. ECS 登录 SWR

```bash
ssh -i "密钥/key-gaush-lab.pem" root@113.44.175.221

# 首次或凭证过期时需要登录
docker login -u cn-north-4@HPUAY8XFKCVNUW5ZP96W -p 546306393360cc4e3966e16532597ecfc84b2c278f021e5c785e3c57f3a34dd4 swr.cn-north-4.myhuaweicloud.com
```

### 3. ECS 拉取 + 重启

```bash
cd /opt/gaush-lab
docker compose pull && docker compose up -d
```

### 4. 验证

```bash
docker ps --format '{{.Names}} {{.Status}}'
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3210/login
# 应返回 200
```

## 备选：SCP 热更新（紧急修复）

> 不推荐长期使用，容器重建后会丢失改动。

```bash
# 上传文件
scp -i "密钥/key-gaush-lab.pem" server.js root@113.44.175.221:/opt/gaush-lab/
scp -i "密钥/key-gaush-lab.pem" -r public/ root@113.44.175.221:/opt/gaush-lab/

# 复制进容器 + 重启
ssh -i "密钥/key-gaush-lab.pem" root@113.44.175.221 \
  "docker cp /opt/gaush-lab/server.js order-app:/app/server.js && \
   docker cp /opt/gaush-lab/public/. order-app:/app/public/ && \
   docker restart order-app"
```

## 本地开发

```bash
node server.js  # 读 ../shared/.env 或 ../.env 里的飞书凭证
```

不依赖 Docker 本地跑，Docker 只用于推镜像部署。

## 踩坑记录

- **BuildKit attestation** → `--provenance=false` 必须加，否则 SWR 不兼容
- **.env 挂载** → `loadEnv()` 读文件不读 process.env，`.env` 必须挂载到 `/app/.env`
- **ECS 出站隔离** → ECS 上无法直接 `docker build`（拉不到基础镜像），必须本地构建推 SWR
- **SWR 登录凭证** → 是 SWR 专用密码（在 SWR 登录指令页面获取），不是 IAM AK/SK
