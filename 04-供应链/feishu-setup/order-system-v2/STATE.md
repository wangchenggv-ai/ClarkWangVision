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
| batch_order | —— | 空 | 该 Bitable 无批次汇总表 |

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

---

## 待办 / 已知问题

- [ ] **生产 Bitable 接入**：切换 `.env` 中的 `FEISHU_APP_TOKEN` 为生产库，确认字段名一致
- [ ] **inbox 归档机制**：每批处理完后手动移走 Excel，避免重复处理（可考虑自动移到 `inbox/done/`）
- [ ] **门店→代理商反向关联**：门店表 `所属代理商` 字段是代理商名称（非 ID），如需从门店推断代理商需做名称→ID映射
- [ ] **批次汇总表**：当前无独立批次表，批次号只存在于镜片明细的`订单编号`字段
- [ ] **SKU 扩展**：当前仅支持 Ultra双效 219个度数；新产品型号需扩充本地映射或对接飞书 SKU 地址映射表

---

## 最近变更

### 2026-05-30 — 对接测试 Bitable，全流程跑通

- 对接测试 Bitable `FVusbaq2fajOHkslh9mc5H5tnXb`，12 张表全部映射
- 修复代理商 ID 格式（AG001 → AG-001）
- 修复 `batch_order` 为空时提前 return 导致 `order_detail` 跳过写入的 bug
- 修复飞书字段名对齐：批次编号→订单编号，库存状态（公式字段，不可写/过滤）
- 接入门店主数据表（202条），收货地址自动填充
- 生成操作手册、测试报告
- 测试：3 代理商 / 20 片 / 18 配货 + 2 排产，全流程通过
