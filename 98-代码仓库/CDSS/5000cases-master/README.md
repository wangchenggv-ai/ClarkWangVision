# 近视离焦镜科研管理平台

面向眼科研究机构的全栈患者数据管理系统，用于追踪近视离焦镜（离焦软镜 / OK 镜）临床试验数据，支持多中心协作、基线检查录入、随访记录与数据导出。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite 8 |
| 后端 | FastAPI (Python 3.12) + SQLAlchemy 2 |
| 数据库 | PostgreSQL 16 |
| 认证 | JWT（access token + refresh token） |
| 容器化 | Docker + Docker Compose |
| 反向代理 | Nginx |

---

## 快速启动（Docker）

### 前置要求

- Docker >= 24
- Docker Compose >= 2.20

### 一键启动

```bash
# 克隆项目
git clone <repo-url>
cd myopia-platform

# 启动所有服务（首次构建需要几分钟）
docker compose up --build

# 后台运行
docker compose up -d --build
```

服务启动后访问：

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost |
| 后端 API | http://localhost/api |
| Swagger 文档 | http://localhost/docs |
| ReDoc 文档 | http://localhost/redoc |
| 后端直连（调试） | http://localhost:8000 |
| 前端直连（调试） | http://localhost:3000 |

### 停止服务

```bash
docker compose down          # 停止并移除容器，保留数据卷
docker compose down -v       # 同上，同时删除数据库数据卷
```

---

## 本地开发环境搭建

### 后端

```bash
cd backend

# 创建并激活虚拟环境
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 复制环境变量模板并按需修改
cp .env.example .env

# 运行数据库迁移
alembic upgrade head

# 启动开发服务器（热重载）
uvicorn app.main:app --reload --port 8000
```

### 前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（热重载）
npm run dev
```

前端默认访问 `http://localhost:5173`，API 请求通过 Vite 代理转发到后端。

---

## 项目结构

```
myopia-platform/
├── backend/
│   ├── app/
│   │   ├── auth/          # JWT 鉴权、权限控制
│   │   ├── models/        # SQLAlchemy ORM 模型
│   │   ├── routers/       # API 路由（auth / centers / patients / exams / visits / export）
│   │   ├── schemas/       # Pydantic 请求 / 响应模型
│   │   ├── config.py      # 环境变量配置
│   │   ├── database.py    # 数据库连接与会话
│   │   └── main.py        # FastAPI 应用入口
│   ├── alembic/           # 数据库迁移脚本
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.js
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## 阶段路线图

### Phase 1 — 数据平台（当前阶段）

- [x] 多中心架构：研究中心管理、中心级权限隔离
- [x] 患者档案：基本信息、戴镜史、知情同意
- [x] 基线检查录入：验光、角膜地形图、眼轴长度
- [x] 随访记录：定期复诊数据追踪
- [x] 数据导出：CSV / Excel 格式下载
- [x] JWT 认证与 RBAC 权限控制
- [ ] 前端界面开发（患者列表、检查录入表单、数据看板）

### Phase 2 — AI 分析流水线

- [ ] 眼轴增长速率预测模型接入
- [ ] 离焦镜效果评估算法
- [ ] 自动化数据质检与异常标注
- [ ] DICOM 医学影像上传与解析
- [ ] 批量数据导入（Excel 模板）

### Phase 3 — 科研看板

- [ ] 多中心汇总统计看板
- [ ] 患者进展趋势可视化图表
- [ ] 临床报告自动生成（PDF）
- [ ] 数据脱敏导出（用于对外合作）
- [ ] 微信 / 企业微信提醒推送（随访到期通知）

---

## 环境变量说明

后端环境变量定义在 `backend/.env.example`，本地开发复制为 `.env` 后修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://myopia:myopia123@postgres:5432/myopia_db` | 数据库连接串 |
| `SECRET_KEY` | （示例值） | JWT 签名密钥，生产环境必须替换 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | access token 有效期（分钟） |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | refresh token 有效期（天） |

---

## 许可证

仅供内部科研使用，未经授权禁止对外分发。
