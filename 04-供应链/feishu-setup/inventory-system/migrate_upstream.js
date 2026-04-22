/**
 * 上游物料表建表 + stock_detail 加字段 + 配表单视图
 *
 * 用法：
 *   node migrate_upstream.js create-tables    # 新建毛坯库存表 + 模具台账表，打印 table_id
 *   node migrate_upstream.js add-fields       # stock_detail 新增 安全库存 + 最近出库
 *   node migrate_upstream.js create-forms     # 三张表各配一个表单视图
 *   node migrate_upstream.js all              # 以上全做
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
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || process.env.FEISHU_APP_TOKEN || "";
const APP_ID = ENV.FEISHU_APP_ID;
const APP_SECRET = ENV.FEISHU_APP_SECRET;

if (!APP_TOKEN || !APP_ID || !APP_SECRET) {
  console.error("❌ 缺少 FEISHU_APP_TOKEN / FEISHU_APP_ID / FEISHU_APP_SECRET");
  process.exit(1);
}

// 现有表 ID
const STOCK_DETAIL_ID = "tbl7U79QGG4JtQev";

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

// ─── 建表：毛坯库存 ─────────────────────────────────────────────────────────
async function createBlankInventory() {
  console.log("📦 新建「毛坯库存」表 ...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "毛坯库存",
      default_view_name: "全部毛坯",
      fields: [
        { field_name: "批次号", type: 1 },                                          // TEXT
        { field_name: "SKU编号", type: 1 },                                         // TEXT
        { field_name: "CYL档位", type: 2, property: { formatter: "0.00" } },        // NUMBER
        { field_name: "数量", type: 2, property: { formatter: "0" } },              // NUMBER
        { field_name: "已消耗", type: 2, property: { formatter: "0" } },            // NUMBER
        { field_name: "到货日期", type: 5 },                                         // DATE
        { field_name: "保质期至", type: 5 },                                         // DATE
        {
          field_name: "状态", type: 3,                                              // SINGLE_SELECT
          property: {
            options: [
              { name: "在库", color: 0 },
              { name: "已用完", color: 1 },
              { name: "已过期", color: 2 },
              { name: "质检中", color: 3 },
            ],
          },
        },
        { field_name: "供应商", type: 1 },                                          // TEXT
        { field_name: "备注", type: 1 },                                            // TEXT
        { field_name: "更新时间", type: 1002 },                                      // MODIFIED_TIME
      ],
    },
  });
  console.log(`✅ 毛坯库存表 ID: ${data.table_id}`);
  return data.table_id;
}

// ─── 建表：模具台账 ─────────────────────────────────────────────────────────
async function createMold() {
  console.log("🔧 新建「模具台账」表 ...");
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: {
      name: "模具台账",
      default_view_name: "全部模具",
      fields: [
        { field_name: "模具编号", type: 1 },                                         // TEXT
        { field_name: "SKU编号", type: 1 },                                         // TEXT
        { field_name: "总寿命", type: 2, property: { formatter: "0" } },            // NUMBER
        { field_name: "已使用", type: 2, property: { formatter: "0" } },            // NUMBER
        { field_name: "剩余寿命", type: 2, property: { formatter: "0" } },          // NUMBER (手动，待API支持公式再改)
        {
          field_name: "状态", type: 3,                                              // SINGLE_SELECT
          property: {
            options: [
              { name: "正常", color: 0 },
              { name: "预警", color: 3 },
              { name: "需更换", color: 2 },
              { name: "已报废", color: 1 },
            ],
          },
        },
        { field_name: "投入使用日", type: 5 },                                       // DATE
        { field_name: "最近使用日", type: 5 },                                       // DATE
        { field_name: "供应商", type: 1 },                                          // TEXT
        { field_name: "备注", type: 1 },                                            // TEXT
        { field_name: "更新时间", type: 1002 },                                      // MODIFIED_TIME
      ],
    },
  });
  console.log(`✅ 模具台账表 ID: ${data.table_id}`);
  return data.table_id;
}

// ─── stock_detail 加字段 ────────────────────────────────────────────────────
async function addStockDetailFields() {
  console.log("📝 stock_detail 新增字段 ...");

  // 安全库存
  try {
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${STOCK_DETAIL_ID}/fields`, {
      field_name: "安全库存",
      type: 2,
      property: { formatter: "0" },
    });
    console.log("  ✅ 安全库存 (NUMBER)");
  } catch (e) {
    if (e.message.includes("FieldNameExist")) {
      console.log("  ⏭️ 安全库存 已存在，跳过");
    } else throw e;
  }

  // 最近出库
  try {
    await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${STOCK_DETAIL_ID}/fields`, {
      field_name: "最近出库",
      type: 5,
    });
    console.log("  ✅ 最近出库 (DATE)");
  } catch (e) {
    if (e.message.includes("FieldNameExist")) {
      console.log("  ⏭️ 最近出库 已存在，跳过");
    } else throw e;
  }
}

// ─── 配表单视图 ─────────────────────────────────────────────────────────────
async function createForm(tableId, tableName, formFields) {
  console.log(`📋 配置「${tableName}」表单视图 ...`);

  // 获取表的所有字段
  const fieldsData = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields?page_size=100`);
  const fieldMap = {};
  for (const f of fieldsData.items || []) {
    fieldMap[f.field_name] = f.field_id;
  }

  // 构造表单字段配置：只包含指定的字段，按顺序排列
  const visibleFields = formFields.map(name => {
    const fid = fieldMap[name];
    if (!fid) {
      console.log(`  ⚠️ 字段 "${name}" 不存在，跳过`);
      return null;
    }
    return { field_id: fid };
  }).filter(Boolean);

  // 创建表单视图
  const data = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views`, {
    view_name: `${tableName}录入`,
    view_type: "form",
  });
  const viewId = data.view?.view_id;
  if (!viewId) {
    console.log("  ❌ 创建表单视图失败");
    return;
  }

  // 更新表单配置：设置可见字段和顺序
  await api("PATCH", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views/${viewId}`, {
    property: {
      form: {
        shared_url: "",
        fields: visibleFields,
      },
    },
  });

  // 获取表单分享链接
  const viewDetail = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views/${viewId}`);
  const shareUrl = viewDetail?.view?.property?.form?.shared_url;

  console.log(`  ✅ 表单视图 ID: ${viewId}`);
  if (shareUrl) console.log(`  🔗 分享链接: ${shareUrl}`);
  return viewId;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────
async function main() {
  const cmd = process.argv[2];

  if (cmd === "create-tables" || cmd === "all") {
    const blankId = await createBlankInventory();
    const moldId = await createMold();
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("👉 请将以下内容更新到 shared/tables.js：");
    console.log(`   blank_inventory: "${blankId}",`);
    console.log(`   mold: "${moldId}",`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  if (cmd === "add-fields" || cmd === "all") {
    await addStockDetailFields();
  }

  if (cmd === "create-forms" || cmd === "all") {
    console.log("\n📋 创建表单视图 ...");

    // 毛坯库存表单：仓库人员填，跳过自动字段
    const blankId = process.argv[3] || "tbladv6bQTXlNOlM";
    await createForm(blankId, "毛坯库存", [
      "批次号", "SKU编号", "CYL档位", "数量", "到货日期", "保质期至", "状态", "供应商", "备注",
    ]);

    // 模具台账表单
    const moldId = process.argv[4] || "tblkZ4ODg3v63prW";
    await createForm(moldId, "模具台账", [
      "模具编号", "SKU编号", "总寿命", "已使用", "状态", "投入使用日", "最近使用日", "供应商", "备注",
    ]);

    // 成品库存表单：日常微调
    await createForm(STOCK_DETAIL_ID, "成品库存", [
      "SKU编号", "SPH", "CYL", "当前库存", "安全库存",
    ]);
  }

  if (!cmd) {
    console.log("用法:");
    console.log("  node migrate_upstream.js create-tables    # 新建毛坯库存 + 模具台账表");
    console.log("  node migrate_upstream.js add-fields       # stock_detail 加 安全库存 + 最近出库");
    console.log("  node migrate_upstream.js create-forms     # 三张表各配一个表单视图");
    console.log("  node migrate_upstream.js all              # 以上全做");
    process.exit(0);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
