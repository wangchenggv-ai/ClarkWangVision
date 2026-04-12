# 近视离焦镜患者管理系统 — 实施计划

## Context

镜片厂商技术团队需要为旗下合作门店搭建一套 SaaS 平台，用于：
1. 采集 5000 名佩戴近视离焦镜患者的随访数据
2. 运行 AI 风险评估（初期为规则/统计模型）
3. 管理患者档案与随访计划
4. 为厂商总部数据团队提供跨门店分析仪表盘

**背景约束：**
- 主要使用者：厂商总部数据分析团队
- 数据录入方式：门店工作人员手动录入
- 技术栈：Python 后端 + React 前端
- AI 方案：初期规则/统计模型，预留 ML 升级接口

---

## 技术选型

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI |
| 数据库 | PostgreSQL + SQLAlchemy (ORM) + Alembic (迁移) |
| 任务队列 | Celery + Redis（定时随访提醒） |
| 认证 | JWT + RBAC（store_staff / hq_analyst / admin） |
| 前端 | React + TypeScript + Ant Design |
| 部署 | Docker Compose（开发），可迁移至云服务 |

---

## 项目结构

```
myopia-platform/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/          # 配置、认证、数据库连接
│   │   ├── patients/      # 患者档案模块
│   │   ├── followup/      # 随访记录与计划模块
│   │   ├── risk_engine/   # 风险评估引擎（可插拔）
│   │   └── analytics/     # 总部仪表盘与数据导出
│   ├── alembic/           # 数据库迁移
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── StoreEntry/    # 门店录入界面
│   │   │   ├── FollowupMgmt/  # 随访管理
│   │   │   └── HQDashboard/   # 总部仪表盘
│   │   ├── components/
│   │   └── api/               # Axios API 封装
│   └── package.json
├── docker-compose.yml
└── docs/
    └── superpowers/specs/
        └── 2026-03-21-myopia-platform-design.md
```

---

## 数据模型

### Patient（患者）
```sql
id, name, dob, gender, phone
store_id (FK)
diagnosis_date       -- 初诊日期
lens_type            -- 镜片型号/SKU
baseline_al_od/os    -- 基线眼轴长度（右眼/左眼）
baseline_vision_od/os -- 基线视力
created_at, updated_at
```

### FollowupRecord（随访记录）
```sql
id, patient_id (FK), visit_date
bare_vision_od/os       -- 裸眼视力
corrected_vision_od/os  -- 戴镜视力
axial_length_od/os      -- 眼轴长度 AL
wearing_hours_per_day   -- 日均配戴时长
complaints              -- JSONB: 主观症状标签
recorded_by (FK -> User)
```

### RiskScore（风险评分，每次随访后重算）
```sql
id, patient_id (FK), calculated_at
progression_risk   -- 近视进展风险 0-100
efficacy_score     -- 疗效评分 0-100
compliance_score   -- 依从性评分 0-100
dropout_risk       -- 脱失风险 0-100
overall_level      -- low / medium / high
rule_version       -- 规则版本号（便于追溯）
```

### FollowupPlan（随访计划）
```sql
id, patient_id (FK), due_date
status             -- pending / completed / overdue
reminder_sent_at
completed_at
```

### Store（门店）& User（用户）
```sql
Store: id, name, region, contact
User: id, store_id, role (store_staff/hq_analyst/admin), email, hashed_password
```

---

## 风险评估引擎

### 架构（策略模式，可插拔）
```
backend/app/risk_engine/
├── base.py          # 抽象基类 RiskRule
├── engine.py        # RiskEngine: 组合多个规则，输出 RiskScore
└── rules/
    ├── progression.py   # 近视进展风险
    ├── efficacy.py      # 疗效评分
    ├── compliance.py    # 依从性评分
    └── dropout.py       # 脱失风险
```

### 初期规则阈值
| 维度 | 规则 |
|------|------|
| 进展风险 | AL增长>0.3mm/年→高(80+); 0.1-0.3mm/年→中(40-79); <0.1→低 |
| 疗效 | 戴镜视力未达标+AL加速增长→疗效不佳(低分) |
| 依从性 | 日均<6h→严重不足(<40); 6-8h→不足(40-70); ≥8h→良好(70+) |
| 脱失 | 逾期>30天 AND 依从性<40 → 高脱失风险(80+) |

### 触发时机
- 每次录入随访记录后异步触发重新计算
- 总部可手动触发全量重算（升级规则版本后）

---

## 随访管理

### 随访计划自动生成规则
- **标准患者**：初诊后第 1、3、6、12 个月
- **高风险患者**（overall_level=high）：第 1、2、4、8 个月

### Celery 定时任务
- `check_upcoming_followups`：每日 09:00 运行
  - 提前 7 天：发送提醒通知
  - 当天：再次提醒
  - 逾期 30 天未完成：升级为 overdue，重新计算脱失风险

### 通知渠道
- 系统内消息（数据库驱动）
- 可选：企业微信 WeCom 接口（参考已有 `WorkBuddy/Claw/send_wecom.js` 逻辑，用 Python `requests` 重写）

---

## API 设计（关键端点）

```
POST   /auth/login
GET    /patients?store_id=&risk_level=&page=
POST   /patients
GET    /patients/{id}
GET    /patients/{id}/followup-records
POST   /patients/{id}/followup-records    # 录入随访数据，触发风险计算
GET    /patients/{id}/risk-scores
GET    /patients/{id}/followup-plans

GET    /analytics/overview               # 总部仪表盘汇总
GET    /analytics/risk-distribution      # 风险分布
GET    /analytics/al-trends              # 眼轴趋势
GET    /analytics/export?format=xlsx     # 数据导出
```

---

## 前端页面

### 门店录入界面（store_staff 角色）
- 患者搜索/新建
- 随访记录录入表单（视力、AL、配戴时长、症状标签）
- 录入后即时显示风险评分变化

### 随访管理界面（store_staff 角色）
- 待随访患者列表（按 due_date 排序）
- 逾期患者高亮显示
- 快速标记完成

### 总部仪表盘（hq_analyst 角色）
- 跨门店患者总览
- 风险分布饼图 + 高风险患者表格
- AL 趋势折线图（群体级别）
- 随访完成率统计
- Excel/CSV 数据导出

---

## 实施步骤

### 阶段一：基础框架（第 1-2 周）
1. 初始化 FastAPI 项目 + Docker Compose（PostgreSQL + Redis）
2. Alembic 迁移：创建全部数据表
3. JWT 认证 + RBAC 中间件
4. Store & User CRUD API

### 阶段二：核心业务（第 3-4 周）
5. Patient CRUD API
6. FollowupRecord 录入 API
7. 风险评估引擎（4 条规则） + 异步触发
8. FollowupPlan 自动生成逻辑

### 阶段三：前端（第 5-6 周）
9. React 项目初始化（Vite + Ant Design）
10. 认证流程（登录/权限路由）
11. 门店录入界面
12. 随访管理界面
13. 总部仪表盘（图表 + 导出）

### 阶段四：自动化与收尾（第 7-8 周）
14. Celery Beat 定时任务（随访提醒）
15. WeCom 通知集成
16. 数据导出（xlsx）
17. 部署文档 + 基础测试

---

## 验证方式

1. **单元测试**：`pytest` 测试风险引擎各规则的评分逻辑
2. **API 测试**：用 Postman / httpie 测试完整录入→风险计算→随访计划流程
3. **集成测试**：创建测试患者，录入 3 次随访数据，验证风险评分变化趋势
4. **前端 E2E**：手动走通"门店录入 → 随访提醒 → 总部查看"完整链路
5. **数据导出**：验证 xlsx 导出包含完整字段且格式正确
