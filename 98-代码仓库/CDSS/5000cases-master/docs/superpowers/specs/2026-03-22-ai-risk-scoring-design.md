# AI 风险评分模块设计文档

**日期：** 2026-03-22
**项目：** 近视离焦镜科研管理平台（5000cases）
**范围：** AI 风险评分微服务 + 后端接口 + 前端展示

---

## 1. 背景与目标

平台目标是收集 5000 名患者佩戴近视离焦镜的数据，通过 AI 进行两项预测：

1. **近视进展风险**（progression_risk）：预测患者近视度数增长速度（high / medium / low）
2. **离焦镜响应效果**（lens_response）：评估该患者对离焦镜的控制效果（effective / moderate / ineffective）

由于真实数据尚在收集阶段，采用**合成数据 + 真实 ML 模型**策略：基于已发表临床研究参数生成训练集，训练初版模型，待真实数据积累后替换。

---

## 2. 架构设计

### 2.1 新增组件

```
Browser → Nginx(:80) → FastAPI Backend(:8000) → AI Service(:8001, 新增)
                                              ↘ PostgreSQL(:5432)
```

新增一个独立 Docker 容器 `ai-service`，运行 Python FastAPI 应用：
- 不暴露公网端口，仅供主后端通过 Docker 内网调用
- 包含两个训练好的模型文件（`.pkl`）
- 启动时加载模型到内存，推理延迟目标 < 500ms
- 内网安全：通过 Docker Compose 网络隔离 + 共享密钥（`X-Internal-Token` header）实现双重保护

### 2.2 触发方式

**同步评分**：医生在患者详情页手动点击"生成评分"按钮 → 主后端同步调用 AI 服务（超时 10 秒）→ 结果写入 `risk_scores` 表 → 页面实时展示。

### 2.3 故障降级

若 AI 服务不可达或超时（10s），主后端返回 `503 Service Unavailable`，响应体：
```json
{"detail": "AI 评分服务暂时不可用，请稍后重试"}
```
不写入任何部分结果，前端显示友好提示。无自动重试（避免重复写入）。

### 2.4 并发保护

同一患者的评分请求在数据库层加乐观锁：若 60 秒内已有进行中的评分，返回 `409 Conflict`：
```json
{"detail": "该患者正在评分中，请稍后刷新"}
```

---

## 3. 两套模型

### 3.1 模型选择逻辑

```
患者有 baseline_exam 记录？
  ├── 否 → 返回 400 Bad Request（"请先完成基线检查"）
  └── 是 → 有 follow_up_visits 记录？
              ├── 否 → 调用基线模型
              └── 是 → 调用趋势模型
```

### 3.2 基线模型（XGBoost）

| 属性 | 说明 |
|------|------|
| 触发时机 | 有基线检查，无随访数据 |
| 输入特征（9个） | age_years, gender_male（0/1）, od_sphere, od_axial_length, os_sphere, os_axial_length, parent_myopia_score（0/1/2）, outdoor_hours_per_day, near_work_hours_per_day |
| 输出 | progression_risk + confidence, lens_response + confidence |
| 算法 | XGBoost，多分类（3 类）× 2 个目标 |
| 模型文件 | `models/baseline_progression.pkl`, `models/baseline_lens.pkl` |

### 3.3 趋势模型（LightGBM）

| 属性 | 说明 |
|------|------|
| 触发时机 | 有基线检查 + ≥1 次随访 |
| 输入特征（13个） | 基线9个特征 + axial_growth_mm_per_month（最近2次眼轴差/时间差）, sphere_change_d_per_month, avg_wearing_hours_per_day（随访均值）, compliance_rate（依从好的随访次数/总随访次数）|
| 输出 | 同上 |
| 算法 | LightGBM |
| 模型文件 | `models/trend_progression.pkl`, `models/trend_lens.pkl` |

### 3.4 模型版本管理

每个 `.pkl` 文件随一个 `models/manifest.json` 发布：
```json
{
  "baseline_progression": {"version": "v1.0", "trained_at": "2026-03-22", "samples": 3000},
  "baseline_lens":        {"version": "v1.0", "trained_at": "2026-03-22", "samples": 3000},
  "trend_progression":    {"version": "v1.0", "trained_at": "2026-03-22", "samples": 1800},
  "trend_lens":           {"version": "v1.0", "trained_at": "2026-03-22", "samples": 1800}
}
```
版本号写入每条 `risk_scores` 记录，保证评分可追溯。重训练时更新版本号，旧评分仍可查阅。

---

## 4. 合成训练数据

### 4.1 样本规模

- 基线数据集：3000 条（无随访特征）
- 趋势数据集：1800 条（有随访趋势特征，样本量较小因参数更多）

### 4.2 标签规则（基于临床文献）

**progression_risk：**
- high：眼轴 > 25mm，或年龄 < 10 岁且双亲近视，或 near_work > 4h/day
- low：眼轴 < 23.5mm，且户外 > 2h/day，且无双亲近视
- medium：其余情况

**lens_response：**
- effective：佩戴依从性好，户外 > 1.5h/day，眼轴增长 < 0.15mm/月（趋势数据）
- ineffective：依从性差，或眼轴增长 > 0.35mm/月
- moderate：其余情况

### 4.3 噪声注入

对 15% 样本随机翻转一个等级（如 high→medium），模拟真实数据不确定性。随机种子固定（seed=42）保证可复现。

---

## 5. AI 服务接口（完整 Schema）

**基础 URL：** `http://ai-service:8001`（仅内网）
**认证：** 所有请求需携带 header `X-Internal-Token: <AI_SERVICE_SECRET>`

### POST /score/baseline

**请求体：**
```json
{
  "patient_id": 1,
  "age_years": 9,
  "gender_male": 1,
  "od_sphere": -3.25,
  "od_axial_length": 25.1,
  "os_sphere": -3.0,
  "os_axial_length": 24.9,
  "parent_myopia_score": 2,
  "outdoor_hours_per_day": 1.0,
  "near_work_hours_per_day": 3.0
}
```

**响应体（200 OK）：**
```json
{
  "progression_risk": "high",
  "progression_confidence": 0.87,
  "lens_response": "effective",
  "lens_response_confidence": 0.73,
  "model_version": "v1.0",
  "model_name": "xgboost-baseline"
}
```

### POST /score/trend

**请求体（基线字段 + 趋势字段）：**
```json
{
  "patient_id": 1,
  "age_years": 9,
  "gender_male": 1,
  "od_sphere": -3.25,
  "od_axial_length": 25.1,
  "os_sphere": -3.0,
  "os_axial_length": 24.9,
  "parent_myopia_score": 2,
  "outdoor_hours_per_day": 1.0,
  "near_work_hours_per_day": 3.0,
  "axial_growth_mm_per_month": 0.035,
  "sphere_change_d_per_month": -0.08,
  "avg_wearing_hours_per_day": 12.0,
  "compliance_rate": 0.85
}
```

**响应体（200 OK）：** 同 baseline，`model_name` 为 `"lgbm-trend"`。

### GET /health

**响应体（200 OK）：**
```json
{
  "status": "ok",
  "models_loaded": ["baseline_progression", "baseline_lens", "trend_progression", "trend_lens"],
  "version_manifest": {
    "baseline_progression": "v1.0",
    "trend_progression": "v1.0"
  }
}
```

---

## 6. 主后端新增接口

### POST /api/patients/{id}/score

触发评分。后端执行：
1. 检查患者是否有 baseline_exam，无则返回 `400 {"detail": "请先完成基线检查再进行评分"}`
2. 检查 60s 内是否有进行中的评分请求（查 redis 或 DB 时间戳），有则返回 `409`
3. 根据是否有随访数据选择模型（baseline / trend）
4. 从 baseline_exam 和 follow_up_visits 提取特征，调用 AI 服务
5. 将结果写入 `risk_scores` 表
6. 返回新建的评分记录

**响应体（201 Created）：**
```json
{
  "id": 5,
  "patient_id": 1,
  "progression_risk": "high",
  "progression_confidence": 0.87,
  "lens_response": "effective",
  "lens_response_confidence": 0.73,
  "model_version": "v1.0",
  "scored_by_model": "xgboost-baseline",
  "scored_at": "2026-03-22T14:22:00"
}
```

### GET /api/patients/{id}/score

**查询参数（可选）：** `?all=true` 返回所有历史评分，默认返回最新一条。

**响应体（200 OK，最新评分）：** 同上 + `null` 若无评分记录。

---

## 7. 数据库表（现有 risk_scores）

```sql
CREATE TABLE risk_scores (
    id                        INTEGER PRIMARY KEY,
    patient_id                INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    progression_risk          VARCHAR(10),   -- high | medium | low
    progression_confidence    FLOAT,         -- 0.0 – 1.0
    lens_response             VARCHAR(10),   -- effective | moderate | ineffective
    lens_response_confidence  FLOAT,         -- 0.0 – 1.0
    model_version             VARCHAR(50),   -- e.g. v1.0
    scored_at                 DATETIME NOT NULL,
    scored_by_model           VARCHAR(100)   -- xgboost-baseline | lgbm-trend
);
```

无需迁移，字段已完整。

---

## 8. 前端新增

### 8.1 患者详情页 — AI 评分卡片（ScoreCard.jsx）

位置：患者详情页底部

交互：
- 初始加载时调用 `GET /api/patients/{id}/score`，有评分则展示，无则显示"暂无评分，点击生成"
- "重新评分"按钮：调用 `POST /api/patients/{id}/score`，Loading 状态 → 成功后刷新卡片
- 错误处理：400（无基线检查）→ 提示"请先录入基线检查"；503（服务不可用）→ 提示"AI 服务暂时不可用"

展示内容：
- 近视进展风险标签（高/中/低）+ 置信度 + 建议随访间隔
- 离焦镜响应效果标签（有效/一般/无效）+ 置信度
- 评分时间、模型版本（折叠显示）

### 8.2 风险仪表盘（RiskDashboard.jsx）— /risk-dashboard

路由：新增至左侧导航"风险管理"菜单项

内容：
- 顶部统计卡：高风险/中风险/低风险/未评分患者数量（从 GET /api/patients 聚合）
- 风险级别筛选 Tab
- 患者列表表格（姓名、编号、进展风险、镜片响应、评分时间、建议随访间隔）
- 点击行跳转患者详情页

---

## 9. Docker Compose 变更

```yaml
ai-service:
  build: ./ai-service
  environment:
    AI_SERVICE_SECRET: ${AI_SERVICE_SECRET:-dev-secret-change-in-prod}
  depends_on:
    - postgres

backend:
  environment:
    AI_SERVICE_URL: http://ai-service:8001
    AI_SERVICE_SECRET: ${AI_SERVICE_SECRET:-dev-secret-change-in-prod}
```

AI 服务不对外暴露端口（无 `ports` 映射），仅通过 Docker 内网访问。

---

## 10. 开发阶段划分

| 阶段 | 内容 | 验收标准 |
|------|------|----------|
| Phase 1 | 合成数据生成脚本 + 模型训练 + `.pkl` 文件输出 | 两套模型训练完成，交叉验证准确率 > 70% |
| Phase 2 | `ai-service/` 目录 + FastAPI + 推理接口 + Docker 镜像 | `POST /score/baseline` 返回正确结构，健康检查通过 |
| Phase 3 | 主后端新增 `routers/scores.py`，含模型选择逻辑和特征提取 | `POST /api/patients/{id}/score` 写入 DB，400/409/503 正确返回 |
| Phase 4 | 前端患者详情页 `ScoreCard.jsx` | 按钮触发评分，结果显示，错误提示正确 |
| Phase 5 | 前端风险仪表盘 `RiskDashboard.jsx` | 统计卡正确，筛选功能可用，跳转正常 |
| Phase 6 | `docker-compose.yml` 集成 + 端到端联调 | 完整链路：点击按钮 → AI 服务 → DB → 页面展示 |
