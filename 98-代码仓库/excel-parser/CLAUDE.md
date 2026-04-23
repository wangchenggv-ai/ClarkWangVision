# CLAUDE.md — Excel 解析引擎

## 项目是什么

通用 Excel 解析引擎。用 JSON 模板定义列映射和数据转换规则，支持自动模板匹配、AI 学习新模板、手动配置三种模式。

从订单系统的 `handleExcelUpload()` 硬编码逻辑抽象而来，目标是让非眼镜业务也能复用同一套解析能力。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 运行时 | Node.js (ES Modules) | |
| HTTP | Node 内置 `http` 模块 | 不是 Express |
| 依赖 | `xlsx` | 唯一依赖 |
| 前端 | 原生 HTML + 内联 JS | 无框架无构建 |
| AI | MIMO API (OpenAI 兼容) | 用于模板学习，可选 |

**不要**引入 Express、TypeScript、打包工具。

## 核心文件

| 文件 | 说明 |
|------|------|
| `parser.js` | 核心引擎：`parseExcel(buffer, template)` → `{ groups, rows, warnings, columnMap, metadata }` |
| `server.js` | HTTP 服务（端口 3300）：parse / learn-template / save-template / templates |
| `public/index.html` | 单页 UI：上传 → 自动匹配/AI学习/手动 → 预览 → 导出JSON |
| `templates/*.json` | 模板配置文件（JSON），重启后自动加载 |

## 模板系统

模板是 JSON 文件，定义列映射、分组、转换规则。

### 关键字段

| 字段 | 说明 |
|------|------|
| `headerKeyword` | 定位表头行的关键词（如 "顾客姓名"） |
| `fields[].patterns` | 列名模糊匹配数组，支持 `includes` 匹配 |
| `fields[].groupKey: true` | 按此列分组（如按客户名） |
| `fields[].transform` | 转换：`round025` / `clamp(0,180)` / `roundInt` |
| `fields[].normalize` | 字典映射（如 `{"右":"右眼"}`） |
| `groupComposite` | 复合分组键数组（如 `["customerOrg", "sourceFile"]`） |
| `orderFields` | 整单级字段，加 `pickFirst: true` 取首个非空值 |
| `metadata` | 表头上方的 key-value 元数据行 |
| `remarkPatterns` | 备注行匹配，自动归并到上一条数据 |

### 当前模板

| 模板 | 用途 |
|------|------|
| `eyeglass` | 单订单格式（顾客姓名/球镜/柱镜/轴位，元数据行含联系人） |
| `eyeglass-merged` | 合并汇总表（来源文件/客户名称列，复合分组键） |
| `eyeglass-shipping` | 出库单格式（商品名称列，客户名在备注列） |
| `sales-order` | 通用销售订单（客户/产品/数量/单价） |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parse` | 上传 Excel + template name → 解析结果。`template: "auto"` 自动检测 |
| GET | `/api/templates` | 列出可用模板 |
| POST | `/api/learn-template` | MIMO AI 从 Excel 样本生成模板 JSON |
| POST | `/api/save-template` | 保存模板到 templates/ 目录 |
| GET | `/api/template/:name` | 获取单个模板配置 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `PORT` | 默认 3300 |
| `MIMO_API_URL` | MIMO API 地址（AI 学习功能） |
| `MIMO_API_KEY` | MIMO API Key |

## 开发

```bash
npm start          # 启动服务
npm test           # 跑单测
node batch-test.mjs  # 批量测试真实 Excel 文件
```

## 注意事项

- 新增模板只需在 `templates/` 下加 JSON 文件，重启服务即生效
- `autoDetectTemplate` 通过 `headerKeyword` 定位表头行，然后按字段匹配度打分
- `parseExcel` 内有 MD5 缓存（50 条上限），同文件+同模板不重复解析
- 添加新 transform：在 `parser.js` 的 `TRANSFORMS` 对象中注册
- 前端无框架，改 `public/index.html` 后刷新浏览器即生效
