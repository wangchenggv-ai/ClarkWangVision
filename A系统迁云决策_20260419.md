# A 系统迁云决策与执行方案

**日期:** 2026-04-19
**决策人:** Clark
**背景:** 基于《高视星订单系统_混合方案实施计划》V1.0 的局部调整
**核心定位:** 学习技术边界 + A 系统冷备演练,不影响 5.1 B 脚本冲刺

---

## 一、今日核心结论

### 1.1 目标重新定位

**不是"上线 A 系统",而是"把已经跑通的 A 从 Mac 临时环境迁到云端稳定环境"。**

| 维度 | 迁云前 | 迁云后 |
|---|---|---|
| 宿主机 | Mac 本地 Docker | 华为云独立 ECS |
| 访问方式 | 内网穿透临时域名 | `lab.gaushclear.com` + HTTPS |
| 稳定性 | Mac 关机即断、网络不稳 | 7x24 运行 |
| 溯源连接 | Mock | **继续 Mock,不变** |
| 飞书连接 | 测试副本 Bitable | 测试副本 Bitable,不变 |
| 访问权限 | 临时 URL 暴露 | IP 白名单,仅 Clark 可访问 |
| 运行模式 | 开发测试 | **只读演练(READ_ONLY_MODE)** |

### 1.2 符合原计划的哪一部分

本次迁云对齐原计划 Phase 3(5.11-5.24)的"影子期"目标,**实质是把 Phase 3 的部署工作提前到 Phase 1 完成**。

符合原计划铁律:
- ✅ A 不写生产飞书 Bitable(用测试副本)
- ✅ A 不调溯源生产 API(用 Mock)
- ✅ A 的 URL 不对外(IP 白名单)
- ✅ B 脚本 4.28 冻结目标不受影响(迁云是周末学习性质,不占 B 的工时)

---

## 二、技术方案

### 2.1 三层物理隔离

| 层级 | 生产(溯源系统) | 学习环境(A) |
|---|---|---|
| 服务器 | 现有华为云 ECS | 新开独立 ECS |
| 域名 | `api/admin/shuang.gaushclear.com` | `lab.gaushclear.com` |
| 数据库 | 现有 MySQL(7116 条) | 独立新库,零生产数据 |
| 飞书 Bitable | 生产 App Token | 测试副本 Token |
| 溯源 API | `api.gaushclear.com`(真) | Mock 容器 |
| 网络出站 | —— | **禁止访问溯源 ECS** |

### 2.2 工作流(单一事实源)

```
Windows 本地(代码主仓库)
    │
    ├── git push → GitHub(唯一代码源)
    │
    ├── docker build → docker push → 华为云 SWR(镜像仓库)
    │                                    │
    │                                    ▼
    └── Mac(开发测试,不部署)          华为云学习 ECS
                                         (docker pull 运行)
```

**关键规则:**
- Windows = 开发 + 构建 + 推镜像的唯一源头
- Mac 只能 git pull,不参与 A 系统部署链路
- GitHub 是代码单一事实源
- 华为云 SWR 是镜像单一事实源

### 2.3 为什么用 Windows 不用 Mac

| 维度 | Mac(M 系列) | Windows |
|---|---|---|
| 架构 | arm64,需 `--platform linux/amd64` | x86_64,和 ECS 一致,零适配 |
| 代码完整性 | 只 pull,非主仓 | 本地主仓,git push 源头 |
| 构建稳定性 | 跨架构 build 偶尔翻车 | 直接构建即可用 |
| 结论 | 不作为部署源 | **作为部署源** |

---

## 三、执行步骤(4 阶段 10 步)

### 阶段 A:Windows 本地验证(30 分钟)

| 步骤 | 操作 | 验收 |
|---|---|---|
| 1 | `git status` 确认代码最新 | 无未提交变更 |
| 2 | `docker compose build` 本地构建 | 无报错 |
| 3 | `docker compose up -d` 本地启动 | 浏览器访问 `http://localhost` 走通一次下单 |

### 阶段 B:华为云 SWR 推镜像(30 分钟)

| 步骤 | 操作 | 验收 |
|---|---|---|
| 4 | 华为云控制台开通 SWR,创建组织 `gaush` | 拿到登录指令 |
| 5 | Windows 执行 `docker login` + `tag` + `push` | SWR 控制台看到镜像 `order-app:v1` 和 `mock-shuang:v1` |

### 阶段 C:ECS 准备(1 小时)

| 步骤 | 操作 | 验收 |
|---|---|---|
| 6 | 开新 ECS(4核8G,Ubuntu 22.04,与溯源 ECS 不同 VPC) | SSH 可登录 |
| 7 | 安全组配置:入站仅 22/443 白名单,出站禁止访问 `api.gaushclear.com` IP | `curl --max-time 5 https://api.gaushclear.com` 必须 timeout |
| 8 | 安装 Docker + Nginx + Certbot,DNS 解析 `lab.gaushclear.com`,申请 HTTPS | `https://lab.gaushclear.com` 返回 Nginx 欢迎页 |

### 阶段 D:拉镜像运行(30 分钟)

| 步骤 | 操作 | 验收 |
|---|---|---|
| 9 | 上传 `docker-compose.prod.yml` 和 `.env.production`(肉眼审计域名配置) | `grep gaushclear.com` 全部是 `lab` 或 `mock` |
| 10 | `docker compose pull && docker compose up -d` | 浏览器走通下单,数据进测试 Bitable,Mock 返回扫码数据 |

---

## 四、原系统绝对安全清单

### 4.1 部署前检查

- [ ] Windows `.env.production` 里 `SHUANG_API_URL` 指向 Mock 容器,不是 `api.gaushclear.com`
- [ ] 飞书 Token 是测试副本的 App Secret,不是生产的
- [ ] `READ_ONLY_MODE=true`(代码级保险开关)
- [ ] 镜像 tag 版本号清晰(`v1`、`v2`),避免误推覆盖

### 4.2 部署后验证

- [ ] `curl --max-time 5 https://api.gaushclear.com` 从学习 ECS 执行,**必须 timeout**
- [ ] `grep -r "gaushclear.com" /opt/gaush-lab` 每一处命中都是 `lab` 或 `mock`
- [ ] 走一次完整下单流程,检查**生产 Bitable** 确认无新增数据
- [ ] 检查**生产溯源后台**,确认 7116 条历史数据后无脚本测试订单

### 4.3 持续守护

- [ ] 学习 ECS 的 SSH 密钥和生产 ECS 密钥物理分开
- [ ] 两台 ECS 的终端提示符区分(`root@gaush-lab` vs `root@gaush-prod`)
- [ ] Admin 弱密码今天内修改(原独立 P0 事项)

---

## 五、需要单独处理的问题

### 5.1 admin.gaushclear.com 弱密码(今日必做)

独立 P0,与迁云无关但紧急程度更高。迁云开始前先改密码。

### 5.2 部署自动化脚本

仓库内增加:

```
gaush-order-system/
├── scripts/
│   ├── build-and-push.ps1      # Windows 构建+推镜像
│   └── deploy-to-ecs.sh        # ECS 拉镜像+重启
```

目的:未来招开发接手时,两个脚本 + README 即可完成交接。

### 5.3 多设备工作流文档

在 Obsidian `00_收件箱/A系统多设备工作流.md` 记录:
- 代码主仓地址
- Windows/Mac/ECS 各自职责
- `.env` 和证书的存放与传递方式
- 下一次部署的操作清单

---

## 六、迁云完成后的纪律

### 6.1 立刻停下

迁云完成后,**不再继续优化 A**,回到 Phase 1 主线:
- 4.20-4.27:B 脚本压测 + 灰度 + 缓冲
- 4.28:B 代码冻结
- 4.29-4.30:助理培训 + 全流程演练

### 6.2 不做的事

- ❌ 不把 A 的 URL 分享给任何代理商或助理
- ❌ 不把 Mock 切换为真溯源 API
- ❌ 不把测试 Bitable 切换为生产 Bitable
- ❌ 不因为"已经部署好了"就接真流量

### 6.3 再启动的时间点

**5.11(Phase 3 正式启动)之后**,才开始:
- A 的 bug 修复
- 数据一致性比对
- 内部冒烟测试

---

## 七、完成后的技术资产

走完这一次迁云,Clark 将掌握的完整技术边界:

- ✅ Docker 本地开发环境
- ✅ 容器化应用的镜像构建与推送
- ✅ 私有镜像仓库(华为云 SWR)
- ✅ 云主机初始化与安全配置
- ✅ Nginx 反向代理 + HTTPS 证书
- ✅ 多设备 git 工作流(single source of truth)
- ✅ 生产/测试环境隔离原则

**战略价值:** 未来招开发、对接外包、评估供应商报价时,具备独立判断力,不被技术黑话忽悠。

---

## 八、风险自查(Clark 对自己)

### 8.1 今日已识别的认知偏差

| 偏差 | 体现 | 校准 |
|---|---|---|
| 完成偏差 | A 做了 2 周,想顺便上线 | 迁云 ≠ 上线,严格分开 |
| 乐观偏差 | "两套系统同时部署" | 物理隔离代替纪律 |
| 范围蔓延 | 从"可复用"滑到"换语言"再到"上线" | 拆成三件独立的事各自评估 |

### 8.2 继续校准

按自定义的三条方法持续使用:
1. 写下来——现在有什么硬证据说精力能兼顾 B 和 A?
2. 72 小时——对"要不要接点真流量看看"的冲动,等 72 小时
3. 分离身份——迁云失败 ≠ Clark 失败,只是一次学习尝试

---

## 附录 A:目录结构参考

```
C:\Users\wangc\Projects\gaush-order-system\   # Windows 主仓
├── src/                                       # 应用代码
├── mock-shuang/                               # Mock 溯源服务
├── docker-compose.yml                         # 本地开发
├── docker-compose.prod.yml                    # 生产部署
├── Dockerfile
├── .env.example                               # 入 git
├── .env.production                            # 不入 git
├── .gitignore
├── scripts/
│   ├── build-and-push.ps1
│   └── deploy-to-ecs.sh
└── README.md
```

---

## 附录 B:关键命令速查

### Windows 构建推镜像

```powershell
docker login swr.cn-north-4.myhuaweicloud.com
docker compose build
docker tag gaush-order-system-app:latest swr.cn-north-4.myhuaweicloud.com/gaush/order-app:v1
docker push swr.cn-north-4.myhuaweicloud.com/gaush/order-app:v1
```

### ECS 拉镜像运行

```bash
cd /opt/gaush-lab
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose logs -f --tail=100
```

### 安全验证

```bash
# 确认出站隔离
curl --max-time 5 https://api.gaushclear.com    # 必须 timeout

# 确认配置无生产域名
grep -r "api\.gaushclear\|admin\.gaushclear\|shuang\.gaushclear" /opt/gaush-lab
# 必须零命中,或只在注释里
```

---

*文档版本:*
- V1.0 (2026-04-19):初版,基于今日决策

人是主驾,AI 是副驾@Clark
