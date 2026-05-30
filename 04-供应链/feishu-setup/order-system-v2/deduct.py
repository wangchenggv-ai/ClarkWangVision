#!/usr/bin/env python3
"""
库存扣减 — 仓库人眼核对完成后调用。

用法:
  python deduct.py BATCH-20260528-143022

流程:
  1. 从飞书订单明细表读取该批次的有货订单
  2. 按 SKU+SPH+CYL 汇总扣减数量
  3. 更新飞书库存表当前库存
  4. 将该批次订单状态改为「已发货」
"""

import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def main():
    if len(sys.argv) < 2:
        print("用法: python deduct.py <批次编号>")
        print("例如: python deduct.py BATCH-20260528-143022")
        sys.exit(1)

    batch_id = sys.argv[1]
    print(f"\n  批次: {batch_id}")
    print("  正在从飞书读取该批次的有货订单…\n")

    from config import TABLES
    from modules import feishu_client as fc, feishu_sync

    detail_table = TABLES.get("order_detail", "")
    if not detail_table:
        print("  ✗ order_detail 表 ID 未配置，请在 config.py 中填入")
        sys.exit(1)

    # Read this batch's in-stock orders
    try:
        records = fc.search_records(detail_table, filter_={
            "conjunction": "and",
            "conditions": [
                {"field_name": "订单编号", "operator": "is", "value": [batch_id]},
            ],
        }, field_names=["订单编号", "产品型号", "球镜SPH", "柱镜CYL"])
    except Exception as e:
        print(f"  ✗ 读取飞书失败: {e}")
        sys.exit(1)

    if not records:
        print(f"  ✗ 批次 {batch_id} 未找到有货订单")
        sys.exit(1)

    # Reconstruct label_list from Feishu records
    label_list = []
    for rec in records:
        sph = fc.number(rec.get("球镜SPH"))
        cyl = fc.number(rec.get("柱镜CYL"))
        label_list.append({
            "product_sku": fc.text(rec.get("产品型号")),
            "sph": sph,
            "cyl": cyl,
        })

    print(f"  ✓ 读取到 {len(label_list)} 片有货订单")
    print()

    # Load inventory to get record_ids
    from modules.inventory import load_inventory
    load_inventory()

    # Confirm
    try:
        ans = input(f"  确认扣减 {len(label_list)} 片库存？[Enter=是 / n=否]: ").strip().lower()
        if ans in ("n", "no", "否"):
            print("  已取消")
            sys.exit(0)
    except (KeyboardInterrupt, EOFError):
        print()
        sys.exit(0)

    # Deduct
    updated = feishu_sync.confirm_and_deduct(label_list)
    print(f"  ✓ 库存扣减完成: {updated} 个SKU组合已更新")

    # Update order status to 已发货
    feishu_sync.update_order_status(batch_id, "已发货")
    print(f"  ✓ 批次 {batch_id} 状态已更新为「已发货」")
    print()


if __name__ == "__main__":
    main()
