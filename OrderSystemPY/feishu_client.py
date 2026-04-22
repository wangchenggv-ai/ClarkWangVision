"""
飞书 Bitable 客户端 — 幂等查询 + 批量写入
"""
import requests

from config import (
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
    FEISHU_APP_TOKEN,
    FEISHU_ORDER_TABLE,
    FEISHU_LENS_TABLE,
)


class FeishuClient:
    def __init__(self):
        self.app_token = FEISHU_APP_TOKEN
        self.order_table = FEISHU_ORDER_TABLE
        self.lens_table = FEISHU_LENS_TABLE
        self.base_url = "https://open.feishu.cn/open-apis"
        self.token = self._get_tenant_token()

    def _get_tenant_token(self):
        """获取 tenant_access_token"""
        r = requests.post(
            f"{self.base_url}/auth/v3/tenant_access_token/internal",
            json={
                "app_id": FEISHU_APP_ID,
                "app_secret": FEISHU_APP_SECRET,
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != 0:
            raise RuntimeError(f"获取飞书 token 失败: {data}")
        return data["tenant_access_token"]

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json; charset=utf-8",
        }

    def query_today_orders(self, date_str):
        """
        查询当天已存在的订单,返回 set: {"代理商名称|顾客姓名", ...}
        用于幂等去重
        """
        url = f"{self.base_url}/bitable/v1/apps/{self.app_token}/tables/{self.order_table}/records/search"

        existing = set()
        page_token = None

        while True:
            body = {
                "page_size": 500,
            }
            if page_token:
                body["page_token"] = page_token

            r = requests.post(url, headers=self._headers(), json=body, timeout=15)
            r.raise_for_status()
            data = r.json()

            if data.get("code") != 0:
                break

            items = data.get("data", {}).get("items", [])
            for item in items:
                fields = item.get("fields", {})
                dealer = str(fields.get("代理商名称", "")).strip()
                name = str(fields.get("顾客姓名", "")).strip()
                order_date = str(fields.get("下单日期", ""))

                # 只匹配当天的订单
                if date_str in order_date and dealer and name:
                    existing.add(f"{dealer}|{name}")

            if not data.get("data", {}).get("has_more"):
                break
            page_token = data["data"].get("page_token")

        return existing

    def batch_create_orders(self, df):
        """
        批量写入订单主表 + 镜片明细表

        返回: (success_list, failed_list)
        """
        success = []
        failed = []

        for _, row in df.iterrows():
            try:
                order_id = row.get("订单编号", "")
                name = row.get("顾客姓名", "")

                # 写订单主表
                order_fields = {
                    "订单编号": order_id,
                    "顾客姓名": name,
                    "产品型号": row.get("产品型号", ""),
                    "数量": int(row.get("数量", 2) or 2),
                    "代理商名称": row.get("代理商名称", ""),
                    "终端客户": row.get("终端客户", ""),
                    "联系人": row.get("联系人", ""),
                    "联系电话": str(row.get("联系电话", "")),
                    "收货地址": row.get("收货地址", ""),
                    "备注": row.get("备注", ""),
                    "订单状态": "待处理",
                    "订单来源": "批处理脚本",
                }

                self._create_record(self.order_table, order_fields)

                # 写镜片明细表 (左右眼各一条)
                for eye, sph_col, cyl_col, axis_col in [
                    ("右眼", "右眼SPH", "右眼CYL", "右眼AXIS"),
                    ("左眼", "左眼SPH", "左眼CYL", "左眼AXIS"),
                ]:
                    lens_fields = {
                        "镜片码": f"{order_id}_{eye}",
                        "订单编号": order_id,
                        "顾客姓名": name,
                        "产品型号": row.get("产品型号", ""),
                        "眼别": eye,
                        "球镜SPH": str(row.get(sph_col, "")),
                        "柱镜CYL": str(row.get(cyl_col, "")),
                        "轴位AXIS": str(row.get(axis_col, "")),
                    }
                    self._create_record(self.lens_table, lens_fields)

                success.append(row.to_dict())

            except Exception as e:
                failed.append({**row.to_dict(), "error": str(e)})

        return success, failed

    def _create_record(self, table_id, fields):
        """写入单条记录"""
        url = f"{self.base_url}/bitable/v1/apps/{self.app_token}/tables/{table_id}/records"
        r = requests.post(
            url,
            headers=self._headers(),
            json={"fields": fields},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != 0:
            raise RuntimeError(f"飞书写入失败: {data}")
        return data
