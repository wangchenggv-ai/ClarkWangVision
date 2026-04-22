"""
高视星溯源管理后台 API 客户端 V3(加固版 + 分级保护)

V3 相对 V2 的新增:
  - 分级规模阈值(无感 / 警告 / 交互确认 / 硬阻断)
  - production 环境批量写入前交互确认
  - 失败阈值保护 + 审计日志保留

V2 基础能力:
  - 环境切换(mock/staging/production)
  - 生产环境二次确认(CONFIRM_PRODUCTION)
  - HTTP 重试 + 超时
  - get_zips_for_orders 精确匹配
  - _val() 覆盖所有空值

作者: Clark + Claude
日期: 2026-04-19
"""
import json
import math
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    SHUANG_API_BASE,
    SHUANG_ENV,
    CONFIRM_PRODUCTION,
    MAX_FAIL_RATE,
    AUDIT_DIR,
)

CN_TZ = timezone(timedelta(hours=8))

# ========== 分级规模阈值 ==========
THRESHOLD_SMALL = 10    # ≤10:无感,直接跑
THRESHOLD_MEDIUM = 50   # ≤50:警告,自动继续
THRESHOLD_LARGE = 300   # ≤300:production 要交互确认
# >300:需要 --yolo 参数解锁


class ProductionGuardError(Exception):
    """生产环境未二次确认"""


class BatchAbortError(Exception):
    """批量处理因失败率过高中止"""


class LargeBatchError(Exception):
    """批量规模超过阈值,需要显式解锁"""


class ShuangClient:
    def __init__(self):
        self.api_base = SHUANG_API_BASE
        self.env = SHUANG_ENV

        # 生产环境二次确认(环境变量级)
        if self.env == "production" and CONFIRM_PRODUCTION != "YES_I_AM_SURE":
            raise ProductionGuardError(
                "⚠️  当前指向生产溯源系统!\n"
                "   必须显式设置 CONFIRM_PRODUCTION=YES_I_AM_SURE 才能继续\n"
                "   命令示例(PowerShell):\n"
                "     $env:CONFIRM_PRODUCTION=\"YES_I_AM_SURE\"\n"
                "     python daily_batch.py\n"
                "   命令示例(bash):\n"
                "     CONFIRM_PRODUCTION=YES_I_AM_SURE python daily_batch.py"
            )

        # Session + 重试
        self.session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST", "GET"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        self.session.headers.update({
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://admin.gaushclear.com",
            "Referer": "https://admin.gaushclear.com/",
        })

        # 审计日志
        today = datetime.now(CN_TZ).strftime("%Y%m%d")
        self.audit_path = AUDIT_DIR / today / "audit_shuang.jsonl"
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"  [ShuangClient] env={self.env}, api={self.api_base}")

    # ---------- 核心接口 ----------

    def add_order(self, goods_name, barcode_num,
                  right_sph=None, right_cyl=None, right_axis=None,
                  left_sph=None, left_cyl=None, left_axis=None,
                  remark="", dealer=""):
        """新增一个溯源订单"""
        payload = {
            "goods_name": goods_name,
            "barcode_num": barcode_num,
            "right_qiujing": _val(right_sph),
            "right_zhujing": _val(right_cyl),
            "righy_zhouwei": _val(right_axis),  # 原系统拼写是 righy
            "left_qiujing": _val(left_sph),
            "left_zhujing": _val(left_cyl),
            "left_zhouwei": _val(left_axis),
            "remark": remark or "",
            "dealer": dealer or "",
        }
        r = self.session.post(
            f"{self.api_base}/securityOrderAdd",
            data=payload,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != 1000:
            raise RuntimeError(f"溯源系统新增失败: {data}")
        return data

    def list_orders(self, page=1, page_size=20):
        """查询订单列表(只读)"""
        r = self.session.post(
            f"{self.api_base}/securityOrderList",
            data={"page": page, "pageSize": page_size},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()

    def batch_add_orders(self, orders, delay=None, max_fail_rate=None, yolo=False):
        """
        批量新增订单,带分级保护 + 失败阈值

        参数:
            orders:        订单列表
            delay:         每次调用间隔,默认 config.API_DELAY
            max_fail_rate: 失败率阈值,默认 config.MAX_FAIL_RATE
            yolo:          超大批量解锁参数(>300 条必须 True)

        异常:
            BatchAbortError: 失败率超过阈值
            LargeBatchError: 规模超过 300 且未设 yolo=True
        """
        if delay is None:
            from config import API_DELAY
            delay = API_DELAY
        if max_fail_rate is None:
            max_fail_rate = MAX_FAIL_RATE

        total = len(orders)

        # ========== 分级规模保护 ==========
        self._enforce_batch_size_policy(total, yolo)

        success = []
        failed = []
        threshold = max(3, int(total * max_fail_rate))
        batch_start_time = datetime.now(CN_TZ).isoformat()

        print(f"\n  开始批量写入:{total} 条 → {self.env} ({self.api_base})")
        print(f"  审计日志: {self.audit_path}")
        print()

        for i, order in enumerate(orders, 1):
            try:
                result = self.add_order(**order)
                success.append({
                    **order,
                    "result": result,
                    "written_at": datetime.now(CN_TZ).isoformat()
                })
                self._audit("add_success", order, result)
                print(f"  [{i}/{total}] ✅ {order.get('remark', '未知')} - {order['goods_name']}")
            except Exception as e:
                failed.append({**order, "error": str(e)})
                self._audit("add_failed", order, {"error": str(e)})
                print(f"  [{i}/{total}] ❌ {order.get('remark', '未知')} - {e}")

                if len(failed) >= threshold:
                    msg = f"⚠️  失败数 {len(failed)} 达到阈值 {threshold},中止批处理"
                    print(msg)
                    self._audit("batch_aborted", {}, {
                        "message": msg,
                        "processed": i,
                        "total": total,
                    })
                    raise BatchAbortError(msg)

            if delay and i < total:
                time.sleep(delay)

        self._audit("batch_complete", {}, {
            "total": total,
            "success": len(success),
            "failed": len(failed),
            "batch_start": batch_start_time,
        })
        return success, failed

    # ---------- 分级规模保护 ----------

    def _enforce_batch_size_policy(self, total, yolo):
        """
        分级规模保护:
          ≤10:    无感,直接跑
          ≤50:    打印警告,自动继续
          ≤300:   production 环境要交互 Enter 确认
          >300:   必须 yolo=True(命令行 --yolo)
        """
        if total <= THRESHOLD_SMALL:
            # 小批量:无感
            return

        if total <= THRESHOLD_MEDIUM:
            print(f"\n  ⚠️  中批量写入: {total} 条(自动继续)")
            return

        if total <= THRESHOLD_LARGE:
            if self.env == "production":
                self._interactive_confirm(total)
            else:
                print(f"\n  ⚠️  大批量写入: {total} 条(非生产环境,自动继续)")
            return

        # >300:超大批量
        if not yolo:
            raise LargeBatchError(
                f"超大批量 {total} 条,超过默认上限 {THRESHOLD_LARGE}。\n"
                f"  如果确定要跑,请加 --yolo 参数解锁。\n"
                f"  如果不应该是这么多,请检查 Excel 是否异常。"
            )
        print(f"\n  🚨 超大批量写入: {total} 条(--yolo 已解锁)")

    def _interactive_confirm(self, total):
        """production 环境大批量交互确认"""
        banner = (
            f"\n  {'='*56}\n"
            f"  🔴 即将写入 {total} 条订单到生产溯源系统\n"
            f"  {'='*56}\n"
            f"  目标: {self.api_base}\n"
            f"  环境: PRODUCTION\n"
            f"  审计: {self.audit_path}\n"
            f"\n"
            f"  按 Enter 继续,Ctrl+C 取消..."
        )
        print(banner)
        try:
            input()
        except (EOFError, KeyboardInterrupt):
            print("\n  用户取消")
            sys.exit(130)

    # ---------- ZIP 精确匹配 ----------

    def get_zips_for_orders(self, written_orders, look_back=100):
        """按 (dealer, remark) 精确匹配 ZIP"""
        data = self.list_orders(page=1, page_size=look_back)
        if data.get("code") != 1000:
            return [], written_orders

        raw_list = data.get("data") or []
        if isinstance(raw_list, dict):
            raw_list = raw_list.get("list", [])

        index = {}
        for item in raw_list:
            key = (
                (item.get("dealer") or "").strip(),
                (item.get("remark") or "").strip(),
            )
            if key not in index:
                index[key] = item

        matched = []
        unmatched = []
        for order in written_orders:
            key = (
                (order.get("dealer") or "").strip(),
                (order.get("remark") or "").strip(),
            )
            hit = index.get(key)
            if hit and hit.get("barcode_url"):
                matched.append({"order": order, "zip_info": hit})
            else:
                unmatched.append(order)

        return matched, unmatched

    def download_zip(self, url, save_path):
        """下载 ZIP 文件到本地"""
        r = self.session.get(url, timeout=30)
        r.raise_for_status()
        save_path = Path(save_path)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "wb") as f:
            f.write(r.content)
        return save_path

    # ---------- 审计日志 ----------

    def _audit(self, action, order, result):
        """写一条 JSONL 审计日志"""
        log = {
            "ts": datetime.now(CN_TZ).isoformat(),
            "env": self.env,
            "action": action,
            "dealer": (order or {}).get("dealer"),
            "remark": (order or {}).get("remark"),
            "goods_name": (order or {}).get("goods_name"),
            "result": result,
        }
        with open(self.audit_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(log, ensure_ascii=False) + "\n")


# ---------- 工具函数 ----------

def _val(v):
    """安全转换为 API 字符串,处理所有空值形态"""
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    if isinstance(v, float) and math.isnan(v):
        return ""
    s = str(v).strip()
    if s.lower() in ("nan", "none", "null", "nat", ""):
        return ""
    return s
