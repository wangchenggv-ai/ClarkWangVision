# 订单交付系统 — 架构说明

**最后更新：** 2026-04-14

---

## 一、E2E 全链路

完整一笔订单从下单到签收的 8 步流程：

```
步骤  角色                    服务端                          Bitable
────  ────                    ──────                          ───────
 ①   代理商/Excel导入 ──→    POST /api/submit
                                ├→ 生成订单号 ORD-XXXX
                                ├→ 写订单主表 (一单一条，状态=待处理)
                                ├→ 写镜片明细表 (一眼一条，生成16位HEX镜片码)
                                ├→ QR图片 → public/qrcodes/
                                └→ 库存如有货则扣减

 ②   助理 管理页确认 ──→     POST /api/admin/confirm
                                ├→ 镜片码如已生成则跳过（幂等）
                                └→ 状态：待处理 → 生产中

 ③   助理 管理页发货 ──→     POST /api/admin/ship
                                ├→ 自动生成快递单号
                                ├→ 写入物流公司/快递单号/发货时间
                                ├→ 状态：生产中 → 已发货
                                └→ 飞书发货卡片

 ④   助理 批量导出ZIP ──→    GET /api/admin/batch-zip
                                ├→ 多订单合并为一个ZIP
                                ├→ 每单子目录含 Excel + QR + 标签
                                └→ 发给工厂生产

 ⑤   工厂生产完成 ────→     物流随货通行单 (logistics.js slip-batch)
                                ├→ 读订单主表(物流信息)
                                ├→ 读镜片明细表(处方+镜片码)
                                └→ 生成A4 HTML随货通行单

 ⑥   助理 管理页签收 ──→     POST /api/admin/deliver
                                ├→ 状态：已发货 → 已签收
                                └→ 飞书签收卡片

 ⑦   助理 打印标签 ────→     管理页 labels.html
                                ├→ 选中订单 → 预览标签 → 打印
                                └→ 80mm×50mm 专业标签（红/蓝眼别色带）

 ⑧   消费者扫码验真 ────→    GET /verify/:lensCode
                                ├→ 镜片码 → 镜片明细表
                                ├→ 订单编号 → 订单主表
                                └→ 显示验真结果+处方信息
```

**状态流转：** `待处理 → 生产中 → 已发货 → 已签收`

---

## 二、系统全景

```
代理商浏览器                      服务端 (server.js)                飞书 Bitable
─────────────                  ──────────────────               ────────────
  order.html ──POST /api/submit──→ 写入订单主表 (一单一条)
                                   写入镜片明细表 (一眼一条)
                                   生成镜片码 + QR
                                   扣减库存(如有货)

  Excel文件 ──POST /api/excel-parse→ MiMo解析 → 返回patients[]
                ↓ 导入表单
              POST /api/submit (同上)

助理管理页 (labels.html)          服务端 API                      飞书 IM 通知
─────────────────────           ────────────                    ──────────
  确认订单 ──→ POST /api/admin/confirm → 状态→生产中
  确认发货 ──→ POST /api/admin/ship    → 状态→已发货 + 快递单号 → 发货卡片
  标记签收 ──→ POST /api/admin/deliver → 状态→已签收            → 签收卡片
  导出ZIP  ──→ GET /api/admin/batch-zip → 多订单合并ZIP
  标签打印 ──→ GET /api/admin/labels/batch → 80×50mm专业标签
```

---

## 三、数据模型

### 两张核心表

**订单主表** (`tblk9Ch4gk2uQ1zG`) — 一单一条

| 字段 | 类型 | 说明 |
|------|------|------|
| 订单编号 | 文本(主键) | `ORD-YYYYMMDD-XXXXXX`，下单时自动生成 |
| 终端客户 | 文本 | 终端客户机构名称 |
| 客户ID | 文本 | 终端客户在Bitable中的ID |
| 下单日期 | 日期时间 | 下单时间戳 |
| 顾客姓名 | 文本 | 配镜顾客 |
| 产品型号 | 文本 | SKU名称 |
| 数量 | 数字 | 镜片数量（片） |
| 是否装配 | 单选 | "是" / "否" |
| 代理商名称 | 单选 | 代理商全称 |
| 代理商ID | 文本 | `AG-XXX` |
| 备注 | 文本 | 每个顾客的特殊要求 |
| 收货地址 | 文本 | 终端客户收货地址 |
| 联系人 | 文本 | 收货联系人 |
| 联系电话 | 电话 | 联系电话 |
| 镜片码 | 文本 | 该订单的镜片码汇总 |
| 订单状态 | 单选 | 待处理→生产中→已发货→已签收 |
| 预计交期 | 日期时间 | 系统估算的交货日期 |
| 订单来源 | 单选 | "代理商门户" |
| 物流公司 | 文本 | 顺丰/中通/韵达 |
| 快递单号 | 文本 | 物流单号 |
| 发货时间 | 日期时间 | 发货时间戳 |
| 签收时间 | 日期时间 | 签收时间戳 |
| 物流状态 | 单选 | 待处理/已发货/运输中/已签收 |

**镜片明细表** (`tblC7pve7ObFgIOl`) — 一眼一条

| 字段 | 类型 | 说明 |
|------|------|------|
| 镜片码(唯一) | 文本 | 16位HEX，唯一标识 |
| 订单编号 | 文本 | 关联订单主表的订单编号 |
| 镜片码 | 文本 | 与"镜片码(唯一)"相同 |
| 顾客姓名 | 文本 | 配镜顾客 |
| 产品型号 | 文本 | SKU |
| 眼别 | 单选 | "右眼" / "左眼" |
| 球镜SPH | 数字 | 处方球镜 |
| 柱镜CYL | 数字 | 处方柱镜 |
| 轴位AXIS | 数字 | 处方轴位 |
| 是否装配 | 单选 | "是" / "否" |
| 代理商名称 | 文本 | |
| 代理商ID | 文本 | |
| 订单状态 | 单选 | 与主表同步 |

### 编号规则

| 编号 | 格式 | 示例 | 生成时机 | 说明 |
|------|------|------|----------|------|
| 订单编号 | `ORD-YYYYMMDD-XXXXXX` | `ORD-20260414-36C98F` | 下单时 | 日期 + 6位随机hex |
| 镜片码 | 16位大写HEX | `1A2B3C4D5E6F7890` | 下单时 | `randomBytes(8)`，每片全球唯一 |
| 代理商ID | `AG-XXX` | `AG-028` | CRM同步签约时 | 与CRM的D001-D045编号对应 |
| 客户ID | `CUS-YYYYMMDD-XXXX` | `CUS-20260414-A3F2` | 终端客户同步时 | 日期 + 4位随机hex |
| 快递单号 | `{前缀}{12位数字}` | `SF359050767297` | 发货时 | 前缀: SF顺丰/75中通/YD韵达/JD京东 |

**唯一性保证：**
- 订单编号：日期+hex，碰撞概率极低，无数据库级校验
- 镜片码：128位随机空间（2^64），碰撞概率可忽略
- 客户ID：日期+hex，同日内碰撞概率极低

### 辅助表（只读引用）

| 表 | Table ID | 用途 |
|----|----------|------|
| 代理商表 | `tblHsgGbJWkB31qu` | 代理商认证（ID、名称、Token） |
| 终端客户表 | `tbltXNNhF65EBl17` | CRM同步的客户数据 |
| SKU主数据 | `tblwQsvGAahoeoJV` | 产品目录+库存 |
| 成品库存 | `tblUF49B6i53MV2O` | 库存数量 |

---

## 三、模块划分

### 3.1 下单模块 (`server.js` — POST /api/submit)

```
前端表单(order.html) 或 Excel导入结果
  ↓ 提交 { token, terminalCustomer, patients[] }
  ↓
验证代理商token + 必填字段
  ↓
生成订单号 ORD-YYYYMMDD-XXXXXX
  ↓
┌─ 订单主表：每个patient写1行
│  字段：订单编号、顾客姓名、产品型号、数量、是否装配、
│        终端客户、联系人、联系电话、收货地址、代理商、备注
│
├─ 镜片明细表：每个patient的每只眼写1行
│  字段：订单编号、顾客姓名、产品型号、眼别、SPH、CYL、AXIS、
│        是否装配、代理商
│
├─ 生成镜片码：每片16位HEX → 写入镜片明细表
│  → QR码图片保存到 public/qrcodes/
│
└─ 库存扣减：如有货，扣减成品库存表
```

**关联：** 读取代理商表(认证)、SKU表(校验)、库存表(扣减)

---

### 3.2 查询模块 (`server.js` — GET /api/orders, /api/order/:no)

- `/api/orders?t=token` — 订单列表（从订单主表读，按状态/日期筛选）
- `/api/order/:no?t=token` — 订单详情（主表+镜片明细表联合）

**关联：** 通过 `订单编号` 字段关联两张表

---

### 3.3 验真模块 (`server.js` — GET /verify/:lensCode)

**公开访问，无需登录。**

```
消费者扫码 → GET /verify/ABCDEF1234567890
  ↓
在镜片明细表中查找镜片码
  ↓
找到 → 通过订单编号查订单主表获取基本信息
  ↓
从镜片明细表获取眼别/SPH/CYL → 渲染验真页面
```

**关联：** 镜片码 → 镜片明细表 → 订单编号 → 订单主表

---

### 3.4 物流模块 (Web API + CLI 双入口)

**Web API（助理操作，无需命令行）：**

| 端点 | 功能 | 说明 |
|------|------|------|
| `POST /api/admin/confirm` | 确认订单 | 批量确认，状态→生产中，生成镜片码 |
| `POST /api/admin/ship` | 发货 | 批量发货，自动生成快递单号，状态→已发货 |
| `POST /api/admin/deliver` | 签收 | 批量签收，状态→已签收 |

**CLI 工具（备用）：**

| 命令 | 说明 |
|------|------|
| `node logistics.js ship` | 逐单发货 |
| `node logistics.js ship-batch` | 合单发货（按代理商合并） |
| `node logistics.js deliver --order ORD-xxx` | 签收 |
| `node logistics.js slip --order ORD-xxx` | 单订单通行单 |
| `node logistics.js slip-batch` | 合单通行单 |
| `node logistics.js status` | 物流汇总 |
| `node logistics.js webhook` | 快递回调服务(端口 3211) |

**状态流转：** `待处理 → 生产中 → 已发货 → 已签收`

**合单逻辑：** 同一代理商的多笔订单共用一个快递单号

**关联：** 按 `订单编号` 从主表找到物流信息，再用同一编号查明细表获取处方

---

### 3.5 工厂导出模块 (单订单 + 批量导出)

**单订单导出** (`GET /api/order/:no/factory-zip`)：
```
按订单编号查镜片明细表
  ↓
生成 Excel (每行一眼，含SPH/CYL/AXIS/镜片码)
  ↓
生成标签 HTML (80×50mm，红/蓝眼别色带)
  ↓
打包 ZIP 下载
```

**批量导出** (`GET /api/admin/batch-zip?orderNos=X,Y,Z`)：
```
多订单合并为一个 ZIP
  ↓
每单一个子目录：订单号/Excel + qrcodes/ + labels/
  ↓
附带说明.txt
```

**关联：** 只读镜片明细表

---

### 3.6 标签打印模块 (`server.js` + `labels.html`)

**标签设计** — 80mm × 50mm 专业眼镜行业标签：

```
┌──────────────────────────────────────────────┐
│ ██ R  右眼 ██           GAUSH | CLEAR        │ ← 顶部色带（右红左蓝）
│                            ORD-2026...       │
├──────────────────────────────────────────────┤
│                                              │
│  张明辉              Ultra双效               │ ← 顾客 + SKU
│  ────────────────────────────────────        │
│  SPH      CYL      AXIS                     │ ← 处方参数网格
│  -2.75    -1.00     90                      │    （粗体高亮）
│                                              │
│  渠道: AG-028                         [QR]  │ ← 渠道 + 验真码
│                                         扫码验真│
├──────────────────────────────────────────────┤
│ 1A2B3C4D5E6F7890            深圳视力康      │ ← 镜片码 + 代理商
└──────────────────────────────────────────────┘
```

**三种生成方式：**

| 方式 | 入口 | 说明 |
|------|------|------|
| 工厂ZIP内嵌 | `GET /api/order/:no/factory-zip` | 每个ZIP包含该订单所有标签 |
| 管理页批量 | `labels.html` → 选订单 → 预览/打印 | 一页6张（A4），直接浏览器打印 |
| API批量 | `GET /api/admin/labels/batch?orderNos=X,Y` | 返回HTML，供iframe预览 |

**关联：** 从镜片明细表读眼别/SPH/CYL/AXIS/镜片码/代理商

---

### 3.7 Excel 解析模块 (`server.js` — POST /api/excel-parse)

**用途：** 代理商上传医院处方 Excel → AI 自动提取患者+处方 → 填入下单表单

```
代理商上传 Excel (.xlsx/.xls)
  ↓
XLSX 解析 → 原始行数据（前50行）
  ↓
MiMo 大模型 (mimo-v2-pro) → 提取结构化处方 JSON
  ↓
后处理：SKU 校验 + 数值归一化（SPH 0.25步长、AXIS 0-180）
  ↓
返回 patients[] + warnings[]
  ↓
前端弹窗预览 → "导入表单" → 自动填充患者卡片
```

**技术栈：**
- LLM：小米 MiMo mimo-v2-pro（OpenAI 兼容格式，`ENV.MIMO_API_URL` + `ENV.MIMO_API_KEY`）
- Excel 解析：已安装的 `xlsx` 库
- 文件传输：Base64 编码在 JSON body 中（无 multipart，零新依赖）

**关联：** 读取 SKU 表(`getSkusWithInventory` + `getModelSkus`) 用于 SKU 校验

---

### 3.8 通知模块 (`server.js` webhook + `logistics.js` notify)

- **下单通知：** POST /api/submit 成功后，通过飞书Webhook发卡片
- **发货通知：** ship/ship-batch 后，通过飞书IM API发私信卡片
- **签收通知：** deliver/webhook 后，发绿色签收卡片

---

## 四、模块间关联图

```
              Excel 上传
                ↓
          Excel解析模块 ──导入表单──→ 下单模块 ──→ 订单主表 ──→ 物流模块(状态写入)
          (MiMo mimo-v2-pro)                    │  镜片明细表 ← 生成镜片码+QR
                                                │       │
                                                │       │ 订单编号(关联)
                                                │       ↓
                                        批量导出模块   标签打印模块
                                        (batch-zip)  (80×50mm专业标签)
                                                │       │
                                                ↓       ↓
                                            工厂生产  管理员打印
                                                │
                                                ↓
                                           物流模块(ship/deliver)
                                                │
                                                ↓
                                           飞书通知(发货/签收)
                                                │
                                                ↓
                                           验真模块(消费者扫码)
```

**核心关联字段：**
- 订单主表 ↔ 镜片明细表：通过 `订单编号`
- 镜片明细表 → 消费者：通过 `镜片码`(16位HEX + QR)

---

## 五、管理页 (`/labels?admin=xxx`)

助理日常操作入口，所有物流操作在浏览器完成，无需命令行。

| 功能 | 操作 | 说明 |
|------|------|------|
| 查看订单 | 打开页面自动加载 | 按状态/代理商/日期筛选 |
| 确认订单 | 勾选 → 点「确认订单」 | 状态→生产中，生成镜片码 |
| 导出工厂包 | 勾选 → 点「导出ZIP」 | 多订单合并为一个ZIP下载 |
| 确认发货 | 勾选 → 点「确认发货」 | 自动生成快递单号，状态→已发货 |
| 预览标签 | 勾选 → 点「预览标签」 | iframe渲染专业标签 |
| 打印标签 | 勾选 → 点「打印」 | 浏览器直接打印A4标签页 |
| 标记签收 | 勾选 → 点「标记签收」 | 状态→已签收 |

---

## 六、CLI 工具清单

```bash
# 启动门户
node server.js                    # 端口 3210

# 物流操作（CLI版，Web管理页已替代大部分功能）
node logistics.js ship            # 逐单发货
node logistics.js ship-batch      # 合单发货(按代理商合并)
node logistics.js deliver --order ORD-xxx  # 签收
node logistics.js slip --order ORD-xxx     # 单订单通行单
node logistics.js slip-batch      # 合单通行单
node logistics.js status          # 物流汇总
node logistics.js webhook         # 快递回调服务(端口 3211)

# 标签打印（CLI版）
node print_labels.js              # 生成标签 + A4批量打印页

# 迁移/初始化
node migrate_split_tables.js      # 镜片明细表创建
node migrate_tables.js            # Bitable字段迁移
node setup_tables.js              # 表结构初始化
node import_real_skus.js          # 导入SKU数据
```

---

## 七、环境依赖

```
shared/.env          飞书应用凭证 + MiMo API + 管理员Token
node_modules/        qrcode, xlsx, http(内置)
```

两表共享同一个飞书多维表格 App Token (`B3xQbbqicaome1sKdZbcwdk8nWg`)，通过 `FEISHU_APP_ID` + `FEISHU_APP_SECRET` 获取 tenant_access_token。

### 环境变量清单

| 变量 | 用途 |
|------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书多维表格读写 |
| `NOTIFY_APP_ID` / `NOTIFY_APP_SECRET` / `NOTIFY_CHAT_ID` | 飞书通知 |
| `MIMO_API_URL` / `MIMO_API_KEY` | MiMo大模型（Excel解析） |
| `ADMIN_TOKEN` | 管理页访问密码 |
| `SERVER_BASE_URL` | 服务器外网地址（QR验真链接用） |
