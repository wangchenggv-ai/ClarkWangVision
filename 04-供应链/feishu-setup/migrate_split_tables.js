/**
 * migrate_split_tables.js — 拆表迁移
 * 订单表（混合）→ 订单主表（一单一条）+ 镜片明细表（一眼一条）
 *
 * Usage: node migrate_split_tables.js [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");
const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const OLD_TBL   = "tblk9Ch4gk2uQ1zG";  // 现有订单表

// ─── .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(__dirname, ".env"), "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("="); env[k.trim()] = v.join("=").trim();
  }
  return env;
}
const ENV = loadEnv();

// ─── Feishu API ────────────────────────────────────────────────────────────
let _token = "";
async function getToken() {
  if (_token) return _token;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  }).then(r => r.json());
  _token = r.tenant_access_token;
  return _token;
}

async function api(method, path, body) {
  const token = await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());
  if (r.code !== 0) throw new Error(`API ${path}: code=${r.code} msg=${r.msg}`);
  return r.data;
}

async function listAllRecords(tableId) {
  const records = []; let pt = "";
  while (true) {
    const qs = `?page_size=100${pt ? "&page_token=" + pt : ""}`;
    const d = await api("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    records.push(...(d.items || []));
    if (!d.has_more) break;
    pt = d.page_token;
  }
  return records;
}

const rv = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");

// ─── 建表 & 加字段 ─────────────────────────────────────────────────────────

async function createTable(name) {
  const d = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables`, {
    table: { name, default_view_name: "默认视图", fields: [{ field_name: name === "订单主表" ? "来源订单号" : "镜片码", type: 1 }] }
  });
  return d.table_id;
}

async function addField(tableId, field) {
  await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, field);
}

const ORDER_FIELDS = [
  { field_name: "顾客姓名",   type: 1 },
  { field_name: "代理商ID",   type: 1 },
  { field_name: "代理商名称", type: 1 },
  { field_name: "SKU",        type: 1 },
  { field_name: "镜片数量",   type: 2 },
  { field_name: "收货地址",   type: 1 },
  { field_name: "下单日期",   type: 5 },
  { field_name: "预计交期",   type: 5 },
  { field_name: "订单状态",   type: 3, property: { options: [
    { name: "待生产", color: 4 }, { name: "生产中", color: 1 },
    { name: "已发货", color: 6 }, { name: "已签收", color: 2 },
  ]}},
  { field_name: "物流公司",   type: 1 },
  { field_name: "快递单号",   type: 1 },
  { field_name: "发货时间",   type: 5 },
  { field_name: "签收时间",   type: 5 },
  { field_name: "物流状态",   type: 3, property: { options: [
    { name: "待发货", color: 4 }, { name: "已发货", color: 1 },
    { name: "运输中", color: 6 }, { name: "已签收", color: 2 },
  ]}},
  { field_name: "备注",       type: 1 },
];

const LENS_FIELDS = [
  { field_name: "来源订单号", type: 1 },
  { field_name: "顾客姓名",   type: 1 },
  { field_name: "代理商ID",   type: 1 },
  { field_name: "眼别",       type: 3, property: { options: [
    { name: "右眼", color: 0 }, { name: "左眼", color: 1 },
  ]}},
  { field_name: "SKU",        type: 1 },
  { field_name: "球镜SPH",    type: 2 },
  { field_name: "柱镜CYL",    type: 2 },
  { field_name: "轴位AXIS",   type: 2 },
  { field_name: "瞳距PD",     type: 2 },
  { field_name: "瞳高PH",     type: 2 },
  { field_name: "镜框型号",   type: 1 },
  { field_name: "生产状态",   type: 3, property: { options: [
    { name: "待生产", color: 4 }, { name: "生产中", color: 1 }, { name: "已完成", color: 2 },
  ]}},
];

// ─── 主流程 ────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  拆表迁移${DRY ? " [DRY-RUN 不写入]" : ""}`);
  console.log(`${"═".repeat(60)}\n`);

  // 1. 读取旧数据
  console.log("1. 读取现有订单表数据...");
  const oldRecords = await listAllRecords(OLD_TBL);
  console.log(`   共 ${oldRecords.length} 条记录`);

  // 按来源订单号分组
  const orderMap = {};
  for (const r of oldRecords) {
    const f  = r.fields;
    const no = rv(f["来源订单号"]);
    if (!no) continue;
    if (!orderMap[no]) {
      orderMap[no] = { fields: f, eyes: [] };
    }
    orderMap[no].eyes.push(r);
  }
  const orderCount = Object.keys(orderMap).length;
  const lensCount  = oldRecords.length;
  console.log(`   ${orderCount} 个订单，${lensCount} 片镜片\n`);

  if (DRY) {
    console.log("   [DRY-RUN] 前3个订单样例：");
    for (const [no, { fields: f, eyes }] of Object.entries(orderMap).slice(0, 3)) {
      console.log(`   ${no}  顾客:${rv(f["顾客姓名"])}  眼别:${eyes.map(e => rv(e.fields["眼别"])).join("/")}  状态:${rv(f["订单状态"])}`);
    }
    console.log("\n   DRY-RUN 完成。去掉 --dry-run 参数执行实际迁移。");
    return;
  }

  // 2. 建订单主表
  console.log("2. 创建「订单主表」...");
  const masterTblId = await createTable("订单主表");
  console.log(`   表ID: ${masterTblId}`);
  for (const f of ORDER_FIELDS) {
    await addField(masterTblId, f);
    process.stdout.write(".");
  }
  console.log(" ✓\n");

  // 3. 建镜片明细表
  console.log("3. 创建「镜片明细表」...");
  const lensTblId = await createTable("镜片明细表");
  console.log(`   表ID: ${lensTblId}`);
  for (const f of LENS_FIELDS) {
    await addField(lensTblId, f);
    process.stdout.write(".");
  }
  console.log(" ✓\n");

  // 4. 写入订单主表（一单一条）
  console.log("4. 迁移数据 → 订单主表...");
  let mOk = 0, mFail = 0;

  // 批量写入，每批 50 条
  const masterRows = [];
  for (const [orderNo, { fields: f, eyes }] of Object.entries(orderMap)) {
    masterRows.push({
      fields: {
        "来源订单号": orderNo,
        "顾客姓名":   rv(f["顾客姓名"]),
        "代理商ID":   rv(f["代理商ID"]),
        "代理商名称": rv(f["代理商名称"]),
        "SKU":        rv(f["SKU"]),
        "镜片数量":   eyes.length,
        "收货地址":   rv(f["收货地址"]) || rv(f["联系人"]),
        "下单日期":   f["下单日期"] || null,
        "预计交期":   f["预计交期"] || null,
        "订单状态":   rv(f["订单状态"]) || "待生产",
        "物流公司":   rv(f["物流公司"]),
        "快递单号":   rv(f["快递单号"]),
        "发货时间":   f["发货时间"] || null,
        "签收时间":   f["签收时间"] || null,
        "物流状态":   rv(f["物流状态"]),
        "备注":       rv(f["备注"]),
      }
    });
  }

  for (let i = 0; i < masterRows.length; i += 50) {
    const batch = masterRows.slice(i, i + 50);
    try {
      await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${masterTblId}/records/batch_create`,
        { records: batch });
      mOk += batch.length;
      process.stdout.write(`\r   ${mOk}/${masterRows.length} 条`);
    } catch (e) {
      mFail += batch.length;
      console.error(`\n   ✗ batch ${i}: ${e.message}`);
    }
  }
  console.log(`\n   ✓ 订单主表：${mOk} 条成功，${mFail} 条失败\n`);

  // 5. 写入镜片明细表（一眼一条）
  console.log("5. 迁移数据 → 镜片明细表...");
  let lOk = 0, lFail = 0;

  const lensRows = [];
  for (const r of oldRecords) {
    const f = r.fields;
    lensRows.push({
      fields: {
        "镜片码":     rv(f["镜片码"]),
        "来源订单号": rv(f["来源订单号"]),
        "顾客姓名":   rv(f["顾客姓名"]),
        "代理商ID":   rv(f["代理商ID"]),
        "眼别":       rv(f["眼别"]) || "右眼",
        "SKU":        rv(f["SKU"]),
        "球镜SPH":    f["球镜SPH"] ?? f["右眼球镜"] ?? null,
        "柱镜CYL":    f["柱镜CYL"] ?? f["右眼柱镜"] ?? null,
        "轴位AXIS":   f["轴位AXIS"] ?? f["右眼轴位"] ?? null,
        "瞳距PD":     f["瞳距"]    ?? f["右眼瞳距"] ?? null,
        "瞳高PH":     f["瞳高"]    ?? f["右眼瞳高"] ?? null,
        "镜框型号":   rv(f["镜框型号"]),
        "生产状态":   rv(f["订单状态"]) === "已签收" || rv(f["订单状态"]) === "已发货" ? "已完成" : "待生产",
      }
    });
  }

  for (let i = 0; i < lensRows.length; i += 50) {
    const batch = lensRows.slice(i, i + 50);
    try {
      await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${lensTblId}/records/batch_create`,
        { records: batch });
      lOk += batch.length;
      process.stdout.write(`\r   ${lOk}/${lensRows.length} 条`);
    } catch (e) {
      lFail += batch.length;
      console.error(`\n   ✗ batch ${i}: ${e.message}`);
    }
  }
  console.log(`\n   ✓ 镜片明细表：${lOk} 条成功，${lFail} 条失败\n`);

  // 6. 保存新表 ID 到 .env
  console.log("6. 写入新表 ID 到 .env...");
  let envContent = readFileSync(resolve(__dirname, ".env"), "utf-8");
  envContent = envContent.replace(/^ORDER_MASTER_TABLE=.*$/m, "");
  envContent = envContent.replace(/^LENS_DETAIL_TABLE=.*$/m, "");
  envContent = envContent.trimEnd() + `\nORDER_MASTER_TABLE=${masterTblId}\nLENS_DETAIL_TABLE=${lensTblId}\n`;
  writeFileSync(resolve(__dirname, ".env"), envContent);
  console.log(`   ORDER_MASTER_TABLE=${masterTblId}`);
  console.log(`   LENS_DETAIL_TABLE=${lensTblId}`);

  // 7. 汇总
  console.log(`\n${"═".repeat(60)}`);
  console.log("  迁移完成！");
  console.log(`  订单主表: ${masterTblId}  (${mOk} 单)`);
  console.log(`  镜片明细表: ${lensTblId}  (${lOk} 片)`);
  console.log(`\n  下一步：更新 server.js / logistics.js 使用新表 ID`);
  console.log(`${"═".repeat(60)}\n`);
})().catch(e => { console.error("✗ 错误:", e.message); process.exit(1); });
