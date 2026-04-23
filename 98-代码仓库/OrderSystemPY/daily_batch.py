"""
高视星订单日批处理脚本 V4(加固版 + 自动 sanity check)

V4 相对 V3 的新增:
  - 每日首次运行自动调用 sanity_check.py
  - 支持 --yolo 解锁超大批量(>300 条)
  - 支持 --skip-sanity 跳过健康检查(不推荐)

V3 基础能力:
  - 互斥参数校验
  - 强制中国时区
  - 分级规模保护(在 shuang_client 里)
  - production 交互确认
  - 精确匹配 ZIP

用法:
  python daily_batch.py                          # 处理今天
  python daily_batch.py --date 20260501          # 处理指定日期
  python daily_batch.py --dry-run                # 试运行
  python daily_batch.py --shuang-only            # 只写溯源
  python daily_batch.py --feishu-only            # 只写飞书
  python daily_batch.py --yolo                   # 解锁 300+ 批量
  python daily_batch.py --skip-sanity            # 跳过健康检查(不推荐)

生产环境运行:
  # PowerShell
  $env:SHUANG_ENV="production"
  $env:CONFIRM_PRODUCTION="YES_I_AM_SURE"
  python daily_batch.py

作者: Clark + Claude
日期: 2026-04-19
"""
import argparse
import subprocess
import sys
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Windows 控制台 emoji 兼容
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from excel_merger import merge_excels, validate_records
from feishu_client import FeishuClient
from shuang_client import (
    ShuangClient,
    BatchAbortError,
    ProductionGuardError,
    LargeBatchError,
)
from config import INPUT_ROOT, OUTPUT_ROOT, SHUANG_ENV

CN_TZ = timezone(timedelta(hours=8))


def run_sanity_check_if_needed(output_dir, skip=False):
    """
    当天首次运行时自动跑 sanity_check.py
    通过后会在 output_dir 创建 .sanity_checked 标记文件,当天后续重跑跳过
    """
    flag = output_dir / ".sanity_checked"
    if flag.exists():
        print(f"[sanity] 当天已检查过 ({flag}),跳过")
        return True

    if skip:
        print(f"[sanity] ⚠️  用户指定 --skip-sanity,跳过检查(不推荐)")
        return True

    print(f"[sanity] 当天首次运行,先跑健康检查...")
    print(f"{'-'*60}")

    script_path = Path(__file__).parent / "sanity_check.py"
    if not script_path.exists():
        print(f"  ⚠️  找不到 sanity_check.py,跳过检查")
        return True

    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=Path(__file__).parent,
    )
    print(f"{'-'*60}")

    if result.returncode != 0:
        print(f"\n❌ Sanity check 失败(退出码 {result.returncode}),禁止继续")
        print(f"   若确需跳过,加 --skip-sanity 参数(不推荐)")
        sys.exit(4)

    print(f"[sanity] ✅ 检查通过\n")
    return True


def main():
    parser = argparse.ArgumentParser(description="高视星订单日批处理 V4")
    parser.add_argument("--date", default=datetime.now(CN_TZ).strftime("%Y%m%d"))
    parser.add_argument("--dry-run", action="store_true", help="试运行")
    parser.add_argument("--shuang-only", action="store_true", help="只写溯源系统")
    parser.add_argument("--feishu-only", action="store_true", help="只写飞书")
    parser.add_argument("--yolo", action="store_true", help="解锁 300+ 超大批量")
    parser.add_argument("--skip-sanity", action="store_true",
                        help="跳过健康检查(不推荐)")
    args = parser.parse_args()

    # 互斥参数校验
    if args.shuang_only and args.feishu_only:
        parser.error("--shuang-only 和 --feishu-only 不能同时使用")

    today = args.date
    input_dir = Path(INPUT_ROOT) / today
    output_dir = Path(OUTPUT_ROOT) / today
    output_dir.mkdir(parents=True, exist_ok=True)

    write_feishu = not args.shuang_only
    write_shuang = not args.feishu_only

    # 环境 banner
    env_banner = {
        "mock": "🟢 MOCK(本地模拟,绝对安全)",
        "staging": "🟡 STAGING(测试环境)",
        "production": "🔴 PRODUCTION(生产环境!!!)",
    }.get(SHUANG_ENV, f"❓ {SHUANG_ENV}")

    print(f"\n{'='*60}")
    print(f"  高视星订单批处理 V4 | {today}")
    print(f"  溯源环境: {env_banner}")
    print(f"  模式: {'试运行 DRY-RUN' if args.dry_run else '正式'}")
    print(f"  写飞书: {'是' if write_feishu else '跳过'}")
    print(f"  写溯源: {'是' if write_shuang else '跳过'}")
    if args.yolo:
        print(f"  🚨 YOLO: 已解锁超大批量")
    print(f"{'='*60}\n")

    # ===== 0. 健康检查 =====
    # 仅在真正要写数据时检查,dry-run 不需要
    if not args.dry_run and write_shuang:
        run_sanity_check_if_needed(output_dir, skip=args.skip_sanity)

    # ===== 1. 扫描 Excel =====
    excels = list(input_dir.glob("*.xlsx")) + list(input_dir.glob("*.xls"))
    if not excels:
        print(f"错误: {input_dir} 没有 Excel 文件")
        sys.exit(1)
    print(f"[1/7] 发现 {len(excels)} 个 Excel")

    # ===== 2. 合并 + 校验 =====
    df, warnings = merge_excels(excels)
    df, failed = validate_records(df)
    master_csv = output_dir / f"master_{today}.csv"
    df.to_csv(master_csv, index=False, encoding="utf-8-sig")
    print(f"[2/7] 有效: {len(df)} 单 | 失败: {len(failed)} 条")
    if len(failed):
        failed.to_csv(output_dir / f"failed_{today}.csv",
                      index=False, encoding="utf-8-sig")

    # ===== 3. 幂等检查 =====
    if write_feishu and not args.dry_run and not args.shuang_only:
        print(f"[3/7] 幂等检查...")
        feishu = FeishuClient()
        existing = feishu.query_today_orders(today)
        new_df = df[~df.apply(
            lambda r: f"{r['代理商名称']}|{r['顾客姓名']}" in existing, axis=1
        )]
        print(f"      待写入: {len(new_df)} | 跳过: {len(df) - len(new_df)}")
    else:
        new_df = df
        print(f"[3/7] 跳过幂等检查")

    if len(new_df) == 0:
        print(f"所有订单已处理,无需重复")
        sys.exit(0)

    # ===== 4. 赋订单号 =====
    new_df = new_df.copy()
    new_df["订单编号"] = [
        f"ORD-{today}-{secrets.token_hex(3).upper()}"
        for _ in range(len(new_df))
    ]
    print(f"[4/7] 赋码: {len(new_df)} 个订单号")

    # ===== 5. 写飞书 =====
    if write_feishu and not args.dry_run:
        print(f"[5/7] 写飞书 Bitable...")
        feishu_success, feishu_failed = feishu.batch_create_orders(new_df)
        print(f"      成功: {len(feishu_success)} | 失败: {len(feishu_failed)}")
    else:
        print(f"[5/7] 跳过飞书")

    # ===== 6. 写溯源系统 =====
    if write_shuang and not args.dry_run:
        print(f"[6/7] 写溯源系统(一眼一码,每人 2 码)...")
        try:
            shuang = ShuangClient()
        except ProductionGuardError as e:
            print(str(e))
            sys.exit(2)

        shuang_orders = []
        for _, row in new_df.iterrows():
            shuang_orders.append({
                "goods_name": row.get("产品型号", ""),
                "barcode_num": 2,
                "right_sph": row.get("右眼SPH"),
                "right_cyl": row.get("右眼CYL"),
                "right_axis": row.get("右眼AXIS"),
                "left_sph": row.get("左眼SPH"),
                "left_cyl": row.get("左眼CYL"),
                "left_axis": row.get("左眼AXIS"),
                "remark": row.get("顾客姓名", ""),
                "dealer": row.get("代理商名称", ""),
            })

        print(f"      {len(new_df)} 个顾客 → {len(new_df) * 2} 个码")

        try:
            shuang_success, shuang_failed = shuang.batch_add_orders(
                shuang_orders, yolo=args.yolo
            )
        except LargeBatchError as e:
            print(f"\n❌ {e}")
            sys.exit(5)
        except BatchAbortError as e:
            print(f"⚠️  批处理中止: {e}")
            print(f"    请检查 {output_dir}/audit_shuang.jsonl")
            sys.exit(3)

        print(f"      成功: {len(shuang_success)} | 失败: {len(shuang_failed)}")

        # 精确匹配 + 下载 ZIP
        print(f"      精确匹配 ZIP...")
        zip_dir = output_dir / "shuang_zips"
        zip_dir.mkdir(exist_ok=True)

        matched, unmatched = shuang.get_zips_for_orders(
            shuang_success,
            look_back=max(100, len(shuang_success) * 2)
        )
        print(f"      匹配到 ZIP: {len(matched)} | 未匹配: {len(unmatched)}")

        for m in matched:
            order = m["order"]
            zip_info = m["zip_info"]
            url = zip_info.get("barcode_url")
            if not url:
                continue
            safe_remark = (order.get("remark") or "unknown")
            for ch in "/\\:*?\"<>|":
                safe_remark = safe_remark.replace(ch, "_")
            save_path = zip_dir / f"{safe_remark}_{zip_info['id']}.zip"
            try:
                shuang.download_zip(url, save_path)
            except Exception as e:
                print(f"      ZIP 下载失败: {safe_remark} - {e}")

        if unmatched:
            print(f"      ⚠️  {len(unmatched)} 条未匹配到 ZIP,需人工核对:")
            for o in unmatched[:5]:
                print(f"         - {o.get('dealer')} / {o.get('remark')}")
            if len(unmatched) > 5:
                print(f"         ...还有 {len(unmatched) - 5} 条,查看 audit 日志")
    else:
        print(f"[6/7] 跳过溯源系统")

    # ===== 7. 报告 =====
    print(f"\n[7/7] 报告")
    report = (
        f"日期: {today}\n"
        f"溯源环境: {SHUANG_ENV}\n"
        f"Excel 文件: {len(excels)}\n"
        f"有效订单: {len(new_df)}\n"
        f"飞书: {'已写' if write_feishu and not args.dry_run else '跳过'}\n"
        f"溯源: {'已写' if write_shuang and not args.dry_run else '跳过'}\n"
        f"完成时间: {datetime.now(CN_TZ).strftime('%Y-%m-%d %H:%M:%S')}\n"
    )
    (output_dir / f"report_{today}.txt").write_text(report, encoding="utf-8")
    print(report)

    print(f"{'='*60}")
    print(f"  完成! 输出目录: {output_dir}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
