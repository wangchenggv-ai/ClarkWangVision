# 大镜片周会分析器

每周二上午9-10点供应链周会，分析大镜片交付情况，目标：准时交付率≥95%。

## 项目结构

```
lens-weekly-analyzer/
├── CLAUDE.md              ← 本文件
├── weeklyReports/         ← 每周分析报告
│   ├── TEMPLATE.md        ← 报告模板
│   ├── 2026-W15_0414.md   ← 4.14期报告
│   └── 2026-W16_0421.md   ← 4.21期报告
```

## 数据源

### 飞书周会文档
- URL：`https://gausheyetech.feishu.cn/docx/LxaCdItHIo8nQlxv8X6cKE2Yn5p`
- 格式：`# 月份` → `## 日期` → `### 1 本周订单情况` / `### 2 上周交付情况` / `### 3 客诉情况` / `### 4 延期情况`
- 包含文字摘要 + Bitable 截图

### Bitable 订单主表
- Bitable Token：`QrY0bFlW2abXjKsLYFtcBznkn1G`（销售订单2026）
- Table ID：`tblc9uHyRzrc6vu1`
- 总记录：约8000条
- 关键字段：

| 字段名 | field_id | 说明 |
|--------|----------|------|
| 姓名 | `fldXiKU0z9` | 客户名 |
| 接单日期 | `fldwGLayRo` | 下单时间 |
| 发货日期 | `fldsVvoArZ` | 实际发货 |
| 是否装配 | `fldnSPQ1uk` | ["装配"] / ["不装配"] |
| 是否加急 | `fldDtrztEv` | 加急/普通 |
| 订单状态 | `fld8TINCxM` | ["已签收"] / 其他 |
| 产品名称 | `fldDqC6xeC` | 产品 |
| 超期原因 | `fldcukHQ4w` | 文本 |
| 交期统计 | `fld9dpEfsK` | 交付天数 |
| 客户需求日期 | `fldRq9V6rM` | 客户期望日 |
| 数量/副 | `fldEVUSqe2` | 订单数量 |

## 业务规则

- 装配订单超期：接单→发货 > 7天
- 不装配订单超期：接单→发货 > 5天
- 目标交付率：95%
- 快超期预警：装配≥5天 / 不装配≥3天未发货
- 周会文档结构：`lark-lens-weekly` skill（位于 `~/.claude/skills/lark-lens-weekly/SKILL.md`）

## 常用操作

```bash
# 读取周会文档
lark-cli docs +fetch --doc "https://gausheyetech.feishu.cn/docx/LxaCdItHIo8nQlxv8X6cKE2Yn5p"

# 下载截图
lark-cli docs +media-download --token "<image_token>" --output "/tmp/lens_xxx.png" --overwrite

# 查询 Bitable（用 jq 动态映射字段）
lark-cli base +record-list \
  --base-token "QrY0bFlW2abXjKsLYFtcBznkn1G" \
  --table-id "tblc9uHyRzrc6vu1" \
  --limit 200 --offset <offset> \
  --jq '.data.field_id_list as $ids | [.data.data[] | {
    name: .[$ids|index("fldXiKU0z9")],
    order_date: .[$ids|index("fldwGLayRo")],
    ship_date: .[$ids|index("fldsVvoArZ")],
    assembly: .[$ids|index("fldnSPQ1uk")],
    status: .[$ids|index("fld8TINCxM")],
    qty: .[$ids|index("fldEVUSqe2")]
  }]'
```

## 工作流

1. 用户发周会文档 URL → 触发 `lark-lens-weekly` skill
2. 按 SKILL.md 的5步流程执行（文档解析→截图下载→OCR→Bitable拉取→交叉验证）
3. 输出报告保存到 `weeklyReports/YYYY-WXX_MMDD.md`

## 注意事项

- Bitable 约8000条记录需分页，2026年4月数据在 offset 7600-8000
- jq 不支持中文变量名，用英文别名
- 文档中的 `### 3 客诉情况`、待交付看板基本都是截图，必须 OCR 识别
- 截图 token 需在文档 markdown 中定位最新一期的 image 标签
- 产品名格式：代号 + A/B（A=右眼，B=左眼），同一客户常有A和B两行
- 表格颜色含义：红色=超期，黄色=快超期，绿色=正常
- 每期报告要和上期做环比，趋势列用 ↑/→/↓
