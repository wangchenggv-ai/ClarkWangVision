/**
 * calc_stock_plan.js — 数据飞轮：从订单数据自动测算备库参数
 *
 * 读 lens_detail 表（含 SPH/CYL），统计近 N 个月的出库分布，
 * 归一化后写入备库参数表（新版本），可选自动回填 stock_detail。
 *
 * 用法：
 *   node calc_stock_plan.js                        # 默认近 3 个月，仅更新参数表
 *   node calc_stock_plan.js --months 6             # 近 6 个月
 *   node calc_stock_plan.js --auto-apply           # 更新参数表 + 自动回填 stock_detail
 *   node calc_stock_plan.js --dry-run              # 预览，不写入
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

let TABLES;
try {
  const mod = await import("../shared/tables.js");
  TABLES = mod.TABLES;
} catch {
  console.error("❌ 无法导入 shared/tables.js");
  process.exit(1);
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

// ─── 工具函数 ──────────────────────────────────────────────────────────────
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

// ─── 统计度数分布 ──────────────────────────────────────────────────────────
async function calcDistribution(months) {
  console.log(`📥 读取镜片明细表（近 ${months} 个月）...`);

  const lensRecords = await listRecords(TABLES.lens_detail);
  console.log(`  📦 lens_detail：${lensRecords.length} 条`);

  // 也读订单表用于时间过滤
  let orderDateMap = new Map();
  if (TABLES.order) {
    const orderRecords = await listRecords(TABLES.order);
    for (const r of orderRecords) {
      const f = r.fields;
      const orderId = f["订单编号"];
      const createTime = f["创建时间"];
      if (orderId && createTime) {
        orderDateMap.set(orderId, new Date(createTime));
      }
    }
    console.log(`  📦 order：${orderRecords.length} 条（建立时间索引）`);
  }

  const cutoff = monthsAgo(months);
  const dist = new Map(); // "SPH|CYL" → count
  let total = 0;
  let filtered = 0;

  for (const r of lensRecords) {
    const f = r.fields;
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    if (!Number.isFinite(sph) || !Number.isFinite(cyl)) continue;

    // 时间过滤：通过订单编号关联订单时间
    const orderId = f["订单编号"];
    if (orderId && orderDateMap.has(orderId)) {
      const orderDate = orderDateMap.get(orderId);
      if (orderDate < cutoff) continue;
    }
    // 如果没有订单关联或时间字段，计入统计

    const key = `${sph.toFixed(2)}|${cyl.toFixed(2)}`;
    dist.set(key, (dist.get(key) || 0) + 1);
    total++;
    filtered++;
  }

  console.log(`  📊 有效镜片：${filtered} 片（总量 ${lensRecords.length}）`);
  return { dist, total };
}

// ─── 写入备库参数表 ───────────────────────────────────────────────────────
async function writePlan(dist, total, month, dryRun) {
  const planTableId = TABLES.stock_plan;
  if (!planTableId) {
    console.error("❌ tables.js 中未配置 stock_plan 表 ID");
    process.exit(1);
  }

  // 先清空当月版本
  if (!dryRun) {
    console.log(`🧹 清空版本 ${month} 的旧数据...`);
    while (true) {
      const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${planTableId}/records?page_size=500`);
      const items = (data.items || []).filter(r => r.fields["版本月份"] === month);
      if (items.length === 0) break;
      const ids = items.map(x => x.record_id);
      await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${planTableId}/records/batch_delete`, { records: ids });
      if (!data.has_more) break;
    }
  }

  // 构建完整 225 行（未命中的补 0）
  const STD_SPH = [];
  for (let s = 0; s >= -6; s -= 0.25) STD_SPH.push(Math.round(s * 100) / 100);
  const STD_CYL = [];
  for (let c = 0; c >= -2; c -= 0.25) STD_CYL.push(Math.round(c * 100) / 100);

  const records = [];
  for (const sph of STD_SPH) {
    for (const cyl of STD_CYL) {
      const key = `${sph.toFixed(2)}|${cyl.toFixed(2)}`;
      const qty = dist.get(key) || 0;
      const ratio = total > 0 ? Math.round((qty / total) * 10000) / 10000 : 0;
      records.push({
        fields: {
          "SPH_CYL": key,
          "SPH": sph,
          "CYL": cyl,
          "备库数量": qty,
          "占比": ratio,
          "版本月份": month,
        },
      });
    }
  }

  if (dryRun) {
    console.log(`\n🏃 DRY RUN：将写入 ${records.length} 条（版本 ${month}）`);
    const topN = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log("分布 Top 10:");
    for (const [k, v] of topN) {
      console.log(`  ${k}  数量=${v}  占比=${((v / total) * 100).toFixed(2)}%`);
    }
    return;
  }

  console.log(`📤 写入备库参数表（${records.length} 条，版本 ${month}）...`);
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${planTableId}/records/batch_create`, { records: batch });
    console.log(`  已写入 ${Math.min(i + 500, records.length)} / ${records.length}`);
  }
  console.log(`✅ 备库参数表更新完成`);
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const autoApply = args.includes("--auto-apply");
  const monthsIdx = args.indexOf("--months");
  const months = monthsIdx >= 0 ? parseInt(args[monthsIdx + 1], 10) : 3;
  const month = currentMonth();

  console.log(`🔄 数据飞轮：自动测算备库参数${dryRun ? " [DRY RUN]" : ""}`);
  console.log(`  回溯月数：${months}`);
  console.log(`  目标版本：${month}`);
  console.log(`  自动回填：${autoApply ? "是" : "否"}\n`);

  // 1. 统计分布
  const { dist, total } = await calcDistribution(months);

  if (total === 0) {
    console.log("⚠️  无有效数据，跳过");
    return;
  }

  // 2. 写入备库参数表
  await writePlan(dist, total, month, dryRun);

  // 3. 自动回填 stock_detail
  if (autoApply && !dryRun) {
    console.log("\n🔧 自动回填 stock_detail...");
    const { execSync } = await import("child_process");
    const scriptPath = resolve(__dirname, "apply_stock_plan.js");
    execSync(`node "${scriptPath}" --month ${month}`, { stdio: "inherit" });
  } else if (autoApply && dryRun) {
    console.log("\n🏃 DRY RUN 模式，跳过回填");
  }

  console.log("\n✅ 数据飞轮完成");
}

run().catch(e => { console.error(e); process.exit(1); });
