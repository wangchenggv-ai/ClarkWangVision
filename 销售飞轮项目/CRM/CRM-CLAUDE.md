# CRM 系统 - 高视星

基于飞书多维表格的销售 CRM，管理代理商、终端客户、销售团队和销售目标。

## Bitable 基本信息

- **App Token**: `RlfTb6gykaEb3gsR1lwcGnShnAA`
- **App 链接**: https://gausheyetech.feishu.cn/base/RlfTb6gykaEb3gsR1lwcGnShnAA
- **读取 App**: `cli_a9492d9e44795cd6`（CRM App）
- **写入 App**: `cli_a94dfd3512f9dbd9`（供应链 App）
- **lark-cli 身份**: user

## 01-04 四张核心表（05为销售目标分解表）

### 01_代理商开发管理 (`tblWmD23R4djdAlW`)

管理潜在和已签约代理商。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 代理商名称 | fldtjfAPEo | text | 主键 |
| 代理商编号 | fldpj0lQM6 | auto_number | 自动生成 D001-Dxxx |
| 是否签约 | fldYgxVXOh | select | 是/否 |
| 省份 | fldEgpy9Pt | select | 动态选项，API不可写 |
| 签约区域 | fldZtlryC3 | text | |
| 渠道分类 | fldwxtdeLN | select | 成熟的渠道代理商/无视光经验的渠道代理商/视光经验较浅的代理商/仅自己门店/物流商/其他 |
| 代理产品 | fldFZ0m46l | select (multi) | |
| 客户所有人 | fldwFCbKXi | user (multi) | |
| 签约月份 | fldsvG7Unn | datetime | |
| 年度目标（万元） | fldxA2Zxap | number | |
| 渠道成功计划 | fld4tTBat3 | text | |
| 备注 | fldFkVD94y | text | |
| 终端客户基本信息 | fldta5DKbx | link → 02表 | 关联终端客户 |

**业务逻辑**:
- 已签约代理商 (`是否签约=是`)：正式合作伙伴，可关联终端客户
- 潜在代理商 (`是否签约=否` 或空)：在开发中

### 02_终端开发和管理 (`tblQidjfbGA8DDkJ`)

管理终端客户（医院/眼科机构），区分已开发和公海客户。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 客户名称 | fldTj1UnXD | text | 主键 |
| 客户ID | fldQIUKHmj | auto_number | 自动生成 C001-Cxxx |
| 所属代理商 | fldZsRa5v7 | link → 01表 | 已开发客户必填 |
| 客户所有人 | fldCSKSC1s | user | 销售负责人 |
| 阶段 | fldRqNBbLt | select | 意向/提单/招标谈判/已入院/已开单/已上量>10/长期关注 |
| 客户性质 | fldyKb4fPr | select | 公立医院/民营眼科医院/集团客户/视光门诊连锁 |
| 客户级别 | fldixscqQz | select | 大客户/普通客户/潜力客户 |
| 产品线 | fldclD5BNq | select (multi) | 大镜片/RGP |
| 是否已开户 | fldMQygxZf | select | 是/否 |
| 授权状态 | fldUWU52K2 | select | 已发/未发 |
| 授权到期时间 | fldJZ7rVCC | datetime | |
| 年度目标（万元） | fldNO6hrIf | number | |
| 经销商 | fldyux1Sgy | text | |
| 角塑量 | fld6MwGWlu | text | |
| 备注 | fldnnLdZ8Y | text | |
| 创建时间 | fldMNf8jGK | created_at | 系统自动 |
| 创建人 | fldnq86aul | created_by | 系统自动 |
| 省份 | flduLIPir6 | not_support | 动态选项，API不可写 |
| 城市 | fldyomN5EK | not_support | 动态选项，API不可写 |
| 客户成功计划 | fldCebnRvW | attachment | |
| 客户来源 | fldTowHlGs | select | COOC 2026/自然来客/代理商推荐/其他会议 |
| 数据状态 | fldxubBUza | select | 待审核/已确认/已废弃 |
| 所属集团 | fldzgh7NY0 | link → 02表自身 | 集团/分支机构层级关系 |
| 终端客户拜访记录 | fldPJxS27i | link | |
| 最新跟进日期 | fldolKybBu | lookup | |

**业务逻辑**:
- **已开发客户**: 阶段 ≥ 已开单，有关联的所属代理商（签约代理商）
- **公海客户**: 阶段 = 意向/提单/招标谈判 等早期阶段，无代理商归属
- **授权管理**: 授权状态=已发 + 授权到期时间，可追踪授权有效期
- **阶段流转**: 意向 → 提单 → 招标谈判 → 已入院 → 已开单 → 已上量>10
- 长期关注：用于暂时搁置但需持续跟进的客户

### 03_ECP开发和维护 (`tbl4BR4d3zDvGTQz`)

ECP（验配师）开发管理，**暂不启用**。

- 当前仅有14个占位列（列1-列14），未定义业务字段
- 未来计划与02终端客户表关联

### 04_销售团队管理 (`tblndzDKhKKhWkhn`)

权限隔离用，按销售分组。

| 字段名 | 字段ID | 类型 |
|--------|--------|------|
| 销售姓名 | fldWYghkrG | formula |
| 销售 | fldBgpiHnT | user (multi) |
| 销售leader | fldO9HYd2V | user |
| 销售区域 | fldhVnheUQ | not_support（动态选项，API不可写）|
| 父记录 | fldI3YOuQx | link |

**当前成员**: 尹建华、徐征颖、余晓玲、高珊（leader均为王成）

### 05_销售目标分解表 (`tbl5B3OuTR2CUKIn`)

按销售经理分解年度/季度销售目标。

| 字段名 | 字段ID | 类型 |
|--------|--------|------|
| 姓名 | fldtl0aESQ | text |
| 销售经理姓名 | fldXGChjCB | user |
| 年度目标(万) | fld21u3Bqv | number |
| 年度合计(万) | fld3IRZ1gv | number |
| Q1(万) ~ Q4(万) | fld3ModjK3 / fld58wCOzq / fldMKeIIBG / fld4iEkrit | number |
| 大镜片销售目标 | fldNXDOxmm | number |
| RGP销售目标 | fldaTicpE2 | number |
| OK镜销售目标 | fldX0sQrqC | number |
| 代理商开发目标 | fldi2YSWG3 | number |
| 大客户开发目标 | fldAGNgvKw | number |
| RGP开发目标 | fldKckVIpk | number |
| 完成率 | fldC0i19JC | text |

**当前团队**: 徐征颖、尹建华、余晓玲、高珊（leader: 王成）

### 06_市场会议管理 (`tblwxQYdk6nuWF8x`)

管理市场会议（大会级+子活动级两层结构），追踪会后客户转化。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 会议名称 | fldHOMmhdW | text | |
| 父会议 | fldDrVMSy3 | link → 06表自身 | 子活动关联大会，大会留空 |
| 会议日期 | fldYj7P4xP | datetime | |
| 会议类型 | fld8F9EEnE | select | 学术年会/城市推广会/卫星会/代理商培训/自办会 |
| 计划人数 | fldm9PPIss | number | |
| 实际签到数 | fld0vqtrxM | number | |
| 不重复机构数 | fldXfT0k65 | number | |
| 总房间数 | fldD3rzYy9 | number | |
| 会议总费用(万元) | fldqvJPB3j | number | |
| 会后30天出单额 | fldEABppVh | number | rule7自动回填 |
| 会议状态 | fldRJnAZmj | select | 筹备中/进行中/已完成/已复盘 |
| 负责销售 | fldStIkQlv | user (multi) | |
| 参会客户名单 | fldcQDbXnD | link → 02表 | |
| 备注 | fldDhWd2dV | text | |

**两层结构**：大会级（如COOC 2026上海）→ 子活动级（如4.9推广会/4.10 CDSA），通过"父会议"link关联。

### 07_会议签到记录 (`tblEXx10RalvFwT6`)

每场会议的扫码签到明细，通过表单收集，会后批量匹配关联到02表。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 所属会议 | fld2bAAAJG | link → 06表 | 签到对应的会议 |
| 姓名 | fldDJDTH9a | text | 签到人 |
| 手机号 | fldV3TaxQ0 | text | |
| 单位名称 | fldFDLUKzO | text | 用于匹配02表客户 |
| 参会场次 | fldMw2o04N | select | 按会议动态设置选项 |
| 邀请销售 | fld2burkq4 | select | 徐征颖/尹建华/余晓玲/高珊 |
| 感兴趣的产品线 | fldADfz2Bm | select | 大镜片/RGP/OK镜 |
| 关联客户 | fldiAqJDOD | link → 02表 | 匹配后自动填入 |
| 签到时间 | fldOAVF854 | created_at | 系统自动 |

**业务流程**：
1. 每次会议在07表上创建一个签到表单，获取分享链接生成二维码
2. 参会者扫码填写表单，数据自动写入07表
3. 会后运行 `meeting_signin_matcher.py` 批量匹配
4. 匹配到的写入"关联客户"link，未匹配的新建02表记录后link
5. 同步更新06表该会议的"参会客户名单"

**表单管理**：`+form-create` / `+form-questions-update` / `+form-get`

### 08_会议酒店房量表 (`tbl18k4MMLYMcgKB`)

酒店房间池，每场会每个酒店一条记录，实时显示各房型余量。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 酒店名称 | fldYJvt0xL | text | |
| 酒店联系人 | fldH8weAXI | text | 对接的助理姓名 |
| 酒店联系电话 | fldvfbuaP3 | text | |
| 大床房总量 | fldKF78odr | number | |
| 大床房已订 | fldnyTt1ho | number | 助理确认订房时+1 |
| 大床房剩余 | fldH0ZH84X | formula | 总量-已订 |
| 双床房总量 | fldVjae7FE | number | |
| 双床房已订 | fldI757SiU | number | |
| 双床房剩余 | fldZVezF47 | formula | 总量-已订 |
| 入住日期 | fldZPsmjn2 | datetime | |
| 退房日期 | fldjmZSLoy | datetime | |
| 备注 | flddCt6OEX | text | |
| 所属会议 | fld3jZb2Y8 | link → 06表 | 双向关联，06表自动生成"关联酒店房量" |

### 09_住宿订房记录 (`tbl9otGltI0zFZCn`)

每条记录 = 一间房的预订请求，销售提交 → 助理审核。

| 字段名 | 字段ID | 类型 | 说明 |
|--------|--------|------|------|
| 会议名称 | fld8uhAfT5 | text | 表单填写（助理确认时关联link） |
| 酒店名称 | fldrPHgBuH | text | 表单填写（助理确认时关联link） |
| 入住客户 | fldMEEz89m | text | 表单填写（助理确认时关联link） |
| 客户联系人 | fldaPdoIuF | text | 入住人姓名 |
| 手机号 | fld7w2Jzd2 | text | |
| 房型 | fldflP63HY | select | 大床房/双床房 |
| 入住日期 | fldCVTQcnW | datetime | |
| 退房日期 | fldVsQzRFl | datetime | |
| 订房销售 | fldan3Da3Q | user | 提交人 |
| 状态 | fldYuUt3NZ | select | 待确认/已确认/已取消 |
| 确认人 | fldbPzaYcj | user | 助理确认时填入 |
| 确认时间 | fldxEXetgd | datetime | |
| 备注 | fld5zhDld5 | text | 特殊需求 |
| 所属会议 | fldZGjm1DL | link → 06表 | 双向关联 |
| 关联酒店 | fldcEqhSzY | link → 08表 | 双向关联 |
| 客户名称 | fldFsICS4f | link → 02表 | 单向关联 |

**订房表单**：form-id `vew8Hz37Vu`，表单链接需在飞书UI中获取
**表单字段**：会议名称/酒店名称/入住客户/客户联系人/手机号/房型/入住日期/退房日期（8个必填）+ 备注（选填）
**业务流程**：
1. 销售扫码填表 → 写入09表（状态=待确认）
2. 助理看"待确认"视图 → 确认时手动关联所属会议/关联酒店/客户名称link字段 → 状态改为"已确认"
3. 助理手动更新08表该酒店对应房型"已订"+1

## API 限制

- **省份/城市字段**: `not_support` 类型（动态选项），无法通过 lark-cli API 写入，需手动在飞书中维护
- **link 字段写入格式**: `[{"id": "record_id"}]`（不是 `record_id`）
- **user 字段写入格式**: `[{"id": "ou_xxx"}]`

## 与其他系统的关系

- **供应链系统** (`B3xQbbqicaome1sKdZbcwdk8nWg`): 订单/库存/生产，通过 `supply-chain/sync_*.js` 同步01/02表数据
- **销售飞轮项目** (`MSqkbR21kaTO9Ys39qkcv7qzn9b`): 独立CRM，含培训/会议/商机管理
