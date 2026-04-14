/**
 * automations.js — 9 business rules engine for eyeglass supply chain
 *
 * Rule parameters are loaded from two sources (Feishu table overrides local defaults):
 *   1. rules_config.json  — local defaults (developer edits)
 *   2. Feishu "规则配置" table — runtime overrides (business users edit in Feishu)
 *
 * Usage:
 *   node automations.js rule1   # Order validation + delivery type
 *   node automations.js rule2   # Finished inventory alerts
 *   node automations.js rule3   # Mold life alerts
 *   node automations.js rule4   # Seasonal forecast → production
 *   node automations.js rule5   # Blank inventory alerts
 *   node automations.js rule6   # Order overdue alerts
 *   node automations.js rule7   # Auto-procurement trigger
 *   node automations.js rule8   # Factory routing
 *   node automations.js rule9   # Mold usage auto-increment
 *   node automations.js all     # Run all 9 rules sequentially
 *   node automations.js all -q  # Quiet mode (summary only, saves tokens)
 *   node automations.js all --fresh  # Bypass cache, fetch fresh from API
 *   node automations.js all -q --fresh  # Quiet + fresh
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { notifyBatch } from "./notify.js";
import { cachedFetch, cacheStatus } from "./cache.js";


const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";

// 表 ID
const TABLES = {
  sku: "tblwQsvGAahoeoJV",
  finished_inventory: "tblUF49B6i53MV2O",
  blank_inventory: "tbladv6bQTXlNOlM",
  mold: "tblkZ4ODg3v63prW",
  production: "tbltSntfaR9KCI7B",
  forecast: "tblFLAHOXLSgWS6Q",
  ai_analysis: "tbl8W9F9K2RbaL0k",
  order: "tblk9Ch4gk2uQ1zG",
  procurement: "tblZX1qW7RvcJieg",
  factory: "tblJ6RXFENJFQe9A",
  rule_config: "tbl78V8wgziRs0pt",
};

let TOKEN = "";

// ─── Rule Config: local defaults + Feishu overrides ─────

const LOCAL_CONFIG = JSON.parse(readFileSync(resolve(__dirname, "rules_config.json"), "utf-8"));
let CFG = structuredClone(LOCAL_CONFIG); // runtime config (merged)

/**
 * Load rule parameter overrides from Feishu "规则配置" table.
 * Table format: 规则编号 | 参数名 | 参数值 | 说明
 * Only overrides non-empty values; missing rows keep local defaults.
 */
async function loadConfigOverrides() {
  if (!TABLES.rule_config) return;
  try {
    const records = await listRecords(TABLES.rule_config);
    let overrideCount = 0;
    for (const r of records) {
      const f = r.fields;
      const rule = f["规则编号"];   // e.g. "rule1"
      const param = f["参数名"];    // e.g. "max_order_qty"
      const raw = f["参数值"];      // e.g. "200" or "1.3" or "[6,7,8]"
      if (!rule || !param || raw === undefined || raw === null || raw === "") continue;
      if (!CFG[rule]) continue;

      // Auto-parse: number, JSON array, or string
      let value;
      const str = String(raw).trim();
      if (/^\[.*\]$/.test(str)) {
        try { value = JSON.parse(str); } catch { value = str; }
      } else if (!isNaN(str) && str !== "") {
        value = Number(str);
      } else {
        value = str;
      }

      CFG[rule][param] = value;
      overrideCount++;
    }
    if (overrideCount > 0) {
      console.log(`  📋 Loaded ${overrideCount} config overrides from Feishu`);
    }
  } catch (err) {
    console.log(`  ⚠️  Config table read failed (${err.message}), using local defaults`);
  }
}

/** Get a rule config value with type-safe fallback */
function cfg(rule, param, fallback) {
  const val = CFG[rule]?.[param];
  return val !== undefined ? val : fallback;
}

// ─── Quiet mode: -q flag suppresses per-record logs ─────

const QUIET = process.argv.includes("-q");
function log(...args) { if (!QUIET) console.log(...args); }

// ─── Global data cache: load each table once, reuse across rules ──

const DATA = {};  // populated by preloadData()

async function preloadData() {
  const cs = cacheStatus();
  if (cs.valid > 0 && !cs.fresh) {
    console.log(`📥 Loading data (cache: ${cs.valid}/${cs.files} valid, TTL ${cs.ttl}min)...`);
  } else {
    console.log(`📥 Loading data from Feishu API${cs.fresh ? " (--fresh)" : ""}...`);
  }
  const keys = ["sku", "finished_inventory", "blank_inventory", "mold", "production", "forecast", "order", "procurement", "factory"];
  const results = await Promise.all(keys.map(k =>
    TABLES[k] ? cachedFetch(k, () => listRecords(TABLES[k])) : Promise.resolve([])
  ));
  keys.forEach((k, i) => { DATA[k] = results[i]; });
  if (!QUIET) {
    const counts = keys.map(k => `${k}:${DATA[k].length}`).join(", ");
    console.log(`  ${counts}`);
  }
}

/** Get cached data (preloaded) or fetch if not cached */
function getData(key) { return DATA[key] || []; }

// ─── HTTP 工具 ──────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.code !== 0) {
    console.error(`  API 错误 [${method} ${path}]:`, json.msg);
    return null;
  }
  return json.data;
}

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  TOKEN = json.tenant_access_token;
}

// ─── 通用：读取全表记录 ────────────────────────────────

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

async function createRecord(tableId, fields) {
  return api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

// ─── 通用：发飞书消息（通过 webhook 或直接写入 AI 分析表记录） ──

function logAlert(emoji, message) {
  log(`  ${emoji} ${message}`);
}

// ─── 规则1：订单 → 查库存 → 写交期 ────────────────────

async function rule1() {
  console.log("\n📦 规则1：处理订单 → 查库存 → 写交期");
  log("─".repeat(50));

  const orders = getData("order");
  const inventory = getData("finished_inventory");
  const skuData = getData("sku");

  // 建立 SKU 类型索引
  const skuMap = {};
  for (const r of skuData) {
    skuMap[r.fields["SKU编号"]] = r;
  }

  // 建立库存索引 SKU -> record
  const invMap = {};
  for (const r of inventory) {
    const sku = r.fields["产品型号"];
    if (sku) invMap[sku] = r;
  }

  function validateOrder(fields) {
    const issues = [];
    const qty = Number(fields["数量"]);
    const maxQty = cfg("rule1", "max_order_qty", 100);
    if (!qty || qty <= 0) issues.push("数量无效");
    if (qty > maxQty) issues.push(`数量异常（>${maxQty}），需人工确认`);

    const sku = fields["产品型号"] || "";
    if (/\+\d/.test(sku)) issues.push("正度数，需人工确认");

    return issues;
  }

  let processed = 0;
  const processedItems = [];
  for (const order of orders) {
    const f = order.fields;
    // 跳过已处理的订单（非待处理状态）
    if (f["订单状态"] && f["订单状态"] !== "待处理") {
      log(`  ⏭️  ${f["订单编号"]} 已处理，跳过`);
      continue;
    }

    // Validate order parameters
    const issues = validateOrder(f);
    if (issues.length > 0) {
      await updateRecord(TABLES.order, order.record_id, {
        "订单状态": "待人工审核",
        "备注": issues.join("; "),
      });
      log(`  ⚠️  ${f["订单编号"]} 参数异常: ${issues.join("; ")}`);
      continue;
    }

    const sku = f["产品型号"];
    const qty = Number(f["数量"]) || 0;
    const orderDate = f["下单日期"]; // 飞书日期是毫秒时间戳

    const inv = invMap[sku];
    const currentStock = Number(inv ? (inv.fields["当前库存"] || 0) : 0);

    // 查 SKU 类型（定制品始终走定制5天）
    const skuInfo = skuMap[sku];
    const customType = cfg("rule1", "custom_product_type", "定制品");
    const isCustom = skuInfo && skuInfo.fields["类型"] === customType;

    const instockDays = cfg("rule1", "instock_delivery_days", 3);
    const customDays = cfg("rule1", "custom_delivery_days", 5);
    let deliveryType, daysToAdd;
    if (!isCustom && currentStock >= qty) {
      deliveryType = `有货${instockDays}天`;
      daysToAdd = instockDays;
      // 扣减库存
      if (inv) {
        const newStock = currentStock - qty;
        await updateRecord(TABLES.finished_inventory, inv.record_id, { "当前库存": newStock });
        inv.fields["当前库存"] = newStock;
        log(`  📉 ${sku} 库存扣减: ${currentStock} → ${newStock}`);
      }
    } else {
      deliveryType = `定制${customDays}天`;
      daysToAdd = customDays;
    }

    // 计算承诺交货日
    let promiseDate = null;
    if (orderDate) {
      const ts = typeof orderDate === "number" ? orderDate : orderDate;
      promiseDate = ts + daysToAdd * 24 * 60 * 60 * 1000;
    }

    const update = {
      "订单状态": "待处理",
    };
    if (promiseDate) update["承诺交货日"] = promiseDate;

    await updateRecord(TABLES.order, order.record_id, update);
    log(`  ✅ ${f["订单编号"]} | ${sku} × ${qty} → ${deliveryType}（库存${currentStock}）`);
    processedItems.push({ emoji: "✅", text: `${f["订单编号"]} | ${sku} × ${qty} → ${deliveryType}` });
    processed++;
  }

  if (processedItems.length > 0) {
    await notifyBatch(`📦 订单处理完成：${processed} 条`, processedItems, "green");
  }

  console.log(`\n  处理完成: ${processed} 条订单`);
}

// ─── 规则2：库存低于安全值 → 预警 ─────────────────────

async function rule2() {
  console.log("\n📊 规则2：库存预警检查");
  log("─".repeat(50));

  const inventory = getData("finished_inventory");
  const skuData = getData("sku");

  // SKU编号 -> 安全库存
  const safetyMap = {};
  for (const r of skuData) {
    const id = r.fields["SKU编号"];
    safetyMap[id] = {
      safety: r.fields["安全库存"] || 0,
      name: r.fields["SKU名称"],
      type: r.fields["类型"],
    };
  }

  let alerts = 0;
  const alertItems = [];
  for (const r of inventory) {
    const sku = r.fields["产品型号"];
    const current = r.fields["当前库存"] || 0;
    const info = safetyMap[sku];
    if (!info) continue;

    // Skip custom products
    if (info.type === cfg("rule1", "custom_product_type", "定制品")) continue;

    let status;
    if (current <= 0) {
      status = "❌缺货";
      logAlert("🚨", `${sku}（${info.name}）已缺货！当前库存 0`);
      alertItems.push({ emoji: "🚨", text: `${sku}（${info.name}）已缺货！当前库存 0` });
      alerts++;
    } else if (current < info.safety) {
      status = "⚠️低库存";
      logAlert("⚠️", `${sku}（${info.name}）库存 ${current} 片，低于安全库存 ${info.safety} 片`);
      alertItems.push({ emoji: "⚠️", text: `${sku}（${info.name}）库存 ${current} 片，低于安全库存 ${info.safety} 片` });
      alerts++;
    } else {
      status = "✅有货";
      log(`  ✅ ${sku}（${info.name}）库存正常: ${current} / 安全线${info.safety}`);
    }

    // 更新状态字段
    await updateRecord(TABLES.finished_inventory, r.record_id, { "状态": status });
  }

  if (alertItems.length > 0) {
    const highThreshold = cfg("rule2", "high_alert_threshold", 3);
    await notifyBatch(`📊 库存预警：${alerts} 条`, alertItems, alerts > highThreshold ? "red" : "orange");
  }

  console.log(`\n  检查完成: ${alerts} 条预警`);
}

// ─── 规则3：模芯寿命预警 ──────────────────────────────

async function rule3() {
  console.log("\n🔧 规则3：模芯寿命预警");
  log("─".repeat(50));

  const molds = getData("mold");

  let alerts = 0;
  const alertItems = [];
  for (const r of molds) {
    const f = r.fields;
    const id = f["模芯编号"];
    const total = f["总寿命（次）"] || 0;
    const used = f["已使用次数"] || 0;
    const remaining = total - used;
    const threshold = f["预警阈值"] || cfg("rule3", "default_warning_threshold", 500);
    const criticalRemaining = cfg("rule3", "critical_remaining", 50);

    let status;
    if (remaining <= criticalRemaining) {
      status = "🔴需更换";
      logAlert("🔴", `${id}（${f["产品型号"]}）仅剩 ${remaining} 次，急需更换！采购周期3-4周`);
      alertItems.push({ emoji: "🔴", text: `${id}（${f["产品型号"]}）仅剩 ${remaining} 次，急需更换！` });
      alerts++;
    } else if (remaining < threshold) {
      status = "🟡预警";
      logAlert("🟡", `${id}（${f["产品型号"]}）剩余 ${remaining} 次，低于预警阈值 ${threshold}`);
      alertItems.push({ emoji: "🟡", text: `${id}（${f["产品型号"]}）剩余 ${remaining} 次，低于阈值` });
      alerts++;
    } else {
      status = "🟢正常";
      log(`  🟢 ${id}（${f["产品型号"]}）剩余 ${remaining} 次，正常`);
    }

    // 更新剩余次数和状态
    await updateRecord(TABLES.mold, r.record_id, {
      "剩余次数": remaining,
      "状态": status,
    });
  }

  if (alertItems.length > 0) {
    await notifyBatch(`🔧 模芯寿命预警：${alerts} 条`, alertItems, "red");
  }

  console.log(`\n  检查完成: ${alerts} 条预警`);
}

// ─── 规则4：销售预测 → 排产建议 ───────────────────────

async function rule4() {
  console.log("\n📋 规则4：销售预测 → 排产建议");
  log("─".repeat(50));

  const forecasts = getData("forecast");
  const inventory = getData("finished_inventory");
  const existingPlans = getData("production");

  // 库存索引
  const invMap = {};
  for (const r of inventory) {
    invMap[r.fields["产品型号"]] = r.fields;
  }

  // 已有排产索引（避免重复生成）
  const planSet = new Set();
  for (const r of existingPlans) {
    planSet.add(`${r.fields["周次"]}_${r.fields["产品型号"]}`);
  }

  // Seasonal adjustment coefficients (from config)
  function getSeasonalCoefficient() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const summerMonths = cfg("rule4", "seasonal_summer_months", [6, 7, 8]);
    const schoolMonths = cfg("rule4", "seasonal_school_months", [9]);
    const cnyMonths = cfg("rule4", "seasonal_cny_months", [1, 2]);
    if (summerMonths.includes(month)) return cfg("rule4", "seasonal_summer", 1.3);
    if (schoolMonths.includes(month)) return cfg("rule4", "seasonal_school", 1.2);
    if (cnyMonths.includes(month)) return cfg("rule4", "seasonal_cny", 0.8);
    return cfg("rule4", "seasonal_default", 1.0);
  }

  const seasonalCoeff = getSeasonalCoefficient();
  log(`  📅 Seasonal coefficient: ${seasonalCoeff}`);

  let created = 0;
  const planItems = [];
  for (const r of forecasts) {
    const f = r.fields;
    const week = f["预测周期"];
    const sku = f["产品型号"];
    const forecastQty = f["预测销量"] || 0;

    // 跳过已有排产计划
    if (planSet.has(`${week}_${sku}`)) {
      log(`  ⏭️  ${week} ${sku} 已有排产计划，跳过`);
      continue;
    }

    const inv = invMap[sku] || {};
    const currentStock = inv["当前库存"] || 0;
    const inProduction = inv["在产量"] || 0;
    const adjustedForecast = Math.ceil(forecastQty * seasonalCoeff);
    const gap = adjustedForecast - currentStock - inProduction;

    if (gap > 0) {
      await createRecord(TABLES.production, {
        "周次": week,
        "产品型号": sku,
        "建议产量": gap,
        "生产类型": "备货生产",
        "触发原因": `预测${forecastQty}×${seasonalCoeff}=${adjustedForecast} - 库存${currentStock} - 在产${inProduction} = 缺口${gap}`,
        "状态": "待确认",
      });
      logAlert("📌", `${week} ${sku}: 建议产量 ${gap}（预测${forecastQty} - 库存${currentStock} - 在产${inProduction}）`);
      planItems.push({ emoji: "📌", text: `${week} ${sku}: 建议产量 ${gap}` });
      created++;
    } else {
      log(`  ✅ ${week} ${sku}: 库存+在产 (${currentStock}+${inProduction}) ≥ 预测 (${forecastQty})，无需排产`);
    }
  }

  if (planItems.length > 0) {
    await notifyBatch(`📋 新排产建议：${created} 条`, planItems, "orange");
  }

  console.log(`\n  生成完成: ${created} 条排产建议`);
}

// ─── 规则5：毛坯库存预警 ──────────────────────────────

async function rule5() {
  console.log("\n🧱 规则5：毛坯库存预警");
  log("─".repeat(50));

  const blanks = getData("blank_inventory");
  const skuData = getData("sku");

  const skuMap = {};
  for (const r of skuData) {
    skuMap[r.fields["SKU编号"]] = r.fields;
  }

  const alertItems = [];
  let alerts = 0;

  for (const r of blanks) {
    const f = r.fields;
    const sku = f["产品型号"];
    const current = f["当前毛坯库存"] || 0;
    const inProduction = f["在产毛坯量"] || 0;
    const info = skuMap[sku];
    if (!info) continue;

    const blankMultiplier = cfg("rule5", "blank_safety_multiplier", 1.5);
    const safetyBlank = f["安全毛坯库存"] || Math.ceil((info["安全库存"] || 0) * blankMultiplier);

    let status;
    if (current <= 0) {
      status = "❌缺货";
      alertItems.push({ emoji: "🚨", text: `${sku} 毛坯已缺货！在产${inProduction}` });
      alerts++;
    } else if (current < safetyBlank) {
      status = "⚠️低库存";
      alertItems.push({ emoji: "⚠️", text: `${sku} 毛坯${current}片 < 安全线${safetyBlank}片` });
      alerts++;
    } else if (current < cfg("rule5", "blank_floor", 2000)) {
      status = "⚠️低库存";
      alertItems.push({ emoji: "⚠️", text: `${sku} 毛坯${current}片 < ${cfg("rule5", "blank_floor", 2000)}片红线` });
      alerts++;
    } else {
      status = "✅充足";
    }

    await updateRecord(TABLES.blank_inventory, r.record_id, { "状态": status });
    log(`  ${status} ${sku}: 毛坯${current}片, 在产${inProduction}片, 安全线${safetyBlank}片`);
  }

  if (alertItems.length > 0) {
    const blankHighThreshold = cfg("rule5", "high_alert_threshold", 2);
    await notifyBatch(`🧱 毛坯库存预警：${alerts} 条`, alertItems, alerts > blankHighThreshold ? "red" : "orange");
  }

  console.log(`\n  检查完成: ${alerts} 条预警`);
}

// ─── 规则6：订单超期预警 ──────────────────────────────

async function rule6() {
  console.log("\n⏰ 规则6：订单超期预警");
  log("─".repeat(50));

  const orders = getData("order");
  const now = Date.now();
  const warningHours = cfg("rule6", "warning_hours", 24);
  const WARNING_MS = warningHours * 60 * 60 * 1000;
  const skipStatuses = cfg("rule6", "skip_statuses", ["已发货", "完成", "已签收"]);
  const alertItems = [];
  let overdueCount = 0;

  for (const order of orders) {
    const f = order.fields;
    const status = f["订单状态"];
    const promiseDate = f["承诺交货日"];

    // Skip completed/shipped orders (configurable)
    if (!status || skipStatuses.includes(status)) continue;
    if (!promiseDate) continue;

    const promiseTs = typeof promiseDate === "number" ? promiseDate : new Date(promiseDate).getTime();
    const remaining = promiseTs - now;

    if (remaining < 0) {
      const daysOverdue = Math.ceil(-remaining / (24 * 60 * 60 * 1000));
      alertItems.push({ emoji: "🔴", text: `${f["订单编号"]} 已超期${daysOverdue}天！状态: ${status}` });
      overdueCount++;
      logAlert("🔴", `${f["订单编号"]} 已超期 ${daysOverdue} 天（状态: ${status}）`);
    } else if (remaining < WARNING_MS) {
      const hoursLeft = Math.ceil(remaining / (60 * 60 * 1000));
      alertItems.push({ emoji: "🟡", text: `${f["订单编号"]} 距交期仅剩${hoursLeft}小时，当前: ${status}` });
      overdueCount++;
      logAlert("🟡", `${f["订单编号"]} 距交期仅剩 ${hoursLeft} 小时（状态: ${status}）`);
    } else {
      log(`  ✅ ${f["订单编号"]} 交期正常，剩余 ${Math.ceil(remaining / (24*60*60*1000))} 天`);
    }
  }

  if (alertItems.length > 0) {
    await notifyBatch(`⏰ 订单交期预警：${overdueCount} 条`, alertItems, "red");
  }

  console.log(`\n  检查完成: ${overdueCount} 条预警`);
}

// ─── 规则7：采购自动触发 ──────────────────────────────

async function rule7() {
  console.log("\n🛒 规则7：采购自动触发");
  log("─".repeat(50));

  if (!TABLES.procurement) {
    console.log("  ⚠️  采购表未配置，请先运行 migrate_tables.js 并填入 table ID");
    return;
  }

  const molds = getData("mold");
  const blanks = getData("blank_inventory");
  const existingPO = getData("procurement");

  // Index existing open procurement by type+SKU
  const openPO = new Set();
  for (const r of existingPO) {
    const f = r.fields;
    if (f["状态"] !== "已到货" && f["状态"] !== "已取消") {
      openPO.add(`${f["采购类型"]}_${f["关联SKU"]}`);
    }
  }

  let created = 0;
  const alertItems = [];

  // Check molds needing replacement
  for (const r of molds) {
    const f = r.fields;
    const remaining = (f["总寿命（次）"] || 0) - (f["已使用次数"] || 0);
    const moldThreshold = f["预警阈值"] || cfg("rule3", "default_warning_threshold", 500);
    if (remaining < moldThreshold) {
      const key = `模具_${f["产品型号"]}`;
      if (openPO.has(key)) {
        log(`  ⏭️  ${f["模芯编号"]} 已有在途采购，跳过`);
        continue;
      }
      const moldLeadDays = cfg("rule7", "mold_lead_days", 28);
      await createRecord(TABLES.procurement, {
        "采购类型": "模具",
        "关联SKU": f["产品型号"],
        "数量": 1,
        "发起日期": Date.now(),
        "预计到货": Date.now() + moldLeadDays * 24 * 60 * 60 * 1000,
        "状态": "待下单",
        "触发来源": `模芯${f["模芯编号"]}剩余${remaining}次`,
      });
      openPO.add(key);
      alertItems.push({ emoji: "🔧", text: `模具采购: ${f["产品型号"]}（模芯${f["模芯编号"]}剩余${remaining}次）` });
      log(`  📌 创建模具采购: ${f["产品型号"]}（模芯${f["模芯编号"]}剩余${remaining}次）`);
      created++;
    }
  }

  // Check blanks needing replenishment
  for (const r of blanks) {
    const f = r.fields;
    const current = f["当前毛坯库存"] || 0;
    const blankReorderPoint = cfg("rule7", "blank_reorder_point", 2000);
    if (current < blankReorderPoint) {
      const key = `毛坯_${f["产品型号"]}`;
      if (openPO.has(key)) {
        log(`  ⏭️  ${f["产品型号"]} 毛坯已有在途采购，跳过`);
        continue;
      }
      const replenishTarget = cfg("rule7", "blank_replenish_target", 5000);
      const minOrderQty = cfg("rule7", "blank_min_order_qty", 3000);
      const blankLeadDays = cfg("rule7", "blank_lead_days", 21);
      const orderQty = Math.max(replenishTarget - current, minOrderQty);
      await createRecord(TABLES.procurement, {
        "采购类型": "毛坯",
        "关联SKU": f["产品型号"],
        "数量": orderQty,
        "发起日期": Date.now(),
        "预计到货": Date.now() + blankLeadDays * 24 * 60 * 60 * 1000,
        "状态": "待下单",
        "触发来源": `毛坯库存${current}片 < 2000片红线`,
      });
      openPO.add(key);
      alertItems.push({ emoji: "🧱", text: `毛坯采购: ${f["产品型号"]} × ${orderQty}片` });
      log(`  📌 创建毛坯采购: ${f["产品型号"]} × ${orderQty}片`);
      created++;
    }
  }

  if (alertItems.length > 0) {
    await notifyBatch(`🛒 新采购单：${created} 条`, alertItems, "red");
  }

  console.log(`\n  创建完成: ${created} 条采购单`);
}

// ─── 规则8：排产分配车房 ──────────────────────────────

async function rule8() {
  console.log("\n🏭 规则8：排产分配车房");
  log("─".repeat(50));

  if (!TABLES.factory) {
    console.log("  ⚠️  车房表未配置，请先运行 migrate_tables.js 并填入 table ID");
    return;
  }

  const plans = getData("production");
  const factories = getData("factory");

  // Build factory index
  const factoryMap = {};
  for (const r of factories) {
    const f = r.fields;
    const specialties = (f["擅长产品"] || "").split(",").map(s => s.trim());
    factoryMap[f["车房名称"]] = { ...f, specialties, record_id: r.record_id };
  }

  let assigned = 0;
  for (const plan of plans) {
    const f = plan.fields;
    if (f["分配车房"]) {
      log(`  ⏭️  ${f["周次"]} ${f["产品型号"]} 已分配至 ${f["分配车房"]}`);
      continue;
    }

    const sku = f["产品型号"] || "";
    const model = sku.split(/\s/)[0];
    const qty = f["建议产量"] || 0;

    // Find best factory: specialty match + lowest queue
    let bestFactory = null;
    let bestScore = -Infinity;
    for (const [name, fac] of Object.entries(factoryMap)) {
      if (fac["状态"] === "停产") continue;
      const isSpecialty = fac.specialties.some(s => model.includes(s) || s.includes(model));
      const queueDays = (fac["当前排队量"] || 0) / (fac["日产能（片）"] || 1);
      const specialtyBonus = cfg("rule8", "specialty_bonus", 10);
      const score = (isSpecialty ? specialtyBonus : 0) - queueDays;
      if (score > bestScore) {
        bestScore = score;
        bestFactory = name;
      }
    }

    if (bestFactory) {
      await updateRecord(TABLES.production, plan.record_id, { "分配车房": bestFactory });
      const fac = factoryMap[bestFactory];
      const newQueue = Math.max((fac["当前排队量"] || 0) + qty, 1);
      await updateRecord(TABLES.factory, fac.record_id, { "当前排队量": newQueue });
      fac["当前排队量"] = newQueue;
      log(`  ✅ ${f["周次"]} ${f["产品型号"]} × ${qty} → ${bestFactory}`);
      assigned++;
    }
  }

  console.log(`\n  分配完成: ${assigned} 条排产计划`);
}

// ─── 规则9：生产完成 → 模芯使用累加 ──────────────────

async function rule9() {
  console.log("\n🔧 规则9：模芯使用累加");
  log("─".repeat(50));

  const plans = getData("production");
  const molds = getData("mold");

  // Build mold index by SKU
  const moldMap = {};
  for (const r of molds) {
    const sku = r.fields["产品型号"];
    if (!moldMap[sku]) moldMap[sku] = [];
    moldMap[sku].push(r);
  }

  let incremented = 0;
  for (const plan of plans) {
    const f = plan.fields;
    // Only process completed production with uncounted mold usage
    if (f["状态"] !== "完成") continue;
    if (f["已计模芯"] === "是") {
      log(`  ⏭️  ${f["周次"]} ${f["产品型号"]} 已计模芯，跳过`);
      continue;
    }

    const sku = f["产品型号"];
    const qty = f["建议产量"] || 0;
    const skuMolds = moldMap[sku];
    if (!skuMolds || skuMolds.length === 0) {
      log(`  ⚠️  ${sku} 无关联模芯，跳过`);
      continue;
    }

    // Pick the first active mold for this SKU
    const mold = skuMolds[0];
    const mf = mold.fields;
    const newUsed = (mf["已使用次数"] || 0) + qty;
    const remaining = (mf["总寿命（次）"] || 0) - newUsed;

    await updateRecord(TABLES.mold, mold.record_id, {
      "已使用次数": newUsed,
      "剩余次数": remaining,
    });

    // Mark production as counted
    await updateRecord(TABLES.production, plan.record_id, {
      "已计模芯": "是",
    });

    // Update local cache
    mf["已使用次数"] = newUsed;

    log(`  🔧 ${f["周次"]} ${f["产品型号"]} × ${qty} → 模芯${mf["模芯编号"]} 使用+${qty}, 剩余${remaining}次`);
    incremented++;
  }

  console.log(`\n  累加完成: ${incremented} 条`);
}

// ─── 主入口 ─────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] || "all";

  console.log("🚀 眼镜供应链自动化规则引擎\n");
  await getToken();
  console.log("✅ 已连接飞书");

  // Load config: local defaults + Feishu overrides
  await loadConfigOverrides();

  // Preload all tables once (avoids redundant API calls across rules)
  await preloadData();

  const rules = {
    rule1,
    rule2,
    rule3,
    rule4,
    rule5,
    rule6,
    rule7,
    rule8,
    rule9,
  };

  if (cmd === "all") {
    for (const [name, fn] of Object.entries(rules)) {
      await fn();
    }
  } else if (rules[cmd]) {
    await rules[cmd]();
  } else {
    console.error(`未知命令: ${cmd}\n用法: node automations.js [rule1|rule2|rule3|rule4|rule5|rule6|rule7|rule8|rule9|all]`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 自动化规则执行完毕");
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("\n💥 执行失败:", err.message);
  process.exit(1);
});
