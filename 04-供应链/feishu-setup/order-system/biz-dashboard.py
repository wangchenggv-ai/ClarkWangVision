# -*- coding: utf-8 -*-
"""
业务看板生成器 — 读取飞书订单数据，生成深色主题单页HTML
使用: python biz-dashboard.py
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import json
import os
from datetime import datetime
from collections import defaultdict
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ─── 配置 ─────────────────────────────────────────────────

APP_TOKEN = "QrY0bFlW2abXjKsLYFtcBznkn1G"
ORDER_TABLE = "tblc9uHyRzrc6vu1"  # 销售订单表

# 从 .env 读取凭证
def load_env():
    env = {}
    try:
        with open(os.path.join(os.path.dirname(__file__), ".env"), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except:
        pass
    return env

_env = load_env()
APP_ID = _env.get("FEISHU_APP_ID", os.getenv("FEISHU_APP_ID", ""))
APP_SECRET = _env.get("FEISHU_APP_SECRET", os.getenv("FEISHU_APP_SECRET", ""))

BASE = "https://open.feishu.cn/open-apis"

# ─── 区域映射 ─────────────────────────────────────────────

region_map = {
    # 东区
    "上海戛桦": "东区", "上海瞳恩欣医疗科技有限公司": "东区", "上海聚势医药科技有限公司": "东区",
    "上海眺瞻医疗科技有限公司": "东区", "上海视路": "东区", "上海医视路": "东区",
    "苏州凌成科技发展有限公司": "东区", "南京嘉泽智丰光学有限公司": "东区", "南京博德眼科医院": "东区",
    "浙江致信医药科技有限公司": "东区", "长沙新辰医疗器械有限公司": "东区",
    "河南初玖医疗科技有限公司": "东区", "河南眼视康": "东区", "河南强晟": "东区",
    "成都锦牧加": "东区", "重庆博萃医疗器械有限公司": "东区",
    "武汉天视宏医疗器械有限公司": "东区",
    # 南区
    "深圳市视力康眼健康有限公司": "南区", "珠海科宏医疗器械有限公司": "南区", "广州云景商贸": "南区",
    "海南安适明": "南区", "厦门华厦视光中心有限公司": "南区", "昆明明德科技有限公司": "南区",
    "武汉亿祥昊医疗器械有限公司": "南区",
    # 西区
    "陕西博美乐贸易有限公司": "西区", "凌渡（西安）医疗管理有限责任公司": "西区",
    "西安美镜诚": "西区", "新疆德康达因苏商贸有限公司": "西区", "宁夏朗洁": "西区",
    # 北区
    "尧视共创（北京）科技有限公司": "北区", "北京澳美雅博": "北区", "北京东方拓普": "北区",
    "石家庄嘉悦润视光学科技有限公司": "北区", "药希望（天津）科技有限公司": "北区",
    "沈阳悦目星禾科技有限公司": "北区", "黑龙江方圆科技有限公司": "北区", "吉林省翔渲商贸有限公司": "北区",
    "青岛蓝健医疗科技有限公司": "北区", "山东瞳康": "北区", "成恩眼科": "北区",
    # 内部
    "内购订单": "内部",
}

region_colors = {
    "东区": "#3b82f6",  # 蓝
    "南区": "#10b981",  # 绿
    "西区": "#f59e0b",  # 橙
    "北区": "#ef4444",  # 红
}

# ─── HTTP 工具 ─────────────────────────────────────────────

def api(method, path, body=None, token=None):
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        print(f"API错误: {e.code} {e.read().decode()}")
        raise

def get_token():
    print("🔑 获取飞书token...")
    resp = api("POST", "/auth/v3/tenant_access_token/internal", {
        "app_id": APP_ID, "app_secret": APP_SECRET
    })
    print("✅ token获取成功")
    return resp["tenant_access_token"]

def list_records(token, table_id, page_size=500):
    items = []
    page_token = ""
    while True:
        params = f"?page_size={page_size}"
        if page_token:
            params += f"&page_token={page_token}"
        resp = api("GET", f"/bitable/v1/apps/{APP_TOKEN}/tables/{table_id}/records{params}", token=token)
        data = resp.get("data", {})
        if data:
            items.extend(data.get("items", []))
            print(f"   已读取 {len(items)} 条...", end="\r")
            page_token = data.get("page_token", "")
        else:
            break
        if not page_token:
            break
    print()
    return items

# ─── 数据处理 ─────────────────────────────────────────────

def extract_text(val):
    """从飞书字段值中提取文本"""
    if val is None:
        return ""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, list):
        # 飞书多选字段或富文本
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

def process_orders(records):
    orders = []
    for r in records:
        f = r.get("fields", {})
        
        # 日期处理 - 月份字段是文本格式 "2024-10"
        month = extract_text(f.get("月份") or "")
        if not month:
            # 尝试其他日期字段
            raw_date = f.get("下单日期") or f.get("日期") or f.get("创建时间") or ""
            if raw_date:
                try:
                    if isinstance(raw_date, (int, float)):
                        d = datetime.fromtimestamp(raw_date / 1000)
                        month = d.strftime("%Y-%m")
                    else:
                        month = str(raw_date)[:7]  # 取前7个字符作为月份
                except:
                    pass
        
        # 提取字段值 - 客户名称是代理商，终端门店是终端客户
        agent = extract_text(f.get("客户名称") or f.get("经销商") or f.get("代理商名称") or "")
        customer = extract_text(f.get("终端门店") or f.get("终端客户") or f.get("顾客姓名") or "")
        sku = extract_text(f.get("产品型号") or f.get("产品名称") or f.get("产品") or "")
        status = extract_text(f.get("订单状态") or f.get("状态") or "")
        
        # 数量处理
        qty_raw = f.get("数量") or f.get("发货数量") or 1
        try:
            qty = float(qty_raw)
        except:
            qty = 1
        
        if not agent and not customer:
            continue
            
        orders.append({
            "customer": customer,
            "agent": agent,  # 客户名称是代理商
            "sku": sku,
            "qty": qty,
            "status": status,
            "month": month,
        })
    return orders

def aggregate(orders):
    # 按代理商聚合
    agents = defaultdict(lambda: {"total": 0, "orders": 0, "months": defaultdict(int), "customers": defaultdict(int)})
    for o in orders:
        a = o["agent"]
        if not a:
            continue
        agents[a]["total"] += o["qty"]
        agents[a]["orders"] += 1
        if o["month"]:
            agents[a]["months"][o["month"]] += o["qty"]
        if o["customer"]:
            agents[a]["customers"][o["customer"]] += o["qty"]

    # 按月聚合
    monthly = defaultdict(int)
    for o in orders:
        if o["month"]:
            monthly[o["month"]] += o["qty"]

    # 按区域聚合
    regions = defaultdict(lambda: {"agents": [], "total": 0, "months": defaultdict(int)})
    for agent_name, data in agents.items():
        region = region_map.get(agent_name, "未分配")
        regions[region]["agents"].append({"name": agent_name, **data})
        regions[region]["total"] += data["total"]
        for m, q in data["months"].items():
            regions[region]["months"][m] += q

    return {
        "total_orders": len(orders),
        "total_qty": sum(o["qty"] for o in orders),
        "agents": sorted([{"name": k, **v} for k, v in agents.items()], key=lambda x: -x["total"]),
        "monthly": sorted([{"month": m, "qty": q} for m, q in monthly.items()], key=lambda x: x["month"]),
        "regions": dict(regions),
    }

# ─── 生成HTML ─────────────────────────────────────────────

def generate_html(data):
    total = data["total_qty"] or 1
    months = [m["month"] for m in data["monthly"]]
    months_len = len(months) or 1

    # 代理商表格
    agent_rows = ""
    for i, a in enumerate(data["agents"]):
        pct = round(a["total"] / total * 100)
        recent3 = sum(a["months"].get(m, 0) for m in months[-3:])
        prev3 = sum(a["months"].get(m, 0) for m in months[-6:-3])
        trend = round((recent3 - prev3) / prev3 * 100) if prev3 > 0 else 0
        region = region_map.get(a["name"], "未分配")
        color = region_colors.get(region, "#94a3b8")
        agent_rows += f"""<tr>
            <td>{i+1}</td>
            <td><span style="color:{color}">{region}</span></td>
            <td>{a['name']}</td>
            <td>{a['total']}</td>
            <td>{recent3}</td>
            <td><span class="badge {'trend-up' if trend>=0 else 'trend-down'}">{'+' if trend>=0 else ''}{trend}%</span></td>
            <td>{pct}%</td>
        </tr>"""

    # 区域tabs
    region_tabs = '<div class="region-tab active" data-region="all" onclick="selectRegion(\'all\')">全部区域</div>'
    for r in ["东区", "南区", "西区", "北区"]:
        if r in data["regions"]:
            region_tabs += f'<div class="region-tab" data-region="{r}" onclick="selectRegion(\'{r}\')">{r}</div>'

    # 区域数据JSON
    region_json = {}
    for r, d in data["regions"].items():
        if r == "内部":
            continue
        region_json[r] = {
            "total": d["total"],
            "months": dict(d["months"]),
            "agents": [{"name": a["name"], "total": a["total"], "months": dict(a["months"])} for a in d["agents"]]
        }

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>高视业务看板 · {datetime.now().strftime('%Y-%m-%d')}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }}
.header {{ background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%); padding: 24px 32px; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }}
h1 {{ font-size: 28px; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }}
.subtitle {{ color: #94a3b8; margin-top: 4px; }}
.container {{ max-width: 1400px; margin: 0 auto; padding: 24px; }}
.region-tabs {{ display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }}
.region-tab {{ padding: 12px 24px; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 15px; transition: all 0.3s; border: 2px solid transparent; }}
.region-tab:hover {{ transform: translateY(-2px); }}
.region-tab.active {{ border-color: currentColor; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }}
.region-tab[data-region="东区"] {{ background: rgba(59,130,246,0.2); color: #3b82f6; }}
.region-tab[data-region="南区"] {{ background: rgba(16,185,129,0.2); color: #10b981; }}
.region-tab[data-region="西区"] {{ background: rgba(245,158,11,0.2); color: #f59e0b; }}
.region-tab[data-region="北区"] {{ background: rgba(239,68,68,0.2); color: #ef4444; }}
.region-tab[data-region="all"] {{ background: rgba(148,163,184,0.2); color: #94a3b8; }}
.stats-row {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }}
.stat-card {{ background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }}
.stat-label {{ font-size: 13px; color: #94a3b8; }}
.stat-value {{ font-size: 32px; font-weight: 700; margin: 8px 0; }}
.stat-sub {{ font-size: 12px; color: #64748b; }}
.charts-row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }}
.chart-card {{ background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }}
.chart-title {{ font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #e2e8f0; }}
.agents-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }}
.agent-card {{ background: #1e293b; border-radius: 12px; padding: 16px; border: 1px solid #334155; transition: all 0.3s; }}
.agent-card:hover {{ border-color: #475569; transform: translateY(-2px); }}
.agent-name {{ font-weight: 600; margin-bottom: 8px; font-size: 14px; }}
.agent-stats {{ display: flex; gap: 20px; }}
.agent-stat-value {{ font-size: 22px; font-weight: 700; }}
.agent-stat-label {{ font-size: 11px; color: #64748b; }}
.table-card {{ background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; overflow-x: auto; }}
table {{ width: 100%; border-collapse: collapse; }}
th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #334155; }}
th {{ color: #94a3b8; font-weight: 600; font-size: 13px; }}
.badge {{ display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }}
.trend-up {{ background: rgba(16,185,129,0.2); color: #10b981; }}
.trend-down {{ background: rgba(239,68,68,0.2); color: #ef4444; }}
@media (max-width: 768px) {{ .stats-row, .charts-row {{ grid-template-columns: 1fr; }} }}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>高视业务看板</h1>
    <div class="subtitle">{months[0] if months else ''} - {months[-1] if months else ''} | 数据截至 {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
  </div>
</div>

<div class="container">
  <div class="region-tabs" id="regionTabs">{region_tabs}</div>
  <div class="stats-row" id="statsRow"></div>
  <div class="charts-row">
    <div class="chart-card"><div class="chart-title">订单占比</div><canvas id="pieChart" height="200"></canvas></div>
    <div class="chart-card"><div class="chart-title">月度趋势</div><canvas id="trendChart" height="200"></canvas></div>
  </div>
  <div class="chart-card" style="margin-bottom:24px"><div class="chart-title">代理商排名</div><div class="agents-grid" id="agentsGrid"></div></div>
  <div class="table-card">
    <div class="chart-title">代理商明细表</div>
    <table><thead><tr><th>排名</th><th>区域</th><th>代理商</th><th>总订单</th><th>近3月</th><th>趋势</th><th>占比</th></tr></thead>
    <tbody id="agentTable">{agent_rows}</tbody></table>
  </div>
</div>

<script>
const regionData = {json.dumps(region_json, ensure_ascii=False)};
const regionColors = {json.dumps(region_colors)};
const months = {json.dumps(months)};
const allAgents = {json.dumps([{"name": a["name"], "total": a["total"], "months": dict(a["months"]), "region": region_map.get(a["name"], "未分配")} for a in data["agents"]], ensure_ascii=False)};

let currentRegion = 'all';
let pieChart, trendChart;

function selectRegion(region) {{
    currentRegion = region;
    document.querySelectorAll('.region-tab').forEach(t => t.classList.toggle('active', t.dataset.region === region));
    updateDashboard();
}}

function getAgents() {{
    if (currentRegion === 'all') return allAgents;
    return (regionData[currentRegion]?.agents || []).map(a => ({{...a, region: currentRegion}}));
}}

function updateDashboard() {{
    const agents = getAgents();
    const totalOrders = agents.reduce((s, a) => s + a.total, 0);
    const recent3 = months.slice(-3);
    const recentOrders = agents.reduce((s, a) => s + recent3.reduce((ss, m) => ss + (a.months[m] || 0), 0), 0);
    const prev3 = months.slice(-6, -3);
    const prevOrders = agents.reduce((s, a) => s + prev3.reduce((ss, m) => ss + (a.months[m] || 0), 0), 0);
    const trend = prevOrders > 0 ? Math.round((recentOrders - prevOrders) / prevOrders * 100) : 0;

    document.getElementById('statsRow').innerHTML = `
        <div class="stat-card"><div class="stat-label">总订单数</div><div class="stat-value">${{totalOrders.toLocaleString()}}</div><div class="stat-sub">${{currentRegion === 'all' ? '全部区域' : currentRegion}}</div></div>
        <div class="stat-card"><div class="stat-label">代理商数</div><div class="stat-value">${{agents.length}}</div><div class="stat-sub">活跃客户</div></div>
        <div class="stat-card"><div class="stat-label">近3月订单</div><div class="stat-value">${{recentOrders.toLocaleString()}}</div><div class="stat-sub">最近3个月</div></div>
        <div class="stat-card"><div class="stat-label">环比趋势</div><div class="stat-value" style="color:${{trend >= 0 ? '#10b981' : '#ef4444'}}">${{trend >= 0 ? '+' : ''}}${{trend}}%</div><div class="stat-sub">vs 前3月</div></div>
    `;

    // 饼图
    if (pieChart) pieChart.destroy();
    const pieData = currentRegion === 'all'
        ? Object.entries(regionData).map(([r, d]) => ({{label: r, value: d.total, color: regionColors[r]}}))
        : agents.sort((a, b) => b.total - a.total).slice(0, 8).map(a => ({{label: a.name.substring(0, 6), value: a.total, color: regionColors[a.region]}}));
    pieChart = new Chart(document.getElementById('pieChart'), {{
        type: 'doughnut',
        data: {{ labels: pieData.map(d => d.label), datasets: [{{ data: pieData.map(d => d.value), backgroundColor: pieData.map(d => d.color) }}] }},
        options: {{ responsive: true, plugins: {{ legend: {{ position: 'right', labels: {{ color: '#94a3b8' }} }} }} }}
    }});

    // 趋势图
    if (trendChart) trendChart.destroy();
    if (currentRegion === 'all') {{
        trendChart = new Chart(document.getElementById('trendChart'), {{
            type: 'line',
            data: {{ labels: months, datasets: Object.entries(regionData).map(([r, d]) => ({{
                label: r, data: months.map(m => d.months[m] || 0), borderColor: regionColors[r], tension: 0.4, borderWidth: 2
            }}))}},
            options: {{ responsive: true, plugins: {{ legend: {{ labels: {{ color: '#94a3b8' }} }} }}, scales: {{ x: {{ ticks: {{ color: '#64748b' }} }}, y: {{ ticks: {{ color: '#64748b' }} }} }} }}
        }});
    }} else {{
        const topAgents = agents.sort((a, b) => b.total - a.total).slice(0, 5);
        const colors = ['#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#e879f9'];
        trendChart = new Chart(document.getElementById('trendChart'), {{
            type: 'line',
            data: {{ labels: months, datasets: topAgents.map((a, i) => ({{
                label: a.name.substring(0, 6), data: months.map(m => a.months[m] || 0), borderColor: colors[i], tension: 0.4, borderWidth: 2
            }}))}},
            options: {{ responsive: true, plugins: {{ legend: {{ labels: {{ color: '#94a3b8' }} }} }}, scales: {{ x: {{ ticks: {{ color: '#64748b' }} }}, y: {{ ticks: {{ color: '#64748b' }} }} }} }}
        }});
    }}

    // 代理商卡片
    document.getElementById('agentsGrid').innerHTML = agents.sort((a, b) => b.total - a.total).slice(0, 12).map(a => {{
        const recent = recent3.reduce((s, m) => s + (a.months[m] || 0), 0);
        return `<div class="agent-card">
            <div class="agent-name" style="color:${{regionColors[a.region] || '#94a3b8'}}">${{a.name}}</div>
            <div class="agent-stats">
                <div><div class="agent-stat-value">${{a.total}}</div><div class="agent-stat-label">总订单</div></div>
                <div><div class="agent-stat-value">${{recent}}</div><div class="agent-stat-label">近3月</div></div>
            </div>
        </div>`;
    }}).join('');

    // 表格
    document.getElementById('agentTable').innerHTML = agents.sort((a, b) => b.total - a.total).map((a, i) => {{
        const recent = recent3.reduce((s, m) => s + (a.months[m] || 0), 0);
        const prev = prev3.reduce((s, m) => s + (a.months[m] || 0), 0);
        const t = prev > 0 ? Math.round((recent - prev) / prev * 100) : 0;
        const share = Math.round(a.total / totalOrders * 100);
        return `<tr>
            <td>${{i + 1}}</td>
            <td><span style="color:${{regionColors[a.region] || '#94a3b8'}}">${{a.region}}</span></td>
            <td>${{a.name}}</td>
            <td>${{a.total}}</td>
            <td>${{recent}}</td>
            <td><span class="badge ${{t >= 0 ? 'trend-up' : 'trend-down'}}">${{t >= 0 ? '+' : ''}}${{t}}%</span></td>
            <td>${{share}}%</td>
        </tr>`;
    }}).join('');
}}

updateDashboard();
</script>
</body>
</html>'''
    return html

# ─── 主流程 ───────────────────────────────────────────────

def main():
    print("📊 高视业务看板生成器")
    print("=" * 50)

    if not APP_ID or not APP_SECRET:
        print("❌ 请配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET")
        print("   方式1: 在 .env 文件中配置")
        print("   方式2: 设置环境变量")
        sys.exit(1)

    token = get_token()

    print("📥 读取订单数据...")
    records = list_records(token, ORDER_TABLE)
    print(f"   获取 {len(records)} 条记录")

    print("🔄 处理数据...")
    orders = process_orders(records)
    data = aggregate(orders)

    print(f"   订单: {data['total_orders']} 单 / {data['total_qty']} 副")
    print(f"   代理商: {len(data['agents'])} 家")
    for r in ["东区", "南区", "西区", "北区"]:
        if r in data["regions"]:
            rd = data["regions"][r]
            print(f"   {r}: {len(rd['agents'])}家 / {rd['total']}副")

    print("📝 生成HTML...")
    html = generate_html(data)

    output = os.path.join(os.path.dirname(__file__), "biz-dashboard.html")
    with open(output, "w", encoding="utf-8") as f:
        f.write(html)

    print("=" * 50)
    print(f"✅ 已生成: {output}")
    print(f"   双击打开即可查看")

if __name__ == "__main__":
    main()
