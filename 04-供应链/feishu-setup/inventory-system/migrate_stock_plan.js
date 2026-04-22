/**
 * 备库参数表迁移脚本
 *
 * 从 CSV 导入理论备库参数到飞书 Bitable，按月版本可追溯。
 * CSV 是 SPH × CYL 二维矩阵，值为备库数量（基于真实订单统计）。
 *
 * 用法：
 *   node migrate_stock_plan.js preview                   # 仅预览 CSV 解析 + 归一化
 *   node migrate_stock_plan.js create                    # 新建 Bitable 表，打印 table_id
 *   node migrate_stock_plan.js import <tableId> [month]  # 导入数据（先清空），month 默认当前月
 *
 * CSV 路径：C:/Users/wangc/Desktop/备库参数比例 - 理论备库表.csv
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const CSV_PATH = "C:/Users/wangc/Desktop/备库参数比例 - 理论备库表.csv";

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
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || process.env.FEISHU_APP_TOKEN || "";
const APP_ID = ENV.FEISHU_APP_ID;
const APP_SECRET = ENV.FEISHU_APP_SECRET;

if (!APP_TOKEN || !APP_ID || !APP_SECRET) {
  console.error("❌ 缺少 FEISHU_APP_TOKEN / FEISHU_APP_ID / FEISHU_APP_SECRET");
  process.exit(1);
}

// ─── 飞书 API ──────────────────────────────────────────────────────────────
let _token = "";
async function getToken() {
  if (_token) return _token;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
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
    console.error(`API 错误 [${method} ${path}]:`, j.msg, j.error || "");
    throw new Error(j.msg);
  }
  return j.data;
}

// ─── CSV 解析 ──────────────────────────────────────────────────────────────
function parseCsv() {
  if (!existsSync(CSV_PATH)) throw new Error(`CSV 不存在: ${CSV_PATH}`);
  const raw = readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n").filter(l => l.trim());

  // 第一行是列头：空格, 0.00, -0.25, -0.50, ..., -2.00
  const headerCells = lines[0].split(",");
  const cylCols = [];
  for (let c = 1; c < headerCells.length; c++) {
    const v = parseFloat(headerCells[c]);
    if (Number.isFinite(v)) cylCols.push({ col: c, cyl: v });
  }

  const combos = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(",");
    const sph = parseFloat(cells[0]);
    if (!Number.isFinite(sph)) continue;
    for (const { col, cyl } of cylCols) {
      const v = parseInt(cells[col], 10);
      if (!Number.isFinite(v)) continue;
      combos.push({ sph, cyl, qty: v });
    }
  }
  return combos;
}

// ─── 归一化 ─────────────────────────────────────────────────────────────────
function normalize(combos) {
  const total = combos.reduce((s, c) => s + c.qty, 0);
  if (total === 0) throw new Error("CSV 总量为 0，无法归一化");
  return combos.map(c => ({ ...c, ratio: c.qty / total }));
}

// ─── 当前月份 ───────────────────────────────────────────────────────────────
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 建表 ─────────────────────────────────────────────────────────────────
async function createTable() {
  console.log("📊 新建「备库参数表」...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "备库参数表",
      default_view_name: "全部参数",
      fields: [
        { field_name: "SPH_CYL", type: 1 },                                    // 去重键
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },       // 球镜
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },       // 柱镜
        { field_name: "备库数量", type: 2, property: { formatter: "0" } },      // 原始数量
        { field_name: "占比", type: 2, property: { formatter: "0.0000" } },     // 归一化比例
        { field_name: "版本月份", type: 1 },                                    // 月份版本
      ],
    },
  });
  console.log(`✅ 建表成功: table_id = ${data.table_id}`);
  console.log(`\n👉 请将以下行加到 shared/tables.js 的 TABLES 中：`);
  console.log(`   stock_plan: "${data.table_id}",`);
  console.log(`\n然后运行导入：`);
  console.log(`   node migrate_stock_plan.js import ${data.table_id}`);
  return data.table_id;
}

// ─── 清空 ─────────────────────────────────────────────────────────────────
async function clearTable(tableId) {
  console.log(`🧹 清空表 ${tableId} ...`);
  let total = 0;
  while (true) {
    const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?page_size=500`);
    const items = data.items || [];
    if (items.length === 0) break;
    const ids = items.map(x => x.record_id);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, { records: ids });
    total += ids.length;
    if (!data.has_more) break;
  }
  console.log(`  已删除 ${total} 条`);
}

// ─── 导入 ─────────────────────────────────────────────────────────────────
async function importData(tableId, month) {
  const ver = month || currentMonth();
  const combos = parseCsv();
  const normalized = normalize(combos);
  const totalQty = combos.reduce((s, c) => s + c.qty, 0);
  console.log(`📦 CSV 解析：${combos.length} 个度数组合，总量 ${totalQty}，版本 ${ver}`);

  const records = normalized.map(c => ({
    fields: {
      "SPH_CYL": `${c.sph.toFixed(2)}|${c.cyl.toFixed(2)}`,
      "SPH": c.sph,
      "CYL": c.cyl,
      "备库数量": c.qty,
      "占比": Math.round(c.ratio * 10000) / 10000,
      "版本月份": ver,
    },
  }));

  await clearTable(tableId);

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    console.log(`  已写入 ${Math.min(i + 500, records.length)} / ${records.length}`);
  }
  console.log(`✅ 导入完成：${records.length} 条（版本 ${ver}）`);
}

// ─── 预览 ─────────────────────────────────────────────────────────────────
function preview() {
  const combos = parseCsv();
  const normalized = normalize(combos);
  const totalQty = combos.reduce((s, c) => s + c.qty, 0);

  console.log(`CSV 解析：${combos.length} 个度数组合，总量 ${totalQty}\n`);
  console.log("占比 Top 10:");
  const sorted = [...normalized].sort((a, b) => b.qty - a.qty);
  for (const c of sorted.slice(0, 10)) {
    console.log(`  SPH=${c.sph.toFixed(2)}  CYL=${c.cyl.toFixed(2)}  数量=${c.qty}  占比=${(c.ratio * 100).toFixed(2)}%`);
  }
  console.log(`\n占比 Bottom 5:`);
  for (const c of sorted.slice(-5)) {
    console.log(`  SPH=${c.sph.toFixed(2)}  CYL=${c.cyl.toFixed(2)}  数量=${c.qty}  占比=${(c.ratio * 100).toFixed(2)}%`);
  }
  console.log(`\n总计：${normalized.filter(c => c.qty > 0).length} 个有效组合 / ${normalized.length} 总行数`);
}

// ─── 入口 ─────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
if (cmd === "create") {
  createTable().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "import") {
  const tid = process.argv[3];
  const month = process.argv[4];
  if (!tid) { console.error("用法: node migrate_stock_plan.js import <tableId> [month]"); process.exit(1); }
  importData(tid, month).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "preview") {
  try { preview(); } catch (e) { console.error(e); process.exit(1); }
} else {
  console.log("用法:");
  console.log("  node migrate_stock_plan.js preview                # 预览 CSV + 归一化");
  console.log("  node migrate_stock_plan.js create                 # 建表，打印 table_id");
  console.log("  node migrate_stock_plan.js import <tid> [month]   # 导入（默认当前月）");
  process.exit(0);
}
