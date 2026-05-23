# 业务看板文档

> 最后更新：2026-05-16

---

## 一、项目概述

业务看板是一个Python脚本，从飞书多维表格读取订单数据，生成单页HTML看板。

**功能：**
- 公司总览（KPI、月度趋势、SKU分布）
- 区域看板（东区/南区/西区/北区）
- 代理商排名（含趋势分析）
- 终端客户排名

**输出：** `biz-dashboard.html`（双击打开，无需服务器）

---

## 二、数据源

### 飞书表信息

| 项目 | 值 |
|------|-----|
| App Token | `QrY0bFlW2abXjKsLYFtcBznkn1G` |
| 表名 | 销售订单 |
| Table ID | `tblc9uHyRzrc6vu1` |
| 总记录数 | ~8900条 |

### 字段映射（重要！）

| 飞书字段名 | 字段类型 | 用途 | 提取方式 |
|-----------|---------|------|---------|
| `月份` | 列表（富文本） | 订单月份 | `extract_text()` 提取 `text` 字段 |
| `客户名称` | 关联字段 | **代理商名称** | `extract_text()` 提取 `text` 字段 |
| `终端门店` | 列表（富文本） | 终端客户名称 | `extract_text()` 提取 `text` 字段 |
| `产品型号` | 列表（富文本） | SKU名称 | `extract_text()` 提取 `text` 字段 |
| `数量` | 数字 | 订单数量 | 直接读取 |
| `订单状态` | 文本 | 订单状态 | 直接读取 |

**⚠️ 关键发现：**
- `客户名称` 字段是**代理商**（不是终端客户）
- `终端门店` 字段是**终端客户**
- `经销商` 字段为空，不使用
- 日期字段使用 `月份`（格式：`2026-05`），不是 `下单日期`

### 飞书字段值格式

飞书多维表格的字段值可能是以下格式：

```python
# 列表格式（富文本、多选）
[{'text': '2026-05', 'type': 'text'}]

# 关联字段格式
[{'record_ids': ['recXXX'], 'table_id': 'tblXXX', 'text': '公司名称', 'text_arr': ['公司名称']}]

# 纯文本
"直接文本"

# 数字
123
```

使用 `extract_text()` 函数统一处理。

---

## 三、区域映射

代理商按地理区域分为四区：

| 区域 | 代理商列表 |
|------|-----------|
| **东区** | 上海戛桦、上海瞳恩欣、上海聚势、上海眺瞻、上海视路、上海医视路、苏州凌成、南京嘉泽、南京博德、浙江致信、长沙新辰、河南初玖、河南眼视康、河南强晟、成都锦牧加、重庆博萃、武汉天视宏 |
| **南区** | 深圳视力康、珠海科宏、广州云景、海南安适明、厦门华厦、昆明明德、武汉亿祥昊 |
| **西区** | 陕西博美乐、凌渡西安、西安美镜诚、新疆德康达、宁夏朗洁 |
| **北区** | 尧视共创北京、北京澳美雅博、北京东方拓普、石家庄嘉悦润视、药希望天津、沈阳悦目星禾、黑龙江方圆、吉林翔渲、青岛蓝健、山东瞳康、成恩眼科 |
| **内部** | 内购订单（不计入统计） |

---

## 四、已知问题与解决方案

### 问题1：代理商数量错误（164家 vs 38家）

**原因：** 字段映射错误，使用了 `经销商` 字段（为空），导致每个终端客户被当作独立代理商。

**解决：** 使用 `客户名称` 字段作为代理商名称。

### 问题2：近3月订单显示为0

**原因：** 日期字段使用了 `下单日期`（为空），应该使用 `月份` 字段。

**解决：** 优先读取 `月份` 字段，格式为 `2026-05`。

### 问题3：数量字段解析错误

**原因：** 数量字段可能是小数（如 `0.5`），使用 `int()` 转换会报错。

**解决：** 使用 `float()` 转换。

### 问题4：飞书字段值格式复杂

**原因：** 飞书字段值可能是列表、字典或纯文本。

**解决：** 使用 `extract_text()` 函数统一处理。

---

## 五、使用方法

### 运行

```bash
cd C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system
python biz-dashboard.py
```

### 输出

生成 `biz-dashboard.html`，双击打开即可查看。

### 配置

需要在 `.env` 文件中配置飞书凭证：

```
FEISHU_APP_ID=cli_a958c5e372b85cb0
FEISHU_APP_SECRET=xxx
```

---

## 六、核心代码

### extract_text() 函数

```python
def extract_text(val):
    """从飞书字段值中提取文本"""
    if val is None:
        return ""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, list):
        texts = []
        for item in val:
            if isinstance(item, dict):
                t = item.get("text", "")
                if t:
                    texts.append(t)
            elif isinstance(item, str):
                texts.append(item)
        return " ".join(filter(None, texts)).strip()
    return str(val).strip()
```

### process_orders() 函数

```python
def process_orders(records):
    orders = []
    for r in records:
        f = r.get("fields", {})
        
        # 日期处理 - 月份字段是文本格式 "2026-05"
        month = extract_text(f.get("月份") or "")
        
        # 提取字段值 - 客户名称是代理商，终端门店是终端客户
        agent = extract_text(f.get("客户名称") or f.get("经销商") or "")
        customer = extract_text(f.get("终端门店") or f.get("终端客户") or "")
        sku = extract_text(f.get("产品型号") or f.get("产品名称") or "")
        
        # 数量处理
        qty_raw = f.get("数量") or 1
        try:
            qty = float(qty_raw)
        except:
            qty = 1
        
        orders.append({
            "customer": customer,
            "agent": agent,
            "sku": sku,
            "qty": qty,
            "month": month,
        })
    return orders
```

---

## 七、待优化

1. **缓存机制** - 避免每次都读取全部数据
2. **增量更新** - 只读取新增记录
3. **更多维度** - 按SKU、按季度分析
4. **自动刷新** - 定时生成看板

---

## 八、相关文件

| 文件 | 说明 |
|------|------|
| `biz-dashboard.py` | 主脚本 |
| `.env` | 飞书凭证配置 |
| `biz-dashboard.html` | 生成的看板（输出） |
| `docs/biz-dashboard.md` | 本文档 |
