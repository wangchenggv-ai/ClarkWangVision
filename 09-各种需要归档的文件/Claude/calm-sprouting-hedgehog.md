# 近视离焦镜科研管理平台 — 设计规格 & 实施计划

## Context

科研团队需要采集5000名佩戴近视离焦镜患者的临床数据，训练AI模型预测近视进展速度和离焦镜效果，并构建一套配套的患者管理与随访系统。

**核心需求：**
- 多中心在线数据采集（联合多家眼科诊所/医院统一填报）
- AI双模型：① 近视进展风险预测（高/中/低）② 离焦镜响应效果评估（有效/一般/无效）
- 患者管理：注册入组、基线检查、定期随访（1M/3M/6M/12M）
- 云端SaaS部署（阿里云），浏览器访问

---

## 已确认设计决策

### 架构：核心平台 + 独立AI服务（方案B）

```
多中心医生/研究员（浏览器）
        ↓ HTTPS
┌─────────────────────────┐
│   核心平台 (FastAPI)     │  ←→ PostgreSQL (RDS)
│   React + Ant Design    │
└────────────┬────────────┘
             ↕ REST API
┌─────────────────────────┐
│   AI 推理服务 (FastAPI)  │  ←→ MLflow 模型仓库
│   XGBoost / LightGBM   │
└─────────────────────────┘
```

- Nginx 反向代理 + HTTPS
- Docker Compose 编排，阿里云 ECS + RDS + OSS

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + Ant Design |
| 后端 | FastAPI (Python) |
| 数据库 | PostgreSQL |
| 认证 | JWT + RBAC（admin/doctor/viewer）|
| AI框架 | XGBoost / LightGBM |
| 实验追踪 | MLflow |
| 部署 | Docker Compose + 阿里云 |

### 数据模型（核心表）

- `centers` — 中心名称、城市、联系人
- `users` — 姓名、角色、所属中心、JWT认证
- `patients` — 患者基本信息 + 家长近视情况 + 年级/就学 + 户外/近距用眼时长
- `baseline_exams` — 入组时视力/度数/眼轴/角膜曲率/镜片参数
- `follow_up_visits` — 每次随访的视力/度数/眼轴/佩戴时长/备注
- `risk_scores` — AI推理结果（进展风险 + 离焦效果 + 模型版本）

---

## 开发分期

### Phase 1 — 数据采集平台（立即启动）

**目标**：让各中心开始录入数据，建立5000例数据基础

#### 功能模块

**1. 多中心账号系统**
- 中心注册与管理（超级管理员操作）
- 用户管理：创建/停用账号，分配角色
- 登录/登出，JWT刷新
- 数据行级隔离：每个中心只能看本中心患者

**2. 患者管理**
- 患者注册：基本信息 + 家长近视情况 + 年级/就学情况 + 环境因素
- 基线检查录入：双眼视力/度数（球/柱/轴）/眼轴/角膜曲率 + 镜片参数
- 患者列表：搜索（姓名/ID）、筛选（中心/入组时间/随访状态）、分页
- 患者详情页：基本信息 + 基线 + 随访历史时间轴

**3. 随访记录**
- 新建随访：选择类型（1M/3M/6M/12M）+ 录入检查数据
- 随访历史：时间轴展示，支持编辑/删除
- 逾期提醒：当前应完成随访但未完成的患者列表

**4. 数据导出**
- 全量导出 CSV（用于AI训练）
- 按中心/时间范围筛选导出
- 导出字段：患者信息 + 基线 + 所有随访记录（宽表格式）

#### 文件结构

```
myopia-platform/
├── backend/
│   ├── main.py                  # FastAPI 入口
│   ├── database.py              # SQLAlchemy 连接
│   ├── models/
│   │   ├── center.py
│   │   ├── user.py
│   │   ├── patient.py
│   │   ├── baseline_exam.py
│   │   └── follow_up_visit.py
│   ├── routers/
│   │   ├── auth.py              # 登录/登出/刷新token
│   │   ├── centers.py
│   │   ├── patients.py
│   │   ├── exams.py             # 基线检查
│   │   ├── visits.py            # 随访记录
│   │   └── export.py            # 数据导出
│   ├── schemas/                 # Pydantic 请求/响应模型
│   ├── auth/
│   │   ├── jwt.py               # JWT 生成/验证
│   │   └── permissions.py       # RBAC 权限检查
│   └── alembic/                 # 数据库迁移
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login/
│   │   │   ├── Patients/        # 患者列表 + 详情
│   │   │   ├── PatientNew/      # 新建患者
│   │   │   ├── FollowUp/        # 随访录入
│   │   │   ├── Export/          # 数据导出
│   │   │   └── Admin/           # 中心/用户管理
│   │   ├── components/
│   │   │   ├── VisitTimeline/   # 随访时间轴
│   │   │   └── EyeDataForm/     # 双眼数据录入组件（复用）
│   │   └── api/                 # Axios API 封装
├── docker-compose.yml
└── nginx.conf
```

### Phase 2 — AI 训练流水线

**依赖**：Phase 1 积累足够数据后启动（建议 ≥500例有12个月随访数据）

**功能：**
- 特征工程脚本：从数据库导出 → 计算眼轴增长速率/度数变化速率/遗传评分
- 模型训练：XGBoost/LightGBM，5折交叉验证
- MLflow 追踪：参数/指标/模型文件版本化
- 双模型：`progression_model`（近视进展分类）+ `lens_response_model`（离焦效果分类）
- 推理服务：FastAPI `/predict` 接口，输入患者特征 → 输出风险等级 + 置信度

### Phase 3 — 风险评估看板

**依赖**：Phase 2 模型上线后集成

**功能：**
- 患者风险评分展示（进展风险 + 离焦效果）
- 高风险患者预警列表
- 随访逾期提醒
- 科研统计看板：入组率/随访完成率/眼轴增长分布/各中心对比
- 数据导出（含AI评分，支持论文分析）

---

## 实施步骤（Phase 1）

1. **搭建项目骨架**
   - 初始化 `myopia-platform/` 目录结构
   - 配置 `docker-compose.yml`（postgres + backend + frontend + nginx）
   - FastAPI 入口 + SQLAlchemy 连接 + Alembic 初始化

2. **数据库建模**
   - 创建所有 SQLAlchemy 模型（centers/users/patients/baseline_exams/follow_up_visits）
   - 运行 Alembic 迁移生成表结构

3. **认证系统**
   - JWT 登录/登出/刷新
   - RBAC 权限装饰器（admin/doctor/viewer）
   - center_id 行级隔离中间件

4. **核心 API**
   - 患者 CRUD（创建/查询/更新）
   - 基线检查 CRUD
   - 随访记录 CRUD
   - 数据导出 CSV

5. **前端实现**
   - 路由框架 + 登录页 + 布局
   - 患者列表页（搜索/筛选/分页）
   - 患者详情页 + 随访时间轴
   - 基线录入表单 + 随访录入表单
   - 数据导出页
   - 管理员：中心/用户管理

6. **部署配置**
   - Dockerfile × 2（backend + frontend）
   - Nginx 配置（反向代理 + 静态文件）
   - 环境变量配置（数据库/JWT密钥/CORS）

---

## 验证方式

**Phase 1 功能验证：**
- 创建2个测试中心 + 各自账号，验证数据隔离
- 注册5名测试患者，录入基线检查
- 创建随访记录（不同类型），验证时间轴显示
- 导出CSV，验证字段完整性
- 测试角色权限：viewer无法创建/编辑，doctor无法管理用户

**部署验证：**
- `docker-compose up` 一键启动所有服务
- HTTPS访问，登录正常
- 多浏览器同时访问（模拟多中心）

---

## 关键文件路径（开发时创建）

| 文件 | 作用 |
|---|---|
| `backend/models/patient.py` | 核心数据模型，含所有字段定义 |
| `backend/routers/patients.py` | 患者CRUD API |
| `backend/routers/visits.py` | 随访记录API |
| `backend/auth/permissions.py` | RBAC + center隔离 |
| `frontend/src/components/EyeDataForm/` | 双眼数据复用组件 |
| `docker-compose.yml` | 服务编排入口 |
