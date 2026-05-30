"""
Phase 2: Write pipeline results back to Feishu Bitable.

Tables written:
  batch_order   — one record per pipeline run            (批次表)
  order_detail  — one record per lens, all metadata      (订单明细表)

Inventory deduction is a separate, explicit step called after physical
pickup is confirmed (人眼核对).

Usage from main.py:
  batch_id = feishu_sync.sync_to_feishu(enriched, label_list, factory_list)
  # ... warehouse picks, human checks ...
  feishu_sync.confirm_and_deduct(label_list)
"""

import logging
from collections import Counter
from datetime import date, datetime
from config import TABLES
from modules import feishu_client as fc

log = logging.getLogger(__name__)


def _batch_id() -> str:
    return f"BATCH-{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def sync_to_feishu(
    enriched: list[dict],
    label_list: list[dict],
    factory_list: list[dict],
) -> str | None:
    """
    Write a batch header record + all order detail rows to Feishu.
    Returns batch_id string on success, None if batch table write fails.
    """
    batch_id = _batch_id()

    # ── 1. 批次表 ─────────────────────────────────────────────────────────────
    batch_table = TABLES.get("batch_order", "")
    if not batch_table:
        log.warning("batch_order 表 ID 未配置，跳过批次表写入")
    else:
        try:
            fc.create_record(batch_table, {
                "批次编号":  batch_id,
                "处理日期":  date.today().isoformat(),
                "总片数":    len(enriched),
                "有货片数":  len(label_list),
                "排产片数":  len(factory_list),
                "状态":      "已入单",
            })
            log.info("批次记录已写入飞书: %s", batch_id)
        except Exception as e:
            log.error("写入批次表失败: %s", e)
            return None

    # ── 2. 订单明细表 ─────────────────────────────────────────────────────────
    detail_table = TABLES.get("order_detail", "")
    if not detail_table:
        log.warning("order_detail 表 ID 未配置，跳过明细写入（建表后在 config.py 填入 ID）")
        return batch_id

    rows = []
    for rec in enriched:
        sph = rec.get("sph")
        cyl = rec.get("cyl")
        row: dict = {
            "订单编号":      batch_id,
            "顾客姓名":      rec.get("customer_name", ""),
            "产品型号":      rec.get("product_sku", ""),
            "眼别":          rec.get("eye", ""),
            "球镜SPH":       sph,
            "柱镜CYL":       cyl,
            "轴位AXIS":      rec.get("axis"),
            "代理商名称":    rec.get("agent_name", ""),
            "代理商ID":      rec.get("agent_id", ""),
            "SKU":           rec.get("serial_no", ""),
            "订单状态":      "已入单",
            "接单日期":      date.today().isoformat(),
        }
        lens_code = rec.get("lens_code", "")
        if lens_code:
            row["镜片码（唯一）"] = lens_code
        rows.append(row)

    try:
        count = fc.batch_create(detail_table, rows)
        log.info("订单明细 %d 行已写入飞书", count)
    except Exception as e:
        log.error("写入订单明细失败: %s", e)

    return batch_id


def confirm_and_deduct(label_list: list[dict]) -> int:
    """
    Deduct inventory in Feishu after physical pickup is confirmed (人眼核对后调用).
    Returns number of SKU combinations successfully updated.
    """
    from modules.inventory import _stock_index

    # Aggregate how many of each (sku, sph, cyl) to deduct
    deductions: Counter = Counter()
    for rec in label_list:
        sku = rec.get("product_sku", "")
        sph = rec.get("sph")
        cyl = rec.get("cyl")
        if sku and sph is not None and cyl is not None:
            deductions[(sku, f"{sph:.2f}", f"{cyl:.2f}")] += 1

    stock_table = TABLES.get("stock_detail", "")
    if not stock_table:
        log.warning("stock_detail 表 ID 未配置，跳过库存扣减")
        return 0

    updated = 0
    for key, qty_used in deductions.items():
        entry = _stock_index.get(key, {})
        record_id = entry.get("record_id", "")
        if not record_id or record_id == "mock":
            log.warning("无有效 record_id，跳过扣减: %s", key)
            continue
        new_qty = max(0, entry.get("qty", 0) - qty_used)
        try:
            fc.update_record(stock_table, record_id, {"当前库存": new_qty})
            log.debug("扣减 %s × %d → 剩余 %d", key, qty_used, new_qty)
            updated += 1
        except Exception as e:
            log.error("库存扣减失败 %s: %s", key, e)

    log.info("库存扣减完成: %d 个SKU组合已更新", updated)
    return updated


def update_order_status(batch_id: str, status: str) -> None:
    """Update all orders in a batch to a new status (e.g., '已发货')."""
    detail_table = TABLES.get("order_detail", "")
    if not detail_table:
        return
    try:
        records = fc.search_records(detail_table, filter_={
            "conjunction": "and",
            "conditions": [{"field_name": "订单编号", "operator": "is", "value": [batch_id]}],
        }, field_names=["订单编号", "订单状态"])
        for rec in records:
            fc.update_record(detail_table, rec["record_id"], {"订单状态": status})
        log.info("批次 %s: %d 条订单状态 → %s", batch_id, len(records), status)
    except Exception as e:
        log.error("更新订单状态失败: %s", e)
