import os
from dotenv import load_dotenv

load_dotenv()

# ── 飞书认证 ──
APP_ID     = os.environ["FEISHU_APP_ID"]
APP_SECRET = os.environ["FEISHU_APP_SECRET"]
APP_TOKEN  = os.environ["FEISHU_APP_TOKEN"]

VERIFY_BASE_URL = os.getenv("VERIFY_BASE_URL", "https://lab.gaushclear.com/verify")

# ── 飞书表 ID（单一真相源）──
# 新 Bitable: https://gausheyetech.feishu.cn/base/HN84b5k0Ia3KKisZIeecZeWCnHg
TABLES = {
    "agent":         "tbl2veixQEYp0RDI",  # 代理商+终端门店主表（新 Bitable）
    "customer":      "",                  # 终端门店独立表（暂未建）
    "sku_location":  "",                  # SKU序列号+货位（暂用本地数据）
    "sku_code":      "",                  # SKU预赋码表（待建，一SKU一码）
    "stock_detail":  "tbl7U79QGG4JtQev",  # 度数级库存表（旧系统）
    "batch_order":   "tbldOzNezl6xGDM2",  # 批次表（Phase 2）
    "order_detail":  "",                  # 订单明细表（Phase 2，建表后填入）
}

# ── 字段名（飞书多维表格字段，改表结构只改这里）──
FIELDS = {
    # 代理商主表
    "agent_id":        "代理商ID",
    "agent_name":      "代理商名称",
    "agent_address":   "地址",
    "agent_status":    "状态",

    # 终端门店主表
    "store_name":      "门店名称",
    "store_id":        "门店ID",
    "store_agent_id":  "代理商ID",

    # SKU序列号+货位（sku_location）
    "serial_no":       "序列号",
    "product_sku":     "产品型号",
    "sph":             "球镜SPH",
    "cyl":             "柱镜CYL",
    "bin":             "货位",

    # SKU预赋码表（sku_code，一SKU一码）
    "sku_code_serial": "序列号",
    "sku_code_value":  "镜片码",
    "sku_code_url":    "验真网址",

    # 度数级库存（stock_detail）
    "stock_sku":       "SKU编号",
    "stock_sph":       "SPH",
    "stock_cyl":       "CYL",
    "stock_qty":       "当前库存",
}

# ── Excel 输入列名变体映射（左边是标准字段，右边是可接受的列名列表）──
EXCEL_COLUMN_ALIASES = {
    "顾客姓名":  ["顾客姓名", "客户姓名", "姓名", "患者姓名"],
    "产品型号":  ["产品型号", "型号", "SKU", "产品"],
    "眼别":      ["眼别", "eye"],
    "SPH":       ["球镜SPH", "球镜", "SPH", "sph", "右眼SPH", "左眼SPH"],
    "CYL":       ["柱镜CYL", "柱镜", "CYL", "cyl", "右眼CYL", "左眼CYL"],
    "AXIS":      ["轴位AXIS", "轴位", "AXIS", "axis"],
    "是否装配":  ["是否装配", "装配", "配框"],
    "备注":      ["备注", "remark", "note"],
    "终端门店":  ["终端门店", "门店", "终端", "终端客户"],
    "联系人":    ["联系人", "收货人"],
    "联系电话":  ["联系电话", "电话", "手机"],
    "收货地址":  ["收货地址", "地址"],
}

# 有效的眼别值 → 标准化为 右眼/左眼
EYE_ALIASES = {
    "右眼": "右眼", "r": "右眼", "right": "右眼", "od": "右眼", "右": "右眼",
    "左眼": "左眼", "l": "左眼", "left":  "左眼", "os": "左眼", "左": "左眼",
}
