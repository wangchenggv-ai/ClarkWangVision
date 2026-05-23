# STATE · 多焦点 OK 镜设计引擎

> **项目名称**：ok-engine — Multifocal Orthokeratology Lens Design Engine  
> **代号**：GaoShiXing（高视兴）  
> **Phase**：Phase 1 — 计算内核 + API + 前端 SPA  
> **日期**：2026-05-05  
> **状态**：运行中，33/33 测试通过

---

## 1. 项目概览

为老视（presbyopia）患者设计多焦点 OK 镜片的计算引擎。核心目标是根据角膜地形参数、屈光参数、上皮厚度和设计选择（CF / CN），输出完整的镜片几何参数和 ADD 效果预测。

**适用场景**：近视合并老视患者夜间配戴 OK 镜，白天获得远近视力。

**临床背景**：OK 镜利用上皮重新分布（epithelial redistribution）原理——镜片不同区域的曲率差异驱动角膜上皮从受压区向周边迁移，形成特定的上皮厚度剖面，从而实现多焦点光学效果。

| 设计 | 含义 | 光学方案 | 上皮机制 |
|------|------|----------|----------|
| **CF** (Center-Far) | 中央看远 | 中央矫正近视，旁中央区制造 ADD 环 | 中央变薄（近视塑形）→ 旁中央上皮堆积形成 ADD |
| **CN** (Center-Near) | 中央看近 | 中央内建 ADD，旁中央区矫正近视 | 中央增厚（ADD 丘）→ 旁中央变薄矫正近视 |

---

## 2. 目录结构

```
ok-engine/
├── app.py                  # FastAPI 入口，路由挂载
├── config.py               # 配置：数据库 URL
├── db.py                   # SQLAlchemy 引擎 & session
├── seed.py                 # 种子数据（10 例患者）
├── requirements.txt        # 依赖声明
├── ok_engine.db            # SQLite 运行时数据库
├── STATE.md                # 本文档
├── engine/                 # 计算内核（纯函数，无副作用）
│   ├── cornea.py           #   角膜几何工具
│   ├── bozr.py             #   BOZR（后视区半径）计算
│   ├── reverse_curve.py    #   反转弧（RC）计算
│   ├── add_predict.py      #   ADD 预测模型
│   ├── epithelium.py       #   上皮剖面模型（Gaussian 叠加）
│   └── lens_params.py      #   总编排器（orchestrator）
├── models/                 # SQLAlchemy ORM + Pydantic schemas
│   ├── patient.py          #   Patient 表
│   ├── calculation.py      #   Calculation 表（镜片参数快照）
│   ├── followup.py         #   FollowUp 表（随访实测）
│   └── schemas.py          #   Pydantic 请求/响应模型
├── api/                    # FastAPI 路由
│   ├── patients.py         #   CRUD + 病例关联计算
│   └── calculations.py     #   队列分析 + CF/CN 对比
├── tests/                  # pytest 测试套件
│   ├── test_epithelium.py  #   上皮剖面 (14 tests)
│   ├── test_bozr.py        #   BOZR 计算 (6 tests)
│   ├── test_add_predict.py #   ADD 预测 (8 tests)
│   └── test_lens_params.py #   集成编排 (5 tests)
└── static/
    └── index.html          # SPA 前端（Canvas 热图 + 参数展示）
```

---

## 3. 架构

```
                  ┌─────────────────────┐
                  │   static/index.html │  SPA 前端
                  │   CDN fonts + Canvas│
                  └────────┬────────────┘
                           │ fetch /api/*
                  ┌────────▼────────────┐
                  │   FastAPI (app.py)  │  CORS: allow_origins=["*"]
                  │   port 8000         │
                  └──┬──────────────┬───┘
                     │              │
            ┌────────▼────┐  ┌──────▼────────┐
            │ api/patients │  │ api/cohort    │  路由层
            │ CRUD+calculate│  │ stats/compare │
            └──────┬───────┘  └──────┬────────┘
                   │                 │
            ┌──────▼─────────────────▼──────┐
            │     engine/lens_params()      │  计算内核（纯函数）
            │  bozr → rc → add_predict      │
            └──────────────┬───────────────┘
                           │
            ┌──────────────▼───────────────┐
            │  SQLAlchemy + SQLite         │  持久层
            │  patients / calculations     │
            │  followups (reserved)        │
            └──────────────────────────────┘
```

**关键设计选择**：
- 计算内核为纯函数（无 DB 依赖、无副作用），独立可测
- API 层负责编排：接收请求 → 查 DB → 调计算内核 → 存快照 → 返回
- SPA 前端直接通过 fetch 调用 API，无构建步骤

---

## 4. 计算管线

`engine/lens_params.py` → `calculate_lens_params()` 是总编排器，按以下顺序执行：

```
输入: k1, k2, sph, cyl, e_value, hvid, epi_central, pupil, add_target, design
  │
  ├─[1] cornea.avg_keratometry(k1, k2) → avgK
  │      cornea.delta_radius_for_power(avgK, ΔD) → ΔR
  │
  ├─[2] bozr.calculate_bozr(k1, k2, sph, design, add_target) → (bozr1, bozr2)
  │      CF: bozr1 = avgK + ΔR_sph (flatter, corrects myopia)
  │          bozr2 = bozr1 - ΔR_add (steeper, produces ADD)
  │      CN: bozr_far = avgK + ΔR_sph
  │          bozr1 = bozr_far - ΔR_add (steeper, ADD mound)
  │          bozr2 = bozr_far (distance correction)
  │
  ├─[3] reverse_curve.calculate_rc(bozr1, design, ...) → (rc1, rc2)
  │      rc1 = bozr1 - 0.85 (CF) 或 -0.90 (CN, 略深)
  │      rc2 = rc1 + 0.40
  │
  ├─[4] fa = bozr2 + 1.25 (定位弧)
  │
  ├─[5] pa = 12.5 (周边弧，标准值)
  │
  ├─[6] td = hvid - 0.8 (总直径)
  │
  ├─[7] add_predict.predict_add(...) → (predicted_add, actual_add)
  │      k_coef = 0.82 + (epi_central - 50) × 0.008 + e_value × 0.05
  │      CF: predicted = add_target × min(1, peak_mound / (ΔR×450)) × 0.92
  │      CN: predicted = add_target × k_coef × pupil_penalty × 0.97
  │      noise: ±0.075 D (simulated actual_add)
  │
  └─[8] Clinical flags:
        night_glare: CF → |sph|>3 → '高', else '中'
                     CN → pupil>3.0 → '高', else '低'
        fit_score:   CN + pupil≤2.8 → '优', CN + pupil>2.8 → '可'
                     CF → '优'
```

---

## 5. 数据模型

### 5.1 数据库表 (SQLAlchemy ORM)

```
patients
├── id: INTEGER PK
├── patient_id: VARCHAR(20) UNIQUE    # "PT-001"
├── age: INTEGER
├── eye: ENUM(OD, OS)
├── k1, k2: FLOAT                    # 角膜曲率 (mm)
├── e_value: FLOAT                   # 偏心率
├── hvid: FLOAT                      # 可见虹膜直径 (mm)
├── epi_central: FLOAT               # 中央上皮厚度 (μm)
├── pupil: FLOAT                     # 明光瞳孔直径 (mm)
├── sph, cyl: FLOAT                  # 屈光 (D)
├── add_target: FLOAT                # 目标 ADD (D)
├── design: ENUM(CF, CN)
├── profile_source: ENUM(parametric, topography)
├── created_at, updated_at: DATETIME
└── ── relationships ──
    ├── calculations → Calculation[]
    └── followups → FollowUp[]

calculations
├── id: INTEGER PK
├── patient_id: INTEGER FK → patients.id
├── bozr1, bozr2: FLOAT             # BOZR (mm)
├── rc1, rc2: FLOAT                  # 反转弧 (mm)
├── fa, pa, td: FLOAT                # 定位弧/周边弧/总直径
├── predicted_add: FLOAT             # 预测 ADD (D)
├── night_glare: VARCHAR(10)         # 高/中/低
├── fit_score: VARCHAR(10)           # 优/可/差
└── created_at: DATETIME

followups (reserved, 未填充)
├── id: INTEGER PK
├── patient_id: INTEGER FK
├── calculation_id: INTEGER FK
├── visit_date: DATETIME
├── actual_add: FLOAT?               # 实测 ADD (D)
├── visual_quality: FLOAT?           # 0.0–1.0
└── notes: TEXT
```

### 5.2 Pydantic Schemas

| Schema | 用途 |
|--------|------|
| `PatientCreate` | POST body 验证，含字段范围约束 |
| `PatientUpdate` | PUT body，所有字段 Optional |
| `PatientResponse` | 含 id + timestamps 的完整输出 |
| `PatientSummary` | 列表视图：id, design, sph, add_target, avg_k |
| `CalculationResponse` | 镜片参数完整快照 |
| `LensParamsResponse` | 聚合：patient + calculation + actual_add |
| `FollowUpResponse` | 随访记录 |
| `CohortStats` | 队列统计：总数, CF/CN 分布, 平均 ADD, 达成率 |

---

## 6. API 端点

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| `GET` | `/health` | 健康检查 | ✅ |
| `GET` | `/` | SPA 前端入口 | ✅ |
| `GET` | `/api/patients/` | 病例列表（可按 ?design=CF/CN 过滤） | ✅ |
| `GET` | `/api/patients/:id` | 单病例详情 | ✅ |
| `POST` | `/api/patients/` | 创建病例 | ✅ |
| `PUT` | `/api/patients/:id` | 更新病例 | ✅ |
| `DELETE` | `/api/patients/:id` | 删除病例（级联计算+随访） | ✅ |
| `POST` | `/api/patients/:id/calculate` | 触发计算，返回 LensParamsResponse | ✅ |
| `GET` | `/api/patients/:id/calculations` | 历史计算记录列表 | ✅ |
| `GET` | `/api/patients/:id/export` | 导出完整病例数据 (JSON) | ✅ |
| `GET` | `/api/cohort/stats` | 队列聚合统计 | ✅ |
| `GET` | `/api/cohort/compare` | 同参数 CF vs CN 对比（?sph=&add=…） | ✅ |

---

## 7. 测试覆盖

**框架**：pytest 9.0.3  
**运行时**：Python 3.12.10  
**结果**：**33 passed, 0 failed, 0 skipped**

```
tests/test_epithelium.py (14 tests)
  TestGaussian ─ 峰值、σ衰减、远端归零
  TestCFProfile ─ 中央变薄、ADD峰存在、近视深度影响、基线回归
  TestCNProfile ─ 中央丘、ADD目标准确度、旁中央变薄
  TestBuildProfile ─ 工厂函数、topography 未实现断言

tests/test_bozr.py (6 tests)
  TestBOZR ─ CF 基础/中度近视、CN 基础/小瞳孔、非法设计断言、正值检查

tests/test_add_predict.py (8 tests)
  TestADDPrediction ─ CF 低度/中度/高度近视、CN 小/大瞳孔惩罚、
                      种子可重现、ratio 不超目标、非法设计断言

tests/test_lens_params.py (5 tests)
  TestLensParams ─ 全键输出、BOZR1<BOZR2(CN)、BOZR1>BOZR2(CF)、
                   CN 适配评分（优/可）、TD 基于 HVID
```

---

## 8. 运行时状态

| 项目 | 值 |
|------|-----|
| **URL** | `http://localhost:8000` |
| **进程** | PID 31300 (uvicorn) |
| **数据库** | `ok_engine.db` — 10 患者 + 12 条计算记录 |
| **CF 病例** | 5 (PT-002, PT-004, PT-005, PT-007, PT-009) |
| **CN 病例** | 5 (PT-001, PT-003, PT-006, PT-008, PT-010) |
| **平均预测 ADD** | 0.54 D |
| **ADD 达成率** | 0.46 (预测值 / 目标值均值) |

---

## 9. 临床假设 & 系数溯源

| 系数 | 值 | 来源 |
|------|-----|------|
| ΔR = R²×ΔD / 337.5 | — | Munnerlyn 公式近似，337.5 为 (n-1)×1000，n=1.3375 |
| k_coef 基础值 | 0.82 | 上皮可塑性基线，经验估计 |
| k_coef 上皮因子 | +0.008 / μm | 中央上皮每厚 1μm，可塑性 +0.008 |
| k_coef 偏心率因子 | +0.05 / e | 偏心率每增 0.1，可塑性 +0.005 |
| CF peak_mound 系数 | 0.55 | 中央变薄量的 55% 转化为旁中央堆积 |
| CN pupil_penalty | 0.85/0.92/1.0 | 瞳孔 >3.0 / 2.8-3.0 / ≤2.8 |
| CF ADD ratio 系数 | 0.92 | 上皮可塑性衰减 |
| CN ADD 系数 | 0.97 | 直接曲率转换效率 |

**风险提示**：上述系数基于文献综述和经验模型，需通过临床数据校准（Phase 3-4）。

---

## 10. 已知限制

1. **topography 模式未实现**：当前仅支持 `profile_source=parametric`（Gaussian 叠加模型），真实角膜地形图导入留待 Phase 5。
2. **柱镜（cyl）未参与计算**：`calculate_lens_params` 接受 cyl 参数但仅在 BOZR 计算中使用 avgK，未对环曲面做特殊处理。
3. **随访表未填充**：followups 表结构就绪，但无实际随访数据。
4. **中文终端编码**：Windows cmd 下 JSON 输出中的中文字段（night_glare, fit_score）可能显示为 `\uXXXX` 转义序列。
5. **ADD 预测噪声为模拟值**：`actual_add` 使用 ±0.075D 均匀噪声模拟测量误差，非真实临床测量。

---

## 11. 后续路线图

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 项目骨架、计算内核、病例 API、种子数据、SPA 前端 | ✅ 完成 |
| Phase 2 | 随访 API + 实测 ADD 对比 + 校准系数 | 待开始 |
| Phase 3 | 真实临床数据导入 + 系数回归校准 | 待开始 |
| Phase 4 | 报告生成 (PDF)、批量计算 | 待开始 |
| Phase 5 | 角膜地形图导入 (topography profile)、3D 可视化 | 待开始 |

---

## 12. 常用命令

```bash
# 启动开发服务器
cd ok-engine
python app.py
# 或: uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# 运行全部测试
python -m pytest tests -v

# 运行单个测试文件
python -m pytest tests/test_bozr.py -v

# 重新播种数据库
python seed.py --reset

# 健康检查
curl http://localhost:8000/health

# 创建新患者
curl -X POST http://localhost:8000/api/patients/ \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"PT-011","age":44,"eye":"OD",
       "k1":7.82,"k2":7.68,"e_value":0.42,"hvid":11.8,
       "epi_central":52,"pupil":2.6,"sph":-1.50,"cyl":-0.25,
       "add_target":1.00,"design":"CN"}'

# 触发计算
curl -X POST http://localhost:8000/api/patients/1/calculate

# CF vs CN 对比
curl "http://localhost:8000/api/cohort/compare?sph=-1.50&add_target=1.00"
```
