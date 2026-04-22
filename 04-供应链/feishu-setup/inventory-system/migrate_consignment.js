/**
 * 寄售库存迁移脚本
 *
 * 创建代理商库存 / 寄售流水 / 月度对账单三张飞书多维表格，
 * 并支持从 Excel 导入代理商初始库存。
 *
 * 用法：
 *   node migrate_consignment.js create-tables              # 在现有 App 下新建三张表，打印 Table ID
 *   node migrate_consignment.js import <agentId> <filePath> # 从 Excel 导入代理商初始库存
 *   node migrate_consignment.js preview <filePath>          # 仅预览 Excel 解析结果
 *   node migrate_consignment.js add-agent-fields            # 给 agent 表添加寄售相关字段
 *
 * Excel 格式（import 用）：
 *   sheet 第一行：SPH \ CYL 矩阵（同 stock_detail 格式）
 *   需要命令行参数指定：agentId 和 Excel 路径
 *   寄售比例默认 50/50（可在脚本常量中修改）
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://open.feishu.cn/open-apis";
const SKUS = ["Ultra双效", "D8"];
const CONSIGN_RATIO = 0.5; // 寄售占比 50%

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

// ─── 建表 ─────────────────────────────────────────────────────────────────
async function createTables() {
  console.log("📊 创建寄售库存相关表...\n");

  // 1. 代理商库存表
  const agentStock = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "代理商库存",
      default_view_name: "全部库存",
      fields: [
        { field_name: "agent_id", type: 1 },                     // TEXT
        { field_name: "SKU_SPH_CYL_AGENT", type: 1 },            // TEXT 主键
        { field_name: "SKU编号", type: 1 },                       // TEXT
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },  // NUMBER
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },  // NUMBER
        { field_name: "自有库存", type: 2, property: { formatter: "0" } },  // NUMBER
        { field_name: "寄售库存", type: 2, property: { formatter: "0" } },  // NUMBER
        { field_name: "寄售入库日期", type: 5 },                   // DATE
        { field_name: "更新时间", type: 1002 },                   // MODIFIED_TIME
      ],
    },
  });
  console.log(`✅ 代理商库存表: ${agentStock.table_id}`);

  // 2. 寄售流水表
  const ledger = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "寄售流水",
      default_view_name: "全部流水",
      fields: [
        { field_name: "流水号", type: 1 },                        // TEXT
        { field_name: "agent_id", type: 1 },                     // TEXT
        { field_name: "类型", type: 3, property: { options: [    // SELECT
          { name: "入库" },
          { name: "消耗" },
          { name: "到期转收入" },
          { name: "退货" },
        ]}},
        { field_name: "SKU编号", type: 1 },
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },
        { field_name: "数量", type: 2, property: { formatter: "0" } },
        { field_name: "关联订单号", type: 1 },
        { field_name: "操作时间", type: 1001 },                   // CREATED_TIME
        { field_name: "备注", type: 1 },
      ],
    },
  });
  console.log(`✅ 寄售流水表: ${ledger.table_id}`);

  // 3. 月度对账单表
  const statement = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "月度对账单",
      default_view_name: "全部对账单",
      fields: [
        { field_name: "代理商", type: 1 },
        { field_name: "月份", type: 1 },                          // "2026-04"
        { field_name: "SKU编号", type: 1 },
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },
        { field_name: "消耗数量", type: 2, property: { formatter: "0" } },
        { field_name: "单价", type: 2, property: { formatter: "0.00" } },
        { field_name: "金额", type: 2, property: { formatter: "0.00" } },
        { field_name: "状态", type: 3, property: { options: [
          { name: "待确认" },
          { name: "已确认" },
          { name: "已付款" },
        ]}},
        { field_name: "确认时间", type: 5 },
      ],
    },
  });
  console.log(`✅ 月度对账单表: ${statement.table_id}`);

  console.log("\n── 请将以下 ID 加到 shared/tables.js ──");
  console.log(`agent_stock: "${agentStock.table_id}",`);
  console.log(`consignment_ledger: "${ledger.table_id}",`);
  console.log(`monthly_statement: "${statement.table_id}",`);
}

// ─── 给 agent 表加字段 ─────────────────────────────────────────────────────
async function addAgentFields() {
  const AGENT_TABLE_ID = "tblHsgGbJWkB31qu";
  console.log("📊 给 agent 表添加寄售相关字段...");

  const fields = [
    { field_name: "寄售账期天数", type: 2, property: { formatter: "0" } },
    { field_name: "结算方式", type: 3, property: { options: [
      { name: "月度消耗结算" },
    ]}},
    { field_name: "备库比例", type: 2, property: { formatter: "0" } },
  ];

  for (const f of fields) {
    try {
      await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_TABLE_ID}/fields`, f);
      console.log(`  ✅ 添加字段: ${f.field_name}`);
    } catch (e) {
      if (e.message?.includes("already exists") || e.message?.includes("已存在")) {
        console.log(`  ⏭️ 字段已存在: ${f.field_name}`);
      } else {
        throw e;
      }
    }
  }
  console.log("✅ agent 表字段添加完成");
}

// ─── Excel 解析 ────────────────────────────────────────────────────────────
function parseExcel(filePath, sheetName) {
  if (!existsSync(filePath)) throw new Error(`Excel 不存在: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
  if (!ws) throw new Error(`sheet 不存在`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const header = rows[0];
  const cylCols = [];
  for (let c = 1; c < header.length; c++) {
    if (typeof header[c] === "number") cylCols.push({ col: c, cyl: header[c] });
  }

  const combos = [];
  for (let r = 1; r < rows.length; r++) {
    const sph = rows[r][0];
    if (typeof sph !== "number") continue;
    for (const { col, cyl } of cylCols) {
      const v = rows[r][col];
      if (v === "" || v === null || v === undefined) continue;
      const stock = Number(v);
      if (!Number.isFinite(stock) || stock <= 0) continue;
      combos.push({ sph, cyl, stock });
    }
  }
  return combos;
}

// ─── 导入代理商库存 ────────────────────────────────────────────────────────
async function importAgentStock(agentId, filePath) {
  const sheetName = process.argv[5]; // 可选 sheet 名
  const combos = parseExcel(filePath, sheetName);
  console.log(`📦 Excel 解析：${combos.length} 个度数组合`);

  // 先清空该代理商的现有记录
  const AGENT_STOCK_TABLE = process.argv[6]; // 可选 tableId
  if (!AGENT_STOCK_TABLE) {
    console.error("用法: node migrate_consignment.js import <agentId> <filePath> [sheetName] <agentStockTableId>");
    process.exit(1);
  }

  console.log(`🧹 清空代理商 ${agentId} 的现有库存...`);
  let cleared = 0;
  while (true) {
    const encoded = encodeURIComponent(`"${agentId}"`);
    const data = await api("GET",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_STOCK_TABLE}/records?page_size=500&filter=CurrentValue.[agent_id]=${encoded}`
    );
    const items = data.items || [];
    if (items.length === 0) break;
    const ids = items.map(x => x.record_id);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_STOCK_TABLE}/records/batch_delete`, { records: ids });
    cleared += ids.length;
    if (!data.has_more) break;
  }
  console.log(`  已删除 ${cleared} 条旧记录`);

  // 构建记录
  const now = new Date().toISOString().slice(0, 10);
  const records = [];
  for (const sku of SKUS) {
    for (const c of combos) {
      const total = c.stock;
      const owned = Math.floor(total * (1 - CONSIGN_RATIO));
      const consigned = total - owned;
      records.push({
        fields: {
          "agent_id": agentId,
          "SKU_SPH_CYL_AGENT": `${agentId}|${sku}|${c.sph.toFixed(2)}|${c.cyl.toFixed(2)}`,
          "SKU编号": sku,
          "SPH": c.sph,
          "CYL": c.cyl,
          "自有库存": owned,
          "寄售库存": consigned,
          "寄售入库日期": new Date(now).getTime(),
        },
      });
    }
  }

  console.log(`📝 将写入 ${records.length} 条记录（${SKUS.length} SKU × ${combos.length} 度数）`);
  console.log(`   每条 = 自有 ${Math.floor(combos[0]?.stock * (1 - CONSIGN_RATIO) || 0)} + 寄售 ${Math.ceil((combos[0]?.stock || 0) * CONSIGN_RATIO)}（首行示例）`);

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${AGENT_STOCK_TABLE}/records/batch_create`, { records: batch });
    console.log(`  已写入 ${Math.min(i + 500, records.length)} / ${records.length}`);
  }
  console.log(`✅ 导入完成：${records.length} 条`);

  // 同时写入库流水
  const LEDGER_TABLE = process.argv[7];
  if (LEDGER_TABLE) {
    console.log("\n📝 写入寄售入库流水...");
    const ledgerRecords = [];
    for (const sku of SKUS) {
      for (const c of combos) {
        const owned = Math.floor(c.stock * (1 - CONSIGN_RATIO));
        const consigned = c.stock - owned;
        if (owned > 0) {
          ledgerRecords.push({
            fields: {
              "流水号": `IN-${agentId}-${sku}-${c.sph.toFixed(2)}-${c.cyl.toFixed(2)}-OWNED`,
              "agent_id": agentId,
              "类型": "入库",
              "SKU编号": sku,
              "SPH": c.sph,
              "CYL": c.cyl,
              "数量": owned,
              "备注": "自有库存初始导入",
            },
          });
        }
        if (consigned > 0) {
          ledgerRecords.push({
            fields: {
              "流水号": `IN-${agentId}-${sku}-${c.sph.toFixed(2)}-${c.cyl.toFixed(2)}-CONSIGN`,
              "agent_id": agentId,
              "类型": "入库",
              "SKU编号": sku,
              "SPH": c.sph,
              "CYL": c.cyl,
              "数量": consigned,
              "备注": `寄售库存初始导入，到期日 ${now}+90天`,
            },
          });
        }
      }
    }
    for (let i = 0; i < ledgerRecords.length; i += 500) {
      const batch = ledgerRecords.slice(i, i + 500);
      await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${LEDGER_TABLE}/records/batch_create`, { records: batch });
    }
    console.log(`✅ 流水写入完成：${ledgerRecords.length} 条`);
  }
}

// ─── 预览 ─────────────────────────────────────────────────────────────────
function preview(filePath) {
  const combos = parseExcel(filePath);
  const total = combos.reduce((a, c) => a + c.stock, 0);
  console.log(`Excel 解析：${combos.length} 个度数组合，合计 ${total} 片`);
  console.log(`SKU 数量：${SKUS.length} → 总写入 ${combos.length * SKUS.length} 行`);
  console.log(`寄售比例：${CONSIGN_RATIO * 100}% / 自有 ${(1 - CONSIGN_RATIO) * 100}%\n`);
  console.log("前 10 行预览：");
  for (const c of combos.slice(0, 10)) {
    const owned = Math.floor(c.stock * (1 - CONSIGN_RATIO));
    const consigned = c.stock - owned;
    console.log(`  SPH=${c.sph.toFixed(2)} CYL=${c.cyl.toFixed(2)} 总=${c.stock} 自有=${owned} 寄售=${consigned}`);
  }
  if (combos.length > 10) {
    const last = combos.at(-1);
    const owned = Math.floor(last.stock * (1 - CONSIGN_RATIO));
    const consigned = last.stock - owned;
    console.log(`  ...`);
    console.log(`  SPH=${last.sph.toFixed(2)} CYL=${last.cyl.toFixed(2)} 总=${last.stock} 自有=${owned} 寄售=${consigned}`);
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
if (cmd === "create-tables") {
  createTables().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "add-agent-fields") {
  addAgentFields().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "import") {
  const agentId = process.argv[3];
  const filePath = process.argv[4];
  if (!agentId || !filePath) {
    console.error("用法: node migrate_consignment.js import <agentId> <filePath> [sheetName] <agentStockTableId> [ledgerTableId]");
    process.exit(1);
  }
  importAgentStock(agentId, filePath).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "preview") {
  const filePath = process.argv[3];
  if (!filePath) { console.error("用法: node migrate_consignment.js preview <filePath>"); process.exit(1); }
  try { preview(filePath); } catch (e) { console.error(e); process.exit(1); }
} else {
  console.log("用法:");
  console.log("  node migrate_consignment.js create-tables              # 建三张表，打印 ID");
  console.log("  node migrate_consignment.js add-agent-fields            # agent 表加寄售字段");
  console.log("  node migrate_consignment.js preview <excel>             # 预览 Excel");
  console.log("  node migrate_consignment.js import <agentId> <excel> [sheet] <stockTableId> [ledgerTableId]");
  process.exit(0);
}
