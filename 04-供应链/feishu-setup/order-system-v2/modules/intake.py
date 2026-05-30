"""
Parse Excel files from the inbox folder into normalized lens records.

Each Excel file should follow the agent order template. Agent is identified
from the filename (AG001_...) or a column in the sheet.

Output: list of lens dicts, one per eye per patient:
  {
    agent_code, file_name,
    customer_name, product_sku, eye,
    sph, cyl, axis,
    store_name, contact, phone, address, note, is_assembled,
    _row, _file   # for error reporting
  }
"""

import re
import logging
from pathlib import Path

import pandas as pd

from config import EXCEL_COLUMN_ALIASES, EYE_ALIASES

log = logging.getLogger(__name__)

_AG_RE = re.compile(r"AG[\-_]?(\d{2,3})", re.IGNORECASE)


def _find_agent_code(filename: str, df: pd.DataFrame) -> str:
    """Extract AG-code from filename first, then fall back to sheet content."""
    m = _AG_RE.search(filename)
    if m:
        return f"AG-{m.group(1).zfill(3)}"

    # Try to find a cell in the first few rows that looks like an agent code
    for col in df.columns:
        col_str = str(col)
        m = _AG_RE.search(col_str)
        if m:
            return f"AG-{m.group(1).zfill(3)}"
    for _, row in df.head(5).iterrows():
        for val in row:
            m = _AG_RE.search(str(val))
            if m:
                return f"AG-{m.group(1).zfill(3)}"
    return ""


def _build_col_map(columns: list) -> dict[str, str]:
    """Map Excel column headers to standard field names."""
    col_map = {}
    for col in columns:
        col_clean = str(col).strip()
        for standard, aliases in EXCEL_COLUMN_ALIASES.items():
            if col_clean in aliases or col_clean.lower() in [a.lower() for a in aliases]:
                if standard not in col_map:
                    col_map[standard] = col
    return col_map


def _safe_float(val) -> float | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return round(float(val), 2)
    except (ValueError, TypeError):
        return None


def _parse_eye(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip().lower()
    return EYE_ALIASES.get(s)


def _parse_sheet(df: pd.DataFrame, agent_code: str, filename: str) -> tuple[list[dict], list[str]]:
    """Parse one sheet into lens records. Returns (records, errors)."""
    col_map = _build_col_map(list(df.columns))
    records, errors = [], []

    def get(row, field: str, default=None):
        col = col_map.get(field)
        if col is None:
            return default
        val = row.get(col, default)
        if isinstance(val, float) and pd.isna(val):
            return default
        return val

    has_eye_col = "眼别" in col_map

    # Detect per-patient format: separate 右眼/左眼 columns
    right_sph_col = next((c for c in df.columns if re.match(r"右眼.*(SPH|球镜)", str(c), re.I)), None)
    left_sph_col  = next((c for c in df.columns if re.match(r"左眼.*(SPH|球镜)", str(c), re.I)), None)
    is_per_patient = bool(right_sph_col and left_sph_col)

    for row_idx, row in df.iterrows():
        customer = str(get(row, "顾客姓名", "")).strip()
        if not customer or customer.lower() in ("nan", "顾客姓名", "客户姓名", "姓名"):
            continue

        sku     = str(get(row, "产品型号", "")).strip()
        store   = str(get(row, "终端门店", "")).strip()
        contact = str(get(row, "联系人",   "")).strip()
        phone   = str(get(row, "联系电话", "")).strip()
        address = str(get(row, "收货地址", "")).strip()
        note    = str(get(row, "备注",     "")).strip()
        assembled = str(get(row, "是否装配", "否")).strip() or "否"

        base = {
            "agent_code": agent_code,
            "file_name":  filename,
            "customer_name": customer,
            "product_sku":   sku,
            "store_name":    store,
            "contact":       contact,
            "phone":         phone,
            "address":       address,
            "note":          note,
            "is_assembled":  assembled,
            "_row":          row_idx + 2,  # 1-indexed + header
            "_file":         filename,
        }

        if is_per_patient:
            # Two eye columns per row
            for eye_label, sph_pat, cyl_pat, axis_pat in [
                ("右眼", r"右眼.*(SPH|球镜)", r"右眼.*(CYL|柱镜)", r"右眼.*(AXIS|轴位)"),
                ("左眼", r"左眼.*(SPH|球镜)", r"左眼.*(CYL|柱镜)", r"左眼.*(AXIS|轴位)"),
            ]:
                sph_col  = next((c for c in df.columns if re.match(sph_pat,  str(c), re.I)), None)
                cyl_col  = next((c for c in df.columns if re.match(cyl_pat,  str(c), re.I)), None)
                axis_col = next((c for c in df.columns if re.match(axis_pat, str(c), re.I)), None)

                sph  = _safe_float(row.get(sph_col))
                cyl  = _safe_float(row.get(cyl_col))
                axis = _safe_float(row.get(axis_col))

                if sph is None and cyl is None:
                    continue  # eye not filled in this row

                records.append({**base, "eye": eye_label, "sph": sph, "cyl": cyl, "axis": axis})

        elif has_eye_col:
            # One row per eye
            eye  = _parse_eye(get(row, "眼别"))
            sph  = _safe_float(get(row, "SPH"))
            cyl  = _safe_float(get(row, "CYL"))
            axis = _safe_float(get(row, "AXIS"))

            if eye is None:
                errors.append(f"行{row_idx+2} 眼别无法识别: {get(row, '眼别')!r}")
                continue
            records.append({**base, "eye": eye, "sph": sph, "cyl": cyl, "axis": axis})

        else:
            # Per-pair: no eye column → create both eyes from same SPH/CYL
            sph  = _safe_float(get(row, "SPH"))
            cyl  = _safe_float(get(row, "CYL"))
            axis = _safe_float(get(row, "AXIS"))
            for eye in ("右眼", "左眼"):
                records.append({**base, "eye": eye, "sph": sph, "cyl": cyl, "axis": axis})

    return records, errors


def load_inbox(inbox_path: str) -> tuple[list[dict], list[str]]:
    """
    Read all .xlsx files from inbox_path.
    Returns (all_lens_records, all_errors).
    """
    inbox = Path(inbox_path)
    files = sorted(inbox.glob("*.xlsx"))
    if not files:
        return [], [f"inbox 目录 {inbox_path} 中没有 .xlsx 文件"]

    all_records, all_errors = [], []

    for xlsx in files:
        fname = xlsx.name
        try:
            xl = pd.ExcelFile(xlsx)
        except Exception as e:
            all_errors.append(f"{fname}: 无法打开 — {e}")
            continue

        for sheet in xl.sheet_names:
            try:
                df = xl.parse(sheet, dtype=str, header=0)
                df = df.dropna(how="all")
            except Exception as e:
                all_errors.append(f"{fname}[{sheet}]: 解析失败 — {e}")
                continue

            agent_code = _find_agent_code(fname, df)
            if not agent_code:
                all_errors.append(f"{fname}[{sheet}]: 无法识别代理商编号（文件名应含 AG001 格式）")
                # still parse, agent_code will be empty and flagged later

            records, errors = _parse_sheet(df, agent_code, fname)
            all_records.extend(records)
            all_errors.extend([f"{fname}[{sheet}]: {e}" for e in errors])

        log.info("  %s → %d 条", fname, sum(1 for r in all_records if r["file_name"] == fname))

    return all_records, all_errors


def archive_processed(inbox_path: str, file_names) -> tuple[int, str]:
    """
    把已处理的 Excel 移到 inbox/done/YYYY-MM-DD/，避免下次重复处理。
    load_inbox 只 glob 当前层 *.xlsx，归档到子目录后不会再被扫到。
    返回 (移动文件数, 归档目录路径)。
    """
    from datetime import datetime

    inbox = Path(inbox_path)
    done_dir = inbox / "done" / datetime.now().strftime("%Y-%m-%d")
    moved = 0
    for fname in sorted(set(file_names)):
        src = inbox / fname
        if not src.exists() or not src.is_file():
            continue
        done_dir.mkdir(parents=True, exist_ok=True)
        dst = done_dir / fname
        if dst.exists():  # 同名已归档过 → 加时间戳避免覆盖
            dst = done_dir / f"{src.stem}_{datetime.now():%H%M%S}{src.suffix}"
        src.rename(dst)
        moved += 1
    return moved, str(done_dir)
