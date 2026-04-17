# 订单系统 UI 美化方案

**日期：** 2026-04-15
**依据：** 高视星价目册设计语言提取

---

## 品牌设计规范

### Logo
- `GAUSH`（粗体） `|` `CLEAR`（细体）
- 蓝色护盾+眼睛图标（SVG inline）

### 配色系统

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色 | `#0066CC` | 深宝蓝，GAUSH 品牌蓝，按钮/链接/重点 |
| 深底色 | `#1B3A5C` | 深蓝，header 背景、大标题 |
| 强调色 | `#E6B422` | 金黄，CTA 按钮、高亮 |
| 成功色 | `#00B894` | 绿，验真通过、已签收 |
| 错误色 | `#E74C3C` | 红，验真失败、超期警告 |
| 背景色 | `#F5F7FA` | 浅灰蓝，页面底色 |
| 卡片白 | `#FFFFFF` | 卡片背景 |
| 文字深 | `#2C3E50` | 正文 |
| 文字浅 | `#7F8C8D` | 辅助文字 |

### 字体
- 中文：`"PingFang SC", "Microsoft YaHei", sans-serif`
- 英文/数字：`"Montserrat", "SF Pro Display", sans-serif`（权重 600-700）
- 等宽（镜片码/订单号）：`"SF Mono", "Menlo", monospace`

### 风格特征
- **磨砂玻璃**：`backdrop-filter: blur(12px)` header/modals
- **大圆角**：卡片 `border-radius: 16px`，按钮 `border-radius: 12px`
- **柔和阴影**：`box-shadow: 0 4px 24px rgba(0,102,204,0.08)`
- **渐变**：header 从 `#1B3A5C` 到 `#0066CC`
- **金色 CTA**：渐变 `linear-gradient(135deg, #E6B422, #F0C040)`
- **科技网格背景**：header 加 SVG 网格纹理

---

## 四个页面改造方案

### 1. common.css — 全局重写

改动点：
- 品牌主色 `#1677ff` → `#0066CC`
- Header 渐变：`#1B3A5C → #0066CC`，加磨砂玻璃
- 背景色 `#f0f2f5` → `#F5F7FA`
- 卡片圆角 10px → 16px，阴影柔和化
- 按钮圆角 → 12px，主按钮用品牌蓝
- 状态 badge 统一配色
- 新增 `.btn-gold`（金色 CTA）
- 字体栈更新
- **不改布局结构，只改颜色/圆角/阴影/字体**

### 2. order.html — 代理商下单页

改动点：
- Header 加 Logo（GAUSH|CLEAR）+ 护盾图标
- 收货信息卡片加浅蓝左色带
- 处方表单：眼别标签用品牌配色（右眼红 `#E74C3C`，左眼蓝 `#0066CC`）
- 提交按钮改为金色渐变 CTA
- 下单成功页加品牌 Logo + 验证通过动画
- 订单摘要卡片样式统一
- Excel 上传按钮品牌化

### 3. labels.html — 管理中心

改动点：
- Header：深蓝渐变 `#1B3A5C → #0066CC`，加 Logo + 磨砂玻璃
- 统计卡片：左色带用品牌色，数字用 Montserrat
- 状态圆点统一配色（待处理=金黄，生产中=品牌蓝，已发货=绿，已签收=深绿）
- 行操作按钮：统一品牌渐变（不再用杂色）
- AI 搜索区：保留紫色渐变，加磨砂玻璃背景
- 数据表格：行 hover 加浅蓝底色
- 筛选器品牌化
- 流程图配色统一

### 4. verify.html — 消费者验真页

改动点（改动最大，因为面向消费者）：
- Hero 区：品牌 Logo 大图 + 护盾图标（放大）
- 成功渐变：`#E8F5E9 → #00B894`（更鲜明的绿）
- 失败渐变：`#FDEDEC → #E74C3C`
- 卡片：加品牌蓝色带标题，磨砂玻璃效果
- 处方表：数字用 Montserrat 粗体，颜色编码
- Footer：品牌信息 + 高视高清官网链接
- 整体增加品牌感和信任感

### 5. track.html — 订单查询页

改动点：
- Header 与 order.html 统一（Logo + 品牌色）
- 统计数字用 Montserrat 粗体
- 订单卡片：品牌化阴影和圆角
- 物流卡片：品牌蓝色带
- QR 码展示区美化

---

## 实施策略

### 优先级
1. **common.css** — 一次改全局生效
2. **verify.html** — 消费者最直观，品牌感最强
3. **order.html** — 代理商每天使用
4. **track.html** — 跟随 order.html 风格
5. **labels.html** — 内部使用，最后改

### 方法
- 改 `common.css` 全局变量和基础组件
- 每个页面的 `<style>` 块只做针对性覆盖
- **不动 HTML 结构和 JS 逻辑**，只改 CSS
- verify.html 单独处理（无外部 CSS）

### 文件清单
| 文件 | 改动量 |
|------|--------|
| `public/css/common.css` | 重写配色/阴影/圆角，~100处替换 |
| `public/verify.html` | 重写 `<style>` 块，~50行 |
| `public/order.html` | 修改 `<style>` 块 + 部分 inline style，~30处 |
| `public/track.html` | 跟随 common.css，微调 ~10处 |
| `public/labels.html` | 修改 `<style>` 块 header/表格/按钮，~50处 |

---

## 效果预览

### Before → After 关键变化

| 元素 | Before | After |
|------|--------|-------|
| Header | 蓝色渐变 `#1677ff` | 深蓝渐变 `#1B3A5C→#0066CC` + Logo + 磨砂 |
| 主按钮 | 蓝色 `#1677ff` | 品牌蓝 `#0066CC` + 金色 CTA |
| 卡片 | 白色 10px 圆角 | 白色 16px 圆角 + 柔和蓝影 |
| 验真页 | 绿/红渐变 | 品牌化大 Logo + 鲜明渐变 |
| 状态色 | 通用 antd 风格 | 品牌统一色系 |
| 字体 | 系统字体 | Montserrat 数字 + PingFang 中文 |
