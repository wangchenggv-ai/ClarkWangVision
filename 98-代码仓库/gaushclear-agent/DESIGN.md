# gaushclear.com 网站内容替换 Agent — 设计文档

**版本:** v1.0
**日期:** 2026-05-06
**状态:** 设计中

---

## 目标

让同事通过飞书 Bot 直接对 gaushclear.com 官网执行文字和图片替换，无需王成手动操作。

---

## 整体流程

```
同事（飞书群） → 发命令消息 → Agent 轮询读取 → 解析命令 → 执行替换 → SCP 部署 → 群内反馈
```

---

## 架构概览

```
gaushclear-agent/
├── agent.py              # 主入口：飞书消息轮询 + 命令调度
├── replacer.py           # 替换引擎：文本锚点替换 + 图片 src 替换 + 图片文件管理
├── deployer.py           # 部署模块：SCP 增量上传 + 验证
├── config.py             # 配置：飞书群ID、密钥路径、服务器信息
├── commands.md           # 同事操作指南（命令格式参考）
├── backups/              # 自动备份目录
└── requirements.txt      # Python 依赖
```

---

## 模块设计

### 1. agent.py — 飞书 Bot 接口

**职责：** 轮询飞书群消息，解析命令，调度替换和部署。

**工作流：**
1. 每 30 秒通过 `lark-cli im +chat-messages-list` 拉取指定群的最近消息
2. 维护已处理消息 ID 集合（避免重复执行）
3. 识别以 `改` 开头的命令消息
4. 对于包含图片附件的消息，下载图片到临时目录
5. 调用 `replacer.replace(command)` 执行替换
6. 调用 `deployer.upload(changed_files)` 上传至 ECS
7. 通过 `lark-cli im +messages-reply` 回复执行结果

**安全措施：**
- 只处理来自指定群的消息
- 维护白名单（允许的发送者）
- 高风险改动（如首页标题）要求回复"确认"后才执行

### 2. replacer.py — 替换引擎

**职责：** 在本地网站副本上执行文字和图片替换。

#### 文字替换

支持三种定位方式：

| 方式 | 示例命令 | 实现 |
|------|---------|------|
| 锚点文本精确匹配 | `改 ultra.html 建议零售价 ¥4,980 为 ¥5,280` | 在 HTML 中搜索 `¥4,980`，替换为 `¥5,280` |
| 标签匹配 | `改 首页 slogan-en 为 "New Slogan"` | 查找 `class="slogan-en"` 所在元素，替换其文本内容 |
| 段落序号匹配 | `改 ultra.html 产品描述 为 "新描述..."` | 匹配 `.product-hero > p` 中的描述文字 |

**实现策略（MVP）：**
初始版本采用最稳健的 **锚点文本精确匹配**：同事必须在命令中提供「原文 → 新文」的完整对应，Agent 在指定 HTML 文件中做 `str.replace(old, new)`。

为什么不做智能语义匹配？因为：
- HTML 结构可能因手动编辑而变化
- 语义匹配有歧义（"产品描述"可能匹配到多处）
- 锚点替换可验证性强（替换后 grep 确认）

后续可扩展标签匹配模式，通过维护一个 `labels.json` 映射表：
```json
{
  "ultra.html": {
    "产品描述": ".product-hero p",
    "价格": ".price-value",
    "适应人群": ".indication-grid"
  }
}
```

#### 图片替换

**流程：**
1. 同事在飞书消息中上传新图片
2. Agent 通过 `lark-cli im +messages-resources-download` 下载原始图片
3. 运行 Pillow 压缩（宽度 ≤ 1920px，质量 85%，转 JPEG）
4. 按命名规范重命名，放入 `images/` 对应子目录
5. 在 HTML 中替换对应 `<img src="...">` 的路径
6. 旧图片自动备份到 `backups/`

**图片命名规范（必须遵守）：**
- Hero 轮播: `images/hero/hero-{1,2,3}-{desc}.jpg`
- 产品卡片: `images/products/{product}-card.jpg`
- 产品详情: `images/products/{product}-{feature}.jpg`
- 团队照: `images/team/{name}.jpg`

**支持的图片替换命令：**
```
改 首页 轮播图1 为 [上传的图片]
改 ultra.html 产品主图 为 [上传的图片]
改 ultra.html 第2节图 为 [上传的图片]
```

### 3. deployer.py — 部署模块

**职责：** 将修改后的文件上传至 ECS。

**部署信息：**
- 服务器: `113.44.177.107`
- 密钥: `C:\Users\wangc\Downloads\001-MyCode\key\web-invite.pem`
- Web 根目录: `/var/www/gaushclear/`

**流程：**
1. 收集变更文件列表（替换引擎返回）
2. `scp -i <key> <file> root@113.44.177.107:/var/www/gaushclear/<path>`
3. `curl -s -o /dev/null -w "%{http_code}" https://gaushclear.com/<page>` 验证 HTTP 200
4. 验证通过 → 返回成功；失败 → 回滚备份

**增量部署：**
只上传变更的文件，不上传整个网站目录，避免不必要的传输。

---

## 命令格式规范

### 基本格式

```
改 [页面] [目标] 为 [新内容]
```

### 页面标识符

| 标识符 | 对应文件 |
|--------|---------|
| `首页` / `index` | `index.html` |
| `ultra` | `products/ultra.html` |
| `star-eye` / `时空之眼` | `products/star-eye.html` |
| `tornado` / `小旋风` | `products/tornado.html` |
| `ok7` | `products/ok7.html` |
| `rgp-kids` / `儿童RGP` | `products/rgp-kids.html` |
| `rgp-adult` / `成人RGP` | `products/rgp-adult.html` |
| `rgp-multi` / `多焦点RGP` | `products/rgp-multi.html` |
| `ok7-star` / `OK7星悦` | `products/ok7-star.html` |
| `ok7-youmou` / `OK7悠眸` | `products/ok7-youmou.html` |

### 完整命令示例

**文本替换：**
```
改 首页 hero标语 为 "Seeing Beyond Today's Vision."
改 ultra.html 产品描述 为 "融合动态离焦与降低对比度技术，双重管控近视进展"
改 ok7.html 价格 ¥4,980 为 ¥5,280
改 首页 联系方式标题 为 "预约咨询"
```

**图片替换：**
```
改 首页 轮播图2 为 [上传新的hero背景图]
改 ultra.html 产品主图 为 [上传新主图]
改 首页 团队照 clark-wang 为 [上传新头像]
```

---

## 操作范围（硬约束）

**只允许操作以下文件：**
- `index.html`
- `products/ultra.html`
- `products/star-eye.html`
- `products/tornado.html`
- `products/ok7.html`
- `products/rgp-kids.html`
- `products/rgp-adult.html`
- `products/rgp-multi.html`
- `products/ok7-star.html`
- `products/ok7-youmou.html`
- `images/` 目录内的图片文件

**禁止操作：**
- `css/style.css`（样式）
- `js/main.js`（脚本）
- 新增 HTML 文件或修改页面结构
- 删除任何文件

---

## 安全设计

| 层级 | 措施 |
|------|------|
| 范围锁定 | 白名单制，只允许操作 10 个已知 HTML 文件 + `images/` 目录 |
| 操作限制 | 只做替换，不新增/删除页面或结构 |
| 自动备份 | 每次修改前将原文件复制到 `backups/` 目录（带时间戳） |
| 预览确认 | 高风险改动（首页标题、价格等）返回 diff 预览，等同事回复"确认"后执行 |
| 发送者白名单 | 只响应白名单内同事的命令 |
| HTTPS 验证 | 部署后 `curl` 验证页面状态码 200 |
| 回滚机制 | 验证失败自动从 `backups/` 恢复 |

---

## 运行方式

```bash
# 启动 Agent（前台运行）
python agent.py

# 后台运行（Windows）
start /B python agent.py

# 单次手动运行（处理一次后退出）
python agent.py --once
```

Agent 启动后持续运行，每 30 秒轮询一次飞书群消息。

---

## 依赖

```
requests>=2.28
Pillow>=9.0
```

飞书通信通过系统已安装的 `lark-cli` 命令行工具（`--as bot` 身份），不另接 SDK。

---

## 后续扩展

| 阶段 | 内容 |
|------|------|
| MVP | 文本锚点替换 + 图片替换 + 手动触发部署 |
| v1.1 | 标签映射表（labels.json），支持 `改 ultra.html 价格 为...` 等语义命令 |
| v1.2 | 飞书卡片消息交互（按钮确认替换预览） |
| v2.0 | 接飞书文档自动读取变更清单，批量执行 |
