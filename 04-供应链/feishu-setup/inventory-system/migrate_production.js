/**
 * migrate_production.js — 给排产表增加度数级排产所需字段
 *
 * 用法：
 *   node migrate_production.js create        # 新建排产表（含全部字段）
 *   node migrate_production.js add-fields    # 已有表新增 6 个字段
 *   node migrate_production.js preview       # 仅打印当前字段列表
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
  console.error("❌ 无法导入 shared/tables.js");
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

// ─── 字段定义 ─────────────────────────────────────────────────────────────
const NEW_FIELDS = [
  { field_name: "SPH", type: 2, property: { formatter: "0.00" } },
  { field_name: "CYL", type: 2, property: { formatter: "0.00" } },
  { field_name: "预计完成日", type: 5 },             // DATE
  { field_name: "实际完成日", type: 5 },             // DATE
  { field_name: "工单号", type: 1 },                 // TEXT
  { field_name: "回补状态", type: 3, property: { options: [
    { name: "待回补" },
    { name: "已回补" },
  ]}},
];

// ─── 预览 ─────────────────────────────────────────────────────────────────
async function preview() {
  const tableId = TABLES.production;
  const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  const existing = (data.items || []).map(f => f.field_name);
  console.log("📋 当前 production 表字段：");
  for (const name of existing) {
    const isNew = NEW_FIELDS.some(f => f.field_name === name);
    console.log(`  ${isNew ? "✓" : " "} ${name}`);
  }
  console.log(`\n待新增：${NEW_FIELDS.filter(f => !existing.includes(f.field_name)).map(f => f.field_name).join(", ")}`);
}

// ─── 加字段 ───────────────────────────────────────────────────────────────
async function addFields() {
  const tableId = TABLES.production;
  console.log("🔧 给 production 表添加度数级排产字段...");

  // 检查已有字段
  const data = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  const existing = new Set((data.items || []).map(f => f.field_name));

  let added = 0;
  for (const field of NEW_FIELDS) {
    if (existing.has(field.field_name)) {
      console.log(`  ⏭️  ${field.field_name} 已存在，跳过`);
      continue;
    }
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, field);
    console.log(`  ✅ ${field.field_name} 已添加`);
    added++;
  }

  console.log(`\n完成：${added} 个字段已添加`);
}

// ─── 建表 ─────────────────────────────────────────────────────────────────
async function createTable() {
  console.log("📊 新建「排产计划」表（含度数级字段）...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "排产计划",
      default_view_name: "全部排产",
      fields: [
        { field_name: "工单号", type: 1 },                                          // 去重键
        { field_name: "产品型号", type: 1 },                                         // SKU
        { field_name: "SPH", type: 2, property: { formatter: "0.00" } },           // 球镜
        { field_name: "CYL", type: 2, property: { formatter: "0.00" } },           // 柱镜
        { field_name: "周次", type: 1 },                                            // 预测周期（rule4 兼容）
        { field_name: "建议产量", type: 2, property: { formatter: "0" } },          // 数量
        { field_name: "生产类型", type: 3, property: { options: [
          { name: "备货生产" }, { name: "订单生产" },
        ]}},
        { field_name: "触发原因", type: 1 },                                         // 公式说明
        { field_name: "状态", type: 3, property: { options: [
          { name: "待确认" }, { name: "生产中" }, { name: "完成" },
        ]}},
        { field_name: "分配车房", type: 1 },                                         // 规则8 填
        { field_name: "已计模芯", type: 3, property: { options: [
          { name: "否" }, { name: "是" },
        ]}},
        { field_name: "预计完成日", type: 5 },                                       // DATE
        { field_name: "实际完成日", type: 5 },                                       // DATE
        { field_name: "回补状态", type: 3, property: { options: [
          { name: "待回补" }, { name: "已回补" },
        ]}},
      ],
    },
  });
  console.log(`✅ 建表成功: table_id = ${data.table_id}`);
  console.log(`\n👉 请更新 shared/tables.js: production: "${data.table_id}"`);
  return data.table_id;
}

// ─── 入口 ─────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
if (cmd === "create") {
  createTable().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "add-fields") {
  addFields().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "preview") {
  preview().catch(e => { console.error(e); process.exit(1); });
} else {
  console.log("用法:");
  console.log("  node migrate_production.js create       # 新建排产表（含全部字段）");
  console.log("  node migrate_production.js preview      # 查看当前字段");
  console.log("  node migrate_production.js add-fields   # 已有表添加度数级字段");
  process.exit(0);
}
