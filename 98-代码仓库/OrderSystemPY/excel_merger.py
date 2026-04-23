"""
Excel 解析 + 列名模糊匹配 + 左右眼合并 + 校验
"""
import re
import pandas as pd


# 列名模糊匹配表: 规范名 -> 可接受的变体
COLUMN_ALIASES = {
    "顾客姓名": ["顾客姓名", "姓名", "患者姓名", "客户姓名", "name"],
    "眼别": ["眼别", "左右眼", "OD/OS", "眼", "eye"],
    "球镜SPH": ["球镜SPH", "球镜", "SPH", "S", "sph"],
    "柱镜CYL": ["柱镜CYL", "柱镜", "CYL", "C", "cyl"],
    "轴位AXIS": ["轴位AXIS", "轴位", "轴向", "AXIS", "A", "axis"],
    "产品型号": ["产品型号", "型号", "SKU", "产品", "product"],
    "数量": ["数量", "数量(片)", "片数", "qty"],
    "代理商名称": ["代理商名称", "代理商", "经销商", "dealer"],
    "终端客户": ["终端客户", "客户", "门店", "机构"],
    "联系人": ["联系人", "收件人"],
    "联系电话": ["联系电话", "电话", "手机", "phone"],
    "收货地址": ["收货地址", "地址", "address"],
    "备注": ["备注", "说明", "remark"],
}


def _match_column(df_columns, target_name):
    """模糊匹配列名,返回实际列名或 None"""
    aliases = COLUMN_ALIASES.get(target_name, [target_name])
    for alias in aliases:
        for col in df_columns:
            if col.strip().lower() == alias.strip().lower():
                return col
    return None


def _normalize_columns(df):
    """将 DataFrame 列名映射为规范名称"""
    mapping = {}
    for canonical in COLUMN_ALIASES:
        actual = _match_column(df.columns, canonical)
        if actual:
            mapping[actual] = canonical
    return df.rename(columns=mapping)


def merge_excels(excel_paths):
    """
    读取多个 Excel 文件,合并为统一格式的 DataFrame

    返回: (df, warnings)
        df: 合并后的 DataFrame,列名为规范名称
        warnings: 解析过程中的警告信息列表
    """
    warnings = []
    frames = []

    for path in excel_paths:
        try:
            raw = pd.read_excel(path, dtype=str)
            df = _normalize_columns(raw)

            if "顾客姓名" not in df.columns:
                warnings.append(f"{path.name}: 缺少「顾客姓名」列,跳过")
                continue

            df["_source_file"] = path.name
            frames.append(df)

        except Exception as e:
            warnings.append(f"{path.name}: 解析失败 - {e}")

    if not frames:
        return pd.DataFrame(), warnings

    merged = pd.concat(frames, ignore_index=True)
    return merged, warnings


def validate_records(df):
    """
    校验订单记录,分离有效和无效记录

    返回: (valid_df, failed_df)
    """
    if df.empty:
        return df, pd.DataFrame()

    failed_rows = []
    valid_mask = pd.Series(True, index=df.index)

    # 必填: 顾客姓名
    name_missing = df["顾客姓名"].isna() | (df["顾客姓名"].str.strip() == "")
    if name_missing.any():
        failed_rows.append(df[name_missing].assign(_fail_reason="顾客姓名为空"))
        valid_mask &= ~name_missing

    # 必填: 产品型号
    if "产品型号" in df.columns:
        prod_missing = df["产品型号"].isna() | (df["产品型号"].str.strip() == "")
        if prod_missing.any():
            failed_rows.append(df[prod_missing].assign(_fail_reason="产品型号为空"))
            valid_mask &= ~prod_missing

    # 必填: 代理商名称
    if "代理商名称" in df.columns:
        dealer_missing = df["代理商名称"].isna() | (df["代理商名称"].str.strip() == "")
        if dealer_missing.any():
            failed_rows.append(df[dealer_missing].assign(_fail_reason="代理商名称为空"))
            valid_mask &= ~dealer_missing

    # AXIS 校验 (0-180)
    for col in ["轴位AXIS"]:
        if col in df.columns:
            axis = pd.to_numeric(df[col], errors="coerce")
            bad_axis = df[col].notna() & (df[col].str.strip() != "") & ((axis < 0) | (axis > 180))
            if bad_axis.any():
                failed_rows.append(df[bad_axis].assign(_fail_reason=f"{col}超出0-180"))
                valid_mask &= ~bad_axis

    # 合并左右眼: 同一顾客+产品 合为一行
    valid_df = df[valid_mask].copy()

    # 提取左右眼
    has_eye = "眼别" in valid_df.columns
    if has_eye:
        right = valid_df[valid_df["眼别"].str.strip().str.contains("右|OD|od", na=False)]
        left = valid_df[valid_df["眼别"].str.strip().str.contains("左|OS|os", na=False)]

        # 对于有眼别的数据,按(顾客姓名,产品型号,代理商名称)合并
        group_keys = [k for k in ["顾客姓名", "产品型号", "代理商名称"] if k in valid_df.columns]
        if group_keys and len(right) > 0 and len(left) > 0:
            merged_rows = []
            for _, grp in valid_df.groupby(group_keys, dropna=False):
                r = grp.iloc[0].to_dict()
                r_row = grp[grp["眼别"].str.strip().str.contains("右|OD|od", na=False)]
                l_row = grp[grp["眼别"].str.strip().str.contains("左|OS|os", na=False)]

                if not r_row.empty:
                    r["右眼SPH"] = r_row.iloc[0].get("球镜SPH", "")
                    r["右眼CYL"] = r_row.iloc[0].get("柱镜CYL", "")
                    r["右眼AXIS"] = r_row.iloc[0].get("轴位AXIS", "")
                if not l_row.empty:
                    r["左眼SPH"] = l_row.iloc[0].get("球镜SPH", "")
                    r["左眼CYL"] = l_row.iloc[0].get("柱镜CYL", "")
                    r["左眼AXIS"] = l_row.iloc[0].get("轴位AXIS", "")

                merged_rows.append(r)
            valid_df = pd.DataFrame(merged_rows)
        else:
            # 没有明确左右眼区分,直接当作单行处理
            valid_df = valid_df.copy()
    else:
        # 没有眼别列,假设每行已包含左右眼
        pass

    # 确保输出列存在
    for col in ["右眼SPH", "右眼CYL", "右眼AXIS", "左眼SPH", "左眼CYL", "左眼AXIS"]:
        if col not in valid_df.columns:
            valid_df[col] = ""

    failed_df = pd.concat(failed_rows, ignore_index=True) if failed_rows else pd.DataFrame()

    return valid_df.reset_index(drop=True), failed_df
