"""Feishu Bitable API client — token caching, pagination, batch write."""

import time
import json
import logging
import requests
from config import APP_ID, APP_SECRET, APP_TOKEN

log = logging.getLogger(__name__)

_token_cache = {"token": "", "expires_at": 0}
BASE = "https://open.feishu.cn/open-apis"
SESSION = requests.Session()
SESSION.headers.update({"Content-Type": "application/json"})


def _token() -> str:
    if time.time() < _token_cache["expires_at"] - 300:
        return _token_cache["token"]
    r = SESSION.post(
        f"{BASE}/auth/v3/tenant_access_token/internal",
        json={"app_id": APP_ID, "app_secret": APP_SECRET},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != 0:
        raise RuntimeError(f"Feishu auth failed: {data}")
    _token_cache["token"] = data["tenant_access_token"]
    _token_cache["expires_at"] = time.time() + data.get("expire", 7200)
    return _token_cache["token"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


# ── Read ──────────────────────────────────────────────────────────────────────

def list_records(table_id: str, field_names: list[str] | None = None) -> list[dict]:
    """Read all records from a table (auto-paginated). Returns list of field dicts."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records"
    params = {"page_size": 500}
    if field_names:
        params["field_names"] = json.dumps(field_names)

    results, page_token = [], None
    while True:
        if page_token:
            params["page_token"] = page_token
        r = SESSION.get(url, headers=_headers(), params=params, timeout=20)
        r.raise_for_status()
        body = r.json()
        if body.get("code") != 0:
            raise RuntimeError(f"list_records failed: {body}")
        data = body["data"]
        for item in (data.get("items") or []):
            results.append({"record_id": item["record_id"], **item["fields"]})
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    log.debug("list_records(%s): %d rows", table_id, len(results))
    return results


def search_records(table_id: str, filter_: dict, field_names: list[str] | None = None) -> list[dict]:
    """Search records with a filter. Returns list of field dicts."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records/search"
    payload: dict = {"page_size": 500, "filter": filter_}
    if field_names:
        payload["field_names"] = field_names

    results, page_token = [], None
    seen = set()
    while True:
        if page_token:
            payload["page_token"] = page_token
        r = SESSION.post(url, headers=_headers(), json=payload, timeout=20)
        r.raise_for_status()
        body = r.json()
        if body.get("code") != 0:
            raise RuntimeError(f"search_records failed: {body}")
        data = body["data"]
        for item in (data.get("items") or []):
            rid = item["record_id"]
            if rid not in seen:
                seen.add(rid)
                results.append({"record_id": rid, **item["fields"]})
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    return results


# ── Write ─────────────────────────────────────────────────────────────────────

def create_record(table_id: str, fields: dict) -> dict:
    """Create a single record. Returns the created record dict (with record_id)."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records"
    r = SESSION.post(url, headers=_headers(), json={"fields": fields}, timeout=15)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"create_record failed: {body}")
    return body["data"]["record"]


def update_record(table_id: str, record_id: str, fields: dict) -> None:
    """PATCH a single record's fields."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records/{record_id}"
    r = SESSION.put(url, headers=_headers(), json={"fields": fields}, timeout=15)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"update_record failed: {body}")


def delete_record(table_id: str, record_id: str) -> None:
    """Delete a single record."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records/{record_id}"
    r = SESSION.delete(url, headers=_headers(), timeout=15)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"delete_record failed: {body}")


def batch_create(table_id: str, records: list[dict]) -> int:
    """Batch create records (max 500/call). Returns total created count."""
    if not records:
        return 0
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records/batch_create"
    total = 0
    for i in range(0, len(records), 500):
        chunk = records[i:i + 500]
        r = SESSION.post(
            url,
            headers=_headers(),
            json={"records": [{"fields": rec} for rec in chunk]},
            timeout=30,
        )
        r.raise_for_status()
        body = r.json()
        if body.get("code") != 0:
            raise RuntimeError(f"batch_create failed: {body}")
        total += len(body["data"].get("records", []))
    return total


# ── Table management ───────────────────────────────────────────────────────────

def list_tables() -> list[dict]:
    """List all data tables in the app. Returns [{table_id, name, revision}, ...]."""
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables"
    params = {"page_size": 100}
    items, page_token = [], None
    while True:
        if page_token:
            params["page_token"] = page_token
        r = SESSION.get(url, headers=_headers(), params=params, timeout=20)
        r.raise_for_status()
        body = r.json()
        if body.get("code") != 0:
            raise RuntimeError(f"list_tables failed: {body}")
        data = body["data"]
        items.extend(data.get("items") or [])
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return items


def create_table(name: str, fields: list[dict]) -> str:
    """
    Create a new data table. fields=[{"field_name":.., "type":1}] —
    type 1=文本, 2=数字, 3=单选, 5=日期. The first field becomes the
    primary (index) field and must be a text-like type. Returns table_id.
    """
    url = f"{BASE}/bitable/v1/apps/{APP_TOKEN}/tables"
    payload = {"table": {"name": name, "fields": fields}}
    r = SESSION.post(url, headers=_headers(), json=payload, timeout=20)
    r.raise_for_status()
    body = r.json()
    if body.get("code") != 0:
        raise RuntimeError(f"create_table failed: {body}")
    return body["data"]["table_id"]


# ── Field value helpers ────────────────────────────────────────────────────────

def text(val) -> str:
    """Extract plain string from a Feishu field value (handles list/dict/str)."""
    if val is None:
        return ""
    if isinstance(val, list):
        parts = []
        for v in val:
            if isinstance(v, dict):
                parts.append(str(v.get("text", "") or v.get("name", "") or v.get("value", "")))
            else:
                parts.append(str(v))
        return "".join(parts)
    if isinstance(val, dict):
        return str(val.get("text", "") or val.get("name", "") or val.get("value", ""))
    return str(val)


def number(val) -> float | None:
    """Extract number from a Feishu field value."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
