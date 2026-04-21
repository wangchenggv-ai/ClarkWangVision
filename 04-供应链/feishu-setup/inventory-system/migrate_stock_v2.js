/**
 * 度数级成品库存迁移脚本（v2）
 *
 * 新建「度数级成品库存」飞书多维表格，并从 Excel 导入 Ultra双效 + D8 各 225 行度数组合。
 *
 * 用法：
 *   node migrate_stock_v2.js create                    # 在现有 App 下新建一张表，打印 Table ID
 *   node migrate_stock_v2.js import <tableId>          # 向指定 Table ID 导入 Excel 数据（先清空）
 *   node migrate_stock_v2.js preview                   # 仅预览，不写入
 *
 * Excel 路径：C:/Users/wangc/Desktop/备库参数比例.xlsx（sheet：库存表）
 * 行 = SPH（0 ~ -6.00，每 0.25D），列 = CYL（0 ~ -2.00，每 0.25D）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const EXCEL_PATH = "C:/Users/wangc/Desktop/备库参数比例.xlsx";
const SHEET_NAME = "库存表";
const SKUS = ["Ultra双效", "D8"]; // 共用同一份度数分布

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

// ─── Excel 解析 ────────────────────────────────────────────────────────────
function parseExcel() {
  if (!existsSync(EXCEL_PATH)) throw new Error(`Excel 不存在: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`sheet 不存在: ${SHEET_NAME}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const header = rows[0]; // ["", 0, -0.25, -0.5, ..., -2]
  const cylCols = [];
  for (let c = 1; c < header.length; c++) {
    if (typeof header[c] === "number") cylCols.push({ col: c, cyl: header[c] });
  }

  const combos = [];
  for (let r = 1; r < rows.length; r++) {
    const sph = rows[r][0];
    if (typeof sph !== "number") continue; // 跳过合计行
    for (const { col, cyl } of cylCols) {
      const v = rows[r][col];
      if (v === "" || v === null || v === undefined) continue;
      const stock = Number(v);
      if (!Number.isFinite(stock)) continue;
      combos.push({ sph, cyl, stock });
    }
  }
  return combos;
}

// ─── 建表 ─────────────────────────────────────────────────────────────────
async function createTable() {
  console.log("📊 新建「度数级成品库存」表 ...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "度数级成品库存",
      default_view_name: "全部库存",
      fields: [
        { field_name: "SKU_SPH_CYL", type: 1 },          // 主键：SKU|SPH|CYL 拼串，方便查重
        { field_name: "SKU编号", type: 1 },
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },
        { field_name: "当前库存", type: 2, property: { formatter: "0" } },
        { field_name: "更新时间", type: 1002 },
      ],
    },
  });
  console.log(`✅ 建表成功: table_id = ${data.table_id}`);
  console.log(`\n👉 请将以下行加到 server.js:35 的 TABLES 常量中：`);
  console.log(`   stock_detail: "${data.table_id}",`);
  console.log(`\n然后运行导入：`);
  console.log(`   node migrate_stock_v2.js import ${data.table_id}`);
  return data.table_id;
}

// ─── 清空现有记录 ─────────────────────────────────────────────────────────
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

// ─── 导入数据 ─────────────────────────────────────────────────────────────
async function importData(tableId) {
  const combos = parseExcel();
  console.log(`📦 Excel 解析：${combos.length} 个度数组合（单 SKU），合计 ${combos.reduce((a, c) => a + c.stock, 0)} 片`);

  const records = [];
  for (const sku of SKUS) {
    for (const c of combos) {
      records.push({
        fields: {
          "SKU_SPH_CYL": `${sku}|${c.sph.toFixed(2)}|${c.cyl.toFixed(2)}`,
          "SKU编号": sku,
          "SPH": c.sph,
          "CYL": c.cyl,
          "当前库存": c.stock,
        },
      });
    }
  }
  console.log(`📝 将写入 ${records.length} 条记录（${SKUS.length} × ${combos.length}）`);

  await clearTable(tableId);

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    console.log(`  已写入 ${Math.min(i + 500, records.length)} / ${records.length}`);
  }
  console.log(`✅ 导入完成：${records.length} 条`);
}

// ─── 预览 ─────────────────────────────────────────────────────────────────
function preview() {
  const combos = parseExcel();
  console.log(`Excel 解析：${combos.length} 个度数组合，合计 ${combos.reduce((a, c) => a + c.stock, 0)} 片`);
  console.log(`SKU 数量：${SKUS.length} → 总写入 ${combos.length * SKUS.length} 行\n`);
  console.log("前 10 行预览：");
  for (const c of combos.slice(0, 10)) {
    console.log(`  SPH=${c.sph.toFixed(2)} CYL=${c.cyl.toFixed(2)} 库存=${c.stock}`);
  }
  console.log(`  ...\n最后一行: SPH=${combos.at(-1).sph.toFixed(2)} CYL=${combos.at(-1).cyl.toFixed(2)} 库存=${combos.at(-1).stock}`);
}

// ─── 入口 ─────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
if (cmd === "create") {
  createTable().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "import") {
  const tid = process.argv[3];
  if (!tid) { console.error("用法: node migrate_stock_v2.js import <tableId>"); process.exit(1); }
  importData(tid).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "preview") {
  try { preview(); } catch (e) { console.error(e); process.exit(1); }
} else {
  console.log("用法:");
  console.log("  node migrate_stock_v2.js preview              # 只看解析结果，不写飞书");
  console.log("  node migrate_stock_v2.js create               # 建表，打印 table_id");
  console.log("  node migrate_stock_v2.js import <tableId>     # 导入 Ultra双效 + D8 各 225 行");
  process.exit(0);
}
