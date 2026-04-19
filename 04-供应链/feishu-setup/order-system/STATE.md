## 2026-04-16
今日开工，准备开始修复 1-2 级 bug。

## 2026-04-17
Day2 bug 修复完成：
- ④-1 (严重度1): XLSX write buffer 类型兼容修复
- ①-2 (严重度2): Excel 导入联系人/电话/地址/备注
- ①-1 (Day2): SPH/CYL/AXIS 列名匹配增强
- ①-3: 单眼勾选数量改用 lensCount
- ②-1: 确认页展开行按客户名过滤
- ④-2: 同 ④-1 根因
- ④-6: downloadZip 自动传 customer 过滤
- ④-3: 待验证（前端选择状态问题）

测试：26/26 断言全部通过 → `docs/day2_test_report.md`
已推送到 main（`12f8d9c`）

## 2026-04-18
代码审核后补修两处 must-fix：
- labels.html 新增 `jsAttr()`，修复 `onclick` 中含 `'` 的客户名导致 JS 字符串截断的崩溃风险
- server.js:1392 `lensCount: quantity * 2` → `quantity * lensCount`，与 1345 行单眼订单逻辑对齐

## 2026-04-19
A 系统迁云完成（学习+冷备演练，不接真流量）：

新建文件：
- `mock-shuang/` — Mock 溯源服务（模拟扫码回调 + 查询）
- `docker-compose.prod.yml` — 生产部署编排（order-app + mock-shuang）
- `.env.production` — 测试飞书 Bitable + Mock 配置

部署链路：Windows 构建 → SWR 推镜像 → ECS 拉取运行

华为云 ECS（gaush-lab）：
- IP: 113.44.175.221
- 域名: lab.gaushclear.com（HTTPS，证书到期 2026-07-18）
- 部署目录: /opt/gaush-lab/
- SSH 密钥: 04-供应链/feishu-setup/order-system/密钥/key-gaush-lab.pem
- SWR 组织: gaushclear-clark
- ADMIN_TOKEN: GaushOrderMock
- 两容器: order-app(:3210) + mock-shuang(:3220)，仅 127.0.0.1

安全隔离：
- 出站已隔离，不访问生产 ECS
- 使用测试 Bitable（B3xQbbqicaome1sKdZbcwdk8nWg）
- SHUANG_API_URL 指向 Mock 容器
- READ_ONLY_MODE=true

踩坑记录：
- Docker BuildKit attestation manifest 不兼容 SWR → 构建需 `--provenance=false`
- server.js loadEnv() 读文件不读 process.env → .env 必须挂载到 /app/.env

## 接手指南

### 飞书测试应用凭证
- APP_ID: cli_a958c5e372b85cb0
- APP_SECRET: PWLWUZ3ZZZj3DnKb2nX0yhBWoQ5hzu0y
- 测试 Bitable: B3xQbbqicaome1sKdZbcwdk8nWg（飞书多维表格副本，非生产）

### SWR 镜像仓库
- 区域: 华北-北京四
- 地址: swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/
- 登录: docker login -u cn-north-4@HST3WE7E22JS62Z857O4 -p 1ccc8f79040c8491b4301272da55df1abe0f3a9278b1ad48a6190d4def6dcdcf swr.cn-north-4.myhuaweicloud.com

### 更新部署流程
本地（Windows）：
```
cd C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system
docker login swr.cn-north-4.myhuaweicloud.com  # 用上面的凭据
docker build --platform linux/amd64 --provenance=false -t swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1 .
docker push swr.cn-north-4.myhuaweicloud.com/gaushclear-clark/order-app:v1
```

ECS（SSH）：
```
ssh -i "密钥/key-gaush-lab.pem" root@113.44.175.221
cd /opt/gaush-lab
docker compose pull && docker compose up -d
```

### 本地开发
本地直接 `node server.js`，读 `../shared/.env` 或 `../.env` 里的飞书凭证。
不依赖 Docker 本地跑，Docker 只用于推镜像部署。

## 2026-04-19 续
全链路验证测试通过（详见 `docs/cloud_migration_verify_report.md`）：
- 测试订单：ORD-20260419-ADCDF2AC（Clark, Ultra双效, 双眼）
- 右眼镜片码：9A01D300D79856A0
- 左眼镜片码：C0CD088A880AE1FD
- 下单 → 镜片码生成 → QR 码生成 → 消费者验真，全部正常
- QR 码图片已下载本地扫码验证通过

A 系统迁云完成，停止优化，回到 B 脚本主线。
