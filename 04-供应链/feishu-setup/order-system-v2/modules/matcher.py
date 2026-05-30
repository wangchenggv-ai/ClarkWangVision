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


# ── Local SKU serial data (from sku-serial.js, 2026-05-16) ──────────────────
# Key: (product_sku, sph_str, cyl_str) → {serial_no, bin}
_ULTRA_LOCAL = [
    ("001",  0.00,  0.00, "A-01-3-01"), ("002", -1.25,  0.00, "A-01-3-02"),
    ("003", -1.00,  0.00, "A-01-3-03"), ("004", -0.75,  0.00, "A-01-3-04"),
    ("005", -1.50,  0.00, "A-01-3-05"), ("006", -1.50, -0.50, "A-01-3-06"),
    ("007", -1.75,  0.00, "A-01-2-01"), ("008", -1.25, -0.50, "A-01-2-02"),
    ("009", -1.00, -0.50, "A-01-2-03"), ("010", -2.25,  0.00, "A-01-2-04"),
    ("011", -2.00, -0.50, "A-01-2-05"), ("012", -2.00,  0.00, "A-01-2-06"),
    ("013", -0.75, -0.50, "A-01-4-01"), ("014", -0.50,  0.00, "A-01-4-02"),
    ("015", -2.25, -0.50, "A-01-4-03"), ("016", -1.75, -0.50, "A-01-4-04"),
    ("017", -2.50, -0.50, "A-01-4-05"), ("018", -2.75, -0.50, "A-01-4-06"),
    ("019", -2.50,  0.00, "A-01-1-01"), ("020", -2.75,  0.00, "A-01-1-02"),
    ("021", -3.00,  0.00, "A-01-1-03"), ("022", -0.50, -0.50, "A-01-1-04"),
    ("023", -1.00, -0.75, "A-01-1-05"), ("024", -3.00, -0.50, "A-01-1-06"),
    ("025", -1.75, -0.75, "A-01-5-01"), ("026", -0.25,  0.00, "A-01-5-02"),
    ("027", -1.50, -0.75, "A-01-5-03"), ("028", -2.00, -0.75, "A-01-5-04"),
    ("029", -2.50, -0.75, "A-01-5-05"), ("030",  0.00, -0.50, "A-01-5-06"),
    ("031", -3.25, -0.50, "A-02-3-01"), ("032", -3.50, -0.50, "A-02-3-02"),
    ("033", -1.25, -0.75, "A-02-3-03"), ("034", -3.25,  0.00, "A-02-3-04"),
    ("035", -2.25, -0.75, "A-02-3-05"), ("036", -2.75, -0.75, "A-02-3-06"),
    ("037", -0.75, -0.75, "A-02-2-01"), ("038", -1.75, -1.00, "A-02-2-02"),
    ("039", -2.00, -1.00, "A-02-2-03"), ("040",  0.00, -0.75, "A-02-2-04"),
    ("041", -1.50, -1.00, "A-02-2-05"), ("042", -3.25, -1.00, "A-02-2-06"),
    ("043", -3.75, -0.50, "A-02-4-01"), ("044", -4.00, -0.50, "A-02-4-02"),
    ("045", -0.25, -0.50, "A-02-4-03"), ("046", -1.00, -1.00, "A-02-4-04"),
    ("047", -2.50, -1.25, "A-02-4-05"), ("048",  0.00, -1.00, "A-02-4-06"),
    ("049", -3.25, -0.75, "A-02-1-01"), ("050", -0.50, -0.75, "A-02-1-02"),
    ("051", -1.25, -1.00, "A-02-1-03"), ("052", -2.50, -1.00, "A-02-1-04"),
    ("053", -3.50,  0.00, "A-02-1-05"), ("054", -4.00, -0.75, "A-02-1-06"),
    ("055", -3.00, -0.75, "A-02-5-01"), ("056", -2.25, -1.00, "A-02-5-02"),
    ("057", -0.75, -1.00, "A-02-5-03"), ("058", -2.50, -1.50, "A-02-5-04"),
    ("059", -2.75, -1.00, "A-02-5-05"), ("060", -3.50, -1.00, "A-02-5-06"),
    ("061", -3.75,  0.00, "A-03-3-01"), ("062", -4.25,  0.00, "B-04-3-01"),
    ("063", -4.25, -0.50, "B-04-3-02"), ("064", -4.50, -0.75, "B-04-3-03"),
    ("065", -3.00, -1.50, "B-04-3-04"), ("066", -3.50, -0.75, "B-04-3-05"),
    ("067", -3.75, -0.75, "B-04-3-06"), ("068", -4.50,  0.00, "B-04-2-01"),
    ("069", -2.25, -1.25, "B-04-2-02"), ("070", -4.25, -1.00, "B-04-2-03"),
    ("071", -1.25, -1.25, "B-04-2-04"), ("072", -4.25, -0.75, "B-04-2-05"),
    ("073", -4.50, -0.50, "B-04-2-06"), ("074", -4.00,  0.00, "B-04-4-01"),
    ("075", -0.25, -0.75, "B-04-4-02"), ("076", -2.75, -1.50, "B-04-4-03"),
    ("077", -3.75, -1.50, "B-04-4-04"), ("078", -5.00,  0.00, "B-04-4-05"),
    ("079", -1.25, -0.25, "B-04-4-06"), ("080", -1.75, -1.50, "B-04-1-01"),
    ("081", -3.00, -1.00, "B-04-1-02"), ("082", -3.00, -1.25, "B-04-1-03"),
    ("083", -3.25, -1.25, "B-04-1-04"), ("084", -3.25, -1.50, "B-04-1-05"),
    ("085", -4.50, -1.25, "B-04-1-06"), ("086", -4.75, -0.50, "B-04-5-01"),
    ("087", -5.25, -0.50, "B-04-5-02"), ("088",  0.00, -1.25, "B-04-5-03"),
    ("089",  0.00, -1.50, "B-04-5-04"), ("090", -0.50, -1.00, "B-04-5-05"),
    ("091", -2.75, -1.25, "B-04-5-06"), ("092", -3.75, -1.25, "B-05-3-01"),
    ("093", -4.00, -1.25, "B-05-3-02"), ("094", -4.25, -1.25, "B-05-3-03"),
    ("095", -1.00, -0.25, "B-05-3-04"), ("096", -1.50, -1.25, "B-05-3-05"),
    ("097", -3.50, -1.25, "B-05-3-06"), ("098", -5.00, -1.00, "B-05-2-01"),
    ("099", -5.25, -1.25, "B-05-2-02"), ("100", -0.25, -1.00, "B-05-2-03"),
    ("101", -1.00, -1.25, "B-05-2-04"), ("102", -1.75, -1.25, "B-05-2-05"),
    ("103", -2.00, -1.50, "B-05-2-06"), ("104",  0.00, -2.00, "B-05-4-01"),
    ("105", -3.50, -1.50, "C-06-3-01"), ("106", -4.75,  0.00, "C-06-3-02"),
    ("107", -5.25, -1.00, "C-06-3-03"), ("108", -0.25, -0.25, "C-06-3-04"),
    ("109", -2.00, -0.25, "C-06-3-05"), ("110", -2.75, -1.75, "C-06-3-06"),
    ("111", -3.75, -1.00, "C-06-2-01"), ("112", -4.00, -1.00, "C-06-2-02"),
    ("113", -4.50, -1.00, "C-06-2-03"), ("114", -4.75, -1.00, "C-06-2-04"),
    ("115", -4.75, -1.50, "C-06-2-05"), ("116", -5.00, -0.50, "C-06-2-06"),
    ("117", -5.00, -0.75, "C-06-4-01"), ("118", -5.00, -1.25, "C-06-4-02"),
    ("119",  0.00, -0.25, "C-06-4-03"), ("120", -0.50, -1.25, "C-06-4-04"),
    ("121", -1.25, -1.50, "C-06-4-05"), ("122", -4.25, -1.50, "C-06-4-06"),
    ("123", -4.50, -1.75, "C-06-1-01"), ("124", -5.50,  0.00, "C-06-1-02"),
    ("125", -6.00, -1.00, "C-06-1-03"), ("126", -0.50, -0.25, "C-06-1-04"),
    ("127", -1.50, -0.25, "C-06-1-05"), ("128", -1.50, -1.50, "C-06-1-06"),
    ("129", -1.75, -1.75, "C-06-5-01"), ("130", -2.00, -1.75, "C-06-5-02"),
    ("131", -2.25, -0.25, "C-06-5-03"), ("132", -2.25, -1.50, "C-06-5-04"),
    ("133", -2.50, -1.75, "C-06-5-05"), ("134", -3.00, -2.00, "C-06-5-06"),
    ("135", -4.00, -2.00, "C-07-3-01"), ("136", -4.75, -0.75, "C-07-3-02"),
    ("137", -5.25,  0.00, "C-07-3-03"), ("138", -5.25, -1.50, "C-07-3-04"),
    ("139", -5.50, -1.50, "C-07-3-05"), ("140", -1.00, -1.50, "C-07-3-06"),
    ("141", -1.50, -2.00, "C-07-2-01"), ("142", -2.00, -1.25, "C-07-2-02"),
    ("143", -2.50, -2.00, "C-07-2-03"), ("144", -3.50, -1.75, "C-07-2-04"),
    ("145", -0.25, -1.25, "C-07-2-05"), ("146", -0.50, -1.50, "C-07-2-06"),
    ("147", -0.75, -1.25, "C-07-4-01"), ("148", -0.75, -1.50, "C-07-4-02"),
    ("149", -2.00, -2.00, "C-07-4-03"), ("150", -3.00, -0.25, "C-07-4-04"),
    ("151", -3.00, -1.75, "C-07-4-05"), ("152", -4.25, -1.75, "C-07-4-06"),
    ("153", -5.25, -2.00, "C-07-1-01"), ("154", -0.75, -0.25, "C-07-1-02"),
    ("155", -1.00, -1.75, "C-07-1-03"), ("156", -1.50, -1.75, "C-07-1-04"),
    ("157", -1.75, -0.25, "C-07-1-05"), ("158", -1.75, -2.00, "C-07-1-06"),
    ("159", -2.25, -2.00, "C-07-5-01"), ("160", -3.25, -2.00, "C-07-5-02"),
    ("161", -4.00, -1.75, "C-07-5-03"), ("162", -4.50, -1.50, "C-07-5-04"),
    ("163", -5.25, -1.75, "C-07-5-05"), ("164", -5.50, -1.25, "C-07-5-06"),
    ("165", -5.75, -1.25, "C-08-3-01"), ("166", -5.75, -1.75, "C-08-3-02"),
    ("167", -6.00, -1.25, "C-08-3-03"), ("168", -0.25, -1.50, "C-08-3-04"),
    ("169", -0.50, -1.75, "C-08-3-05"), ("170", -0.75, -1.75, "C-08-3-06"),
    ("171", -2.25, -1.75, "C-08-2-01"), ("172", -2.50, -0.25, "C-08-2-02"),
    ("173", -3.75, -1.75, "C-08-2-03"), ("174", -3.75, -2.00, "C-08-2-04"),
    ("175", -4.75, -1.75, "C-08-2-05"), ("176", -4.75, -2.00, "C-08-2-06"),
    ("177", -5.00, -2.00, "C-08-4-01"), ("178", -5.50, -1.00, "C-08-4-02"),
    ("179", -5.75,  0.00, "C-08-4-03"), ("180", -5.75, -0.75, "C-08-4-04"),
    ("181",  0.00, -1.75, "C-08-4-05"), ("182", -0.75, -2.00, "C-08-4-06"),
    ("183", -4.00, -1.50, "C-08-1-01"), ("184", -4.75, -1.25, "C-08-1-02"),
    ("185", -5.00, -1.50, "C-08-1-03"), ("186", -5.00, -1.75, "C-08-1-04"),
    ("187", -5.50, -0.50, "C-08-1-05"), ("188", -5.50, -0.75, "C-08-1-06"),
    ("189", -6.00,  0.00, "C-08-5-01"), ("190", -0.25, -2.00, "C-08-5-02"),
    ("191", -0.50, -2.00, "C-08-5-03"), ("192", -1.00, -2.00, "C-08-5-04"),
    ("193", -1.25, -1.75, "C-08-5-05"), ("194", -1.25, -2.00, "C-08-5-06"),
    ("195", -2.75, -2.00, "C-09-3-01"), ("196", -3.50, -0.25, "C-09-3-02"),
    ("197", -4.25, -2.00, "C-09-3-03"), ("198", -5.25, -0.75, "C-09-3-04"),
    ("199", -5.50, -1.75, "C-09-3-05"), ("200", -5.75, -0.50, "C-09-3-06"),
    ("201", -5.75, -1.50, "C-09-2-01"), ("202", -6.00, -1.50, "C-09-2-02"),
    ("203", -6.00, -2.00, "C-09-2-03"), ("204", -3.25, -0.25, "C-09-2-04"),
    ("205", -3.25, -1.75, "C-09-2-05"), ("206", -3.50, -2.00, "C-09-2-06"),
    ("207", -4.50, -2.00, "C-09-4-01"), ("208", -5.50, -0.25, "C-09-4-02"),
    ("209", -5.75, -1.00, "C-09-4-03"), ("210", -6.00, -0.50, "C-09-4-04"),
    ("211", -6.00, -0.75, "C-09-4-05"), ("212", -2.75, -0.25, "C-09-4-06"),
    ("213", -3.75, -0.25, "C-09-1-01"), ("214", -4.00, -0.25, "C-09-1-02"),
    ("215", -4.50, -0.25, "C-09-1-03"), ("216", -4.75, -0.25, "C-09-1-04"),
    ("217", -5.25, -0.25, "C-09-1-05"), ("218", -5.50, -2.00, "C-09-1-06"),
    ("219", -5.75, -2.00, "C-09-5-01"),
]

# Build local index: (sku_name, sph_str, cyl_str) → {serial_no, bin}
_LOCAL_SKU_INDEX: dict[tuple, dict] = {}
for _serial, _sph, _cyl, _bin in _ULTRA_LOCAL:
    _LOCAL_SKU_INDEX[("Ultra双效", f"{_sph:.2f}", f"{_cyl:.2f}")] = {
        "serial_no": _serial, "bin": _bin
    }


# ── In-memory indexes (populated by load_master_tables) ─────────────────────

_agents: dict[str, dict] = {}          # agent_code → {id, name, address}
_stores: dict[str, dict] = {}          # store_name → {agent_code, agent_name, address, contact, phone}
_sku_location: dict[str, dict] = {}    # (product_sku, sph_str, cyl_str) → {serial_no, bin}
_sku_code: dict[str, dict] = {}        # serial_no → {lens_code, verify_url}


def load_local_tables() -> None:
    """Load all local data (no Feishu). Used in --dry-run / MVP mode."""
    _sku_location.update(_LOCAL_SKU_INDEX)
    _load_local_agents()
    load_mock_codes()
    log.info("本地主表加载完成: SKU=%d, 代理商=%d, 门店=%d, 码=%d",
             len(_sku_location), len(_agents), len(_stores), len(_sku_code))


def _load_local_agents() -> None:
    """Populate agent and store indexes from embedded local data."""
    from modules.local_master import LOCAL_AGENTS, LOCAL_STORES
    for code, name in LOCAL_AGENTS.items():
        if code not in _agents:
            _agents[code] = {"agent_id": code, "agent_name": name, "agent_address": ""}
    for store_name, info in LOCAL_STORES.items():
        if store_name not in _stores:
            _stores[store_name] = info
    log.info("本地代理商: %d 家, 终端门店: %d 家", len(_agents), len(_stores))


def load_master_tables() -> None:
    """Fetch all master tables from Feishu and build lookup indexes."""
    _load_local_agents()   # seed with local data first, Feishu overwrites if available
    _load_agents()
    _load_stores_from_feishu()
    _load_sku_location()
    _load_sku_code()


def _load_stores_from_feishu() -> None:
    table_id = TABLES.get("store", "")
    if not table_id:
        return
    rows = fc.list_records(table_id, field_names=[
        FIELDS["store_short"], FIELDS["store_display"], FIELDS["store_agent"],
        FIELDS["store_address"], FIELDS["store_contact"], FIELDS["store_phone"],
        FIELDS["store_active"],
    ])
    added = 0
    for row in rows:
        active = fc.text(row.get(FIELDS["store_active"], "")).strip()
        if active and active not in ("是", "yes", "true", "1"):
            continue
        short = fc.text(row.get(FIELDS["store_short"], "")).strip()
        display = fc.text(row.get(FIELDS["store_display"], "")).strip()
        if not short and not display:
            continue
        info = {
            "agent_code":  "",
            "agent_name":  fc.text(row.get(FIELDS["store_agent"], "")),
            "address":     fc.text(row.get(FIELDS["store_address"], "")),
            "contact":     fc.text(row.get(FIELDS["store_contact"], "")),
            "phone":       fc.text(row.get(FIELDS["store_phone"], "")),
        }
        for key in (short, display):
            if key:
                _stores[key] = info
                added += 1
    log.info("门店主数据表（飞书）: %d 条门店", added)


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
    table_id = TABLES.get("sku_location", "")
    if table_id:
        rows = fc.list_records(table_id, field_names=[
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
        log.info("SKU序列号映射（飞书）: %d 条", len(_sku_location))
    if not _sku_location:
        # Feishu table not configured or empty — fall back to hardcoded local data
        _sku_location.update(_LOCAL_SKU_INDEX)
        log.info("SKU序列号映射（本地）: %d 条", len(_sku_location))


def load_mock_codes() -> None:
    """Seed sku_code index with deterministic mock codes (one per serial 001-219)."""
    import hashlib
    from config import VERIFY_BASE_URL
    for serial, sph, cyl, _ in _ULTRA_LOCAL:
        raw = f"ultra-{serial}-{sph:.2f}-{cyl:.2f}"
        code = hashlib.md5(raw.encode()).hexdigest()[:16].upper()
        url = f"{VERIFY_BASE_URL}/{code}"
        _sku_code[serial] = {"lens_code": code, "verify_url": url}
    log.info("Mock镜片码: %d 个序列号", len(_sku_code))


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

    # 1b. Terminal store lookup — auto-fill address/contact if not in Excel
    store_name = rec.get("store_name", "").strip()
    if store_name and store_name in _stores:
        store = _stores[store_name]
        if not rec.get("address"):
            rec["address"] = store["address"]
        if not rec.get("contact"):
            rec["contact"] = store["contact"]
        if not rec.get("phone"):
            rec["phone"] = store["phone"]
        # If agent not identified from filename, derive from store
        if not agent_code and store.get("agent_code"):
            rec["agent_code"]    = store["agent_code"]
            rec["agent_id"]      = store["agent_code"]
            rec["agent_name"]    = store["agent_name"]
            rec["agent_address"] = ""
            rec["_match_errors"] = [e for e in rec["_match_errors"] if "代理商编号缺失" not in e]

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
