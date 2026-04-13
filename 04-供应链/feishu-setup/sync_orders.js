/**
 * sync_orders.js — 增量同步旧订单表 → 新系统订单表
 *
 * 旧表只读，不做任何写操作。
 * 用 来源订单号 去重，幂等，重跑安全。
 *
 * Usage:
 *   node sync_orders.js               # 增量同步（从上次游标）
 *   node sync_orders.js --days 7      # 同步最近N天（测试）
 *   node sync_orders.js --dry-run     # 只读取打印，不写入
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const NEW_APP_TOKEN = "B3xQbbqicaome1sKdZbcwdk8nWg";
const NEW_ORDER_TABLE = "tblk9Ch4gk2uQ1zG";
const CURSOR_FILE = resolve(__dirname, ".sync_cursor.json");
const MAPPING_FILE = resolve(__dirname, "field_mapping.json");
const BASE = "https://open.feishu.cn/open-apis";

// ─── Field mapping (填写旧表信息后生效) ────────────────────────────────────────

function loadMapping() {
  if (!existsSync(MAPPING_FILE)) return null;
  return JSON.parse(readFileSync(MAPPING_FILE, "utf-8"));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [k, ...v] = t.split("=");
    env[k.trim()] = v.join("=").trim();
  }
  return env;
}

function loadCursor() {
  if (!existsSync(CURSOR_FILE)) return null;
  return JSON.parse(readFileSync(CURSOR_FILE, "utf-8")).last_sync_time;
}

function saveCursor(isoTime) {
  writeFileSync(CURSOR_FILE, JSON.stringify({ last_sync_time: isoTime }, null, 2));
}

let TOKEN = "";
async function getToken(env) {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await res.json()).tenant_access_token;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── 读旧表（只读）────────────────────────────────────────────────────────────

async function fetchOldOrders(mapping, sinceDate) {
  const { OLD_APP_TOKEN, OLD_TABLE_ID } = mapping;
  if (!OLD_APP_TOKEN || OLD_APP_TOKEN === "待填") {
    console.log("  ⚠️  field_mapping.json 中 OLD_APP_TOKEN 尚未填写，跳过读取旧表");
    return [];
  }

  let records = [];
  let pageToken = "";

  while (true) {
    let qs = "?page_size=100";
    if (pageToken) qs += `&page_token=${pageToken}`;
    // 注意：不使用filter，读取后在本地按日期过滤
    // （飞书filter对日期字段的语法需要field_id，且行为不可靠）
    const res = await apiGet(`/bitable/v1/apps/${OLD_APP_TOKEN}/tables/${OLD_TABLE_ID}/records${qs}`);
    if (res.code !== 0) { console.error("  ❌ 读旧表失败:", res.msg); break; }
    if (res.data.items) records.push(...res.data.items);
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }

  // 本地按日期过滤
  if (sinceDate) {
    const dateFieldName = mapping.fields["旧_下单日期"];
    const sinceTs = new Date(sinceDate).getTime();
    const before = records.length;
    records = records.filter(r => {
      const dt = r.fields[dateFieldName];
      if (!dt) return false;
      // 飞书日期字段可能是毫秒时间戳
      const ts = typeof dt === "number" ? dt : new Date(dt).getTime();
      return ts >= sinceTs;
    });
    console.log(`    日期过滤: ${before} → ${records.length} 条 (>= ${sinceDate})`);
  }

  return records;
}

// ─── Link字段文本提取 ─────────────────────────────────────────────────────────
// 飞书Link字段返回格式: [{text:"...", record_ids:["rec..."], table_id:"tbl..."}]
// text属性已经包含可读文本，无需额外查询关联表

function extractLinkText(fieldValue) {
  if (!fieldValue) return "";
  if (typeof fieldValue === "string") return fieldValue;
  const arr = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  return arr.map(item => item.text || item.name || "").filter(Boolean).join(", ");
}

// 从飞书字段值中提取纯文本
function val(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(i => i.text || i.name || String(i)).join("");
  if (typeof v === "object") return v.text || v.name || "";
  return String(v);
}

// ─── 客户表：按名称查找或新建 ──────────────────────────────────────────────────

const customerCache = {};  // name → 客户ID

async function getOrCreateCustomer(customerTable, customerName, dryRun) {
  if (!customerName) return null;
  if (customerCache[customerName]) return customerCache[customerName];

  // 查飞书客户表
  const res = await apiGet(
    `/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${customerTable}/records` +
    `?page_size=1&filter=CurrentValue.[客户名称]="${encodeURIComponent(customerName)}"`
  );
  if (res.code === 0 && res.data.items?.length > 0) {
    const id = res.data.items[0].fields["客户ID"];
    customerCache[customerName] = id;
    return id;
  }

  // 新建客户
  const newId = `CUS-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  if (!dryRun) {
    await apiPost(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${customerTable}/records`, {
      fields: { 客户ID: newId, 客户名称: customerName, 来源系统: "订单同步" },
    });
  }
  customerCache[customerName] = newId;
  console.log(`  👤 ${dryRun ? "[DRY]" : "新建"} 客户: ${customerName} → ${newId}`);
  return newId;
}

// ─── 新系统订单表：按来源订单号去重 ───────────────────────────────────────────

async function getExistingOrderNos() {
  const nos = new Set();
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records${qs}`);
    if (res.code !== 0) break;
    for (const r of res.data.items || []) {
      const no = r.fields["来源订单号"];
      if (no) nos.add(no);
    }
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }
  return nos;
}

async function cleanupOldOrders(dryRun) {
  const cutoff = new Date(Date.now() - 90 * 86400000).getTime();
  const toDelete = [];
  let pageToken = "";

  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const res = await apiGet(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records${qs}`);
    if (res.code !== 0) break;
    for (const r of res.data.items || []) {
      const ts = r.fields["下单日期"];
      if (ts && typeof ts === "number" && ts < cutoff) toDelete.push(r.record_id);
    }
    if (!res.data.has_more) break;
    pageToken = res.data.page_token;
  }

  if (toDelete.length === 0) { console.log("  清理：无过期记录"); return; }
  console.log(`  清理：${toDelete.length} 条超过90天的记录 ${dryRun ? "[DRY-跳过]" : ""}`);
  if (dryRun) return;

  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500);
    await fetch(`${BASE}/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records/batch_delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ records: batch }),
    });
  }
}

// ─── 字段映射：旧记录 → 新记录 ────────────────────────────────────────────────

function mapRecord(oldFields, mapping, customerId, resolvedFields) {
  const f = mapping.fields;

  // 日期转毫秒时间戳（飞书日期字段要求）
  function toTs(raw) {
    if (!raw) return null;
    if (typeof raw === "number") {
      // 可能是毫秒时间戳或Excel日期序列号
      if (raw > 1e12) return raw;  // 已经是毫秒时间戳
      return (raw - 25569) * 86400000;  // Excel序列号转毫秒
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  return {
    "SKU":        resolvedFields.sku || oldFields[f["旧_SKU"]] || "",
    "数量":       Number(oldFields[f["旧_数量"]]) || 0,
    "下单日期":   toTs(oldFields[f["旧_下单日期"]]),
    "订单状态":   oldFields[f["旧_状态"]] || "待处理",
    "客户ID":     customerId || "",
    "来源订单号": String(oldFields[f["旧_订单号"]] || ""),
    "同步时间":   Date.now(),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const daysArg = args.find(a => a.startsWith("--days"));
  const days = daysArg ? Number(daysArg.split("=")[1] || args[args.indexOf(daysArg) + 1]) : null;

  console.log(`=== 订单增量同步 ${dryRun ? "[DRY-RUN]" : ""} ===\n`);

  const mapping = loadMapping();
  if (!mapping) {
    console.log("⚠️  field_mapping.json 不存在，以 --dry-run 模式运行演示");
    console.log("   请复制 field_mapping.template.json 并填写旧表信息后重试");
    return;
  }

  const env = loadEnv();
  await getToken(env);
  console.log("✅ 飞书 token 获取成功\n");

  // 确定同步起始时间
  let sinceDate;
  if (days) {
    sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    console.log(`📅 同步范围: 最近 ${days} 天 (>= ${sinceDate})`);
  } else {
    sinceDate = loadCursor();
    console.log(sinceDate ? `📅 增量同步: 上次游标 ${sinceDate}` : "📅 首次同步: 全量");
  }

  // 读旧表
  console.log("\n[1] 读取旧订单表...");
  const oldRecords = await fetchOldOrders(mapping, sinceDate);
  console.log(`    读到 ${oldRecords.length} 条`);

  if (oldRecords.length === 0) {
    console.log("\n✅ 无新记录，同步完成");
    return;
  }

  // 获取新表已有订单号（去重用）
  console.log("\n[2] 加载新系统已有订单号...");
  const existingNos = dryRun ? new Set() : await getExistingOrderNos();
  console.log(`    已有 ${existingNos.size} 条`);

  // 查客户表 ID
  const listRes = await apiGet(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables`);
  const customerTable = (listRes.data?.items || []).find(t => t.name.includes("终端客户"))?.table_id;
  if (!customerTable) { console.error("❌ 未找到终端客户表"); return; }

  // 同步
  console.log("\n[3] 同步中...");
  let inserted = 0, skipped = 0;
  const syncTime = new Date().toISOString();

  for (const rec of oldRecords) {
    const orderNo = String(rec.fields[mapping.fields["旧_订单号"]] || rec.record_id);
    if (existingNos.has(orderNo)) { skipped++; continue; }

    // 提取Link字段文本（Link字段的text属性已包含可读文本）
    const customerName = extractLinkText(rec.fields[mapping.fields["旧_客户名"]]);
    const sku = extractLinkText(rec.fields[mapping.fields["旧_SKU"]]);

    const customerId = await getOrCreateCustomer(customerTable, customerName, dryRun);
    const newFields = mapRecord(rec.fields, mapping, customerId, { sku });

    if (dryRun) {
      console.log(`  [DRY] 订单 ${orderNo}: SKU=${newFields.SKU} 数量=${newFields.数量} 客户=${customerName}(${customerId})`);
    } else {
      const r = await apiPost(`/bitable/v1/apps/${NEW_APP_TOKEN}/tables/${NEW_ORDER_TABLE}/records`, { fields: newFields });
      if (r.code !== 0) {
        console.error(`  ❌ 写入失败 ${orderNo}:`, r.msg);
        if (inserted === 0) console.error('    调试 fields:', JSON.stringify(newFields));
        continue;
      }
    }
    inserted++;
    existingNos.add(orderNo);
  }

  console.log(`\n✅ 同步完成: 写入 ${inserted} 条，跳过重复 ${skipped} 条`);

  console.log("\n[4] 清理90天前的旧记录...");
  await cleanupOldOrders(dryRun);
  if (!dryRun) saveCursor(syncTime);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
