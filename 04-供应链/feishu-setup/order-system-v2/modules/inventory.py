"""
Inventory check and split.

Reads stock_detail table once, builds an in-memory index by (product_sku, sph, cyl).
Splits enriched lens records into:
  - label_list:   has stock → ready for warehouse picking
  - factory_list: no stock  → send to factory for production
"""

import logging
from collections import defaultdict
from config import TABLES, FIELDS
from modules import feishu_client as fc

log = logging.getLogger(__name__)

# stock_index: (product_sku, sph_str, cyl_str) → {"qty": int, "record_id": str}
_stock_index: dict[tuple, dict] = {}


def load_inventory() -> None:
    rows = fc.list_records(TABLES["stock_detail"], field_names=[
        FIELDS["stock_sku"], FIELDS["stock_sph"], FIELDS["stock_cyl"], FIELDS["stock_qty"]
    ])
    for row in rows:
        sku = fc.text(row.get(FIELDS["stock_sku"], "")).strip()
        sph = fc.number(row.get(FIELDS["stock_sph"]))
        cyl = fc.number(row.get(FIELDS["stock_cyl"]))
        qty = fc.number(row.get(FIELDS["stock_qty"]))
        if not sku or sph is None or cyl is None:
            continue
        key = (sku, f"{sph:.2f}", f"{cyl:.2f}")
        _stock_index[key] = {
            "qty":       int(qty or 0),
            "record_id": row.get("record_id", ""),
        }
    log.info("库存表: %d 条SKU度数组合", len(_stock_index))


def _stock_qty(sku: str, sph: float | None, cyl: float | None) -> int:
    if sph is None or cyl is None:
        return 0
    key = (sku, f"{sph:.2f}", f"{cyl:.2f}")
    return _stock_index.get(key, {}).get("qty", 0)


def split(records: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Split records into (label_list, factory_list).
    Deducts inventory optimistically (first-come-first-served within the batch).
    Returns records enriched with 'in_stock' bool.
    """
    # Track running deductions within this batch to avoid double-allocating
    deducted: dict[tuple, int] = defaultdict(int)

    label_list, factory_list = [], []

    for rec in records:
        sku = rec.get("product_sku", "")
        sph = rec.get("sph")
        cyl = rec.get("cyl")
        key = (sku, f"{sph:.2f}", f"{cyl:.2f}") if sph is not None and cyl is not None else None

        if key:
            available = _stock_qty(sku, sph, cyl) - deducted[key]
        else:
            available = 0

        if available > 0:
            deducted[key] += 1
            label_list.append({**rec, "in_stock": True})
        else:
            factory_list.append({**rec, "in_stock": False})

    return label_list, factory_list


def stock_summary() -> dict:
    """Return total available units and SKU count for reporting."""
    total_units = sum(v["qty"] for v in _stock_index.values())
    skus_with_stock = sum(1 for v in _stock_index.values() if v["qty"] > 0)
    return {"total_units": total_units, "skus_with_stock": skus_with_stock}
