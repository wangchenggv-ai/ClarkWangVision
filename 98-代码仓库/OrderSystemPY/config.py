"""
高视星订单批处理 — 配置管理
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ========== 路径 ==========
SCRIPT_DIR = Path(__file__).parent
INPUT_ROOT = SCRIPT_DIR / "inputs"
OUTPUT_ROOT = SCRIPT_DIR / "outputs"

# ========== 飞书 ==========
FEISHU_APP_ID = os.getenv("FEISHU_APP_ID", "")
FEISHU_APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
FEISHU_APP_TOKEN = os.getenv("FEISHU_APP_TOKEN", "")
FEISHU_ORDER_TABLE = os.getenv("FEISHU_ORDER_TABLE", "tblk9Ch4gk2uQ1zG")
FEISHU_LENS_TABLE = os.getenv("FEISHU_LENS_TABLE", "tblC7pve7ObFgIOl")

# ========== 溯源系统环境切换 ==========
SHUANG_ENV = os.getenv("SHUANG_ENV", "mock").lower()

_api_base_map = {
    "mock": os.getenv("SHUANG_API_BASE_MOCK", "http://localhost:3001/api"),
    "staging": os.getenv("SHUANG_API_BASE_STAGING", "http://localhost:3001/api"),
    "production": os.getenv("SHUANG_API_BASE_PRODUCTION", "https://api.gaushclear.com/api"),
}

if SHUANG_ENV not in _api_base_map:
    raise ValueError(
        f"SHUANG_ENV 必须是 mock/staging/production,当前是 {SHUANG_ENV}"
    )

SHUANG_API_BASE = _api_base_map[SHUANG_ENV]

# 生产环境二次确认(环境变量级)
CONFIRM_PRODUCTION = os.getenv("CONFIRM_PRODUCTION", "NO").upper()

# ========== 批处理保护参数 ==========
MAX_FAIL_RATE = float(os.getenv("MAX_FAIL_RATE", "0.05"))
API_DELAY = float(os.getenv("API_DELAY", "0.3"))

# ========== 审计日志目录 ==========
AUDIT_DIR = Path(os.getenv("AUDIT_DIR", str(OUTPUT_ROOT)))
