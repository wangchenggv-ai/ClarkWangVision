# 高视星 CDSS V2 — 项目状态

## 当前状态：✅ 开发中

### 已完成的合并
- [x] 后端：5000cases-master FastAPI + PostgreSQL（复刻完成）
- [x] CDSS分析API：风险评分 + 方案推荐端点
- [x] 前端基础设施：JWT认证、RBAC、API层
- [x] 接诊工作台6步流程：选患者 → 检查录入 → 患者教育 → CDSS推荐 → 成交辅助 → 完成
- [x] 患者教育：眼球SVG动画 + 4方案18岁趋势预测 + 话术提示
- [x] CDSS推荐：综合风险评分 + 3方案对比 + ParentTags智能策略
- [x] 临床报告：可打印PDF风格报告
- [x] 种子数据：admin/admin123（含演示数据）

### 待开发
- [ ] 后端CDSS分析对接真实数据（当前mock数据）
- [ ] RAG相似病例检索
- [ ] QLoRA微调集成
- [ ] 运营仪表盘
- [ ] iPad响应式适配优化

### 关键技术栈
- 前端：React 19 + Ant Design 6 + Recharts 3 + Lucide
- 后端：FastAPI + SQLAlchemy 2 + PostgreSQL（开发用SQLite）
- 认证：JWT access/refresh token + RBAC
