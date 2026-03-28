/**
 * 供应链可视化看板 — 从飞书拉数据，生成 HTML 看板
 *
 * 用法: node dashboard.js
 * 生成 dashboard.html，浏览器打开即可
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  order: "tblk9Ch4gk2uQ1zG",
  ai_analysis: "tbl8W9F9K2RbaL0k",
};

let TOKEN = "";

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const json = await res.json();
    if (json.code !== 0) break;
    if (json.data.items) records.push(...json.data.items);
    if (!json.data.has_more) break;
    pageToken = json.data.page_token;
  }
  return records;
}

async function main() {
  console.log("Fetching data from Feishu ...");
  await getToken();

  const [skus, inventory, molds, production, orders, aiRecords] = await Promise.all([
    listRecords(TABLES.sku),
    listRecords(TABLES.finished_inventory),
    listRecords(TABLES.mold),
    listRecords(TABLES.production),
    listRecords(TABLES.order),
    listRecords(TABLES.ai_analysis),
  ]);

  console.log(`  SKU: ${skus.length}, Inventory: ${inventory.length}, Molds: ${molds.length}, Production: ${production.length}, Orders: ${orders.length}, AI: ${aiRecords.length}`);

  // --- Process data ---

  // SKU map
  const skuMap = {};
  for (const r of skus) skuMap[r.fields["SKU\u7F16\u53F7"]] = r.fields;

  // Inventory health
  const invData = inventory.map(r => {
    const f = r.fields;
    const sku = f["SKU"];
    const info = skuMap[sku] || {};
    return {
      sku,
      name: info["SKU\u540D\u79F0"] || sku,
      type: info["\u7C7B\u578B"] || "",
      current: Number(f["\u5F53\u524D\u5E93\u5B58"]) || 0,
      inProd: Number(f["\u5728\u4EA7\u91CF"]) || 0,
      safety: Number(info["\u5B89\u5168\u5E93\u5B58"]) || 0,
      status: f["\u72B6\u6001"] || "",
    };
  }).filter(d => d.type !== "\u5B9A\u5236\u54C1");

  // Inventory status counts
  const statusCounts = { ok: 0, low: 0, out: 0 };
  for (const d of invData) {
    if (d.current <= 0) statusCounts.out++;
    else if (d.current < d.safety) statusCounts.low++;
    else statusCounts.ok++;
  }

  // Mold data
  const moldData = molds.map(r => {
    const f = r.fields;
    return {
      id: f["\u6A21\u82AF\u7F16\u53F7"],
      sku: f["SKU"],
      total: Number(f["\u603B\u5BFF\u547D\uFF08\u6B21\uFF09"]) || 0,
      used: Number(f["\u5DF2\u4F7F\u7528\u6B21\u6570"]) || 0,
      remaining: Number(f["\u5269\u4F59\u6B21\u6570"]) || 0,
      threshold: Number(f["\u9884\u8B66\u9608\u503C"]) || 500,
      status: f["\u72B6\u6001"] || "",
    };
  });

  // Production plans
  const prodData = production.map(r => {
    const f = r.fields;
    return {
      week: f["\u5468\u6B21"],
      sku: f["SKU"],
      qty: Number(f["\u5EFA\u8BAE\u4EA7\u91CF"]) || 0,
      status: f["\u72B6\u6001"] || "",
      reason: f["\u89E6\u53D1\u539F\u56E0"] || "",
    };
  });

  // Orders by delivery type
  const orderStats = { inStock: 0, custom: 0, pending: 0 };
  const orderBySku = {};
  for (const r of orders) {
    const f = r.fields;
    const type = f["\u4EA4\u671F\u7C7B\u578B"];
    if (type === "\u6709\u8D273\u5929") orderStats.inStock++;
    else if (type === "\u5B9A\u52365\u5929") orderStats.custom++;
    if (!type) orderStats.pending++;
    const sku = f["SKU"];
    orderBySku[sku] = (orderBySku[sku] || 0) + (Number(f["\u6570\u91CF"]) || 0);
  }

  // Latest AI analysis
  let latestAI = "";
  if (aiRecords.length > 0) {
    const sorted = aiRecords.sort((a, b) => {
      const da = a.fields["\u5206\u6790\u65E5\u671F"] || 0;
      const db = b.fields["\u5206\u6790\u65E5\u671F"] || 0;
      return db - da;
    });
    latestAI = sorted[0].fields["AI\u5206\u6790\u5185\u5BB9"] || "";
    // Remove duplicate content (Coze sometimes doubles)
    const half = Math.floor(latestAI.length / 2);
    if (latestAI.length > 500 && latestAI.slice(0, 200) === latestAI.slice(half, half + 200)) {
      latestAI = latestAI.slice(0, half);
    }
  }

  // --- Generate HTML ---
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>眼镜供应链智能看板</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #0f1923; color: #e0e0e0; }
  .header { background: linear-gradient(135deg, #1a2a3a, #0d1b2a); padding: 20px 40px; border-bottom: 2px solid #1e90ff; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 24px; color: #1e90ff; letter-spacing: 2px; }
  .header .time { color: #888; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px; }
  .card { background: #1a2a3a; border-radius: 12px; padding: 20px; border: 1px solid #2a3a4a; }
  .card h3 { color: #1e90ff; font-size: 16px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #2a3a4a; }
  .card-full { grid-column: 1 / -1; }
  .card-2col { grid-column: span 2; }
  .chart { width: 100%; height: 280px; }
  .chart-tall { height: 320px; }

  /* KPI cards */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 20px 20px 0; }
  .kpi { background: #1a2a3a; border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #2a3a4a; }
  .kpi .num { font-size: 36px; font-weight: bold; margin: 8px 0; }
  .kpi .label { color: #888; font-size: 13px; }
  .kpi.green .num { color: #00c853; }
  .kpi.orange .num { color: #ff9800; }
  .kpi.red .num { color: #f44336; }
  .kpi.blue .num { color: #1e90ff; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #0d1b2a; color: #1e90ff; text-align: left; padding: 8px 12px; }
  td { padding: 8px 12px; border-bottom: 1px solid #2a3a4a; }
  tr:hover { background: #223344; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .tag-ok { background: #00c85322; color: #00c853; }
  .tag-warn { background: #ff980022; color: #ff9800; }
  .tag-danger { background: #f4433622; color: #f44336; }
  .tag-pending { background: #1e90ff22; color: #1e90ff; }

  /* AI section */
  .ai-content { font-size: 13px; line-height: 1.8; white-space: pre-wrap; max-height: 400px; overflow-y: auto; color: #ccc; }
  .ai-content::-webkit-scrollbar { width: 6px; }
  .ai-content::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

  /* Progress bar */
  .progress-bar { height: 8px; background: #2a3a4a; border-radius: 4px; overflow: hidden; margin-top: 4px; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
</style>
</head>
<body>

<div class="header">
  <h1>眼镜供应链智能看板</h1>
  <div class="time">数据更新: ${new Date().toLocaleString("zh-CN")}</div>
</div>

<!-- KPI -->
<div class="kpi-row">
  <div class="kpi blue">
    <div class="label">总订单数</div>
    <div class="num">${orders.length}</div>
    <div class="label">有货${orderStats.inStock} / 定制${orderStats.custom}</div>
  </div>
  <div class="kpi green">
    <div class="label">库存正常 SKU</div>
    <div class="num">${statusCounts.ok}</div>
    <div class="label">备货品</div>
  </div>
  <div class="kpi orange">
    <div class="label">低库存预警</div>
    <div class="num">${statusCounts.low}</div>
    <div class="label">需关注</div>
  </div>
  <div class="kpi red">
    <div class="label">缺货 SKU</div>
    <div class="num">${statusCounts.out}</div>
    <div class="label">紧急</div>
  </div>
</div>

<div class="grid">

  <!-- 库存健康度 -->
  <div class="card">
    <h3>库存健康度</h3>
    <div id="chart-health" class="chart"></div>
  </div>

  <!-- 库存 vs 安全线 -->
  <div class="card card-2col">
    <h3>各 SKU 库存 vs 安全线</h3>
    <div id="chart-inventory" class="chart"></div>
  </div>

  <!-- 模芯寿命 -->
  <div class="card">
    <h3>模芯寿命状态</h3>
    <div id="chart-mold" class="chart chart-tall"></div>
  </div>

  <!-- 订单分布 -->
  <div class="card">
    <h3>订单数量 by SKU</h3>
    <div id="chart-orders" class="chart chart-tall"></div>
  </div>

  <!-- 排产待确认 -->
  <div class="card">
    <h3>排产计划</h3>
    <table>
      <tr><th>SKU</th><th>建议产量</th><th>状态</th><th>原因</th></tr>
      ${prodData.map(d => `<tr>
        <td>${d.sku}</td>
        <td><strong>${d.qty}</strong></td>
        <td><span class="tag ${d.status === '\u5F85\u786E\u8BA4' ? 'tag-pending' : 'tag-ok'}">${d.status}</span></td>
        <td style="font-size:12px;color:#888">${d.reason}</td>
      </tr>`).join("")}
      ${prodData.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#666">暂无排产计划</td></tr>' : ''}
    </table>
  </div>

  <!-- 模芯详情 -->
  <div class="card card-full">
    <h3>模芯管理详情</h3>
    <table>
      <tr><th>模芯编号</th><th>对应 SKU</th><th>总寿命</th><th>已使用</th><th>剩余</th><th>使用率</th><th>状态</th></tr>
      ${moldData.map(d => {
        const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : 0;
        const color = d.remaining <= 50 ? '#f44336' : d.remaining < d.threshold ? '#ff9800' : '#00c853';
        const tag = d.remaining <= 50 ? 'tag-danger' : d.remaining < d.threshold ? 'tag-warn' : 'tag-ok';
        return `<tr>
          <td>${d.id}</td>
          <td>${d.sku}</td>
          <td>${d.total.toLocaleString()}</td>
          <td>${d.used.toLocaleString()}</td>
          <td><strong style="color:${color}">${d.remaining.toLocaleString()}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar" style="width:120px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
              <span>${pct}%</span>
            </div>
          </td>
          <td><span class="tag ${tag}">${d.status}</span></td>
        </tr>`;
      }).join("")}
    </table>
  </div>

  <!-- AI 分析 -->
  <div class="card card-full">
    <h3>AI 智能分析（最新）</h3>
    <div class="ai-content">${latestAI || "暂无分析记录"}</div>
  </div>

</div>

<script>
// 库存健康度饼图
echarts.init(document.getElementById('chart-health')).setOption({
  tooltip: { trigger: 'item' },
  series: [{
    type: 'pie', radius: ['45%', '70%'], center: ['50%', '55%'],
    label: { color: '#ccc', fontSize: 12 },
    data: [
      { value: ${statusCounts.ok}, name: '正常', itemStyle: { color: '#00c853' } },
      { value: ${statusCounts.low}, name: '低库存', itemStyle: { color: '#ff9800' } },
      { value: ${statusCounts.out}, name: '缺货', itemStyle: { color: '#f44336' } },
    ]
  }]
});

// 库存 vs 安全线柱状图
echarts.init(document.getElementById('chart-inventory')).setOption({
  tooltip: { trigger: 'axis' },
  legend: { data: ['当前库存', '在产量', '安全库存'], textStyle: { color: '#888' }, top: 0 },
  grid: { top: 30, bottom: 30, left: 50, right: 20 },
  xAxis: { type: 'category', data: ${JSON.stringify(invData.map(d => d.sku))}, axisLabel: { color: '#888', rotate: 30, fontSize: 11 } },
  yAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
  series: [
    { name: '当前库存', type: 'bar', stack: 'total', data: ${JSON.stringify(invData.map(d => d.current))}, itemStyle: { color: '#1e90ff' } },
    { name: '在产量', type: 'bar', stack: 'total', data: ${JSON.stringify(invData.map(d => d.inProd))}, itemStyle: { color: '#1e90ff44' } },
    { name: '安全库存', type: 'line', data: ${JSON.stringify(invData.map(d => d.safety))}, itemStyle: { color: '#f44336' }, lineStyle: { type: 'dashed' }, symbol: 'circle', symbolSize: 6 },
  ]
});

// 模芯寿命
echarts.init(document.getElementById('chart-mold')).setOption({
  tooltip: { trigger: 'axis' },
  grid: { top: 10, bottom: 30, left: 70, right: 20 },
  xAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
  yAxis: { type: 'category', data: ${JSON.stringify(moldData.map(d => d.id))}, axisLabel: { color: '#888' } },
  series: [
    { name: '已使用', type: 'bar', stack: 'life', data: ${JSON.stringify(moldData.map(d => d.used))}, itemStyle: { color: '#ff9800' } },
    { name: '剩余', type: 'bar', stack: 'life', data: ${JSON.stringify(moldData.map(d => d.remaining))},
      itemStyle: { color: function(p) { return ${JSON.stringify(moldData.map(d => d.remaining))}[p.dataIndex] < 500 ? '#f44336' : '#00c853'; } }
    },
  ]
});

// 订单 by SKU
const orderSkus = ${JSON.stringify(Object.keys(orderBySku))};
const orderQtys = ${JSON.stringify(Object.values(orderBySku))};
echarts.init(document.getElementById('chart-orders')).setOption({
  tooltip: { trigger: 'axis' },
  grid: { top: 10, bottom: 40, left: 50, right: 20 },
  xAxis: { type: 'category', data: orderSkus, axisLabel: { color: '#888', rotate: 30, fontSize: 11 } },
  yAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
  series: [{ type: 'bar', data: orderQtys, itemStyle: { color: '#7c4dff', borderRadius: [4, 4, 0, 0] } }]
});
</script>
</body>
</html>`;

  const outPath = resolve(__dirname, "dashboard.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`\nDashboard generated: ${outPath}`);
}

main().catch(console.error);
