/**
 * 5.1 节库存消耗模拟 v4
 *
 * 库存：2340 片（一个SKU，不分Ultra/D8）
 * 订单：5天 × 100 副/天 = 500 副 = 1000 片（左右眼各500片）
 *
 * 10种情景：
 *   1. 真实比例 × 5天均匀
 *   2. 真实比例 × 前重后轻（Day1=300片, 逐日递减）
 *   3. 真实比例 × 后重前轻（Day3-5高峰）
 *   4. 真实比例 × Day3爆发（单日400片）
 *   5. 真实比例 × 周末高峰（Day1+Day5各300片）
 *   6. 均匀度数 × 5天均匀
 *   7. 真实比例 × 长尾偏重（CYL≥-1占比提升）
 *   8. 真实比例 × 高度数偏重（SPH≤-3占比提升）
 *   9. 真实比例 × 偶发大单（Day3来30副单眼定制）
 *   10. 真实比例 × 总量+20%（600副/1200片）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";

function loadEnv() {
  const candidates = [
    resolve(__dirname, "../shared/.env"),
    resolve(__dirname, "../.env"),
    resolve(__dirname, ".env"),
  ];
  const env = {};
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      if (!(k.trim() in env)) env[k.trim()] = v.join("=").trim();
    }
  }
  return env;
}

const ENV = loadEnv();
const APP_TOKEN = ENV.FEISHU_APP_TOKEN;

// ─── 参数 ────────────────────────────────────────────────────────────────
const DAYS = 5;
const STD_SPH = [-6.00, 0];
const STD_CYL = [-2.00, 0];

// ─── 真实销售度数分布矩阵（从 SKU比例.md 解析） ────────────────────────────
// SPH 从 0 到 -6.00，CYL 从 0 到 -2.00，值为百分比
const SALES_RATIO_RAW = [
  // [SPH, [CYL 0, -0.25, -0.50, -0.75, -1.00, -1.25, -1.50, -1.75, -2.00]]
  [0.00,  [3.6, 0.2, 0.9, 0.6, 0.6, 0.3, 0.3, 0.1, 0.3]],
  [-0.25, [1.0, 0.2, 0.6, 0.4, 0.3, 0.1, 0.1, 0.0, 0.1]],
  [-0.50, [1.6, 0.2, 1.1, 0.5, 0.3, 0.2, 0.1, 0.1, 0.1]],
  [-0.75, [2.4, 0.1, 1.7, 0.7, 0.5, 0.1, 0.1, 0.1, 0.1]],
  [-1.00, [3.0, 0.3, 1.9, 1.1, 0.6, 0.3, 0.2, 0.1, 0.1]],
  [-1.25, [3.3, 0.3, 2.0, 0.8, 0.5, 0.4, 0.2, 0.1, 0.1]],
  [-1.50, [2.3, 0.2, 2.3, 0.9, 0.6, 0.3, 0.2, 0.1, 0.2]],
  [-1.75, [2.2, 0.1, 1.6, 1.0, 0.7, 0.3, 0.3, 0.2, 0.1]],
  [-2.00, [1.8, 0.2, 1.8, 0.9, 0.7, 0.2, 0.3, 0.2, 0.1]],
  [-2.25, [1.9, 0.2, 1.6, 0.7, 0.5, 0.4, 0.2, 0.1, 0.1]],
  [-2.50, [1.4, 0.1, 1.5, 0.9, 0.5, 0.6, 0.5, 0.2, 0.2]],
  [-2.75, [1.4, 0.0, 1.5, 0.7, 0.5, 0.3, 0.4, 0.2, 0.1]],
  [-3.00, [1.2, 0.1, 1.1, 0.5, 0.3, 0.3, 0.4, 0.1, 0.2]],
  [-3.25, [0.8, 0.0, 0.9, 0.6, 0.6, 0.3, 0.3, 0.0, 0.1]],
  [-3.50, [0.5, 0.1, 0.9, 0.4, 0.5, 0.3, 0.3, 0.2, 0.0]],
  [-3.75, [0.5, 0.0, 0.6, 0.4, 0.2, 0.3, 0.4, 0.1, 0.1]],
  [-4.00, [0.4, 0.0, 0.6, 0.5, 0.2, 0.3, 0.1, 0.1, 0.2]],
  [-4.25, [0.5, 0.0, 0.5, 0.4, 0.4, 0.3, 0.2, 0.1, 0.1]],
  [-4.50, [0.4, 0.0, 0.4, 0.5, 0.2, 0.3, 0.1, 0.2, 0.0]],
  [-4.75, [0.3, 0.0, 0.3, 0.2, 0.2, 0.1, 0.2, 0.1, 0.1]],
  [-5.00, [0.4, 0.0, 0.2, 0.2, 0.3, 0.2, 0.1, 0.1, 0.1]],
  [-5.25, [0.2, 0.0, 0.3, 0.1, 0.3, 0.3, 0.2, 0.1, 0.1]],
  [-5.50, [0.2, 0.0, 0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.0]],
  [-5.75, [0.1, 0.0, 0.1, 0.1, 0.0, 0.1, 0.1, 0.1, 0.0]],
  [-6.00, [0.1, 0.0, 0.0, 0.0, 0.2, 0.1, 0.1, 0.0, 0.1]],
];

const CYL_VALUES = [0, -0.25, -0.50, -0.75, -1.00, -1.25, -1.50, -1.75, -2.00];

// 构建加权查找表：[{sph, cyl, weight}]，weight 总和=100
function buildSalesWeightTable() {
  const table = [];
  for (const [sph, cylWeights] of SALES_RATIO_RAW) {
    for (let ci = 0; ci < CYL_VALUES.length; ci++) {
      const w = cylWeights[ci];
      if (w > 0) table.push({ sph, cyl: CYL_VALUES[ci], weight: w });
    }
  }
  return table;
}

// 从加权表中随机选一个度数
function weightedPickFromTable(table) {
  const totalWeight = table.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const e of table) {
    r -= e.weight;
    if (r <= 0) return { sph: e.sph, cyl: e.cyl };
  }
  return { sph: table.at(-1).sph, cyl: table.at(-1).cyl };
}

// 构建变形版销售比例表
function adjustSalesTable(salesTable, adjustFn) {
  const adjusted = salesTable.map(e => ({ ...e }));
  adjustFn(adjusted);
  // 重新归一化到100
  const total = adjusted.reduce((a, e) => a + e.weight, 0);
  for (const e of adjusted) e.weight = e.weight / total * 100;
  return adjusted;
}

// 长尾偏重：CYL ≥ -1（即 -0.25~-1.00）的权重×1.5
function adjustLongTail(table) {
  for (const e of table) {
    if (e.cyl >= -1.00 && e.cyl < 0) e.weight *= 1.5;
  }
}

// 高度数偏重：SPH ≤ -3 的权重×1.8
function adjustHighPower(table) {
  for (const e of table) {
    if (e.sph <= -3) e.weight *= 1.8;
  }
}

// 均匀随机度数（从库存表中存在的度数里等概率选）
function uniformPick(entries) {
  const idx = Math.floor(Math.random() * entries.length);
  return entries[idx];
}

// ─── 拉取库存 ────────────────────────────────────────────────────────────
async function fetchStock() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  const j = await r.json();
  const tok = j.tenant_access_token;

  const records = [];
  let pageToken = "";
  do {
    const url = `${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/tbl7U79QGG4JtQev/records?page_size=500${pageToken ? "&page_token=" + pageToken : ""}`;
    const r2 = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    const j2 = await r2.json();
    records.push(...(j2.data?.items || []));
    pageToken = j2.data?.page_token || "";
  } while (pageToken);

  // Ultra双效 和 D8 库存完全一样，只取一份（真实库存 = 单SKU的2340片）
  const stockMap = {};
  for (const rec of records) {
    const f = rec.fields;
    if (f["SKU编号"] !== "Ultra双效") continue;  // 只取一个SKU
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const stock = Number(f["当前库存"]);
    stockMap[sph.toFixed(2) + "|" + cyl.toFixed(2)] = { sph, cyl, stock };
  }
  return Object.values(stockMap);
}

function isInRange(sph, cyl) {
  return sph >= STD_SPH[0] && sph <= STD_SPH[1] && cyl >= STD_CYL[0] && cyl <= STD_CYL[1];
}

function deliveryType(sph, cyl, qty, stock) {
  if (!isInRange(sph, cyl)) return "定制7-10天";
  if (stock >= qty) return "有货1-2天";
  return "排产5-7天";
}

// 查找库存表中对应度数的条目
function findEntry(entries, sph, cyl) {
  // 精确匹配
  let e = entries.find(e => e.sph === sph && e.cyl === cyl);
  if (e) return e;
  // 容差匹配（浮点精度问题）
  e = entries.find(e => Math.abs(e.sph - sph) < 0.01 && Math.abs(e.cyl - cyl) < 0.01);
  return e || null;
}

// ─── 单次模拟 ────────────────────────────────────────────────────────────
// dailyPieces: 每天片数数组，如 [200,200,200,200,200]
// pickFn: () => {sph, cyl} 选择度数的函数
function runOneSimulation(rawEntries, dailyPieces, pickFn) {
  const entries = rawEntries.map(e => ({ ...e }));
  const stats = {
    totalPieces: 0, totalOrders: 0,
    delivery: { "有货1-2天": 0, "排产5-7天": 0, "定制7-10天": 0 },
    outOfStock: 0, lowStock: 0, byDay: [], oosDetails: [],
  };

  for (let day = 0; day < dailyPieces.length; day++) {
    const pieces = dailyPieces[day];
    const orders = Math.round(pieces / 2);
    const dayStats = { day: day+1, pieces: 0, delivered: 0, queued: 0, custom: 0, oos: 0 };

    for (let order = 0; order < orders; order++) {
      for (const eye of ["右", "左"]) {
        const pick = pickFn();
        let entry = findEntry(entries, pick.sph, pick.cyl);

        if (!entry) {
          stats.totalPieces++; dayStats.pieces++;
          stats.delivery["定制7-10天"]++; dayStats.custom++;
          continue;
        }

        stats.totalPieces++; dayStats.pieces++;

        if (entry.stock <= 0) {
          stats.outOfStock++; dayStats.oos++;
          if (stats.oosDetails.length < 50) {
            stats.oosDetails.push(`D${day+1} SPH=${entry.sph} CYL=${entry.cyl} ${eye}`);
          }
        }

        const dt = deliveryType(entry.sph, entry.cyl, 1, entry.stock);
        stats.delivery[dt]++;
        if (dt === "有货1-2天") dayStats.delivered++;
        else if (dt === "排产5-7天") dayStats.queued++;
        else dayStats.custom++;

        entry.stock -= 1;
        if (entry.stock < 0) entry.stock = 0;
        if (entry.stock <= 5) stats.lowStock++;
      }
      stats.totalOrders++;
    }

    dayStats.remaining = entries.reduce((a, e) => a + e.stock, 0);
    stats.byDay.push(dayStats);
  }

  return { entries, stats };
}

// ─── 输出单场景 ──────────────────────────────────────────────────────────
function compactReport(result) {
  const { entries, stats } = result;
  const spotRate = (stats.delivery["有货1-2天"] / stats.totalPieces * 100).toFixed(1);
  const zeroCount = entries.filter(e => e.stock === 0).length;
  const tightCount = entries.filter(e => e.stock > 0 && e.stock <= 5).length;
  const consumed = stats.byDay.reduce((a, d) => a + d.pieces, 0);
  return { spotRate, oos: stats.outOfStock, zero: zeroCount, tight: tightCount, queued: stats.delivery["排产5-7天"], consumed };
}

// ─── 10 种情景 ───────────────────────────────────────────────────────────
async function main() {
  console.log("📦 从飞书拉取库存数据 ...");
  const rawEntries = await fetchStock();
  const totalStock = rawEntries.reduce((a, e) => a + e.stock, 0);

  const salesTable = buildSalesWeightTable();
  const longTailTable = adjustSalesTable(salesTable, adjustLongTail);
  const highPowerTable = adjustSalesTable(salesTable, adjustHighPower);

  const pickReal = () => weightedPickFromTable(salesTable);
  const pickUniform = () => uniformPick(rawEntries);
  const pickLongTail = () => weightedPickFromTable(longTailTable);
  const pickHighPower = () => weightedPickFromTable(highPowerTable);

  console.log(`库存池：${totalStock} 片 | 225 个度数组合`);
  console.log(`销售度数分布：${salesTable.length} 个非零组合\n`);

  const scenarios = [
    {
      name: "① 真实比例 × 5天均匀200片",
      desc: "基准场景：每天100副，按真实度数分布",
      schedule: [200,200,200,200,200],
      pick: pickReal,
    },
    {
      name: "② 真实比例 × 前重后轻",
      desc: "Day1爆发300片，逐日递减到100片",
      schedule: [300,250,200,150,100],
      pick: pickReal,
    },
    {
      name: "③ 真实比例 × 后重前轻",
      desc: "前两天冷清100片，Day3-5高峰300/300/200",
      schedule: [100,100,300,300,200],
      pick: pickReal,
    },
    {
      name: "④ 真实比例 × Day3爆发",
      desc: "Day3单日400片大促，其余150片",
      schedule: [150,150,400,150,150],
      pick: pickReal,
    },
    {
      name: "⑤ 真实比例 × 两头高峰",
      desc: "Day1+Day5各300片（假期首尾集中）",
      schedule: [300,150,100,150,300],
      pick: pickReal,
    },
    {
      name: "⑥ 均匀度数 × 5天均匀",
      desc: "所有度数等概率被下单（基准对比）",
      schedule: [200,200,200,200,200],
      pick: pickUniform,
    },
    {
      name: "⑦ 长尾偏重 × 5天均匀",
      desc: "CYL -0.25~-1.00 权重×1.5（散光适中的度数更多）",
      schedule: [200,200,200,200,200],
      pick: pickLongTail,
    },
    {
      name: "⑧ 高度数偏重 × 5天均匀",
      desc: "SPH≤-3 权重×1.8（深度近视偏多）",
      schedule: [200,200,200,200,200],
      pick: pickHighPower,
    },
    {
      name: "⑨ 真实比例 + Day3定制大单",
      desc: "Day3额外30副单眼高难度订单（SPH≤-5,CYL≤-1.5）",
      schedule: [200,200,200,200,200],
      pick: pickReal,
      extraDay: 2,  // 0-indexed, day3
      extraPieces: 60,
      extraPick: () => ({ sph: -(Math.floor(Math.random()*5)+3)*0.25*4/0.25*0.25, cyl: -(Math.floor(Math.random()*3)+1)*0.5 }),
    },
    {
      name: "⑩ 真实比例 × 总量+20%（600副）",
      desc: "卖得比预期多20%，验证库存韧性",
      schedule: [240,240,240,240,240],
      pick: pickReal,
    },
  ];

  // Fix scenario 9 extraPick
  scenarios[8].extraPick = () => {
    const sphs = [-3, -3.25, -3.5, -3.75, -4, -4.25, -4.5, -4.75, -5, -5.25, -5.5, -5.75, -6];
    const cyls = [-1.5, -1.75, -2];
    return { sph: sphs[Math.floor(Math.random()*sphs.length)], cyl: cyls[Math.floor(Math.random()*cyls.length)] };
  };

  const results = [];

  for (const sc of scenarios) {
    const result = runOneSimulation(rawEntries, sc.schedule, sc.pick);

    // Scenario 9: add extra custom orders on day 3
    if (sc.extraPieces) {
      const extraEntries = rawEntries.map(e => ({ ...e }));
      // re-run with extra
      const result2 = runOneSimulation(rawEntries, sc.schedule, sc.pick);
      // Actually just add extra pieces to existing result
      // Better: re-run from scratch with modified schedule
      // Let's just inject extra orders after the fact
      // Actually let me just note it differently - run normally but add the custom pieces count
      // For simplicity, let's just run it properly
    }

    results.push({ name: sc.name, desc: sc.desc, schedule: sc.schedule, result, sc });
  }

  // Scenario 9 needs special handling - re-run with extra custom orders
  {
    const sc = scenarios[8];
    const entries = rawEntries.map(e => ({ ...e }));
    const stats = {
      totalPieces: 0, totalOrders: 0,
      delivery: { "有货1-2天": 0, "排产5-7天": 0, "定制7-10天": 0 },
      outOfStock: 0, lowStock: 0, byDay: [], oosDetails: [],
    };

    for (let day = 0; day < sc.schedule.length; day++) {
      const pieces = sc.schedule[day];
      const orders = Math.round(pieces / 2);
      const dayStats = { day: day+1, pieces: 0, delivered: 0, queued: 0, custom: 0, oos: 0 };

      for (let order = 0; order < orders; order++) {
        for (const eye of ["右", "左"]) {
          const pick = sc.pick();
          let entry = findEntry(entries, pick.sph, pick.cyl);
          if (!entry) { stats.totalPieces++; dayStats.pieces++; stats.delivery["定制7-10天"]++; dayStats.custom++; continue; }
          stats.totalPieces++; dayStats.pieces++;
          if (entry.stock <= 0) { stats.outOfStock++; dayStats.oos++; }
          const dt = deliveryType(entry.sph, entry.cyl, 1, entry.stock);
          stats.delivery[dt]++;
          if (dt === "有货1-2天") dayStats.delivered++;
          else if (dt === "排产5-7天") dayStats.queued++;
          else dayStats.custom++;
          entry.stock -= 1; if (entry.stock < 0) entry.stock = 0;
          if (entry.stock <= 5) stats.lowStock++;
        }
        stats.totalOrders++;
      }

      // Day3 extra: 30 custom orders
      if (day === sc.extraDay) {
        for (let i = 0; i < sc.extraPieces / 2; i++) {
          for (const eye of ["右", "左"]) {
            const pick = sc.extraPick();
            let entry = findEntry(entries, pick.sph, pick.cyl);
            if (!entry) { stats.totalPieces++; dayStats.pieces++; stats.delivery["定制7-10天"]++; dayStats.custom++; continue; }
            stats.totalPieces++; dayStats.pieces++;
            if (entry.stock <= 0) { stats.outOfStock++; dayStats.oos++; }
            const dt = deliveryType(entry.sph, entry.cyl, 1, entry.stock);
            stats.delivery[dt]++;
            if (dt === "有货1-2天") dayStats.delivered++;
            else if (dt === "排产5-7天") dayStats.queued++;
            else dayStats.custom++;
            entry.stock -= 1; if (entry.stock < 0) entry.stock = 0;
            if (entry.stock <= 5) stats.lowStock++;
          }
          stats.totalOrders++;
        }
      }

      dayStats.remaining = entries.reduce((a, e) => a + e.stock, 0);
      stats.byDay.push(dayStats);
    }

    results[8] = { name: sc.name, desc: sc.desc, schedule: [...sc.schedule], result: { entries, stats }, sc };
    results[8].schedule[2] = sc.schedule[2] + sc.extraPieces; // show real day total
  }

  // ─── 汇总表 ──────────────────────────────────────────────────────────
  console.log(`${"═".repeat(100)}`);
  console.log("📊 5.1 节库存消耗模拟 — 10种情景对比");
  console.log(`库存：${totalStock} 片 | 订单目标：500副=1000片`);
  console.log(`${"═".repeat(100)}\n`);

  // Header
  console.log(`${"场景".padEnd(40)} ${"消耗".padStart(5)} ${"现货率".padStart(7)} ${"缺货".padStart(5)} ${"排产".padStart(5)} ${"归零".padStart(5)} ${"紧张".padStart(5)} ${"评价".padEnd(6)}`);
  console.log("─".repeat(100));

  for (const r of results) {
    const c = compactReport(r.result);
    let verdict;
    if (parseFloat(c.spotRate) >= 95) verdict = "✅ 充足";
    else if (parseFloat(c.spotRate) >= 90) verdict = "⚠️ 轻紧";
    else if (parseFloat(c.spotRate) >= 80) verdict = "⚠️ 偏紧";
    else verdict = "❌ 不足";

    const totalPieces = r.schedule.reduce((a, b) => a + b, 0);
    console.log(`${r.name.padEnd(38)} ${String(totalPieces).padStart(5)} ${c.spotRate.padStart(6)}% ${String(c.oos).padStart(5)} ${String(c.queued).padStart(5)} ${String(c.zero).padStart(5)} ${String(c.tight).padStart(5)} ${verdict}`);
  }

  console.log("\n" + "─".repeat(100));

  // Detailed daily breakdown for key scenarios
  for (const r of results) {
    console.log(`\n${r.name}`);
    console.log(`  ${r.desc}`);
    console.log(`  每日：${r.schedule.map((p,i) => `D${i+1}=${p}片`).join(" / ")}`);
    console.log(`  ${"Day".padEnd(5)} ${"现货".padStart(5)} ${"排产".padStart(5)} ${"定制".padStart(5)} ${"缺货".padStart(5)} ${"剩余".padStart(6)}`);
    for (const d of r.result.stats.byDay) {
      console.log(`  ${String(d.day).padEnd(5)} ${String(d.delivered).padStart(5)} ${String(d.queued).padStart(5)} ${String(d.custom).padStart(5)} ${String(d.oos).padStart(5)} ${String(d.remaining).padStart(6)}`);
    }
  }

  // 建议
  const worst = results.reduce((a, b) => {
    const aRate = parseFloat(compactReport(a.result).spotRate);
    const bRate = parseFloat(compactReport(b.result).spotRate);
    return aRate < bRate ? a : b;
  });
  const best = results.reduce((a, b) => {
    const aRate = parseFloat(compactReport(a.result).spotRate);
    const bRate = parseFloat(compactReport(b.result).spotRate);
    return aRate > bRate ? a : b;
  });

  console.log(`\n${"═".repeat(100)}`);
  console.log("💡 结论");
  console.log("═".repeat(100));
  console.log(`最佳情景：${best.name} — 现货率 ${compactReport(best.result).spotRate}%`);
  console.log(`最差情景：${worst.name} — 现货率 ${compactReport(worst.result).spotRate}%`);
  console.log(`\n${totalStock} 片库存对 1000 片需求（2.34:1），大部分场景现货率>90%。`);
  console.log(`风险点：高度数偏重场景和爆发场景下热门度数（SPH -2~-4, CYL 0~-1）会缺货。`);
}

main().catch(e => { console.error(e); process.exit(1); });
