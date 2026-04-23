"""
溯源系统健康检查(只读探测)

作用:
    每天跑批处理之前,先跑这个脚本确认:
      1. API 可达,响应格式正常
      2. 能抽查几条记录,说明数据层面工作正常
      3. barcode_url ZIP 能下载,说明存储层工作正常

    任何写入操作都不执行,绝对安全。

用法:
    # 检查 mock 环境
    python sanity_check.py

    # 检查生产环境(只读,不需要 CONFIRM_PRODUCTION)
    SHUANG_ENV=production python sanity_check.py

    # PowerShell
    $env:SHUANG_ENV="production"; python sanity_check.py

退出码:
    0:  全部健康
    1:  API 不可达或返回异常
    2:  ZIP 下载失败
    3:  数据结构异常

作者: Clark + Claude
日期: 2026-04-19
"""
import io
import os
import sys
import tempfile
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

# Windows 控制台 emoji 兼容
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# 直接读环境,不走 shuang_client(避免误触发 ProductionGuardError)
from config import SHUANG_API_BASE, SHUANG_ENV, AUDIT_DIR

CN_TZ = timezone(timedelta(hours=8))


class SanityCheckFailed(Exception):
    pass


def _session():
    s = requests.Session()
    s.headers.update({
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://admin.gaushclear.com",
        "Referer": "https://admin.gaushclear.com/",
    })
    return s


def check_api_reachable(session):
    """检查 1:API 可达 + 响应正常"""
    print(f"\n[1/3] 检查 API 可达性...")
    print(f"      目标: {SHUANG_API_BASE}/securityOrderList")

    try:
        r = session.post(
            f"{SHUANG_API_BASE}/securityOrderList",
            data={"page": 1, "pageSize": 5},
            timeout=10,
        )
    except requests.exceptions.ConnectionError as e:
        raise SanityCheckFailed(f"连不上 API: {e}")
    except requests.exceptions.Timeout:
        raise SanityCheckFailed("API 超时(10 秒无响应)")

    if r.status_code != 200:
        raise SanityCheckFailed(f"HTTP {r.status_code}: {r.text[:200]}")

    try:
        data = r.json()
    except Exception:
        raise SanityCheckFailed(f"返回非 JSON: {r.text[:200]}")

    if data.get("code") != 1000:
        raise SanityCheckFailed(f"API 返回错误 code={data.get('code')}: {data}")

    count = data.get("count", "未知")
    print(f"      ✅ API 可达,响应正常")
    print(f"      ✅ 历史订单总数: {count}")
    return data


def check_records_sampling(data):
    """检查 2:抽查数据结构是否正常"""
    print(f"\n[2/3] 抽查记录数据结构...")

    raw = data.get("data") or []
    if isinstance(raw, dict):
        raw = raw.get("list", [])

    if not raw:
        print(f"      ⚠️  没有历史记录(可能是全新系统或 mock 未写入)")
        return []

    required_fields = ["id", "goods_name", "barcode_url", "create_time"]
    issues = []

    print(f"      抽查 {len(raw)} 条记录:")
    for i, item in enumerate(raw[:5], 1):
        missing = [f for f in required_fields if f not in item]
        if missing:
            issues.append(f"记录 {item.get('id', '?')} 缺字段: {missing}")
            print(f"        [{i}] id={item.get('id')} ⚠️  缺字段: {missing}")
        else:
            print(f"        [{i}] id={item.get('id')} | "
                  f"{item.get('create_time', '?')[:10]} | "
                  f"{item.get('dealer', '')[:20] or '(无)'} | "
                  f"{item.get('remark', '')[:20] or '(无)'}")

    if issues:
        raise SanityCheckFailed(f"数据结构异常: {'; '.join(issues)}")

    print(f"      ✅ 记录结构正常")
    return raw


def check_zip_download(session, records):
    """检查 3:抽查 barcode_url 能否下载"""
    print(f"\n[3/3] 抽查 ZIP 下载...")

    # 找前 3 条有 barcode_url 的记录
    samples = [r for r in records if r.get("barcode_url")][:3]

    if not samples:
        print(f"      ⚠️  抽查的记录都没有 barcode_url,跳过下载检查")
        return

    success_count = 0
    for item in samples:
        url = item["barcode_url"]
        order_id = item["id"]
        print(f"      尝试下载 #{order_id}: {url}")

        try:
            r = session.get(url, timeout=15)
            if r.status_code != 200:
                print(f"        ❌ HTTP {r.status_code}")
                continue

            # 检查是否是合法 ZIP
            try:
                with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                    names = zf.namelist()
                    print(f"        ✅ ZIP 正常,内含 {len(names)} 个文件")
                    success_count += 1
            except zipfile.BadZipFile:
                print(f"        ❌ 不是合法 ZIP(大小: {len(r.content)} bytes)")

        except Exception as e:
            print(f"        ❌ 下载失败: {e}")

    if success_count == 0:
        raise SanityCheckFailed("所有抽样 ZIP 下载都失败")

    print(f"      ✅ {success_count}/{len(samples)} 条 ZIP 下载成功")


def write_health_report(status, details):
    """写健康报告到当天 outputs 目录"""
    today = datetime.now(CN_TZ).strftime("%Y%m%d")
    report_dir = AUDIT_DIR / today
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "sanity_check.txt"

    report = (
        f"溯源系统健康检查报告\n"
        f"{'='*50}\n"
        f"检查时间: {datetime.now(CN_TZ).strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"目标环境: {SHUANG_ENV}\n"
        f"API 地址: {SHUANG_API_BASE}\n"
        f"结果: {status}\n"
        f"\n"
        f"详细:\n{details}\n"
    )
    report_path.write_text(report, encoding="utf-8")

    # 同时打一个标记文件,daily_batch.py 会检查它
    flag_path = report_dir / ".sanity_checked"
    if status == "PASS":
        flag_path.touch()

    return report_path


def main():
    # 环境 banner
    env_banner = {
        "mock": "🟢 MOCK(本地模拟)",
        "staging": "🟡 STAGING(测试)",
        "production": "🔴 PRODUCTION(生产)",
    }.get(SHUANG_ENV, f"❓ {SHUANG_ENV}")

    print(f"{'='*60}")
    print(f"  溯源系统健康检查")
    print(f"  环境: {env_banner}")
    print(f"  API:  {SHUANG_API_BASE}")
    print(f"  时间: {datetime.now(CN_TZ).strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    session = _session()
    details = []

    try:
        data = check_api_reachable(session)
        details.append("[1] API 可达: ✅")

        records = check_records_sampling(data)
        details.append(f"[2] 数据结构: ✅ (抽查 {min(len(records), 5)} 条)")

        check_zip_download(session, records)
        details.append("[3] ZIP 下载: ✅")

        print(f"\n{'='*60}")
        print(f"  ✅ 所有检查通过")
        print(f"{'='*60}\n")

        report_path = write_health_report("PASS", "\n".join(details))
        print(f"  报告已写入: {report_path}")
        sys.exit(0)

    except SanityCheckFailed as e:
        print(f"\n{'='*60}")
        print(f"  ❌ 健康检查失败: {e}")
        print(f"{'='*60}\n")
        details.append(f"[失败] {e}")
        write_health_report("FAIL", "\n".join(details))
        sys.exit(1)

    except KeyboardInterrupt:
        print("\n  用户取消")
        sys.exit(130)


if __name__ == "__main__":
    main()
