# AI 风险评分模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立 AI 微服务（XGBoost + LightGBM），通过合成训练数据预测患者近视进展风险和离焦镜响应效果，并在前端患者详情页和风险仪表盘展示评分结果。

**Architecture:** 独立 `ai-service` Docker 容器（FastAPI，端口 8001）加载预训练模型，主后端同步调用并将结果写入现有 `risk_scores` 表。两套模型：入组时用基线模型（XGBoost），有随访数据后用趋势模型（LightGBM）。

**Tech Stack:** Python 3.11, XGBoost, LightGBM, scikit-learn, FastAPI, React, Ant Design, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-22-ai-risk-scoring-design.md`

---

## 文件地图

### 新建文件

```
ai-service/
  Dockerfile
  requirements.txt
  scripts/
    generate_data.py      # 合成数据生成脚本
    train_models.py       # 模型训练脚本
  models/
    manifest.json         # 模型版本清单（训练后生成）
    baseline_progression.pkl  # (训练后生成)
    baseline_lens.pkl         # (训练后生成)
    trend_progression.pkl     # (训练后生成)
    trend_lens.pkl            # (训练后生成)
  app/
    __init__.py
    main.py               # FastAPI 入口 + /score/baseline + /score/trend + /health
    schemas.py            # Pydantic 请求/响应模型

backend/app/
  routers/scores.py       # POST /api/patients/{id}/score + GET /api/patients/{id}/score
  services/ai_client.py   # httpx 调用 AI 服务的封装

frontend/src/
  api/scores.js                        # API 调用函数
  pages/Patients/ScoreCard.jsx         # 患者详情页评分卡片
  pages/RiskDashboard/index.jsx        # 风险仪表盘页面
```

### 修改文件

```
backend/app/config.py                  # 新增 AI_SERVICE_URL, AI_SERVICE_SECRET
backend/app/main.py                    # 注册 scores router
backend/.env.example                   # 新增 AI 服务环境变量
docker-compose.yml                     # 新增 ai-service 服务
frontend/src/App.jsx                   # 新增 /risk-dashboard 路由
frontend/src/components/Layout/index.jsx  # 新增"风险管理"导航项
frontend/src/pages/Patients/PatientDetail.jsx  # 引入 ScoreCard 组件
```

---

## Phase 1：合成数据 + 模型训练

### Task 1：创建 ai-service 目录结构

**Files:**
- Create: `ai-service/requirements.txt`
- Create: `ai-service/scripts/generate_data.py`

- [ ] **Step 1: 创建 requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic==2.9.2
xgboost==2.1.1
lightgbm==4.5.0
scikit-learn==1.5.2
numpy==1.26.4
pandas==2.2.3
joblib==1.4.2
httpx==0.27.2
```

保存到 `ai-service/requirements.txt`。

- [ ] **Step 2: 创建合成数据生成脚本**

保存到 `ai-service/scripts/generate_data.py`：

```python
"""Generate synthetic training data based on published myopia defocus lens research."""
import numpy as np
import pandas as pd
import json
import os

RNG = np.random.default_rng(42)

def _parent_myopia_score(s: str) -> int:
    return {"none": 0, "one": 1, "both": 2}.get(s, 0)

def generate_baseline(n: int = 3000) -> pd.DataFrame:
    age          = RNG.integers(6, 16, n).astype(float)
    gender_male  = RNG.integers(0, 2, n).astype(float)
    od_sphere    = RNG.uniform(-8.0, -0.5, n)
    od_axial     = RNG.uniform(22.0, 27.0, n)
    os_sphere    = od_sphere + RNG.uniform(-0.5, 0.5, n)
    os_axial     = od_axial  + RNG.uniform(-0.3, 0.3, n)
    parent_score = RNG.choice([0, 1, 2], n, p=[0.3, 0.4, 0.3]).astype(float)
    outdoor_h    = RNG.uniform(0.5, 4.0, n)
    nearwork_h   = RNG.uniform(1.0, 6.0, n)

    # progression_risk label
    high_mask = (od_axial > 25.0) | ((age < 10) & (parent_score == 2)) | (nearwork_h > 4.0)
    low_mask  = (od_axial < 23.5) & (outdoor_h > 2.0) & (parent_score == 0)
    prog_risk = np.where(high_mask, 2, np.where(low_mask, 0, 1))  # 2=high,1=medium,0=low

    # lens_response label (baseline: use proxy — outdoor + parent_score)
    eff_mask  = (outdoor_h > 1.5) & (parent_score <= 1)
    ineff_mask = (outdoor_h < 1.0) | (parent_score == 2)
    lens_resp = np.where(eff_mask, 2, np.where(ineff_mask, 0, 1))  # 2=effective,1=moderate,0=ineffective

    # 15% noise flip
    noise_idx = RNG.choice(n, int(n * 0.15), replace=False)
    prog_risk[noise_idx] = (prog_risk[noise_idx] + RNG.integers(1, 3, len(noise_idx))) % 3
    lens_resp[noise_idx] = (lens_resp[noise_idx] + RNG.integers(1, 3, len(noise_idx))) % 3

    return pd.DataFrame({
        "age_years": age, "gender_male": gender_male,
        "od_sphere": od_sphere, "od_axial_length": od_axial,
        "os_sphere": os_sphere, "os_axial_length": os_axial,
        "parent_myopia_score": parent_score,
        "outdoor_hours_per_day": outdoor_h, "near_work_hours_per_day": nearwork_h,
        "progression_risk": prog_risk, "lens_response": lens_resp,
    })

def generate_trend(n: int = 1800) -> pd.DataFrame:
    base = generate_baseline(n)
    axial_growth  = RNG.uniform(0.05, 0.50, n)   # mm/month
    sphere_change = RNG.uniform(-0.25, -0.02, n)  # D/month (negative = worse)
    avg_wearing   = RNG.uniform(8.0, 16.0, n)
    compliance    = RNG.uniform(0.4, 1.0, n)

    # Override progression_risk with trend data
    high_mask = (axial_growth > 0.30)
    low_mask  = (axial_growth < 0.15) & (compliance > 0.8)
    base["progression_risk"] = np.where(high_mask, 2, np.where(low_mask, 0, 1))

    # Override lens_response with trend data
    eff_mask   = (compliance > 0.8) & (axial_growth < 0.15) & (avg_wearing > 12)
    ineff_mask = (compliance < 0.6) | (axial_growth > 0.35)
    base["lens_response"] = np.where(eff_mask, 2, np.where(ineff_mask, 0, 1))

    # 15% noise
    n2 = len(base)
    noise_idx = RNG.choice(n2, int(n2 * 0.15), replace=False)
    base.loc[noise_idx, "progression_risk"] = (base.loc[noise_idx, "progression_risk"] + RNG.integers(1, 3, len(noise_idx))) % 3
    base.loc[noise_idx, "lens_response"]    = (base.loc[noise_idx, "lens_response"]    + RNG.integers(1, 3, len(noise_idx))) % 3

    base["axial_growth_mm_per_month"]  = axial_growth
    base["sphere_change_d_per_month"]  = sphere_change
    base["avg_wearing_hours_per_day"]  = avg_wearing
    base["compliance_rate"]            = compliance
    return base

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    df_base  = generate_baseline(3000)
    df_trend = generate_trend(1800)
    df_base.to_csv("data/baseline.csv",  index=False)
    df_trend.to_csv("data/trend.csv",    index=False)
    print(f"Baseline: {len(df_base)} rows")
    print(f"Trend:    {len(df_trend)} rows")
    print("Saved to data/baseline.csv and data/trend.csv")
```

- [ ] **Step 3: 生成数据，验证输出**

```bash
cd ai-service
pip install pandas numpy
python scripts/generate_data.py
```

期望输出：
```
Baseline: 3000 rows
Trend:    1800 rows
Saved to data/baseline.csv and data/trend.csv
```

- [ ] **Step 4: Commit**

```bash
git add ai-service/requirements.txt ai-service/scripts/generate_data.py
git commit -m "feat(ai): add synthetic data generation script"
```

---

### Task 2：训练模型并生成 .pkl 文件

**Files:**
- Create: `ai-service/scripts/train_models.py`
- Create: `ai-service/models/manifest.json` (generated)

- [ ] **Step 1: 创建训练脚本**

保存到 `ai-service/scripts/train_models.py`：

```python
"""Train XGBoost (baseline) and LightGBM (trend) models, save as .pkl files."""
import json, os, joblib
import pandas as pd
from datetime import date
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb
import lightgbm as lgb

BASELINE_FEATURES = [
    "age_years", "gender_male", "od_sphere", "od_axial_length",
    "os_sphere", "os_axial_length", "parent_myopia_score",
    "outdoor_hours_per_day", "near_work_hours_per_day",
]
TREND_FEATURES = BASELINE_FEATURES + [
    "axial_growth_mm_per_month", "sphere_change_d_per_month",
    "avg_wearing_hours_per_day", "compliance_rate",
]

def train_and_save(X, y, model, path: str, label_name: str) -> float:
    scores = cross_val_score(model, X, y, cv=5, scoring="accuracy")
    print(f"  {label_name}: CV accuracy = {scores.mean():.3f} ± {scores.std():.3f}")
    model.fit(X, y)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(model, path)
    print(f"  Saved → {path}")
    return float(scores.mean())

def main():
    df_base  = pd.read_csv("data/baseline.csv")
    df_trend = pd.read_csv("data/trend.csv")

    X_base  = df_base[BASELINE_FEATURES]
    X_trend = df_trend[TREND_FEATURES]

    print("Training baseline models (XGBoost)...")
    xgb_params = dict(n_estimators=200, max_depth=4, learning_rate=0.1,
                      use_label_encoder=False, eval_metric="mlogloss",
                      random_state=42, n_jobs=-1)

    acc_bp = train_and_save(X_base, df_base["progression_risk"],
        xgb.XGBClassifier(**xgb_params), "models/baseline_progression.pkl", "baseline_progression")
    acc_bl = train_and_save(X_base, df_base["lens_response"],
        xgb.XGBClassifier(**xgb_params), "models/baseline_lens.pkl", "baseline_lens")

    print("Training trend models (LightGBM)...")
    lgb_params = dict(n_estimators=200, max_depth=4, learning_rate=0.1,
                      random_state=42, n_jobs=-1, verbose=-1)

    acc_tp = train_and_save(X_trend, df_trend["progression_risk"],
        lgb.LGBMClassifier(**lgb_params), "models/trend_progression.pkl", "trend_progression")
    acc_tl = train_and_save(X_trend, df_trend["lens_response"],
        lgb.LGBMClassifier(**lgb_params), "models/trend_lens.pkl", "trend_lens")

    manifest = {
        "baseline_progression": {"version": "v1.0", "trained_at": str(date.today()), "samples": len(df_base),  "cv_accuracy": acc_bp},
        "baseline_lens":        {"version": "v1.0", "trained_at": str(date.today()), "samples": len(df_base),  "cv_accuracy": acc_bl},
        "trend_progression":    {"version": "v1.0", "trained_at": str(date.today()), "samples": len(df_trend), "cv_accuracy": acc_tp},
        "trend_lens":           {"version": "v1.0", "trained_at": str(date.today()), "samples": len(df_trend), "cv_accuracy": acc_tl},
    }
    with open("models/manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print("\nmanifest.json written.")
    print("All CV accuracies:", {k: f"{v['cv_accuracy']:.3f}" for k, v in manifest.items()})
    assert all(v["cv_accuracy"] > 0.70 for v in manifest.values()), "Accuracy < 70% — check data generation!"
    print("✓ All models pass accuracy threshold (>70%).")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 安装依赖并运行**

```bash
cd ai-service
pip install xgboost lightgbm scikit-learn joblib
python scripts/train_models.py
```

期望输出（示例）：
```
Training baseline models (XGBoost)...
  baseline_progression: CV accuracy = 0.82 ± 0.02
  baseline_lens:        CV accuracy = 0.79 ± 0.03
Training trend models (LightGBM)...
  trend_progression:    CV accuracy = 0.86 ± 0.02
  trend_lens:           CV accuracy = 0.83 ± 0.02
✓ All models pass accuracy threshold (>70%).
```

- [ ] **Step 3: 验证 .pkl 文件存在**

```bash
ls -lh ai-service/models/
```

期望看到 4 个 `.pkl` 文件 + `manifest.json`。

- [ ] **Step 4: 在 .gitignore 排除大文件，提交脚本**

```bash
echo "ai-service/data/" >> .gitignore
echo "ai-service/models/*.pkl" >> .gitignore
```

```bash
git add ai-service/scripts/train_models.py ai-service/models/manifest.json .gitignore
git commit -m "feat(ai): add model training script; gitignore pkl and data files"
```

---

## Phase 2：AI 微服务容器

### Task 3：实现 AI Service FastAPI 应用

**Files:**
- Create: `ai-service/app/__init__.py`
- Create: `ai-service/app/schemas.py`
- Create: `ai-service/app/main.py`

- [ ] **Step 1: 创建 schemas.py**

```python
# ai-service/app/schemas.py
from pydantic import BaseModel, Field
from typing import Optional

class BaselineRequest(BaseModel):
    patient_id: int
    age_years: float
    gender_male: int          # 0 or 1
    od_sphere: float
    od_axial_length: float
    os_sphere: float
    os_axial_length: float
    parent_myopia_score: int  # 0=none, 1=one parent, 2=both
    outdoor_hours_per_day: float
    near_work_hours_per_day: float

class TrendRequest(BaselineRequest):
    axial_growth_mm_per_month: float
    sphere_change_d_per_month: float
    avg_wearing_hours_per_day: float
    compliance_rate: float    # 0.0 – 1.0

class ScoreResponse(BaseModel):
    progression_risk: str           # high | medium | low
    progression_confidence: float
    lens_response: str              # effective | moderate | ineffective
    lens_response_confidence: float
    model_version: str
    model_name: str

class HealthResponse(BaseModel):
    status: str
    models_loaded: list[str]
    version_manifest: dict
```

- [ ] **Step 2: 创建 main.py（推理服务）**

```python
# ai-service/app/main.py
import json, os, joblib
import numpy as np
from fastapi import FastAPI, HTTPException, Header, Depends
from typing import Optional
from app.schemas import BaselineRequest, TrendRequest, ScoreResponse, HealthResponse

app = FastAPI(title="AI Risk Scoring Service", version="1.0.0")

AI_SECRET = os.getenv("AI_SERVICE_SECRET", "dev-secret-change-in-prod")

BASELINE_FEATURES = [
    "age_years", "gender_male", "od_sphere", "od_axial_length",
    "os_sphere", "os_axial_length", "parent_myopia_score",
    "outdoor_hours_per_day", "near_work_hours_per_day",
]
TREND_FEATURES = BASELINE_FEATURES + [
    "axial_growth_mm_per_month", "sphere_change_d_per_month",
    "avg_wearing_hours_per_day", "compliance_rate",
]
RISK_LABELS  = {0: "low",          1: "medium",     2: "high"}
LENS_LABELS  = {0: "ineffective",  1: "moderate",   2: "effective"}

# Load models and manifest at startup
_models: dict = {}
_manifest: dict = {}

@app.on_event("startup")
def load_models():
    model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    names = ["baseline_progression", "baseline_lens", "trend_progression", "trend_lens"]
    for name in names:
        path = os.path.join(model_dir, f"{name}.pkl")
        if not os.path.exists(path):
            raise RuntimeError(f"Model file not found: {path}")
        _models[name] = joblib.load(path)
    with open(os.path.join(model_dir, "manifest.json")) as f:
        _manifest.update(json.load(f))

def verify_token(x_internal_token: Optional[str] = Header(None)):
    if x_internal_token != AI_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

def _predict(model_prog, model_lens, features: list, model_name: str) -> ScoreResponse:
    X = np.array([features])
    prog_class  = int(model_prog.predict(X)[0])
    prog_proba  = float(model_prog.predict_proba(X)[0][prog_class])
    lens_class  = int(model_lens.predict(X)[0])
    lens_proba  = float(model_lens.predict_proba(X)[0][lens_class])
    manifest_key = model_name.split("-")[0] + "_progression"  # e.g. baseline_progression
    version = _manifest.get(manifest_key, {}).get("version", "v1.0")
    return ScoreResponse(
        progression_risk=RISK_LABELS[prog_class],
        progression_confidence=round(prog_proba, 4),
        lens_response=LENS_LABELS[lens_class],
        lens_response_confidence=round(lens_proba, 4),
        model_version=version,
        model_name=model_name,
    )

@app.post("/score/baseline", response_model=ScoreResponse)
def score_baseline(req: BaselineRequest, _=Depends(verify_token)):
    features = [getattr(req, f) for f in BASELINE_FEATURES]
    return _predict(_models["baseline_progression"], _models["baseline_lens"],
                    features, "xgboost-baseline")

@app.post("/score/trend", response_model=ScoreResponse)
def score_trend(req: TrendRequest, _=Depends(verify_token)):
    features = [getattr(req, f) for f in TREND_FEATURES]
    return _predict(_models["trend_progression"], _models["trend_lens"],
                    features, "lgbm-trend")

@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        models_loaded=list(_models.keys()),
        version_manifest={k: v["version"] for k, v in _manifest.items()},
    )
```

- [ ] **Step 3: 创建空 `__init__.py`**

```bash
touch ai-service/app/__init__.py
```

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/
git commit -m "feat(ai): implement AI scoring service (FastAPI + XGBoost/LightGBM inference)"
```

---

### Task 4：Dockerfile + 本地冒烟测试

**Files:**
- Create: `ai-service/Dockerfile`

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
# ai-service/Dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY models/ ./models/

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

注意：`libgomp1` 是 LightGBM 在 Linux 上必需的依赖。

- [ ] **Step 2: 本地测试 AI 服务（在训练好模型后）**

```bash
cd ai-service
pip install -r requirements.txt
uvicorn app.main:app --port 8001 &
sleep 2
curl -s http://localhost:8001/health
```

期望输出：
```json
{"status":"ok","models_loaded":["baseline_progression","baseline_lens","trend_progression","trend_lens"],"version_manifest":{...}}
```

- [ ] **Step 3: 测试基线评分接口**

```bash
curl -s -X POST http://localhost:8001/score/baseline \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: dev-secret-change-in-prod" \
  -d '{
    "patient_id": 1, "age_years": 9, "gender_male": 1,
    "od_sphere": -3.25, "od_axial_length": 25.1,
    "os_sphere": -3.0, "os_axial_length": 24.9,
    "parent_myopia_score": 2, "outdoor_hours_per_day": 1.0,
    "near_work_hours_per_day": 3.0
  }'
```

期望：返回包含 `progression_risk`、`lens_response`、`model_version` 的 JSON。

- [ ] **Step 4: 验证 token 校验**

```bash
curl -s -X POST http://localhost:8001/score/baseline \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: wrong-token" \
  -d '{"patient_id":1}'
```

期望：`{"detail":"Unauthorized"}`（401）

- [ ] **Step 5: 停止测试服务并 Commit**

```bash
kill %1  # 停止后台 uvicorn
git add ai-service/Dockerfile
git commit -m "feat(ai): add Dockerfile for AI service container"
```

---

## Phase 3：主后端新增评分接口

### Task 5：更新 backend config + 添加 httpx 依赖

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`

- [ ] **Step 1: 在 config.py 新增 AI 服务配置**

在 `backend/app/config.py` 的 `Settings` 类中添加：

```python
AI_SERVICE_URL: str = "http://localhost:8001"
AI_SERVICE_SECRET: str = "dev-secret-change-in-prod"
```

- [ ] **Step 2: 在 requirements.txt 新增 httpx**

在 `backend/requirements.txt` 末尾添加：
```
httpx==0.27.2
```

- [ ] **Step 3: 在 .env.example 新增环境变量**

在 `backend/.env.example` 末尾添加：
```
AI_SERVICE_URL=http://ai-service:8001
AI_SERVICE_SECRET=dev-secret-change-in-prod
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/config.py backend/requirements.txt backend/.env.example
git commit -m "feat(backend): add AI service config and httpx dependency"
```

---

### Task 6：实现 AI 客户端服务

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/ai_client.py`

- [ ] **Step 1: 创建 ai_client.py**

```python
# backend/app/services/ai_client.py
"""HTTP client for the internal AI scoring microservice."""
import httpx
from app.config import settings

_TIMEOUT = 10.0  # seconds

def _headers() -> dict:
    return {
        "X-Internal-Token": settings.AI_SERVICE_SECRET,
        "Content-Type": "application/json",
    }

def call_baseline(payload: dict) -> dict:
    """Call POST /score/baseline on the AI service.
    Raises httpx.HTTPError on network failure or non-2xx response.
    """
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            f"{settings.AI_SERVICE_URL}/score/baseline",
            json=payload,
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()

def call_trend(payload: dict) -> dict:
    """Call POST /score/trend on the AI service."""
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            f"{settings.AI_SERVICE_URL}/score/trend",
            json=payload,
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()
```

- [ ] **Step 2: 创建空 `__init__.py`**

```bash
touch backend/app/services/__init__.py
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/
git commit -m "feat(backend): add AI service HTTP client"
```

---

### Task 7：实现评分路由

**Files:**
- Create: `backend/app/routers/scores.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建 scores.py**

```python
# backend/app/routers/scores.py
"""Scoring router: trigger AI risk scoring and retrieve results."""
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.permissions import require_doctor_or_admin
from app.database import get_db
from app.models.baseline_exam import BaselineExam
from app.models.follow_up_visit import FollowUpVisit
from app.models.patient import Patient
from app.models.risk_score import RiskScore
from app.models.user import User
from app.services import ai_client

router = APIRouter()

DEDUP_WINDOW_SECONDS = 60

# ── Response schema ───────────────────────────────────────────────────────────

class ScoreOut(BaseModel):
    id: int
    patient_id: int
    progression_risk: Optional[str]
    progression_confidence: Optional[float]
    lens_response: Optional[str]
    lens_response_confidence: Optional[float]
    model_version: Optional[str]
    scored_by_model: Optional[str]
    scored_at: datetime

    class Config:
        from_attributes = True

# ── Helper: extract features ──────────────────────────────────────────────────

def _age_years(patient: Patient) -> float:
    today = datetime.now(timezone.utc).date()
    return (today - patient.birth_date).days / 365.25

def _parent_score(patient: Patient) -> int:
    return {"none": 0, "one": 1, "both": 2}.get(patient.parent_myopia or "none", 0)

def _baseline_payload(patient: Patient, exam: BaselineExam) -> dict:
    return {
        "patient_id": patient.id,
        "age_years": _age_years(patient),
        "gender_male": 1 if patient.gender == "male" else 0,
        "od_sphere": exam.od_sphere or 0.0,
        "od_axial_length": exam.od_axial_length or 24.0,
        "os_sphere": exam.os_sphere or 0.0,
        "os_axial_length": exam.os_axial_length or 24.0,
        "parent_myopia_score": _parent_score(patient),
        "outdoor_hours_per_day": patient.outdoor_hours_per_day or 1.0,
        "near_work_hours_per_day": patient.near_work_hours_per_day or 2.0,
    }

def _trend_payload(patient: Patient, exam: BaselineExam, visits: list) -> dict:
    payload = _baseline_payload(patient, exam)
    # Sort visits by date
    sorted_visits = sorted(visits, key=lambda v: v.visit_date)
    # Axial growth rate: compare latest vs earliest
    if len(sorted_visits) >= 2:
        first, last = sorted_visits[0], sorted_visits[-1]
        days = (last.visit_date - first.visit_date).days or 1
        months = days / 30.44
        axial_diff = ((last.od_axial_length or 0) - (first.od_axial_length or 0))
        sphere_diff = ((last.od_sphere or 0) - (first.od_sphere or 0))
        payload["axial_growth_mm_per_month"] = max(0.0, axial_diff / months)
        payload["sphere_change_d_per_month"] = sphere_diff / months
    else:
        v = sorted_visits[0]
        payload["axial_growth_mm_per_month"] = 0.02
        payload["sphere_change_d_per_month"] = -0.05
    good_count = sum(1 for v in visits if v.compliance_good)
    payload["avg_wearing_hours_per_day"] = sum(v.wearing_hours_per_day or 12 for v in visits) / len(visits)
    payload["compliance_rate"] = good_count / len(visits)
    return payload

# ── POST /api/patients/{patient_id}/score ─────────────────────────────────────

@router.post(
    "/{patient_id}/score",
    response_model=ScoreOut,
    status_code=status.HTTP_201_CREATED,
)
def trigger_score(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_doctor_or_admin),
):
    # 1. Patient exists?
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.is_active == True).first()
    if not patient:
        raise HTTPException(status_code=404, detail="患者不存在")

    # 2. Baseline exam exists?
    exam = db.query(BaselineExam).filter(BaselineExam.patient_id == patient_id).first()
    if not exam:
        raise HTTPException(status_code=400, detail="请先完成基线检查再进行评分")

    # 3. Dedup: 60s window
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    recent = (db.query(RiskScore)
               .filter(RiskScore.patient_id == patient_id,
                       RiskScore.scored_at >= cutoff)
               .first())
    if recent:
        raise HTTPException(status_code=409, detail="该患者正在评分中，请稍后刷新")

    # 4. Choose model
    visits = db.query(FollowUpVisit).filter(FollowUpVisit.patient_id == patient_id).all()
    try:
        if visits:
            payload = _trend_payload(patient, exam, visits)
            result = ai_client.call_trend(payload)
        else:
            payload = _baseline_payload(patient, exam)
            result = ai_client.call_baseline(payload)
    except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError):
        raise HTTPException(status_code=503, detail="AI 评分服务暂时不可用，请稍后重试")

    # 5. Save to DB
    score = RiskScore(
        patient_id=patient_id,
        progression_risk=result["progression_risk"],
        progression_confidence=result["progression_confidence"],
        lens_response=result["lens_response"],
        lens_response_confidence=result["lens_response_confidence"],
        model_version=result["model_version"],
        scored_by_model=result["model_name"],
        scored_at=datetime.now(timezone.utc),
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score

# ── GET /api/patients/{patient_id}/score ──────────────────────────────────────

@router.get("/{patient_id}/score", response_model=ScoreOut | list[ScoreOut] | None)
def get_score(
    patient_id: int,
    all: bool = Query(False, description="若 true 则返回所有历史评分"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_doctor_or_admin),
):
    q = db.query(RiskScore).filter(RiskScore.patient_id == patient_id).order_by(RiskScore.scored_at.desc())
    if all:
        return q.all()
    return q.first()  # returns None if no score yet
```

- [ ] **Step 2: 在 main.py 注册 scores router**

在 `backend/app/main.py` 中，在已有 router 注册后添加：

```python
from app.routers import auth, centers, patients, exams, visits, export, scores
# ...
app.include_router(scores.router, prefix="/api/patients", tags=["scores"])
```

- [ ] **Step 3: 重启后端，验证新接口出现在 Swagger**

```bash
docker restart 5000cases-backend-1
sleep 3
curl -s http://localhost:8000/openapi.json | grep -o '"scores"' | head -3
```

期望：输出 `"scores"` 说明 router 已注册。

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/scores.py backend/app/main.py
git commit -m "feat(backend): add patient scoring endpoints POST/GET /api/patients/{id}/score"
```

---

## Phase 4：前端患者详情页评分卡片

### Task 8：评分 API 客户端函数

**Files:**
- Create: `frontend/src/api/scores.js`

- [ ] **Step 1: 创建 scores.js**

```javascript
// frontend/src/api/scores.js
import api from './client'

export const getScore = (patientId) =>
  api.get(`/patients/${patientId}/score`)

export const triggerScore = (patientId) =>
  api.post(`/patients/${patientId}/score`)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/scores.js
git commit -m "feat(frontend): add AI scoring API client functions"
```

---

### Task 9：实现 ScoreCard 组件

**Files:**
- Create: `frontend/src/pages/Patients/ScoreCard.jsx`
- Modify: `frontend/src/pages/Patients/PatientDetail.jsx`

- [ ] **Step 1: 创建 ScoreCard.jsx**

```jsx
// frontend/src/pages/Patients/ScoreCard.jsx
import { useState, useEffect, useCallback } from 'react'
import { Card, Button, Tag, Tooltip, Descriptions, Alert, Spin, Typography } from 'antd'
import { RobotOutlined, ReloadOutlined } from '@ant-design/icons'
import { getScore, triggerScore } from '../../api/scores'

const { Text } = Typography

const RISK_MAP = {
  high:        { label: '高风险', color: 'red',    interval: '建议1个月随访' },
  medium:      { label: '中风险', color: 'orange', interval: '建议3个月随访' },
  low:         { label: '低风险', color: 'green',  interval: '建议6个月随访' },
}
const LENS_MAP = {
  effective:   { label: '有效',   color: 'success' },
  moderate:    { label: '一般',   color: 'warning' },
  ineffective: { label: '无效',   color: 'error'   },
}

export default function ScoreCard({ patientId }) {
  const [score, setScore]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [scoring, setScoring]   = useState(false)
  const [error, setError]       = useState(null)

  const fetchScore = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { data } = await getScore(patientId)
      setScore(data)
    } catch {
      // 404 or null means no score yet — not an error
      setScore(null)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { fetchScore() }, [fetchScore])

  const handleTrigger = async () => {
    setScoring(true)
    setError(null)
    try {
      const { data } = await triggerScore(patientId)
      setScore(data)
    } catch (err) {
      const status = err.response?.status
      if (status === 400) setError('请先录入基线检查数据再进行评分')
      else if (status === 409) setError('正在评分中，请稍后刷新')
      else setError('AI 评分服务暂时不可用，请稍后重试')
    } finally {
      setScoring(false)
    }
  }

  const prog = score ? RISK_MAP[score.progression_risk]  : null
  const lens = score ? LENS_MAP[score.lens_response]     : null

  return (
    <Card
      title={<span><RobotOutlined /> AI 风险评估</span>}
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={handleTrigger}
          loading={scoring}
          type="primary"
          size="small"
        >
          {score ? '重新评分' : '生成评分'}
        </Button>
      }
      style={{ marginTop: 24 }}
    >
      {loading && <Spin />}

      {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 12 }} />}

      {!loading && !score && !error && (
        <Text type="secondary">暂无评分记录，点击"生成评分"开始评估</Text>
      )}

      {score && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Card size="small" style={{ background: '#fff2f0', borderColor: '#ffccc7' }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>近视进展风险</div>
              <Tag color={prog.color} style={{ fontSize: 13, padding: '2px 10px' }}>{prog.label}</Tag>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                置信度 {Math.round(score.progression_confidence * 100)}%
              </Text>
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>{prog.interval}</div>
            </Card>

            <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>离焦镜响应效果</div>
              <Tag color={lens.color} style={{ fontSize: 13, padding: '2px 10px' }}>{lens.label}</Tag>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                置信度 {Math.round(score.lens_response_confidence * 100)}%
              </Text>
            </Card>
          </div>

          <Descriptions size="small" column={2} style={{ fontSize: 11 }}>
            <Descriptions.Item label="评分时间">
              {new Date(score.scored_at).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="模型版本">
              {score.scored_by_model} {score.model_version}
            </Descriptions.Item>
          </Descriptions>
        </>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: 在 PatientDetail.jsx 底部引入 ScoreCard**

打开 `frontend/src/pages/Patients/PatientDetail.jsx`，在文件顶部 import 区域添加：

```jsx
import ScoreCard from './ScoreCard'
```

在组件 `return` 的最后一个组件之后、`</div>` 或 `</>` 之前添加：

```jsx
<ScoreCard patientId={patient.id} />
```

（具体位置需根据文件实际结构调整，找到患者详情的主内容区域底部插入）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Patients/ScoreCard.jsx frontend/src/pages/Patients/PatientDetail.jsx
git commit -m "feat(frontend): add AI ScoreCard component to patient detail page"
```

---

## Phase 5：前端风险仪表盘

### Task 10：实现 RiskDashboard 页面

**Files:**
- Create: `frontend/src/pages/RiskDashboard/index.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Layout/index.jsx`

- [ ] **Step 1: 创建 RiskDashboard/index.jsx**

```jsx
// frontend/src/pages/RiskDashboard/index.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Tag, Tabs, Statistic, Row, Col, Spin } from 'antd'
import { listPatients } from '../../api/patients'
import { getScore } from '../../api/scores'

const RISK_MAP = { high: '高风险', medium: '中风险', low: '低风险' }
const RISK_COLOR = { high: 'red', medium: 'orange', low: 'green' }
const LENS_MAP   = { effective: '有效', moderate: '一般', ineffective: '无效' }
const INTERVAL   = { high: '1个月', medium: '3个月', low: '6个月' }

export default function RiskDashboard() {
  const navigate = useNavigate()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const { data: patients } = await listPatients({ page_size: 500 })
        const items = patients.items || patients
        const withScores = await Promise.all(
          items.map(async (p) => {
            try {
              const { data: score } = await getScore(p.id)
              return { ...p, score }
            } catch {
              return { ...p, score: null }
            }
          })
        )
        setRows(withScores)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const counts = {
    high:   rows.filter(r => r.score?.progression_risk === 'high').length,
    medium: rows.filter(r => r.score?.progression_risk === 'medium').length,
    low:    rows.filter(r => r.score?.progression_risk === 'low').length,
    unscored: rows.filter(r => !r.score).length,
  }

  const filtered = activeTab === 'all'      ? rows
    : activeTab === 'unscored'              ? rows.filter(r => !r.score)
    : rows.filter(r => r.score?.progression_risk === activeTab)

  const columns = [
    { title: '患者', dataIndex: 'name', render: (n, r) => <a onClick={() => navigate(`/patients/${r.id}`)}>{n} <span style={{color:'#aaa',fontSize:11}}>{r.patient_no}</span></a> },
    { title: '进展风险', dataIndex: ['score','progression_risk'], render: v => v ? <Tag color={RISK_COLOR[v]}>{RISK_MAP[v]}</Tag> : <Tag>未评分</Tag> },
    { title: '镜片响应', dataIndex: ['score','lens_response'],    render: v => v ? <Tag>{LENS_MAP[v]}</Tag> : '-' },
    { title: '评分时间', dataIndex: ['score','scored_at'],         render: v => v ? new Date(v).toLocaleDateString('zh-CN') : '-' },
    { title: '建议随访', dataIndex: ['score','progression_risk'], render: v => v ? INTERVAL[v] : '-' },
  ]

  const tabItems = [
    { key: 'all',      label: `全部 (${rows.length})` },
    { key: 'high',     label: `高风险 (${counts.high})` },
    { key: 'medium',   label: `中风险 (${counts.medium})` },
    { key: 'low',      label: `低风险 (${counts.low})` },
    { key: 'unscored', label: `未评分 (${counts.unscored})` },
  ]

  if (loading) return <Spin fullscreen />

  return (
    <div style={{ padding: 24 }}>
      <h2>风险管理仪表盘</h2>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="高风险患者" value={counts.high}   valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="中风险患者" value={counts.medium} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="低风险患者" value={counts.low}    valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="未评分"     value={counts.unscored} valueStyle={{ color: '#999' }} /></Card></Col>
      </Row>
      <Card>
        <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
        <Table dataSource={filtered} columns={columns} rowKey="id" pagination={{ pageSize: 20 }} />
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: 在 App.jsx 添加路由**

在 `frontend/src/App.jsx` 中：

顶部 import 添加：
```jsx
import RiskDashboard from './pages/RiskDashboard'
```

在 protected routes 区域添加：
```jsx
<Route path="risk-dashboard" element={<RiskDashboard />} />
```

- [ ] **Step 3: 在 Layout 导航添加"风险管理"入口**

打开 `frontend/src/components/Layout/index.jsx`，在现有菜单项中找到菜单配置数组，添加：

```jsx
{ key: '/risk-dashboard', label: '风险管理', icon: <AlertOutlined /> }
```

并在顶部引入：
```jsx
import { AlertOutlined } from '@ant-design/icons'
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/RiskDashboard/ frontend/src/App.jsx frontend/src/components/Layout/index.jsx
git commit -m "feat(frontend): add risk dashboard page with stats and filterable patient table"
```

---

## Phase 6：Docker Compose 集成 + 端到端测试

### Task 11：更新 docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 在 docker-compose.yml 添加 ai-service**

在 `backend` 服务后添加：

```yaml
  ai-service:
    build: ./ai-service
    environment:
      AI_SERVICE_SECRET: ${AI_SERVICE_SECRET:-dev-secret-change-in-prod}
    depends_on:
      - postgres
```

在 `backend` 服务的 `environment` 下新增：

```yaml
      AI_SERVICE_URL: http://ai-service:8001
      AI_SERVICE_SECRET: ${AI_SERVICE_SECRET:-dev-secret-change-in-prod}
```

- [ ] **Step 2: 在 backend 服务的 depends_on 添加 ai-service**

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      ai-service:
        condition: service_started
```

- [ ] **Step 3: 重建并启动所有服务**

```bash
cd 5000cases
docker-compose up -d --build ai-service backend
```

- [ ] **Step 4: 验证 ai-service 健康检查**

```bash
docker-compose logs ai-service --tail 20
docker exec 5000cases-backend-1 curl -s http://ai-service:8001/health
```

期望：`{"status":"ok","models_loaded":[...], ...}`

- [ ] **Step 5: 端到端测试**

需要先有一个有基线检查的患者（可通过 Swagger UI 创建测试数据）：

```bash
# 获取登录 token
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=Admin1234" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# 触发评分（替换 {PATIENT_ID} 为实际 ID）
curl -s -X POST http://localhost/api/patients/1/score \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

期望：返回包含 `progression_risk`、`lens_response` 的 201 响应。

- [ ] **Step 6: 验证前端展示**

打开 http://localhost，进入一个已有基线检查的患者详情页，点击"生成评分"，确认：
- 评分卡片正确显示风险等级和置信度
- 错误状态正确处理（无基线检查时提示友好信息）

打开 http://localhost/risk-dashboard，确认：
- 统计卡显示正确数量
- 患者列表可按风险筛选

- [ ] **Step 7: 最终 Commit**

```bash
git add docker-compose.yml
git commit -m "feat: integrate ai-service into docker-compose; complete AI risk scoring feature"
git push origin master
```

---

## 验收标准汇总

| Phase | 验收标准 |
|-------|----------|
| 1 | 4 个 `.pkl` 文件生成，所有模型 CV 准确率 > 70% |
| 2 | `GET /health` 返回 4 个模型已加载；token 校验正常（401）；评分接口返回正确结构 |
| 3 | `POST /api/patients/{id}/score` 写入 DB 返回 201；无基线检查返回 400；服务不可用返回 503；60s 内重复请求返回 409 |
| 4 | 患者详情页评分卡片正常显示；按钮触发评分后卡片刷新；错误状态有友好提示 |
| 5 | 风险仪表盘统计正确；Tab 筛选生效；点击患者跳转详情页 |
| 6 | `docker-compose up` 全链路正常；端到端手动测试通过 |
