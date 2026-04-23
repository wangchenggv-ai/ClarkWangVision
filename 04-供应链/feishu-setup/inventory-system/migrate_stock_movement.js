/**
 * migrate_stock_movement.js — 新建库存流水表
 *
 * 用法：
 *   node migrate_stock_movement.js create   # 新建库存流水表，打印 table_id
 *   node migrate_stock_movement.js preview  # 查看表字段
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

let TABLES;
try {
  const mod = await import("../shared/tables.js");
  TABLES = mod.TABLES;
} catch {
  console.error("无法导入 shared/tables.js");
  process.exit(1);
}

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

async function createTable() {
  console.log("新建「库存流水」表...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "库存流水",
      default_view_name: "全部流水",
      fields: [
        { field_name: "单据号", type: 1 },
        { field_name: "类型", type: 3, property: { options: [
          { name: "入库" }, { name: "出库" },
        ]}},
        { field_name: "来源去向", type: 3, property: { options: [
          { name: "采购到货" }, { name: "生产回补" }, { name: "退货退回" }, { name: "盘点补录" },
          { name: "订单发货" }, { name: "报废损耗" }, { name: "调拨出库" }, { name: "盘点差异" },
        ]}},
        { field_name: "SKU编号", type: 1 },
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },
        { field_name: "数量", type: 2, property: { formatter: "0" } },
        { field_name: "变动前库存", type: 2, property: { formatter: "0" } },
        { field_name: "变动后库存", type: 2, property: { formatter: "0" } },
        { field_name: "关联单号", type: 1 },
        { field_name: "备注", type: 1 },
        { field_name: "操作人", type: 1 },
      ],
    },
  });
  console.log(`建表成功: table_id = ${data.table_id}`);
  console.log(`\n请更新 shared/tables.js: stock_movement: "${data.table_id}"`);
  return data.table_id;
}

async function preview() {
  const tableId = TABLES.stock_movement;
  if (!tableId) { console.log("stock_movement 未配置在 tables.js 中"); return; }
  const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  console.log("当前库存流水表字段：");
  for (const f of data.items || []) console.log(`  ${f.field_name} (type=${f.type})`);
}

const cmd = process.argv[2];
if (cmd === "create") {
  createTable().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "preview") {
  preview().catch(e => { console.error(e); process.exit(1); });
} else {
  console.log("用法:");
  console.log("  node migrate_stock_movement.js create   # 新建库存流水表");
  console.log("  node migrate_stock_movement.js preview  # 查看表字段");
  process.exit(0);
}
