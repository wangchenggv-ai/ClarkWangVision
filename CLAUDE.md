# CLAUDE.md — AI Assistant Guide for ClarkWangVision

This file provides context and conventions for AI assistants (Claude and others) working with this repository.

---

## Repository Overview

**Type:** Obsidian knowledge management vault
**Purpose:** Business strategy and operational planning for Clark Wang Vision, an eyeglass lens company
**Primary focus:** Supply Chain AI-Native Transformation Project (代号：Lightning)
**Language:** Chinese (Simplified), with occasional English in technical terms

This is **not a software development repository**. There is no code to build, test, or deploy. The repository contains business documentation in Markdown format, organized by department.

---

## Repository Structure

```
ClarkWangVision/
├── 00-CEO驾驶舱/           # CEO Dashboard — cross-functional decisions & strategy
├── 01-销售/                # Sales
├── 02-医学市场/            # Medical Market
├── 03-研发/                # R&D
├── 04-供应链/              # Supply Chain (primary focus — most detailed content)
├── 05-人力/                # Human Resources
├── 06-财务/                # Finance
├── 99-模板/                # Templates
├── .obsidian/              # Obsidian vault configuration (do not edit manually)
├── 欢迎.md                 # Default Obsidian welcome file
└── CLAUDE.md               # This file
```

### Key Content Files

| File | Description |
|------|-------------|
| `04-供应链/供应链AI_Native改造项目_项目章程.md` | Main 442-line project charter for the 100-day supply chain transformation |
| `04-供应链/供应链100天改进矩阵_流程×实践.md` | 14-week improvement matrix with week-by-week task breakdown |
| `04-供应链/xiaomi供应链项目.md` | Supply chain delivery project details |
| `99-模板/Claude对话沉淀模板.md` | Template for capturing Claude AI conversation insights |
| `99-模板/决策记录模板.md` | Decision record template |

---

## Business Context

**Company:** Clark Wang Vision (视光产品公司)
**Products:** Premium eyeglass lenses — OK镜, 离焦镜片, Ultra, 小旋风, 时空之眼, etc.

**Core Project: Supply Chain AI-Native Transformation (Project Lightning)**
- **Duration:** March 24 – June 30, 2026 (100 days)
- **Current state:** ~7,000 unit delivery volume (March 2026), 50% overdue rate during peak season, manual processes
- **Target state:** 25,000 units/year capacity, <20% overdue rate, 100+ units/day delivery

**Three phases:**
| Phase | Weeks | Dates | Theme |
|-------|-------|-------|-------|
| Phase 1 | 1–4 | Mar 24 – Apr 18 | "止血" — Stop the bleeding (stabilize critical processes) |
| Phase 2 | 5–10 | Apr 21 – May 29 | "建系统" — Build the system (implement AI automation) |
| Phase 3 | 11–14 | Jun 1 – Jun 30 | "压力测试" — Pressure test (validate at scale) |

**Key success metrics:**
- Overdue rate: 50% → <20%
- Daily delivery capacity: 70 → 100+ units
- SKU inventory coverage: 0% → 50–70%
- Delivery accuracy: → 99%+
- Customer inquiry response time: → <2 hours

---

## Team

| Name | Role |
|------|------|
| Clark Wang | Project Owner (executive oversight) |
| 沈锋 (Shen Feng) | Execution Lead (system redesign, supply chain, AI rollout) |
| 胡瑞雪 (Hu Ruixue) | Order Operations (WeChat order aggregation, AI chatbots) |
| 谢碧琪 (Xie Biqi) | Production Planning (supply ordering, process automation) |
| 王成 (Wang Cheng) | Customer/Partner Liaison |
| 唐洁琼 (Tang Jiejing) | Quality & Shipping |
| 唐工 + 沈工 | Technical Research (product quality issues) |
| 邱博 (Qiu Bo) | Documentation |

---

## Technology Stack

**Vault & version control:**
- [Obsidian](https://obsidian.md) — Markdown-based knowledge management
- Git + `obsidian-git` plugin (v2.38.0) — automatic backup commits every ~3–5 minutes

**Operational tools (referenced in docs, not in this repo):**
- **飞书 (Feishu)** — Team collaboration platform; houses the operational control tower (多维表格), KPI dashboards, and AI robot integrations
- **企业微信 (WeChat Work)** — Primary customer order channel

**AI & automation tools (planned for integration):**
- **Coze + GLM (扣子)** — Team AI assistant for order queries, support, SOP Q&A
- **引刀 (RPA)** — Process automation (QR code generation, etc.)
- **Claude** — Data analysis, decision support, document generation
- **豆包 (Doubao)** — AI tool demonstrations

**ERP/systems:**
- **NC System** — Financial system (being decoupled from order system)
- **圣谱 (Spectrum)** — Manufacturing facility system

**Supply chain partners:**
- 欧陆 (Eurland) — New primary supply chain partner (being onboarded)
- 豪雅 (Hoya) — Optical partner
- 五彩 — Assembly partner

---

## Documentation Conventions

All content follows consistent Markdown conventions designed for Obsidian.

### File naming
```
YYYY-MM-DD 主题描述.md
```
Example: `2026-03-24 供应链周会记录.md`

### Cross-linking
Use Obsidian bidirectional wiki links to connect related notes across departments:
```markdown
[[04-供应链/供应链AI_Native改造项目_项目章程]]
[[00-CEO驾驶舱/2026-03-24 决策记录]]
```

### Tags
| Tag | Usage |
|-----|-------|
| `#决策` | Decision records |
| `#待办` | To-do items |
| `#存档` | Archived/historical content |
| `#Claude沉淀` | Claude AI conversation insights |

### Task status values (used in tables)
| Chinese | Meaning |
|---------|---------|
| 待启动 | Pending start |
| 规划中 | Planning |
| 进行中 | In progress |
| 待测试 | Awaiting test |
| 待评估 | Awaiting evaluation |
| 待确认 | Awaiting confirmation |
| 待开会 | Pending meeting |
| 探索中 | Exploring |
| 已完成 | Completed |

### Project charter format
Project documentation (项目章程) follows this structure:
1. 文档信息 (Document metadata table)
2. 项目背景 (Project background & problem statement)
3. 核心问题 (Core problems being solved)
4. 项目定位 (Project positioning)
5. 项目目标 (Goals with KPI baselines and targets)
6. 项目范围 (In-scope / out-of-scope)
7. 全流程拆解 (End-to-end process breakdown)
8. 分阶段任务 (Phase-by-phase task tables)
9. 里程碑 (Milestones)
10. 团队分工 (Team responsibility matrix)

### Task table columns
```markdown
| 序号 | 任务项 | 负责人 | 优先级 | 目标完成时间 | 当前状态 | 关键产出/验收标准 |
```

---

## Obsidian Configuration

Obsidian core plugins enabled:
- File explorer, Global search, Graph view, Backlinks, Canvas
- Tags, Properties, Page preview, Daily notes, Templates
- Outline, Word count, Bookmarks, Command palette

Disabled: Slash commands, Footnotes, Workspaces, Slides, Audio recording

**Do not manually edit files under `.obsidian/`** — these are managed by Obsidian itself.

---

## Git Workflow

**Branch strategy:**
- `main` (remote) / `master` (local) — stable vault state
- `claude/` prefixed branches — AI assistant development branches

**Commit style:**
- Automatic: `vault backup: YYYY-MM-DD HH:MM:SS` (from obsidian-git plugin)
- Manual: Descriptive commits for intentional changes (e.g., `add project charter for supply chain transformation`)

**Remote:** Configured via local proxy at `http://local_proxy@127.0.0.1:37537/git/wangchenggv-ai/ClarkWangVision`

**When adding or editing documentation:**
1. Create or edit `.md` files in the appropriate department folder
2. Use the file naming convention (`YYYY-MM-DD 主题.md`)
3. Add cross-links using `[[wiki links]]` where relevant
4. Apply appropriate tags
5. Commit with a meaningful message describing what was added or changed

---

## Templates

Two reusable templates are in `99-模板/`:

**Claude对话沉淀模板.md** — For capturing insights from Claude AI conversations:
```markdown
# YYYY-MM-DD Claude对话沉淀

## 问题
<!-- What question or problem was explored -->

## Claude关键结论
<!-- Key conclusions from Claude -->

## 我的判断
<!-- Your own assessment -->

## 行动项
- [ ] Action item

#Claude沉淀
```

**决策记录模板.md** — For recording business decisions:
```markdown
# YYYY-MM-DD 决策主题

## 背景

## 选项
- 选项1：
- 选项2：

## 决策

## 理由

## 下一步

#决策
```

---

## Guidance for AI Assistants

### What to do
- Write content in **Chinese (Simplified)** to match the existing documentation style
- Follow the file naming convention: `YYYY-MM-DD 主题.md`
- Use Obsidian wiki links (`[[...]]`) to connect related notes
- Apply the established tag taxonomy (`#决策`, `#待办`, `#存档`, `#Claude沉淀`)
- Use the provided templates in `99-模板/` when creating new decisions or meeting notes
- Preserve the department-based folder structure
- Keep task tables consistent with the established column schema

### What to avoid
- Do not create files outside the established folder structure without good reason
- Do not edit files under `.obsidian/` — these are Obsidian system files
- Do not use English for content documents (English is acceptable in technical terms and this CLAUDE.md file)
- Do not change the auto-backup commit messages from obsidian-git
- Do not assume this is a software project — there is no code to run, build, or test

### When asked to add meeting notes
Use the folder for the relevant department, name the file `YYYY-MM-DD 主题.md`, and cross-link to related project documents.

### When asked to update project status
Edit the relevant task table in `04-供应链/供应链AI_Native改造项目_项目章程.md` or the improvement matrix, updating the 当前状态 column and any KPI progress notes.

### When asked to record a decision
Use `99-模板/决策记录模板.md` as a starting point. Save in `00-CEO驾驶舱/` for cross-functional decisions, or in the relevant department folder.

### When asked to capture a Claude conversation
Use `99-模板/Claude对话沉淀模板.md`. Save in the folder most relevant to the topic discussed.
