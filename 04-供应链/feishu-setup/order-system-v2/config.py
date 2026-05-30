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
    "agent":         "tblNobZtXkMJO2rj",  # 代理商表
    "store":         "tbllokLjXN47fQxg",  # 门店主数据表
    "customer":      "",                  # 终端客户（暂未使用）
    "sku_location":  "tblzrbrPFYLIc9sG",  # SKU序列号+货位（已迁飞书，加行即扩展）
    "sku_code":      "tblb1ojrIsIOKbMx",  # Ultra库存赋码
    "stock_detail":  "tblphzGMEp7ptXCf",  # 度数级成品库存
    "batch_order":   "tbl9KCmgvEE4DOp9",  # 批次汇总（每跑一批写一条）
    "order_detail":  "tbl5EaRw6lskfHLr",  # 镜片明细
    "order_main":    "tblCOgu81npwqGHT",  # 订单表（主视图）
}

# ── 字段名（飞书多维表格字段，改表结构只改这里）──
FIELDS = {
    # 代理商主表
    "agent_id":        "代理商ID",
    "agent_name":      "代理商名称",
    "agent_address":   "地址",
    "agent_status":    "状态",

    # 门店主数据表
    "store_display":   "门店显示名",
    "store_short":     "门店简称",
    "store_agent":     "所属代理商",
    "store_address":   "收货地址",
    "store_contact":   "收货联系人",
    "store_phone":     "收货电话",
    "store_active":    "是否激活",

    # SKU序列号+货位（sku_location）
    "serial_no":       "序列号",
    "product_sku":     "产品型号",
    "sph":             "球镜SPH",
    "cyl":             "柱镜CYL",
    "bin":             "货位",

    # SKU预赋码表（sku_code，一SKU一码）
    "sku_code_serial": "SKU序列号",
    "sku_code_value":  "镜片码",
    "sku_code_url":    "验证网址",

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
