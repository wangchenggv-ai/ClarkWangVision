# PostVisit.ai 架构拆解 — 高视AI产品参考

> 拆解目的：提取可复用的架构模式，映射到高视星CDSS / AI验配系统的产品规划中。

---

## 一、系统全景

```
PostVisit.ai（诊后患者AI平台）
├── Laravel 12 (PHP 8.4)         → API + 后端逻辑
├── Vue 3 + Tailwind CSS          → 患者端 & 医生端 SPA
├── Claude Opus 4.6               → AI引擎（SSE流式）
├── PostgreSQL 17                  → 主数据库（UUID, JSONB）
├── OpenFDA + DailyMed + RxNorm   → 药物安全数据（公共域）
├── NIH Clinical Tables           → 疾病/手术查询
└── Laravel Sanctum               → Cookie + Token 认证
```

**关键数据：** 111个REST端点，22个数据模型，15个AI服务，14个版本化prompt文件，262个测试用例。

---

## 二、最值得参考的5个架构模式

### 1. 5层AI上下文组装（Context Assembly）

这是整个架构最核心的设计。每次AI调用前，系统自动组装多层临床上下文：

| 层 | 内容 | 映射到高视场景 |
|---|------|-------------|
| Layer 1 | 就诊数据（SOAP note + 转录） | 验配记录（处方参数、角膜地形图） |
| Layer 2 | 患者档案（病史、既往史） | 患者档案（屈光度变化、眼轴长度历史） |
| Layer 3 | 临床指南（全文PMC文章） | 近视防控指南（IMI白皮书、国内专家共识） |
| Layer 4 | 用药信息 | 镜片参数库（OK镜弧度、离焦镜设计参数） |
| Layer 5 | FDA安全数据 | 不良反应数据库（角膜染色、异物感等） |

**关键点：** 他用了Opus的1M上下文窗口，单次请求加载60K-180K tokens。这意味着AI回答不是基于通用知识，而是基于该患者的完整临床画像。

### 2. AI Tool Use（工具调用）管道

AI不仅仅是对话，它在推理过程中可以实时调用外部工具：

```
患者提问 → AI推理 → 需要药物信息？
                    ├── 调用RxNorm查药物相互作用
                    ├── 调用OpenFDA查不良事件
                    ├── 调用DailyMed查药品说明书
                    ├── 调用指南检索
                    └── 综合所有结果 → 生成回答
```

**映射到高视：** AI验配助手在推荐处方时，可以实时调用：镜片参数库查匹配镜片、历史数据查同类患者效果、指南库查推荐方案、库存系统查可用库存。

### 3. 三级AI深度（Tier System）

| 级别 | 模型 | Extended Thinking | 临床指南 | 适用场景 |
|------|------|-----------------|---------|---------|
| Quick | Sonnet | 无 | 无 | 简单术语解释 |
| Better | Opus | Chat+Scribe | 无 | 常规问答 |
| Deep | Opus 4.6 | 全子系统 | 全文PMC | 复杂临床推理 |

**映射到高视：** 简单查询（库存查询、订单状态）用轻量模型；常规验配建议用标准模型；复杂case分析（高度近视+散光+角膜异常）用深度推理模型。成本和响应速度的平衡。

### 4. Plan-Execute-Verify 临床推理管道

```
Plan:   分析患者问题，制定推理计划
Execute: 调用工具获取数据，生成临床回答
Verify:  对照循证依据验证回答准确性
```

这不是简单的prompt → response，而是结构化的推理流程。AI先规划需要查什么，再执行查询，最后自我验证。

**映射到高视CDSS：** 验配决策 → Plan（评估患者参数）→ Execute（匹配镜片方案、预测效果）→ Verify（对照指南检查合理性、标记风险因素）。

### 5. SSE流式 + Thinking透明化

- 使用Server-Sent Events实现token级别的流式输出
- 分离两个通道：thinking（推理过程）和 response（最终回答）
- 患者可以看到AI"在想什么"，增加信任感

**映射到高视：** 验配师使用CDSS时，不仅看到推荐结果，还看到"为什么推荐这个方案"的推理过程。这对临床采纳率至关重要。

---

## 三、数据模型设计（FHIR对齐）

PostVisit的数据模型对齐了FHIR标准：

| FHIR资源 | PostVisit实现 | 高视对应 |
|----------|-------------|---------|
| Patient | 患者基本信息 | 患者档案（姓名、年龄、屈光度） |
| Encounter | 就诊记录 | 验配记录 / 复查记录 |
| Observation | 检查结果（生命体征、检验） | 眼轴长度、角膜曲率、视力 |
| Condition | 诊断 | 近视诊断、散光、其他眼部疾病 |
| MedicationRequest | 处方 | 镜片处方（OK镜参数、离焦镜处方） |

**设计要点：**
- UUID主键（非自增ID），便于跨系统整合
- JSONB字段存储半结构化临床数据
- 35个migration文件，PostgreSQL优化

---

## 四、安全与合规架构

| 维度 | PostVisit做法 | 高视需要考虑的 |
|------|-------------|-------------|
| 认证 | Sanctum（Cookie + Token双模式） | 根据国内等保要求选型 |
| AI端点保护 | 所有LLM路由需认证+角色验证+限流 | 同理，AI调用不能匿名 |
| 审计日志 | 每次PHI访问记录：用户、操作、资源、IP | 等保三级要求的操作日志 |
| 数据归属 | 患者数据归患者所有（consent model, right to erasure） | PIPL合规 |
| 文件存储 | S3兼容对象存储（不在应用服务器上） | 角膜地形图等影像数据同理 |
| 角色隔离 | 医生只能看自己的患者 | 验配师只能看自己服务的客户 |

---

## 五、AI服务架构（15个服务）

```
app/Services/AI/
├── QaAssistant              → 流式问答 + 升级检测
├── ClinicalReasoningPipeline → Plan-Execute-Verify推理
├── ToolExecutor             → 执行AI工具调用
├── MedicalExplainer         → 术语解释（上下文相关）
├── PatientEducationGenerator → 个性化患教材料生成
├── DocumentAnalyzer         → 上传文档AI分析
├── LibraryItemAnalyzer      → 医学文献分析
├── ScribeProcessor          → 语音转录 → SOAP note
├── TermExtractor            → 医学术语提取分类
├── EscalationDetector       → 紧急症状检测（关键词+AI+Thinking）
├── SessionSummarizer        → 对话摘要（供医生审阅）
├── AiTierManager            → Quick/Better/Deep路由
├── ContextAssembler         → 8层上下文组装
├── PromptLoader             → 从prompts/目录加载版本化prompt
└── AnthropicClient          → 底层API客户端（流式+Thinking）
```

**映射到高视AI服务设计：**

```
app/Services/AI/（高视版本构想）
├── FittingAssistant          → 验配建议生成（流式）
├── ClinicalReasoningPipeline → 处方推理（Plan-Execute-Verify）
├── LensMatchEngine           → 镜片参数匹配
├── ProgressPredictor         → 近视进展预测
├── AlertDetector             → 异常指标预警（角膜变形、快速进展）
├── ReportGenerator           → 复查报告自动生成
├── PatientEducator           → 个性化患教（家长沟通材料）
├── DataAnalyzer              → 临床数据分析（群体统计）
├── ContextAssembler          → 患者全景上下文组装
├── PromptManager             → prompt版本管理
└── AiClient                  → LLM调用客户端（国内用GLM/Coze，Clark个人用Claude）
```

---

## 六、Prompt工程

PostVisit将prompt作为独立文件版本管理，存放在 `prompts/` 目录下，14个文件。这意味着：

- Prompt不是硬编码在代码里
- 可以独立迭代prompt而不改代码
- 可以A/B测试不同prompt版本
- 有专门的PromptLoader服务负责加载

**这是你的CDSS应该采用的模式。** 验配建议的prompt、患教材料的prompt、报告生成的prompt应该都是独立管理的。

---

## 七、成本优化

| 技巧 | 做法 | 效果 |
|------|------|------|
| Prompt Caching | 系统prompt和临床指南缓存5分钟TTL | 多轮对话输入token成本降低78% |
| 分级路由 | 简单问题用Sonnet，复杂推理用Opus | 避免所有请求都用最贵模型 |
| Adaptive Thinking | 根据问题复杂度动态调整thinking budget（1K-16K tokens） | 简单问题不浪费thinking tokens |

---

## 八、批判性评估

**值得学的：**
1. 上下文组装模式（这是AI医疗产品的核心竞争力来源）
2. Tool Use让AI有"手"——可以查数据库而不只是聊天
3. Prompt版本化管理
4. 三级AI深度的成本控制思路
5. FHIR数据模型对齐（虽然国内不用FHIR，但结构化思路一致）

**不能直接抄的：**
1. **技术栈不适配** — Laravel+Vue是西方Web栈，你的团队用飞书+Coze+GLM，国内部署考虑微信生态/小程序
2. **这是demo不是产品** — 7天349个commit，代码质量和生产稳定性存疑
3. **合规体系不同** — HIPAA/FHIR是美国体系，国内是等保+PIPL+医疗器械软件注册
4. **商业模式缺失** — PostVisit解决的是"患者理解问题"，你的CDSS解决的是"验配师决策效率+结果保障"，切入点完全不同
5. **单人项目的局限** — 没有真实临床数据验证，没有多用户并发测试，没有运维监控

---

## 九、行动建议

1. **立即可用：** 将"5层上下文组装"模式应用到你的CDSS原型设计中。定义高视的5层是什么。
2. **短期参考：** Prompt版本化管理——在你的Obsidian vault里建一个 `prompts/` 目录，开始积累验配相关的prompt。
3. **中期规划：** Tool Use架构——让AI验配助手能实时查询镜片参数库和历史数据，而不是纯对话。
4. **注意边界：** 不要被技术架构的精巧迷惑。你的核心壁垒是临床数据+domain expertise，不是代码架构。

---

*来源：https://github.com/mnedoszytko/postvisit — MIT License*
*分析日期：2026-03-22*

---

## 相关文档
- [[CDSA演讲大纲_20260410]] — CDSS是CDSA成员的核心权益工具
- [[calm-sprouting-hedgehog]] — 近视研究平台技术规划（5000例数据）
