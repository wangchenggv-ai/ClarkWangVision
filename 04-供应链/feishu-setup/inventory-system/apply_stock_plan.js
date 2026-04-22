/**
 * apply_stock_plan.js — 理论备库计算 + 回填
 *
 * 公式：理论备库 = max(ceil(月预测 × 季节系数 × 2 × 度数占比), 1)
 *
 * 用法：
 *   node apply_stock_plan.js --dry-run    # 预览计算结果，不写入
 *   node apply_stock_plan.js              # 计算并写入 stock_detail 安全库存
 *   node apply_stock_plan.js --month 2026-04  # 指定备库参数版本月份
 *   node apply_stock_plan.js --targets "Ultra双效=6000,D8=6000,小旋风=5000"  # 手动指定 SKU 总目标
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";

// ─── 环境 ─────────────────────────────────────────────────────────────────
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

// ─── 表 ID（从 tables.js 引用）────────────────────────────────────────────
let TABLES;
try {
  const mod = await import("../shared/tables.js");
  TABLES = mod.TABLES;
} catch {
  console.error("❌ 无法导入 shared/tables.js");
  process.exit(1);
}

// ─── 规则配置（复用 automations.js 的逻辑）─────────────────────────────────
let LOCAL_CONFIG = {};
try {
  LOCAL_CONFIG = JSON.parse(readFileSync(resolve(__dirname, "../order-system/rules_config.json"), "utf-8"));
} catch {
  console.log("⚠️  rules_config.json 未找到，使用内置默认值");
}

// ─── 飞书 API ──────────────────────────────────────────────────────────────
let _token = "";
async function getToken() {
  if (_token) return _token;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`token 获取失败: ${j.msg}`);
  _token = j.tenant_access_token;
  return _token;
}

async function api(method, path, body) {
  const tok = await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code !== 0) {
    console.error(`API 错误 [${method} ${path}]:`, j.msg);
    throw new Error(j.msg);
  }
  return j.data;
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

// ─── 季节系数（复用 rule4 逻辑）───────────────────────────────────────────
function getSeasonalCoefficient() {
  const cfg = LOCAL_CONFIG.rule4 || {};
  const month = new Date().getMonth() + 1;
  const summerMonths = cfg.seasonal_summer_months || [6, 7, 8];
  const schoolMonths = cfg.seasonal_school_months || [9];
  const cnyMonths = cfg.seasonal_cny_months || [1, 2];
  if (summerMonths.includes(month)) return cfg.seasonal_summer || 1.3;
  if (schoolMonths.includes(month)) return cfg.seasonal_school || 1.2;
  if (cnyMonths.includes(month)) return cfg.seasonal_cny || 0.8;
  return cfg.seasonal_default || 1.0;
}

// ─── 读备库参数表 ──────────────────────────────────────────────────────────
async function loadStockPlan(tableId, month) {
  const records = await listRecords(tableId);
  const ver = month || currentMonth();

  // 先尝试精确匹配月份，找不到则用最新版本
  let filtered = records.filter(r => (r.fields["版本月份"] || "") === ver);
  if (filtered.length === 0) {
    const versions = [...new Set(records.map(r => r.fields["版本月份"]).filter(Boolean))].sort();
    if (versions.length === 0) throw new Error("备库参数表为空");
    ver = versions.at(-1);
    filtered = records.filter(r => (r.fields["版本月份"] || "") === ver);
    console.log(`  ℹ️  版本 ${month || currentMonth()} 不存在，使用最新版本 ${ver}`);
  }

  const planMap = new Map();
  for (const r of filtered) {
    const f = r.fields;
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const ratio = Number(f["占比"]) || 0;
    if (!Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
    planMap.set(`${sph.toFixed(2)}|${cyl.toFixed(2)}`, ratio);
  }
  console.log(`  📊 备库参数表：版本 ${ver}，${planMap.size} 个度数组合`);
  return planMap;
}

// ─── 读月预测 ─────────────────────────────────────────────────────────────
async function loadMonthlyForecast() {
  if (!TABLES.forecast) {
    console.log("  ⚠️  forecast 表未配置，跳过");
    return new Map();
  }
  try {
    const records = await listRecords(TABLES.forecast);
    const skuForecast = new Map();

    for (const r of records) {
      const f = r.fields;
      const sku = f["产品型号"] || (Array.isArray(f["SKU"]) ? f["SKU"][0]?.text : f["SKU"]);
      const qty = Number(f["预测销量"]) || 0;
      if (!sku || qty <= 0) continue;
      skuForecast.set(sku, (skuForecast.get(sku) || 0) + qty);
    }

    const monthly = new Map();
    for (const [sku, totalWeekly] of skuForecast) {
      const weeks = Math.max(1, records.filter(r => {
        const s = r.fields["产品型号"] || (Array.isArray(r.fields["SKU"]) ? r.fields["SKU"][0]?.text : r.fields["SKU"]);
        return s === sku && (Number(r.fields["预测销量"]) || 0) > 0;
      }).length);
      const monthlyQty = Math.ceil((totalWeekly / weeks) * 4.33);
      monthly.set(sku, monthlyQty);
    }

    console.log(`  📈 月预测：${[...monthly.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    return monthly;
  } catch (err) {
    console.log(`  ⚠️  forecast 表读取失败（${err.message}），跳过`);
    return new Map();
  }
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────
async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const monthIdx = process.argv.indexOf("--month");
  const month = monthIdx >= 0 ? process.argv[monthIdx + 1] : null;
  const targetsIdx = process.argv.indexOf("--targets");
  const targetsStr = targetsIdx >= 0 ? process.argv[targetsIdx + 1] : null;

  // 解析 --targets "Ultra双效=6000,D8=6000"
  let manualTargets = new Map();
  if (targetsStr) {
    for (const pair of targetsStr.split(",")) {
      const [sku, qty] = pair.split("=");
      if (sku && qty) manualTargets.set(sku.trim(), parseInt(qty, 10));
    }
  }

  console.log(`🔧 理论备库计算${dryRun ? " [DRY RUN]" : ""}`);
  console.log(`  当前月份：${new Date().getMonth() + 1} 月`);
  const coeff = getSeasonalCoefficient();
  console.log(`  季节系数：${coeff}`);
  if (manualTargets.size > 0) {
    console.log(`  手动目标：${[...manualTargets.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  // 1. 读备库参数表
  console.log("\n📥 读取备库参数表...");
  const planTableId = TABLES.stock_plan;
  if (!planTableId) {
    console.error("❌ tables.js 中未配置 stock_plan 表 ID");
    process.exit(1);
  }
  const planMap = await loadStockPlan(planTableId, month);

  // 2. 读月预测
  console.log("\n📥 读取销售预测...");
  const monthlyForecast = await loadMonthlyForecast();

  // 3. 读当前 stock_detail
  console.log("\n📥 读取 stock_detail...");
  const stockRecords = await listRecords(TABLES.stock_detail);
  console.log(`  📦 stock_detail：${stockRecords.length} 条`);

  // 4. 按 SKU 分组计算
  const SKU_CATALOG = ["Ultra双效", "D8", "时空之眼A", "时空之眼B", "时空之眼PRO", "时空之眼MAX", "小旋风"];
  const updates = [];
  const summary = [];

  for (const sku of SKU_CATALOG) {
    // 优先级：手动目标 > 预测 × 季节 × 2
    let totalTarget = 0;
    let source = "";
    if (manualTargets.has(sku)) {
      totalTarget = manualTargets.get(sku);
      source = `手动目标=${totalTarget}`;
    } else {
      const monthlyQty = monthlyForecast.get(sku) || 0;
      if (monthlyQty > 0) {
        totalTarget = Math.ceil(monthlyQty * coeff * 2);
        source = `月预测=${monthlyQty} × 季节${coeff} × 2`;
      }
    }

    if (totalTarget === 0) {
      console.log(`  ⏭️  ${sku}：无预测数据且无手动目标，跳过`);
      continue;
    }

    console.log(`\n  🔢 ${sku}：${source} = 总目标${totalTarget}`);

    let applied = 0;
    let skipped = 0;

    for (const r of stockRecords) {
      const f = r.fields;
      const recSku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : (Array.isArray(f["SKU编号"]) ? f["SKU编号"][0]?.text : "");
      if (recSku !== sku) continue;

      const sph = Number(f["SPH"]);
      const cyl = Number(f["CYL"]);
      if (!Number.isFinite(sph) || !Number.isFinite(cyl)) continue;

      const key = `${sph.toFixed(2)}|${cyl.toFixed(2)}`;
      const ratio = planMap.get(key) || 0;
      const target = ratio > 0 ? Math.max(Math.ceil(totalTarget * ratio), 1) : 0;

      updates.push({
        record_id: r.record_id,
        fields: { "安全库存": target },
        _debug: { sku, sph, cyl, ratio, target },
      });
      applied++;
    }

    summary.push({ sku, totalTarget, applied });
    console.log(`    → ${applied} 行将更新`);
  }

  // 5. 输出摘要
  console.log("\n" + "=".repeat(50));
  console.log("📋 计算摘要");
  console.log("=".repeat(50));
  for (const s of summary) {
    console.log(`  ${s.sku}：总目标 ${s.totalTarget} 片，更新 ${s.applied} 行`);
  }
  console.log(`  总计：${updates.length} 条更新`);

  // 6. 写入
  if (dryRun) {
    console.log("\n🏃 DRY RUN 模式，不写入飞书");
    // 展示前 5 条预览
    console.log("\n前 5 条预览：");
    for (const u of updates.slice(0, 5)) {
      const d = u._debug;
      console.log(`  ${d.sku} SPH=${d.sph.toFixed(2)} CYL=${d.cyl.toFixed(2)}  占比=${(d.ratio * 100).toFixed(2)}%  → 安全库存=${d.target}`);
    }
    return;
  }

  console.log("\n📤 写入 stock_detail...");
  // 清除 debug 字段，只保留 record_id 和 fields
  const cleanUpdates = updates.map(({ record_id, fields }) => ({ record_id, fields }));
  for (let i = 0; i < cleanUpdates.length; i += 500) {
    const batch = cleanUpdates.slice(i, i + 500);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/batch_update`, { records: batch });
    console.log(`  已更新 ${Math.min(i + 500, cleanUpdates.length)} / ${cleanUpdates.length}`);
  }
  console.log(`\n✅ 完成：${cleanUpdates.length} 条安全库存已更新`);
}

run().catch(e => { console.error(e); process.exit(1); });
