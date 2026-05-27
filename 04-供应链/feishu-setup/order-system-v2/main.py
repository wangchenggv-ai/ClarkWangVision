#!/usr/bin/env python3
"""
批量订单 Pipeline — 一条命令处理所有代理商 Excel，输出配货单 + 排产单。

用法:
  python main.py ./inbox/              # 处理 inbox/ 目录下所有 .xlsx 文件
  python main.py ./inbox/ --dry-run    # 只解析，不读飞书，不写文件（快速测试）
  python main.py ./inbox/ --no-sync    # 处理并输出 Excel，但不写回飞书

输出:
  output/YYYY-MM-DD/labels.xlsx        配货单（仓库拣货）
  output/YYYY-MM-DD/factory.xlsx       排产单（工厂生产）
  output/YYYY-MM-DD/errors.xlsx        异常记录（有问题时才生成）
"""

import sys
import logging
import argparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def _parse_args():
    p = argparse.ArgumentParser(description="批量订单 Pipeline")
    p.add_argument("inbox", help="包含代理商 Excel 文件的目录")
    p.add_argument("--dry-run", action="store_true", help="只解析 Excel，不连接飞书")
    p.add_argument("--no-sync", action="store_true", help="处理完整 pipeline，但不写回飞书")
    return p.parse_args()


def _header(text: str) -> None:
    print(f"\n{'─'*50}\n  {text}\n{'─'*50}")


def main():
    args = _parse_args()

    # ── 1. 加载主表 ────────────────────────────────────────────────────────
    from modules import matcher, inventory
    if args.dry_run:
        _header("加载本地主表（dry-run）")
        matcher.load_local_tables()
        print("  ✓ 本地SKU映射加载完成（代理商/库存跳过）")
    else:
        _header("加载主表")
        print("  正在读取代理商主表、SKU映射、库存表…")
        matcher.load_master_tables()
        inventory.load_inventory()
        print("  ✓ 主表加载完成")

    # ── 2. 解析 Excel ─────────────────────────────────────────────────────
    _header("解析 Excel")
    from modules.intake import load_inbox
    records, parse_errors = load_inbox(args.inbox)

    if not records:
        print(f"  ✗ 未找到任何有效订单行。错误：")
        for e in parse_errors:
            print(f"    · {e}")
        sys.exit(1)

    # Group by agent for summary
    agent_counts: dict[str, int] = {}
    for r in records:
        ac = r.get("agent_code") or "未识别"
        agent_counts[ac] = agent_counts.get(ac, 0) + 1

    print(f"  ✓ 解析完成：{len(records)} 片（{len(records)//2} 人）")
    for ac, cnt in sorted(agent_counts.items()):
        print(f"    · {ac}: {cnt} 片")
    if parse_errors:
        print(f"  ⚠ 解析问题：{len(parse_errors)} 条")
        for e in parse_errors[:5]:
            print(f"    · {e}")
        if len(parse_errors) > 5:
            print(f"    … 还有 {len(parse_errors)-5} 条（见 errors.xlsx）")

    # ── 3. 富化（SKU匹配 + 代理商匹配）────────────────────────────────────
    _header("SKU 匹配")
    from modules.matcher import enrich
    enriched = [enrich(r) for r in records]

    match_errors = [r for r in enriched if r["_match_errors"]]
    ok_count = len(enriched) - len(match_errors)
    print(f"  ✓ 匹配成功：{ok_count} 片")
    if match_errors:
        print(f"  ⚠ 匹配问题：{len(match_errors)} 片")
        # Show first few unique errors
        shown = set()
        for r in match_errors[:10]:
            for e in r["_match_errors"]:
                if e not in shown:
                    print(f"    · {e}")
                    shown.add(e)

    # ── 4. 库存分流 ───────────────────────────────────────────────────────
    _header("库存分流")
    if args.dry_run:
        label_list = [{**r, "in_stock": True} for r in enriched]
        factory_list = []
        print("  (dry-run — 跳过库存查询，所有记录归入配货单)")
    else:
        from modules.inventory import split
        label_list, factory_list = split(enriched)

    print(f"  ✓ 有库存 → 配货单：{len(label_list)} 片")
    print(f"  ✓ 排产   → 排产单：{len(factory_list)} 片")

    # ── 5. 输出 Excel ─────────────────────────────────────────────────────
    _header("生成输出文件")
    from modules.output import prepare_output_dir, write_labels, write_factory, write_errors
    out_dir = prepare_output_dir()

    label_path   = write_labels(label_list, out_dir)
    factory_path = write_factory(factory_list, out_dir)
    error_path   = write_errors(parse_errors, match_errors, out_dir)

    print(f"\n  ✓ 配货单: {label_path}")
    if factory_path:
        print(f"  ✓ 排产单: {factory_path}")
    if error_path:
        print(f"  ⚠ 异常记录: {error_path}")

    # ── 6. 写回飞书（Phase 2，--no-sync 跳过）─────────────────────────────
    if not args.dry_run and not args.no_sync:
        _header("写回飞书")
        print("  (Phase 2 — 尚未实现，跳过)")

    # ── 汇总 ─────────────────────────────────────────────────────────────
    _header("完成")
    print(f"  总计：{len(records)} 片，{len(label_list)} 片配货，{len(factory_list)} 片排产")
    errors_total = len(parse_errors) + sum(len(r["_match_errors"]) for r in enriched)
    if errors_total:
        print(f"  ⚠ 共 {errors_total} 条问题，请检查 errors.xlsx")
    print()


if __name__ == "__main__":
    main()
