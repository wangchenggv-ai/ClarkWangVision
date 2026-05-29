#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
库存导入脚本
────────────────────────────────────────────────────────
用法：
  python import_stock.py 入库 入库单.csv
  python import_stock.py 出库 出库单.csv

必填列（列名完全一致）：
  SPH       球镜度数  如 -3.00
  CYL       柱镜度数  如 -0.75，无散光填 0.00
  入库数量 / 出库数量   正整数

可选列：
  日期      格式 YYYY-MM-DD，省略则取今天
  备注      文字说明
────────────────────────────────────────────────────────
"""
import subprocess, json, sys, os, csv, time
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LARK_CLI   = r"C:\Users\wangc\AppData\Roaming\npm\lark-cli.cmd"
BASE_TOKEN = "HN84b5k0Ia3KKisZIeecZeWCnHg"
TABLES = {
    "入库": "tblc46c9bJNM11Lf",
    "出库": "tblHOPj2RSWf8tbv",
}
QTY_COL = {"入库": "入库数量", "出库": "出库数量"}

def cli(*args):
    r = subprocess.run([LARK_CLI] + list(args), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    out = "\n".join(l for l in (r.stdout + r.stderr).splitlines()
                    if not l.startswith("[lark-cli]"))
    return json.loads(out) if out.strip() else {}

def read_csv(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def to_ts(date_str):
    """日期字符串 → 毫秒时间戳"""
    try:
        d = datetime.strptime(date_str.strip(), "%Y-%m-%d")
    except Exception:
        d = datetime.today()
    return int(d.replace(tzinfo=timezone.utc).timestamp() * 1000)

def main():
    if len(sys.argv) < 3 or sys.argv[1] not in TABLES:
        print(__doc__)
        sys.exit(1)

    mode, filepath = sys.argv[1], sys.argv[2]
    table_id = TABLES[mode]
    qty_col  = QTY_COL[mode]

    rows = read_csv(filepath)
    rows = [r for r in rows if any(v.strip() for v in r.values())]
    if not rows:
        print("文件为空，退出。"); sys.exit(0)

    required = {"SPH", "CYL", qty_col}
    missing = required - set(rows[0].keys())
    if missing:
        print(f"❌ 缺少列：{missing}"); sys.exit(1)

    today_ts = int(datetime.today().replace(tzinfo=timezone.utc).timestamp() * 1000)
    records, errors = [], []

    for i, row in enumerate(rows):
        try:
            sph = round(float(row["SPH"]), 2)
            cyl = round(float(row["CYL"]), 2)
            qty = int(row[qty_col])
            if qty <= 0: raise ValueError("数量需为正整数")
        except Exception as e:
            errors.append(f"行{i+2}: {e}"); continue

        rec = {
            "SKU":  f"{sph:.2f}/{cyl:.2f}",
            "SPH":  sph,
            "CYL":  cyl,
            qty_col: qty,
            "日期": to_ts(row.get("日期", "")),
            "来源文件": os.path.basename(filepath),
        }
        if row.get("备注", "").strip():
            rec["备注"] = row["备注"].strip()
        records.append(rec)

    print(f"▶ 准备写入 {len(records)} 条{mode}流水（{os.path.basename(filepath)}）...")

    # +record-batch-create 使用列式格式 {"fields":[...], "rows":[[...], ...]}
    fields = ["SKU", "SPH", "CYL", qty_col, "日期", "来源文件", "备注"]
    ok_count = 0
    for start in range(0, len(records), 200):
        chunk = records[start:start+200]
        rows = [
            [r["SKU"], r["SPH"], r["CYL"], r[qty_col],
             r["日期"], r["来源文件"], r.get("备注", None)]
            for r in chunk
        ]
        payload = {"fields": fields, "rows": rows}
        resp = cli("base", "+record-batch-create",
                   "--base-token", BASE_TOKEN, "--table-id", table_id,
                   "--as", "user",
                   "--json", json.dumps(payload, ensure_ascii=False))
        if resp.get("ok"):
            ok_count += len(chunk)
        else:
            errors.append(f"批次{start}~{start+len(chunk)}: {str(resp)[:120]}")
        time.sleep(0.3)

    print(f"✅ 成功写入 {ok_count} 条，库存表自动更新。")
    if errors:
        print(f"\n⚠  {len(errors)} 条错误：")
        for e in errors: print(f"  {e}")

if __name__ == "__main__":
    main()
