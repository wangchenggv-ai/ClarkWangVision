## 2026-04-22 项目启动

从订单系统的 Excel 解析逻辑抽象为通用引擎，独立 repo `excel-parser`。

### MVP 完成

- `parser.js` 核心引擎：列模糊匹配、行分组（含复合键）、字段转换（round025/clamp/normalize）、备注归并、元数据提取
- `templates/eyeglass.json` 眼镜单订单模板
- `server.js` 极简 HTTP 服务 + `public/index.html` 单页 UI

### 批量测试

8 个真实订单文件测试：7/8 直接匹配 eyeglass 模板解析成功，1 个格式不同需要新模板。

## 2026-04-23 自动检测 + AI 学习 + 手动配置

### 新功能

- **自动检测**：上传 Excel 自动匹配已有模板（按 headerKeyword 定位表头 → 字段匹配度打分）
- **AI 学习**：`/api/learn-template` 调 MIMO API 从表头+样本数据生成模板 JSON
- **手动配置**：UI 表单定义字段（key/label/patterns/type/groupKey）
- **保存模板**：`/api/save-template` 写入 templates/ 目录，立即可用

### Bug 修复

- `autoDetectTemplate` 原逻辑用"第一行 3+ 非空"定位表头，误把元数据行当表头 → 改为按 template.headerKeyword 扫描所有行
- `fileInput` change handler 误用 `e.dataTransfer` → 修复为 `e.target`

### 新增模板

- `eyeglass-shipping.json` — 出库单格式（商品名称/数量/片，客户名在备注列，元数据行含出库单号）

### 当前状态

| 项目 | 状态 |
|------|------|
| 自动匹配 3 种格式 | ✅ eyeglass / eyeglass-merged / eyeglass-shipping |
| AI 模板学习 | ⚠️ 代码完成，需配置 MIMO_API_URL/MIMO_API_KEY |
| 手动配置 | ✅ |
| 批量测试 | ✅ 8/8 解析成功 |
| GitHub 同步 | ✅ |

### 待办

- [ ] 配置 MIMO API 环境变量，测试 AI 学习端到端
- [ ] 更多模板类型（非眼镜业务验证通用性）
- [ ] 模板编辑 UI（当前只能看 JSON 手动改）
