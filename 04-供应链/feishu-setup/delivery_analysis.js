/**
 * delivery_analysis.js — Delivery performance analysis, simulation & self-improvement
 *
 * Core loop:
 *   1. Measure ACTUAL delivery performance (from order history)
 *   2. Measure PREDICTED delivery performance (from inventory + config)
 *   3. Find gaps: which SKUs/rules underperform and why
 *   4. Simulate parameter changes to find improvements
 *   5. Recommend (or auto-apply) config changes
 *
 * Usage:
 *   node delivery_analysis.js              # Full analysis + simulation
 *   node delivery_analysis.js --apply      # Auto-apply best improvements
 *   node delivery_analysis.js --report     # Analysis only, no simulation
 *   node delivery_analysis.js -q           # Quiet mode (scorecard only)
 */
import { readFileSync } from "fs";
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
  blank_inventory: "tbladv6bQTXlNOlM",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  forecast: "tblFLAHOXLSgWS6Q",
  order: "tblk9Ch4gk2uQ1zG",
  procurement: "tblZX1qW7RvcJieg",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl78V8wgziRs0pt",
};
let TOKEN = "";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) return null;
  return json.data;
}

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
    const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function updateRecord(tableId, recordId, fields) {
  return api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

// ─── 1. ACTUAL Delivery Performance ─────────────────────

function measureActual(orders) {
  const now = Date.now();
  let total = 0, inStock = 0, custom = 0, manualReview = 0;
  let onTime = 0, overdue = 0, pending = 0;
  const skuStats = {}; // per-SKU delivery stats

  for (const r of orders) {
    const f = r.fields;
    const sku = f["SKU"] || "unknown";
    if (!skuStats[sku]) skuStats[sku] = { total: 0, inStock: 0, custom: 0, overdue: 0, totalQty: 0 };

    total++;
    skuStats[sku].total++;
    skuStats[sku].totalQty += Number(f["数量"]) || 0;

    const deliveryType = f["交期类型"] || "";
    if (deliveryType.includes("有货")) {
      inStock++;
      skuStats[sku].inStock++;
    } else if (deliveryType.includes("定制")) {
      custom++;
      skuStats[sku].custom++;
    }

    const status = f["订单状态"] || "";
    if (status === "待人工审核") {
      manualReview++;
    }

    // On-time analysis
    const promiseDate = f["承诺交货日"];
    if (promiseDate) {
      const promiseTs = typeof promiseDate === "number" ? promiseDate : new Date(promiseDate).getTime();
      if (status === "已发货" || status === "完成" || status === "已签收") {
        onTime++;
      } else if (promiseTs < now) {
        overdue++;
        skuStats[sku].overdue++;
      } else {
        pending++;
      }
    }
  }

  const processedTotal = inStock + custom;
  return {
    total,
    inStock,
    custom,
    manualReview,
    onTime,
    overdue,
    pending,
    fillRate: processedTotal > 0 ? (inStock / processedTotal * 100) : 0,
    overdueRate: (overdue + pending) > 0 ? (overdue / (overdue + pending + onTime) * 100) : 0,
    skuStats,
  };
}

// ─── 2. PREDICTED Delivery Performance ──────────────────

function measurePredicted(skuRecords, inventoryRecords, forecastRecords) {
  // Build indices
  const invMap = {};
  for (const r of inventoryRecords) {
    invMap[r.fields["SKU"]] = r.fields;
  }

  const demandMap = {};
  for (const r of forecastRecords) {
    const sku = r.fields["SKU"];
    const qty = r.fields["预测销量"] || 0;
    if (!demandMap[sku]) demandMap[sku] = 0;
    demandMap[sku] += qty;
  }

  let canFulfill = 0, cannotFulfill = 0;
  const skuPredictions = {};

  for (const r of skuRecords) {
    const f = r.fields;
    const sku = f["SKU编号"];
    const safety = f["安全库存"] || 0;
    const inv = invMap[sku] || {};
    const currentStock = Number(inv["当前库存"]) || 0;
    const demand = demandMap[sku] || 0;
    const weeklyDemand = demand / 2; // forecast is 2-week window

    // Coverage: how many weeks of stock do we have?
    const coverageWeeks = weeklyDemand > 0 ? currentStock / weeklyDemand : (currentStock > 0 ? 99 : 0);

    // Can we fulfill typical orders from stock?
    const canFulfillFromStock = currentStock >= safety && currentStock > 0;
    if (canFulfillFromStock) canFulfill++;
    else cannotFulfill++;

    skuPredictions[sku] = {
      currentStock,
      safety,
      weeklyDemand,
      coverageWeeks: Math.round(coverageWeeks * 10) / 10,
      canFulfillFromStock,
      abc: f["ABC分类"] || "?",
      xyz: f["XYZ分类"] || "?",
      strategy: f["备库策略"] || "?",
    };
  }

  const totalSKUs = canFulfill + cannotFulfill;
  return {
    predictedFillRate: totalSKUs > 0 ? (canFulfill / totalSKUs * 100) : 0,
    canFulfill,
    cannotFulfill,
    totalSKUs,
    skuPredictions,
  };
}

// ─── 3. GAP Analysis ────────────────────────────────────

function analyzeGaps(actual, predicted) {
  const gaps = [];

  // Overall fill rate gap
  const fillGap = predicted.predictedFillRate - actual.fillRate;
  gaps.push({
    type: "overall",
    metric: "fill_rate",
    predicted: predicted.predictedFillRate,
    actual: actual.fillRate,
    gap: fillGap,
    severity: Math.abs(fillGap) > 20 ? "critical" : Math.abs(fillGap) > 10 ? "warning" : "ok",
    insight: fillGap > 10
      ? `Predicted fill rate ${predicted.predictedFillRate.toFixed(1)}% but actual only ${actual.fillRate.toFixed(1)}% — safety stock levels may be too optimistic`
      : fillGap < -10
      ? `Actual fill rate ${actual.fillRate.toFixed(1)}% exceeds predicted ${predicted.predictedFillRate.toFixed(1)}% — may be over-stocked`
      : `Fill rate gap is within acceptable range (${Math.abs(fillGap).toFixed(1)}%)`,
  });

  // Per-SKU gap analysis: find worst performers
  const skuGaps = [];
  for (const [sku, pred] of Object.entries(predicted.skuPredictions)) {
    const act = actual.skuStats[sku] || { total: 0, inStock: 0, custom: 0, overdue: 0, totalQty: 0 };
    if (act.total === 0) continue; // no orders for this SKU

    const actualFill = act.total > 0 ? (act.inStock / act.total * 100) : 0;
    const predictedFill = pred.canFulfillFromStock ? 100 : 0;
    const gap = predictedFill - actualFill;

    skuGaps.push({
      sku,
      abc: pred.abc,
      xyz: pred.xyz,
      strategy: pred.strategy,
      orders: act.total,
      totalQty: act.totalQty,
      actualFill,
      predictedFill,
      gap,
      coverageWeeks: pred.coverageWeeks,
      currentStock: pred.currentStock,
      safety: pred.safety,
      overdue: act.overdue,
    });
  }

  // Sort by gap (worst performers first), then by order volume
  skuGaps.sort((a, b) => {
    // A-class SKUs with gaps are most critical
    const aWeight = (a.abc === "A" ? 3 : a.abc === "B" ? 2 : 1) * a.orders;
    const bWeight = (b.abc === "A" ? 3 : b.abc === "B" ? 2 : 1) * b.orders;
    if (a.actualFill === 0 && b.actualFill > 0) return -1;
    if (b.actualFill === 0 && a.actualFill > 0) return 1;
    return bWeight - aWeight;
  });

  return { gaps, skuGaps };
}

// ─── 4. Root Cause Diagnosis ────────────────────────────

function diagnoseRootCauses(skuGaps, molds, blanks, factories) {
  const causes = [];

  // Build mold index
  const moldMap = {};
  for (const r of molds) {
    const f = r.fields;
    const remaining = (f["总寿命（次）"] || 0) - (f["已使用次数"] || 0);
    moldMap[f["SKU"]] = { remaining, id: f["模芯编号"], total: f["总寿命（次）"] || 0 };
  }

  // Blank inventory index
  const blankMap = {};
  for (const r of blanks) {
    blankMap[r.fields["SKU"]] = r.fields["当前毛坯库存"] || 0;
  }

  // Factory capacity check
  let totalCapacity = 0, totalQueue = 0;
  for (const r of factories) {
    totalCapacity += r.fields["日产能（片）"] || 0;
    totalQueue += r.fields["当前排队量"] || 0;
  }
  const capacityUtilization = totalCapacity > 0 ? (totalQueue / totalCapacity * 100) : 0;

  if (capacityUtilization > 80) {
    causes.push({
      type: "capacity_bottleneck",
      severity: "critical",
      detail: `Factory utilization at ${capacityUtilization.toFixed(0)}% — production queue exceeds 80% of daily capacity`,
      recommendation: "Consider adding factory capacity or prioritizing A-class SKUs",
    });
  }

  // Per-SKU root causes for underperforming SKUs
  for (const sg of skuGaps) {
    if (sg.actualFill >= 80) continue; // OK

    const skuCauses = [];

    // Check 1: Stock insufficient
    if (sg.currentStock === 0) {
      skuCauses.push("zero_stock");
    } else if (sg.currentStock < sg.safety) {
      skuCauses.push("below_safety");
    }

    // Check 2: Coverage too low
    if (sg.coverageWeeks < 1) {
      skuCauses.push("low_coverage");
    }

    // Check 3: Mold issue
    const mold = moldMap[sg.sku];
    if (mold && mold.remaining < 500) {
      skuCauses.push(mold.remaining < 50 ? "mold_critical" : "mold_warning");
    }

    // Check 4: Blank stock
    const blank = blankMap[sg.sku];
    if (blank !== undefined && blank < 2000) {
      skuCauses.push("blank_low");
    }

    if (skuCauses.length > 0) {
      causes.push({
        type: "sku_underperform",
        sku: sg.sku,
        abc: sg.abc,
        orders: sg.orders,
        actualFill: sg.actualFill,
        causes: skuCauses,
        severity: sg.abc === "A" ? "critical" : sg.abc === "B" ? "warning" : "info",
      });
    }
  }

  return causes;
}

// ─── 5. Simulation Engine ───────────────────────────────

function simulate(skuGaps, predicted, configOverrides) {
  // Simulate: "what if we change these config params?"
  // Returns predicted improvement in fill rate

  let improved = 0, total = 0;

  for (const sg of skuGaps) {
    total++;
    const pred = predicted.skuPredictions[sg.sku];
    if (!pred) continue;

    let simulatedStock = pred.currentStock;
    let simulatedSafety = pred.safety;

    // Apply config overrides
    if (configOverrides.safety_multiplier) {
      simulatedSafety = Math.ceil(pred.weeklyDemand * configOverrides.safety_multiplier);
    }

    if (configOverrides.extra_stock_weeks) {
      simulatedStock += Math.ceil(pred.weeklyDemand * configOverrides.extra_stock_weeks);
    }

    if (simulatedStock >= simulatedSafety && simulatedStock > 0) {
      improved++;
    }
  }

  return {
    simulatedFillRate: total > 0 ? (improved / total * 100) : 0,
    improved,
    total,
    overrides: configOverrides,
  };
}

function runSimulations(skuGaps, predicted, actual) {
  const scenarios = [
    { name: "Current state", overrides: {} },
    { name: "Safety stock +50%", overrides: { safety_multiplier: (getCurrSafetyMultiplier(predicted) * 1.5) } },
    { name: "Safety stock +100%", overrides: { safety_multiplier: (getCurrSafetyMultiplier(predicted) * 2.0) } },
    { name: "+1 week buffer stock", overrides: { extra_stock_weeks: 1 } },
    { name: "+2 week buffer stock", overrides: { extra_stock_weeks: 2 } },
    { name: "+3 week buffer stock", overrides: { extra_stock_weeks: 3 } },
    { name: "Safety +50% & +1wk buffer", overrides: { safety_multiplier: (getCurrSafetyMultiplier(predicted) * 1.5), extra_stock_weeks: 1 } },
  ];

  return scenarios.map(s => ({
    ...s,
    result: simulate(skuGaps, predicted, s.overrides),
  }));
}

function getCurrSafetyMultiplier(predicted) {
  // Estimate current average safety multiplier from data
  let totalRatio = 0, count = 0;
  for (const p of Object.values(predicted.skuPredictions)) {
    if (p.weeklyDemand > 0 && p.safety > 0) {
      totalRatio += p.safety / p.weeklyDemand;
      count++;
    }
  }
  return count > 0 ? totalRatio / count : 2.0;
}

// ─── 6. Improvement Recommendations ─────────────────────

function generateRecommendations(actual, predicted, gapAnalysis, rootCauses, simResults) {
  const recs = [];
  const bestSim = simResults.reduce((best, s) => s.result.simulatedFillRate > best.result.simulatedFillRate ? s : best);

  // Rec 1: Overall fill rate improvement
  if (actual.fillRate < 50) {
    recs.push({
      priority: 1,
      category: "safety_stock",
      title: `Fill rate critically low (${actual.fillRate.toFixed(1)}%)`,
      action: `Best simulation: "${bestSim.name}" → ${bestSim.result.simulatedFillRate.toFixed(1)}% fill rate`,
      config_changes: bestSim.overrides,
      impact: `+${(bestSim.result.simulatedFillRate - actual.fillRate).toFixed(1)}% fill rate`,
    });
  }

  // Rec 2: A-class SKU stockouts
  const aClassProblems = gapAnalysis.skuGaps.filter(s => s.abc === "A" && s.currentStock === 0);
  if (aClassProblems.length > 0) {
    recs.push({
      priority: 1,
      category: "a_class_stockout",
      title: `${aClassProblems.length} A-class SKUs at zero stock`,
      action: `Urgent replenishment: ${aClassProblems.slice(0, 5).map(s => s.sku).join(", ")}`,
      config_changes: {},
      impact: `These SKUs drive ~70% of volume`,
    });
  }

  // Rec 3: Overdue rate
  if (actual.overdueRate > 10) {
    recs.push({
      priority: 2,
      category: "overdue",
      title: `Overdue rate ${actual.overdueRate.toFixed(1)}% exceeds 10% threshold`,
      action: `Increase delivery days or expedite production for overdue orders`,
      config_changes: { custom_delivery_days: 7, warning_hours: 48 },
      impact: `Reduces overdue by extending promise window + earlier alerts`,
    });
  }

  // Rec 4: Mold bottlenecks
  const moldCauses = rootCauses.filter(c => c.causes?.some(x => x.startsWith("mold_")));
  if (moldCauses.length > 0) {
    recs.push({
      priority: 2,
      category: "mold",
      title: `${moldCauses.length} SKUs affected by mold issues`,
      action: `Accelerate mold procurement for: ${moldCauses.map(c => c.sku).join(", ")}`,
      config_changes: { mold_lead_days: 21 },
      impact: `Shorter procurement cycle reduces stockout risk`,
    });
  }

  // Rec 5: Blank inventory gaps
  const blankCauses = rootCauses.filter(c => c.causes?.includes("blank_low"));
  if (blankCauses.length > 5) {
    recs.push({
      priority: 2,
      category: "blank_inventory",
      title: `${blankCauses.length} SKUs have low blank inventory`,
      action: `Raise blank floor from 2000 to 3000 or increase replenishment target`,
      config_changes: { blank_floor: 3000, blank_replenish_target: 8000 },
      impact: `Reduces blank stockout incidents`,
    });
  }

  // Rec 6: Over-stocked C-class SKUs
  const overStocked = gapAnalysis.skuGaps.filter(s => s.abc === "C" && s.coverageWeeks > 8 && s.currentStock > 0);
  if (overStocked.length > 10) {
    recs.push({
      priority: 3,
      category: "overstock",
      title: `${overStocked.length} C-class SKUs over-stocked (>8 weeks coverage)`,
      action: `Reduce safety stock for C-class SKUs; consider pure make-to-order`,
      config_changes: {},
      impact: `Frees up working capital and warehouse space`,
    });
  }

  recs.sort((a, b) => a.priority - b.priority);
  return recs;
}

// ─── 7. Auto-Apply Improvements ─────────────────────────

async function applyRecommendations(recs) {
  console.log("\n🔄 Auto-applying config changes...\n");

  const configRecords = await listRecords(TABLES.rule_config);
  const configIndex = {};
  for (const r of configRecords) {
    const f = r.fields;
    configIndex[`${f["规则编号"]}.${f["参数名"]}`] = r;
  }

  const paramToRule = {
    custom_delivery_days: "rule1",
    instock_delivery_days: "rule1",
    max_order_qty: "rule1",
    warning_hours: "rule6",
    mold_lead_days: "rule7",
    blank_lead_days: "rule7",
    blank_floor: "rule5",
    blank_replenish_target: "rule7",
    blank_reorder_point: "rule7",
  };

  let applied = 0;
  for (const rec of recs) {
    if (!rec.config_changes || Object.keys(rec.config_changes).length === 0) continue;

    for (const [param, value] of Object.entries(rec.config_changes)) {
      const rule = paramToRule[param];
      if (!rule) continue;

      const key = `${rule}.${param}`;
      const record = configIndex[key];
      if (!record) {
        console.log(`  ⚠️  ${key} not found in config table, skipping`);
        continue;
      }

      const oldValue = record.fields["参数值"];
      const newValue = String(value);
      if (oldValue === newValue) {
        console.log(`  ⏭️  ${key} = ${newValue} (unchanged)`);
        continue;
      }

      await updateRecord(TABLES.rule_config, record.record_id, { "参数值": newValue });
      console.log(`  ✅ ${key}: ${oldValue} → ${newValue} (${rec.title})`);
      applied++;
    }
  }

  console.log(`\n  Applied ${applied} config changes`);
  return applied;
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const autoApply = args.includes("--apply");
  const reportOnly = args.includes("--report");
  const QUIET = args.includes("-q");
  const log = (...a) => { if (!QUIET) console.log(...a); };

  log("📊 Delivery Performance Analysis & Self-Improvement Engine\n");
  log("═".repeat(70));
  await getToken();

  // Fetch all data
  log("\n📥 Loading data...");
  const [orders, skus, inventory, forecasts, molds, blanks, factories] = await Promise.all([
    listRecords(TABLES.order),
    listRecords(TABLES.sku),
    listRecords(TABLES.finished_inventory),
    listRecords(TABLES.forecast),
    listRecords(TABLES.mold),
    listRecords(TABLES.blank_inventory),
    listRecords(TABLES.factory),
  ]);
  log(`  Orders: ${orders.length}, SKUs: ${skus.length}, Inventory: ${inventory.length}`);

  // ── Step 1: Actual performance ──
  log("\n" + "─".repeat(70));
  log("📈 STEP 1: Actual Delivery Performance");
  log("─".repeat(70));
  const actual = measureActual(orders);
  log(`
  Total orders:        ${actual.total}
  In-stock (3-day):    ${actual.inStock}  (${(actual.inStock / actual.total * 100).toFixed(1)}%)
  Custom (5-day):      ${actual.custom}   (${(actual.custom / actual.total * 100).toFixed(1)}%)
  Manual review:       ${actual.manualReview}
  ────────────────────
  FILL RATE:           ${actual.fillRate.toFixed(1)}%  (in-stock / processed)
  OVERDUE RATE:        ${actual.overdueRate.toFixed(1)}%
  On-time:             ${actual.onTime}
  Overdue:             ${actual.overdue}
  Pending:             ${actual.pending}`);

  // ── Step 2: Predicted performance ──
  log("\n" + "─".repeat(70));
  log("🔮 STEP 2: Predicted Delivery Performance");
  log("─".repeat(70));
  const predicted = measurePredicted(skus, inventory, forecasts);
  log(`
  Total SKUs:          ${predicted.totalSKUs}
  Can fulfill:         ${predicted.canFulfill}  (stock >= safety)
  Cannot fulfill:      ${predicted.cannotFulfill}
  ────────────────────
  PREDICTED FILL RATE: ${predicted.predictedFillRate.toFixed(1)}%`);

  // ── Step 3: Gap analysis ──
  log("\n" + "─".repeat(70));
  log("🔍 STEP 3: Gap Analysis (Predicted vs Actual)");
  log("─".repeat(70));
  const gapAnalysis = analyzeGaps(actual, predicted);

  for (const gap of gapAnalysis.gaps) {
    const icon = gap.severity === "critical" ? "🔴" : gap.severity === "warning" ? "🟡" : "🟢";
    log(`\n  ${icon} ${gap.metric}: Predicted ${gap.predicted.toFixed(1)}% vs Actual ${gap.actual.toFixed(1)}% (gap: ${gap.gap > 0 ? "+" : ""}${gap.gap.toFixed(1)}%)`);
    log(`     ${gap.insight}`);
  }

  // Top problem SKUs
  const problemSKUs = gapAnalysis.skuGaps.filter(s => s.actualFill < 50 && s.orders > 0);
  if (problemSKUs.length > 0) {
    log(`\n  📋 Top underperforming SKUs (fill rate < 50%):`);
    log(`  ${"SKU".padEnd(28)} ${"ABC".padEnd(4)} ${"Orders".padEnd(8)} ${"Fill%".padEnd(8)} ${"Stock".padEnd(8)} ${"Cover(wk)".padEnd(10)}`);
    log(`  ${"─".repeat(66)}`);
    for (const s of problemSKUs.slice(0, 15)) {
      log(`  ${s.sku.padEnd(28)} ${s.abc.padEnd(4)} ${String(s.orders).padEnd(8)} ${s.actualFill.toFixed(0).padEnd(8)} ${String(s.currentStock).padEnd(8)} ${String(s.coverageWeeks).padEnd(10)}`);
    }
  }

  // ── Step 4: Root cause diagnosis ──
  log("\n" + "─".repeat(70));
  log("🔬 STEP 4: Root Cause Diagnosis");
  log("─".repeat(70));
  const rootCauses = diagnoseRootCauses(gapAnalysis.skuGaps, molds, blanks, factories);

  const causeCounts = {};
  for (const c of rootCauses) {
    if (c.causes) {
      for (const cause of c.causes) {
        causeCounts[cause] = (causeCounts[cause] || 0) + 1;
      }
    } else {
      causeCounts[c.type] = (causeCounts[c.type] || 0) + 1;
    }
  }

  log("\n  Root cause distribution:");
  const causeLabels = {
    zero_stock: "Zero stock (no inventory at all)",
    below_safety: "Below safety stock level",
    low_coverage: "Coverage < 1 week",
    mold_critical: "Mold needs urgent replacement",
    mold_warning: "Mold approaching end-of-life",
    blank_low: "Blank inventory below floor",
    capacity_bottleneck: "Factory capacity bottleneck",
  };
  for (const [cause, count] of Object.entries(causeCounts).sort((a, b) => b[1] - a[1])) {
    log(`  ${String(count).padStart(4)}× ${causeLabels[cause] || cause}`);
  }

  if (!reportOnly) {
    // ── Step 5: Simulation ──
    log("\n" + "─".repeat(70));
    log("🧪 STEP 5: Simulation — What-If Scenarios");
    log("─".repeat(70));
    const simResults = runSimulations(gapAnalysis.skuGaps, predicted, actual);

    log(`\n  ${"Scenario".padEnd(35)} ${"Fill Rate".padEnd(12)} ${"Δ vs Current".padEnd(15)} ${"SKUs Improved"}`);
    log(`  ${"─".repeat(70)}`);
    const currentFill = simResults[0].result.simulatedFillRate;
    for (const s of simResults) {
      const delta = s.result.simulatedFillRate - currentFill;
      const deltaStr = delta > 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
      log(`  ${s.name.padEnd(35)} ${(s.result.simulatedFillRate.toFixed(1) + "%").padEnd(12)} ${deltaStr.padEnd(15)} ${s.result.improved}/${s.result.total}`);
    }

    // ── Step 6: Recommendations ──
    log("\n" + "─".repeat(70));
    log("💡 STEP 6: Improvement Recommendations");
    log("─".repeat(70));
    const recs = generateRecommendations(actual, predicted, gapAnalysis, rootCauses, simResults);

    if (recs.length === 0) {
      log("\n  ✅ No critical improvements needed at this time.");
    } else {
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        const icon = rec.priority === 1 ? "🔴" : rec.priority === 2 ? "🟡" : "🟢";
        log(`\n  ${icon} #${i + 1} [P${rec.priority}] ${rec.title}`);
        log(`     Action: ${rec.action}`);
        log(`     Impact: ${rec.impact}`);
        if (Object.keys(rec.config_changes).length > 0) {
          log(`     Config: ${JSON.stringify(rec.config_changes)}`);
        }
      }
    }

    // ── Step 7: Auto-apply ──
    if (autoApply && recs.length > 0) {
      await applyRecommendations(recs);
      console.log("\n  Config changes applied. Run 'node automations.js all' to execute with new parameters.");
    } else if (!QUIET && recs.some(r => Object.keys(r.config_changes).length > 0)) {
      log("\n  💡 To auto-apply these changes, run: node delivery_analysis.js --apply");
    }
  }

  // ── Summary (always printed) ──
  console.log("\n📊 SCORECARD: Fill=" + actual.fillRate.toFixed(1) + "% Predicted=" + predicted.predictedFillRate.toFixed(1) + "% Overdue=" + actual.overdueRate.toFixed(1) + "% A-zero=" + gapAnalysis.skuGaps.filter(s => s.abc === "A" && s.currentStock === 0).length + " Causes=" + rootCauses.length);
}

main().catch(err => { console.error("💥 Failed:", err.message); process.exit(1); });
