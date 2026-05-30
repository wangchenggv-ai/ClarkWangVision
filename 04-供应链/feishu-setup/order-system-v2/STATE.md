# Order System v2 — STATE

最后更新：2026-05-30

---

## 当前状态

**阶段：测试完成，待生产部署**

全流程已在测试 Bitable 跑通：Excel解析 → 飞书主表匹配 → 库存分流 → 写入镜片明细 → 扣减库存 → 状态更新。12项测试全部通过。

---

## 环境

| 项目 | 值 |
|------|-----|
| 运行环境 | Mac 本地 |
| Python 虚拟环境 | `.venv/`（已配置） |
| 飞书应用 | `cli_a958c5e372b85cb0` |
| 测试 Bitable | `FVusbaq2fajOHkslh9mc5H5tnXb` |
| Git 分支 | `claude/order-system-review-mAFlI` |
| 最新 commit | `2c08f1c` |

---

## 飞书表映射

| TABLES key | 表名 | 表 ID | 用途 |
|------------|------|-------|------|
| agent | 代理商表 | tblNobZtXkMJO2rj | 读：代理商 ID/名称 |
| store | 门店主数据表 | tbllokLjXN47fQxg | 读：收货地址自动填充 |
| sku_code | Ultra库存赋码 | tblb1ojrIsIOKbMx | 读：镜片码 |
| stock_detail | 度数级成品库存 | tblphzGMEp7ptXCf | 读+扣减写 |
| order_detail | 镜片明细 | tbl5EaRw6lskfHLr | 写：每片订单记录 |
| batch_order | 批次汇总 | tbl9KCmgvEE4DOp9 | 写：每批一条汇总 |
| sku_location | SKU序列号映射 | tblzrbrPFYLIc9sG | 读：219条 SKU序列号+货位（加行即扩展） |

---

## 已完成功能

- [x] 多代理商 Excel 批量解析（每眼一行 + 每人一行两种格式）
- [x] 代理商 ID 从文件名识别（AG-xxx 格式）
- [x] SKU 序列号 + 货位 + 镜片码匹配（本地 219 条 Ultra双效）
- [x] 飞书代理商表实时读取（66条）
- [x] 飞书门店主数据表实时读取（202条），收货地址自动填充
- [x] 飞书度数级库存读取 + 有货/排产分流
- [x] 配货单 labels.xlsx + 排产单 factory.xlsx + 异常记录 errors.xlsx 生成
- [x] 飞书镜片明细写入（订单状态初始为「已入单」）
- [x] 库存扣减 deduct.py（按批次号操作，确认后执行）
- [x] 订单状态流转「已入单」→「已发货」
- [x] 操作手册 + 测试报告
- [x] inbox 自动归档（sync 成功后移到 `inbox/done/YYYY-MM-DD/`，子目录不被重复扫描）
- [x] 门店→代理商名称反查（门店表「所属代理商」名称 → ID，enrich 自动反推 agent_id）
- [x] 批次汇总表（飞书 `批次汇总` 表，每批一条；幂等建表脚本 `setup_tables.py`）
- [x] SKU 序列号映射迁飞书（219条入 `SKU序列号映射` 表，加行即扩展，无需改代码）

---

## 待办 / 已知问题

- [ ] **生产 Bitable 接入**：切换 `.env` 中的 `FEISHU_APP_TOKEN` 为生产库，确认字段名一致；切库后重跑 `python setup_tables.py` 在生产库建批次/SKU两张表并填回 config
- [ ] **SKU 度数补全**：当前覆盖 Ultra双效 219 个度数，超出范围（如 -7.50/-8.00）会进排产；需要时直接往飞书 `SKU序列号映射` 表加行即可（无需改代码）

---

## 最近变更

### 2026-05-30 — 完成4项待办（归档 / 门店反查 / 批次表 / SKU迁移）

- inbox 归档：`intake.archive_processed`，main 在 sync 成功后移走已处理 Excel → `inbox/done/日期/`
- 门店→代理商反查：新增 `matcher._agent_name_to_code` 索引，门店表「所属代理商」名称→ID，enrich 反推 agent_id（本地+飞书 agent 都建索引）
- 批次汇总表：测试库新建 `批次汇总`(tbl9KCmgvEE4DOp9)，sync 每批写一条；新增幂等建表脚本 `setup_tables.py`（切生产改 .env 重跑即可）
- SKU 迁飞书：219条 Ultra双效 → `SKU序列号映射`(tblzrbrPFYLIc9sG)，config 启用 sku_location；以后加度数/新品在表里加行即可
- 修 `feishu_client.list_records` 空表 `items:null` 崩溃；补 `create_table` / `list_tables` / `delete_record`
- 验证：单测归档+门店反查通过；飞书读回 219 条；批次表写入读回删除通过；`--no-sync` 端到端 16 片解析 / 14 匹配 / 9 配货 7 排产

### 2026-05-30 — 对接测试 Bitable，全流程跑通

- 对接测试 Bitable `FVusbaq2fajOHkslh9mc5H5tnXb`，12 张表全部映射
- 修复代理商 ID 格式（AG001 → AG-001）
- 修复 `batch_order` 为空时提前 return 导致 `order_detail` 跳过写入的 bug
- 修复飞书字段名对齐：批次编号→订单编号，库存状态（公式字段，不可写/过滤）
- 接入门店主数据表（202条），收货地址自动填充
- 生成操作手册、测试报告
- 测试：3 代理商 / 20 片 / 18 配货 + 2 排产，全流程通过
