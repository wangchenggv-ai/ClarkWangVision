"""
config.py 增量配置(V2)

说明:
    把下面整段代码追加到你现有 config.py 末尾。
    如果你已经追加过 V1 版本,先删除旧的再追加这版(这版只是补充注释,逻辑不变)。

前提:
    现有 config.py 已加载 .env,即文件开头有:
        from dotenv import load_dotenv
        load_dotenv()
    并且已定义 INPUT_ROOT / OUTPUT_ROOT
"""
import os
from pathlib import Path

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
# 默认和 OUTPUT_ROOT 同一个目录
_default_audit = str(OUTPUT_ROOT) if 'OUTPUT_ROOT' in dir() else "./outputs"
AUDIT_DIR = Path(os.getenv("AUDIT_DIR", _default_audit))
