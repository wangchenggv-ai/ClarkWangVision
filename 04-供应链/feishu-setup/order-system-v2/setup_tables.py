#!/usr/bin/env python3
"""
一次性建表脚本 — 在 .env 指向的 Bitable 建『批次汇总』『SKU序列号映射』两张表。

  · 批次汇总：pipeline 每跑一次写一条（批次编号/处理日期/总片数/有货片数/排产片数/状态），
              替代「批次号只散落在镜片明细」的现状。
  · SKU映射：把 matcher.py 里硬编码的 219 条 Ultra双效迁到飞书。以后加度数/新产品
              只需在表里加行，无需改代码（matcher._load_sku_location 已支持从此表读）。

幂等：表已存在则复用、SKU 已灌则跳过。切生产库时改 .env 后重跑即可。
跑完按提示把两个 table_id 填进 config.py 的 TABLES。

  python setup_tables.py
"""

import sys

sys.path.insert(0, ".")
from modules import feishu_client as fc
from modules.matcher import _ULTRA_LOCAL

T_TEXT, T_NUMBER = 1, 2

BATCH_TABLE_NAME = "批次汇总"
SKU_TABLE_NAME = "SKU序列号映射"


def ensure_table(name: str, fields: list[dict]) -> str:
    existing = {t["name"]: t["table_id"] for t in fc.list_tables()}
    if name in existing:
        print(f"  · 表已存在，复用: {name} ({existing[name]})")
        return existing[name]
    tid = fc.create_table(name, fields)
    print(f"  ✓ 新建表: {name} ({tid})")
    return tid


def main():
    print("连接 Bitable，准备建表…\n")

    batch_tbl = ensure_table(BATCH_TABLE_NAME, [
        {"field_name": "批次编号", "type": T_TEXT},    # 主字段
        {"field_name": "处理日期", "type": T_TEXT},
        {"field_name": "总片数",   "type": T_NUMBER},
        {"field_name": "有货片数", "type": T_NUMBER},
        {"field_name": "排产片数", "type": T_NUMBER},
        {"field_name": "状态",     "type": T_TEXT},
    ])

    sku_tbl = ensure_table(SKU_TABLE_NAME, [
        {"field_name": "序列号",   "type": T_TEXT},    # 主字段（001-219 唯一）
        {"field_name": "产品型号", "type": T_TEXT},
        {"field_name": "球镜SPH",  "type": T_NUMBER},
        {"field_name": "柱镜CYL",  "type": T_NUMBER},
        {"field_name": "货位",     "type": T_TEXT},
    ])

    existing_n = len(fc.list_records(sku_tbl, field_names=["序列号"]))
    if existing_n == 0:
        rows = [
            {"序列号": s, "产品型号": "Ultra双效", "球镜SPH": sph, "柱镜CYL": cyl, "货位": b}
            for s, sph, cyl, b in _ULTRA_LOCAL
        ]
        cnt = fc.batch_create(sku_tbl, rows)
        print(f"  ✓ 灌入 SKU {cnt} 条")
    else:
        print(f"  · SKU 表已有 {existing_n} 条，跳过灌数据")

    print("\n── 把以下两行填进 config.py 的 TABLES ──")
    print(f'    "batch_order":   "{batch_tbl}",')
    print(f'    "sku_location":  "{sku_tbl}",')


if __name__ == "__main__":
    main()
