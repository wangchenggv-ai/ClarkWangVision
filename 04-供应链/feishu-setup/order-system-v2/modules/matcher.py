"""
Master table lookups — loaded once at startup, matched per lens record.

Enriches each lens dict with:
  agent_id, agent_name, agent_address
  serial_no, bin_location
  lens_code, verify_url
  _match_errors (list of issues for this record)
"""

import logging
from config import TABLES, FIELDS, VERIFY_BASE_URL
from modules import feishu_client as fc

log = logging.getLogger(__name__)


# ── In-memory indexes (populated by load_master_tables) ─────────────────────

_agents: dict[str, dict] = {}          # agent_code → {id, name, address}
_sku_location: dict[str, dict] = {}    # (product_sku, sph_str, cyl_str) → {serial_no, bin}
_sku_code: dict[str, dict] = {}        # serial_no → {lens_code, verify_url}


def load_master_tables() -> None:
    """Fetch all master tables from Feishu and build lookup indexes."""
    _load_agents()
    _load_sku_location()
    _load_sku_code()


def _load_agents() -> None:
    rows = fc.list_records(TABLES["agent"], field_names=[
        FIELDS["agent_id"], FIELDS["agent_name"], FIELDS["agent_address"], FIELDS["agent_status"]
    ])
    for row in rows:
        status = fc.text(row.get(FIELDS["agent_status"], "")).strip()
        if status and status not in ("启用", "active", "Active"):
            continue
        aid = fc.text(row.get(FIELDS["agent_id"], "")).strip()
        if not aid:
            continue
        _agents[aid] = {
            "agent_id":      aid,
            "agent_name":    fc.text(row.get(FIELDS["agent_name"], "")),
            "agent_address": fc.text(row.get(FIELDS["agent_address"], "")),
        }
    log.info("代理商主表: %d 条", len(_agents))


def _load_sku_location() -> None:
    rows = fc.list_records(TABLES["sku_location"], field_names=[
        FIELDS["product_sku"], FIELDS["sph"], FIELDS["cyl"], FIELDS["serial_no"], FIELDS["bin"]
    ])
    for row in rows:
        sku    = fc.text(row.get(FIELDS["product_sku"], "")).strip()
        sph    = fc.number(row.get(FIELDS["sph"]))
        cyl    = fc.number(row.get(FIELDS["cyl"]))
        serial = fc.text(row.get(FIELDS["serial_no"], "")).strip()
        bin_   = fc.text(row.get(FIELDS["bin"], "")).strip()
        if not sku or sph is None or cyl is None or not serial:
            continue
        key = (sku, f"{sph:.2f}", f"{cyl:.2f}")
        _sku_location[key] = {"serial_no": serial, "bin": bin_}
    log.info("SKU序列号映射: %d 条", len(_sku_location))


def _load_sku_code() -> None:
    table_id = TABLES.get("sku_code", "")
    if not table_id:
        log.warning("SKU预赋码表 ID 未配置（TABLES['sku_code'] 为空），镜片码将留空")
        return
    rows = fc.list_records(table_id, field_names=[
        FIELDS["sku_code_serial"], FIELDS["sku_code_value"], FIELDS["sku_code_url"]
    ])
    for row in rows:
        serial = fc.text(row.get(FIELDS["sku_code_serial"], "")).strip()
        code   = fc.text(row.get(FIELDS["sku_code_value"], "")).strip()
        url    = fc.text(row.get(FIELDS["sku_code_url"], "")).strip()
        if not serial or not code:
            continue
        if not url:
            url = f"{VERIFY_BASE_URL}/{code}"
        _sku_code[serial] = {"lens_code": code, "verify_url": url}
    log.info("SKU预赋码: %d 条", len(_sku_code))


# ── Per-record enrichment ────────────────────────────────────────────────────

def enrich(record: dict) -> dict:
    """
    Enrich one lens record with agent info, serial_no, bin, lens_code.
    Adds '_match_errors' list to the record (empty if all matched).
    """
    rec = {**record, "_match_errors": []}

    # 1. Agent lookup
    agent_code = rec.get("agent_code", "")
    if agent_code in _agents:
        rec.update(_agents[agent_code])
    else:
        rec["agent_id"]      = agent_code
        rec["agent_name"]    = agent_code
        rec["agent_address"] = ""
        if agent_code:
            rec["_match_errors"].append(f"代理商 {agent_code!r} 不在主表中")
        else:
            rec["_match_errors"].append("代理商编号缺失（文件名无 AG-xxx 格式）")

    # 2. SKU serial + bin lookup
    sku = rec.get("product_sku", "").strip()
    sph = rec.get("sph")
    cyl = rec.get("cyl")

    if sku and sph is not None and cyl is not None:
        key = (sku, f"{sph:.2f}", f"{cyl:.2f}")
        loc = _sku_location.get(key)
        if loc:
            rec["serial_no"]    = loc["serial_no"]
            rec["bin_location"] = loc["bin"]
        else:
            rec["serial_no"]    = ""
            rec["bin_location"] = ""
            rec["_match_errors"].append(
                f"SKU {sku!r} SPH={sph} CYL={cyl} 不在序列号映射表中"
            )
    else:
        rec["serial_no"]    = ""
        rec["bin_location"] = ""
        if not sku:
            rec["_match_errors"].append("产品型号缺失")
        if sph is None:
            rec["_match_errors"].append("SPH 缺失")
        if cyl is None:
            rec["_match_errors"].append("CYL 缺失")

    # 3. Pre-assigned lens code lookup
    serial = rec.get("serial_no", "")
    if serial and serial in _sku_code:
        rec["lens_code"]  = _sku_code[serial]["lens_code"]
        rec["verify_url"] = _sku_code[serial]["verify_url"]
    else:
        rec["lens_code"]  = ""
        rec["verify_url"] = ""
        if serial and TABLES.get("sku_code"):
            rec["_match_errors"].append(f"序列号 {serial} 无预赋码")

    return rec
