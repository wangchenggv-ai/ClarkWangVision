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
  blank_inventory: "tbladv6bQTXlNOlM",
  factory: "tblJ6RXFENJFQe9A",      // fill after migration
  procurement: "tblZX1qW7RvcJieg",  // fill after migration
  after_sales: "tblzr1b8kH9yERZt",  // fill after migration
  forecast: "tblFLAHOXLSgWS6Q",
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

  const [skus, inventory, molds, production, orders, aiRecords, forecasts] = await Promise.all([
    listRecords(TABLES.sku),
    listRecords(TABLES.finished_inventory),
    listRecords(TABLES.mold),
    listRecords(TABLES.production),
    listRecords(TABLES.order),
    listRecords(TABLES.ai_analysis),
    listRecords(TABLES.forecast),
  ]);

  // Fetch new tables conditionally
  const blanks = TABLES.blank_inventory ? await listRecords(TABLES.blank_inventory) : [];
  const factories = TABLES.factory ? await listRecords(TABLES.factory) : [];
  const procurements = TABLES.procurement ? await listRecords(TABLES.procurement) : [];
  const afterSalesData = TABLES.after_sales ? await listRecords(TABLES.after_sales) : [];

  console.log(`  SKU: ${skus.length}, Inventory: ${inventory.length}, Molds: ${molds.length}, Production: ${production.length}, Orders: ${orders.length}, AI: ${aiRecords.length}`);
  console.log(`  Blanks: ${blanks.length}, Factories: ${factories.length}, Procurement: ${procurements.length}, AfterSales: ${afterSalesData.length}`);

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

  // --- New KPI data ---

  // Blank inventory total
  const blankInvData = blanks.map(r => {
    const f = r.fields;
    return {
      sku: f["SKU"] || "",
      name: f["SKU名称"] || f["SKU"] || "",
      current: Number(f["当前毛坯库存"]) || 0,
      safety: Number(f["安全毛坯库存"]) || 0,
    };
  });
  const blankTotal = blankInvData.reduce((s, d) => s + d.current, 0);

  // Mold utilization rate (average of used/total)
  const moldUtilRates = moldData.filter(d => d.total > 0).map(d => d.used / d.total);
  const avgMoldUtil = moldUtilRates.length > 0
    ? Math.round(moldUtilRates.reduce((s, v) => s + v, 0) / moldUtilRates.length * 100)
    : 0;

  // Overdue order rate
  const now = Date.now();
  const completedStatuses = ["完成", "已发货", "已签收"];
  const activeOrders = orders.filter(r => !completedStatuses.includes(r.fields["订单状态"]));
  const overdueOrders = activeOrders.filter(r => {
    const due = r.fields["承诺交货日"];
    if (!due) return false;
    const dueTs = typeof due === "number" ? due : new Date(due).getTime();
    return dueTs < now;
  });
  const overdueRate = activeOrders.length > 0
    ? Math.round(overdueOrders.length / activeOrders.length * 100)
    : 0;

  // Pending procurement count
  const doneStatuses = ["已到货", "已取消"];
  const pendingProcurement = procurements.filter(r => !doneStatuses.includes(r.fields["状态"])).length;

  // --- New chart data ---

  // Factory load data
  const factoryData = factories.map(r => {
    const f = r.fields;
    return {
      name: f["车房名称"] || f["名称"] || "未知",
      queue: Number(f["当前排队量"]) || 0,
      capacity: Number(f["日产能"]) || 0,
    };
  });

  // After-sales by problem type
  const afterSalesByType = {};
  for (const r of afterSalesData) {
    const t = r.fields["问题类型"] || "其他";
    afterSalesByType[t] = (afterSalesByType[t] || 0) + 1;
  }

  // Procurement by status
  const procByStatus = {};
  for (const r of procurements) {
    const s = r.fields["状态"] || "未知";
    procByStatus[s] = (procByStatus[s] || 0) + 1;
  }

  // --- Delivery Performance Analysis ---

  // Actual delivery metrics
  let delivActualFill = 0, delivInStock = 0, delivCustom = 0, delivProcessed = 0;
  let delivOverdue = 0, delivOnTime = 0, delivPending = 0;
  const delivSkuStats = {};
  for (const r of orders) {
    const f = r.fields;
    const sku = f["SKU"] || "";
    const dt = f["交期类型"] || "";
    if (!delivSkuStats[sku]) delivSkuStats[sku] = { total: 0, inStock: 0, totalQty: 0, overdue: 0 };
    delivSkuStats[sku].total++;
    delivSkuStats[sku].totalQty += Number(f["数量"]) || 0;
    if (dt.includes("有货")) { delivInStock++; delivSkuStats[sku].inStock++; }
    else if (dt.includes("定制")) { delivCustom++; }
    const status = f["订单状态"] || "";
    const promiseDate = f["承诺交货日"];
    if (promiseDate) {
      const pTs = typeof promiseDate === "number" ? promiseDate : new Date(promiseDate).getTime();
      if (["已发货","完成","已签收"].includes(status)) delivOnTime++;
      else if (pTs < now) { delivOverdue++; delivSkuStats[sku].overdue++; }
      else delivPending++;
    }
  }
  delivProcessed = delivInStock + delivCustom;
  delivActualFill = delivProcessed > 0 ? (delivInStock / delivProcessed * 100) : 0;
  const delivOverdueRate = (delivOverdue + delivPending + delivOnTime) > 0
    ? (delivOverdue / (delivOverdue + delivPending + delivOnTime) * 100) : 0;

  // Predicted delivery metrics
  const invMapDeliv = {};
  for (const r of inventory) invMapDeliv[r.fields["SKU"]] = r.fields;
  const demandMap = {};
  for (const r of forecasts) {
    const sku = r.fields["SKU"];
    demandMap[sku] = (demandMap[sku] || 0) + (r.fields["预测销量"] || 0);
  }
  let canFulfill = 0, cannotFulfill = 0;
  const skuPredictions = {};
  for (const r of skus) {
    const f = r.fields;
    const sku = f["SKU编号"];
    const safety = f["安全库存"] || 0;
    const inv = invMapDeliv[sku] || {};
    const stock = Number(inv["当前库存"]) || 0;
    const demand = demandMap[sku] || 0;
    const weekly = demand / 2;
    const coverage = weekly > 0 ? stock / weekly : (stock > 0 ? 99 : 0);
    const ok = stock >= safety && stock > 0;
    if (ok) canFulfill++; else cannotFulfill++;
    skuPredictions[sku] = { stock, safety, weekly, coverage: Math.round(coverage * 10) / 10, ok, abc: f["ABC分类"] || "?" };
  }
  const predictedFill = (canFulfill + cannotFulfill) > 0 ? (canFulfill / (canFulfill + cannotFulfill) * 100) : 0;

  // Gap analysis — top problem SKUs
  const gapSKUs = [];
  for (const [sku, pred] of Object.entries(skuPredictions)) {
    const act = delivSkuStats[sku] || { total: 0, inStock: 0, totalQty: 0, overdue: 0 };
    if (act.total === 0) continue;
    const actualFill = act.inStock / act.total * 100;
    gapSKUs.push({ sku, abc: pred.abc, orders: act.total, qty: act.totalQty, fill: Math.round(actualFill), stock: pred.stock, cover: pred.coverage, overdue: act.overdue });
  }
  gapSKUs.sort((a, b) => {
    const aw = (a.abc === "A" ? 3 : a.abc === "B" ? 2 : 1) * a.orders;
    const bw = (b.abc === "A" ? 3 : b.abc === "B" ? 2 : 1) * b.orders;
    return a.fill - b.fill || bw - aw;
  });
  const topGaps = gapSKUs.filter(s => s.fill < 80).slice(0, 10);

  // Simulation (lightweight — estimate improvement from buffer stock)
  const simScenarios = [
    { name: "当前状态", weeks: 0, mult: 1.0 },
    { name: "安全库存 +50%", weeks: 0, mult: 1.5 },
    { name: "+1周缓冲库存", weeks: 1, mult: 1.0 },
    { name: "+2周缓冲库存", weeks: 2, mult: 1.0 },
    { name: "安全+50% & +1周", weeks: 1, mult: 1.5 },
  ];
  const simResults = simScenarios.map(sc => {
    let improved = 0, total = 0;
    for (const [sku, pred] of Object.entries(skuPredictions)) {
      const act = delivSkuStats[sku];
      if (!act || act.total === 0) continue;
      total++;
      let simStock = pred.stock + Math.ceil(pred.weekly * sc.weeks);
      let simSafety = Math.ceil(pred.safety * sc.mult);
      if (simStock >= simSafety && simStock > 0) improved++;
    }
    return { name: sc.name, fill: total > 0 ? Math.round(improved / total * 100) : 0, improved, total };
  });

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

<!-- KPI Row 2 -->
<div class="kpi-row">
  <div class="kpi ${blankTotal > 2000 ? 'green' : 'red'}">
    <div class="label">毛坯库存</div>
    <div class="num">${blankTotal.toLocaleString()}</div>
    <div class="label">${blanks.length} 个 SKU</div>
  </div>
  <div class="kpi ${avgMoldUtil > 80 ? 'red' : avgMoldUtil > 60 ? 'orange' : 'green'}">
    <div class="label">模芯使用率</div>
    <div class="num">${avgMoldUtil}%</div>
    <div class="label">平均寿命消耗</div>
  </div>
  <div class="kpi ${overdueRate > 20 ? 'red' : overdueRate > 10 ? 'orange' : 'green'}">
    <div class="label">订单超期率</div>
    <div class="num">${overdueRate}%</div>
    <div class="label">${overdueOrders.length}/${activeOrders.length} 笔超期</div>
  </div>
  <div class="kpi ${pendingProcurement > 5 ? 'orange' : 'blue'}">
    <div class="label">待处理采购</div>
    <div class="num">${pendingProcurement}</div>
    <div class="label">进行中</div>
  </div>
</div>

<!-- Delivery Performance Section -->
<div style="padding:20px 20px 0">
  <div style="background: #1a2a3a; border-radius: 12px; padding: 20px; border: 2px solid #1e90ff;">
    <h3 style="color:#1e90ff; font-size:18px; margin-bottom:16px; padding-bottom:10px; border-bottom:2px solid #1e90ff;">交付水平分析引擎</h3>
    <div class="kpi-row" style="padding:0;">
      <div class="kpi ${delivActualFill >= 80 ? 'green' : delivActualFill >= 50 ? 'orange' : 'red'}" style="background:#0d1b2a">
        <div class="label">实际填充率</div>
        <div class="num">${delivActualFill.toFixed(1)}%</div>
        <div class="label">有货${delivInStock} / 总${delivProcessed}单</div>
      </div>
      <div class="kpi ${predictedFill >= 80 ? 'green' : predictedFill >= 50 ? 'orange' : 'red'}" style="background:#0d1b2a">
        <div class="label">预测填充率</div>
        <div class="num">${predictedFill.toFixed(1)}%</div>
        <div class="label">${canFulfill}/${canFulfill + cannotFulfill} SKU可履约</div>
      </div>
      <div class="kpi ${delivOverdueRate <= 5 ? 'green' : delivOverdueRate <= 15 ? 'orange' : 'red'}" style="background:#0d1b2a">
        <div class="label">超期率</div>
        <div class="num">${delivOverdueRate.toFixed(1)}%</div>
        <div class="label">超期${delivOverdue} / 准时${delivOnTime}</div>
      </div>
      <div class="kpi blue" style="background:#0d1b2a">
        <div class="label">最优模拟方案</div>
        <div class="num">${simResults.reduce((b, s) => s.fill > b.fill ? s : b).fill}%</div>
        <div class="label">${simResults.reduce((b, s) => s.fill > b.fill ? s : b).name}</div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-top:16px;">
      <div>
        <h3 style="color:#1e90ff; font-size:14px; margin-bottom:8px; border:none; padding:0;">模拟优化方案对比</h3>
        <div id="chart-simulation" style="width:100%; height:250px;"></div>
      </div>
      <div>
        <h3 style="color:#1e90ff; font-size:14px; margin-bottom:8px; border:none; padding:0;">交付差距 Top SKU (填充率 &lt; 80%)</h3>
        <div style="max-height:250px; overflow-y:auto;">
          <table>
            <tr><th>SKU</th><th>ABC</th><th>订单</th><th>填充率</th><th>库存</th><th>覆盖(周)</th></tr>
            ${topGaps.map(s => {
              const fillColor = s.fill === 0 ? '#f44336' : s.fill < 50 ? '#ff9800' : '#ffeb3b';
              return '<tr>' +
                '<td style="font-size:12px">' + s.sku + '</td>' +
                '<td><span class="tag ' + (s.abc === 'A' ? 'tag-danger' : s.abc === 'B' ? 'tag-warn' : 'tag-ok') + '">' + s.abc + '</span></td>' +
                '<td>' + s.orders + '</td>' +
                '<td><strong style="color:' + fillColor + '">' + s.fill + '%</strong></td>' +
                '<td>' + s.stock + '</td>' +
                '<td>' + s.cover + '</td>' +
              '</tr>';
            }).join("")}
            ${topGaps.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#666">All SKU fill rate >= 80%</td></tr>' : ''}
          </table>
        </div>
      </div>
    </div>
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

  <!-- 毛坯库存 -->
  <div class="card card-2col">
    <h3>毛坯库存 vs 安全线</h3>
    <div id="chart-blanks" class="chart"></div>
  </div>

  <!-- 车房负载 -->
  <div class="card">
    <h3>车房负载</h3>
    <div id="chart-factory" class="chart chart-tall"></div>
  </div>

  <!-- 售后问题分布 -->
  <div class="card">
    <h3>售后问题分布</h3>
    <div id="chart-aftersales" class="chart"></div>
  </div>

  <!-- 采购管线 -->
  <div class="card">
    <h3>采购管线</h3>
    <div id="chart-procurement" class="chart"></div>
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

// Chart 5: Blank inventory bar chart
(function() {
  const el = document.getElementById('chart-blanks');
  if (!el) return;
  const names = ${JSON.stringify(blankInvData.map(d => d.name || d.sku))};
  const currents = ${JSON.stringify(blankInvData.map(d => d.current))};
  const safeties = ${JSON.stringify(blankInvData.map(d => d.safety))};
  if (names.length === 0) { el.innerHTML = '<div style="text-align:center;color:#666;padding-top:80px">暂无毛坯库存数据</div>'; return; }
  echarts.init(el).setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['当前毛坯库存', '安全毛坯库存'], textStyle: { color: '#888' }, top: 0 },
    grid: { top: 30, bottom: 30, left: 50, right: 20 },
    xAxis: { type: 'category', data: names, axisLabel: { color: '#888', rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
    series: [
      { name: '当前毛坯库存', type: 'bar', data: currents, itemStyle: { color: '#26a69a', borderRadius: [4,4,0,0] } },
      { name: '安全毛坯库存', type: 'line', data: safeties, itemStyle: { color: '#f44336' }, lineStyle: { type: 'dashed' }, symbol: 'circle', symbolSize: 6 },
    ]
  });
})();

// Chart 6: Factory load horizontal bar
(function() {
  const el = document.getElementById('chart-factory');
  if (!el) return;
  const names = ${JSON.stringify(factoryData.map(d => d.name))};
  const queues = ${JSON.stringify(factoryData.map(d => d.queue))};
  const caps = ${JSON.stringify(factoryData.map(d => d.capacity))};
  if (names.length === 0) { el.innerHTML = '<div style="text-align:center;color:#666;padding-top:80px">暂无车房数据</div>'; return; }
  echarts.init(el).setOption({
    tooltip: { trigger: 'axis', formatter: function(params) {
      const name = params[0].name;
      let s = name + '<br/>';
      params.forEach(p => { s += p.marker + p.seriesName + ': ' + p.value + '<br/>'; });
      if (caps[params[0].dataIndex] > 0) {
        s += '利用率: ' + Math.round(queues[params[0].dataIndex] / caps[params[0].dataIndex] * 100) + '%';
      }
      return s;
    }},
    grid: { top: 10, bottom: 30, left: 80, right: 20 },
    xAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: '#888' } },
    series: [
      { name: '当前排队量', type: 'bar', data: queues, itemStyle: { color: '#ff9800' } },
      { name: '日产能', type: 'bar', data: caps, itemStyle: { color: '#00c85344' } },
    ]
  });
})();

// Chart 7: After-sales issues pie
(function() {
  const el = document.getElementById('chart-aftersales');
  if (!el) return;
  const data = ${JSON.stringify(Object.entries(afterSalesByType).map(([k, v]) => ({ name: k, value: v })))};
  if (data.length === 0) { el.innerHTML = '<div style="text-align:center;color:#666;padding-top:80px">暂无售后数据</div>'; return; }
  const colors = ['#1e90ff', '#ff9800', '#f44336', '#00c853', '#7c4dff', '#e91e63', '#00bcd4', '#ffeb3b'];
  echarts.init(el).setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['40%', '65%'], center: ['50%', '55%'],
      label: { color: '#ccc', fontSize: 11 },
      data: data.map(function(d, i) { return { value: d.value, name: d.name, itemStyle: { color: colors[i % colors.length] } }; })
    }]
  });
})();

// Chart 8: Procurement pipeline bar
(function() {
  const el = document.getElementById('chart-procurement');
  if (!el) return;
  const statuses = ${JSON.stringify(Object.keys(procByStatus))};
  const counts = ${JSON.stringify(Object.values(procByStatus))};
  if (statuses.length === 0) { el.innerHTML = '<div style="text-align:center;color:#666;padding-top:80px">暂无采购数据</div>'; return; }
  const colors = statuses.map(function(s) {
    if (s === '已到货') return '#00c853';
    if (s === '已取消') return '#666';
    if (s === '运输中') return '#1e90ff';
    if (s === '待下单') return '#ff9800';
    return '#7c4dff';
  });
  echarts.init(el).setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 10, bottom: 40, left: 50, right: 20 },
    xAxis: { type: 'category', data: statuses, axisLabel: { color: '#888', fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { color: '#888' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
    series: [{ type: 'bar', data: counts.map(function(v, i) { return { value: v, itemStyle: { color: colors[i], borderRadius: [4,4,0,0] } }; }) }]
  });
})();

// Chart: Simulation results bar chart
(function() {
  var el = document.getElementById('chart-simulation');
  if (!el) return;
  var names = ${JSON.stringify(simResults.map(s => s.name))};
  var fills = ${JSON.stringify(simResults.map(s => s.fill))};
  if (names.length === 0) return;
  echarts.init(el).setOption({
    tooltip: { trigger: 'axis', formatter: function(p) { return p[0].name + ': ' + p[0].value + '% fill rate'; } },
    grid: { top: 10, bottom: 60, left: 50, right: 20 },
    xAxis: { type: 'category', data: names, axisLabel: { color: '#888', rotate: 25, fontSize: 11 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: '#888', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#2a3a4a' } } },
    series: [{
      type: 'bar',
      data: fills.map(function(v, i) {
        var color = i === 0 ? '#666' : v > fills[0] ? '#00c853' : '#ff9800';
        var maxFill = Math.max.apply(null, fills);
        if (v === maxFill && i > 0) color = '#1e90ff';
        return { value: v, itemStyle: { color: color, borderRadius: [4,4,0,0] } };
      }),
      label: { show: true, position: 'top', color: '#ccc', fontSize: 12, formatter: '{c}%' }
    }]
  });
})();
</script>
</body>
</html>`;

  const outPath = resolve(__dirname, "dashboard.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`\nDashboard generated: ${outPath}`);
}

main().catch(console.error);
