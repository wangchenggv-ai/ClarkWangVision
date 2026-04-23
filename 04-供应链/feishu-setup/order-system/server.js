/**
 * order-system/server.js — 代理商订单门户后端（生产级）
 *
 * 接口：
 *   GET  /                     → 下单页
 *   GET  /track                → 查询页
 *   GET  /api/agent?t=xxx      → 代理商信息
 *   GET  /api/skus?t=xxx       → SKU列表 + 实时库存状态（5分钟缓存）
 *   GET  /api/delivery-estimate?t=xxx&sku=xxx&qty=N → 交期预估
 *   POST /api/submit?t=xxx     → 提交订单（智能预处理）
 *   GET  /api/orders?t=xxx     → 订单列表（筛选+分页+统计）
 *   GET  /api/order/:orderNo?t=xxx → 单个订单详情
 *   GET  /api/orders/export?t=xxx  → CSV导出
 *   GET  /api/customers?t=xxx  → 历史客户名列表
 *
 * Usage:
 *   node server.js             # 默认端口 3210
 *   PORT=8080 node server.js
 */

import { createServer } from "http";
import { Socket } from "net";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { spawn } from "child_process";
import QRCode from "qrcode";
import XLSX from "xlsx";
import { TABLES } from "./shared/tables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = "https://open.feishu.cn/open-apis";
const QR_DIR = resolve(__dirname, "public", "qrcodes");

// 常规备货度数范围（闭区间）
const STD_SPH_RANGE = [-6, 0];
const STD_CYL_RANGE = [-2, 0];

// 14 条业务规则元数据（控制中心 UI 用）
const RULE_MANIFEST = {
  rule1: { name: "订单自动分配", desc: "新订单自动分配SKU", params: {
    instock_delivery_days: { label: "现货交期(天)", type: "number" },
    custom_delivery_days: { label: "定制交期(天)", type: "number" },
    max_order_qty: { label: "最大下单量", type: "number" },
  }},
  rule2: { name: "库存预警", desc: "低于阈值自动告警", params: {
    high_alert_threshold: { label: "紧急阈值(倍)", type: "number" },
  }},
  rule3: { name: "模芯寿命预警", desc: "模芯剩余次数告警", params: {
    critical_remaining: { label: "紧急剩余(次)", type: "number" },
    default_warning_threshold: { label: "预警阈值(次)", type: "number" },
  }},
  rule4: { name: "销售预测→排产", desc: "根据周预测+季节系数排产", params: {
    seasonal_summer: { label: "夏季系数", type: "number" },
    seasonal_school: { label: "开学系数", type: "number" },
    seasonal_cny: { label: "春节系数", type: "number" },
  }},
  rule5: { name: "毛坯库存预警", desc: "毛坯低于安全线告警", params: {
    blank_safety_multiplier: { label: "安全倍数", type: "number" },
    blank_floor: { label: "最低库存", type: "number" },
  }},
  rule6: { name: "订单超期预警", desc: "超时未处理/生产告警", params: {
    warning_hours: { label: "告警小时数", type: "number" },
  }},
  rule7: { name: "采购自动触发", desc: "毛坯/模芯低于安全线自动下单", params: {
    mold_lead_days: { label: "模具交期(天)", type: "number" },
    blank_lead_days: { label: "毛坯交期(天)", type: "number" },
    blank_reorder_point: { label: "毛坯再订点", type: "number" },
    blank_replenish_target: { label: "毛坯补货目标", type: "number" },
    blank_min_order_qty: { label: "毛坯最小批量", type: "number" },
  }},
  rule8: { name: "排产分配车房", desc: "按产能+专长自动分配", params: {
    specialty_bonus: { label: "专长加成", type: "number" },
  }},
  rule9: { name: "模芯使用累加", desc: "完工后累加模芯使用量", params: {}},
  rule10: { name: "寄售到期预警", desc: "60天黄/90天红预警", params: {}},
  rule11: { name: "月度对账单", desc: "每月1-3日自动生成", params: {}},
  rule12: { name: "度数级库存预警", desc: "当前库存<安全库存时告警", params: {}},
  rule13: { name: "度数级自动排产", desc: "缺口→工单→分配车房→生产中", params: {
    production_lead_days: { label: "生产周期(天)", type: "number" },
    replenish_multiplier: { label: "补货倍数", type: "number" },
    min_batch_size: { label: "最小批量", type: "number" },
    auto_confirm: { label: "自动确认生产", type: "checkbox" },
  }},
  rule14: { name: "度数级库存回补", desc: "到期/完成→库存+=产量→累加模芯", params: {
    auto_complete: { label: "自动完成回补", type: "checkbox" },
  }},
};

// ─── 配置 ──────────────────────────────────────────────────────────────────

function loadEnv() {
  // 依次尝试 shared/.env → ../.env（兼容不同部署目录）
  const candidates = [
    resolve(__dirname, "../shared/.env"),
    resolve(__dirname, "../.env"),
    resolve(__dirname, ".env"),
  ];
  const env = {};
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [k, ...v] = t.split("=");
      const key = k.trim();
      if (!(key in env)) env[key] = v.join("=").trim(); // 先找到的优先
    }
  }
  return env;
}

const ENV = loadEnv();

// 飞书多维表格 App Token（从环境变量读取，不硬编码在源码）
const APP_TOKEN = ENV.FEISHU_APP_TOKEN || process.env.FEISHU_APP_TOKEN || "";
if (!APP_TOKEN) {
  console.error("❌ 缺少 FEISHU_APP_TOKEN，请在 .env 中配置");
  process.exit(1);
}

// ─── MiMo 大模型 ─────────────────────────────────────────────────────────────

async function callMiMo(systemPrompt, userPrompt) {
  const url = ENV.MIMO_API_URL + "/chat/completions";
  const body = {
    model: "mimo-v2-pro",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + ENV.MIMO_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.choices?.[0]?.message?.content || "";
}

// Excel 解析缓存（fileHash → result）
const _excelCache = new Map();

async function handleExcelUpload(file) {
  // 1. 解析 Excel
  const buffer = Buffer.from(file.data, "base64");

  // 文件哈希缓存 — 同一文件秒回
  const fileHash = createHash("md5").update(buffer).digest("hex");
  if (_excelCache.has(fileHash)) return _excelCache.get(fileHash);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const allRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  if (allRows.length < 2) return { patients: [], warnings: ["Excel 内容为空或无数据行"] };

  // 2. 找表头行（包含"顾客姓名"的行）
  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].some(c => String(c || "").includes("顾客姓名"))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    // 兜底：用第一行当表头
    headerIdx = 0;
  }

  const headers = allRows[headerIdx].map(c => String(c || "").trim());

  // 模糊匹配列
  const findCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx >= 0) return idx;
    idx = headers.findIndex(h => h.startsWith(name) || h.includes(name));
    return idx;
  };

  // 3. 解析数据行
  const dataRows = allRows.slice(headerIdx + 1);
  const warnings = [];
  const patients = [];
  let lastCustomerName = "";
  let orderContact = "", orderPhone = "", orderAddress = "";

  for (const row of dataRows) {
    // 跳过空行
    if (!row.some(c => c != null && String(c).trim() !== "")) continue;

    const get = (name) => {
      const idx = findCol(name);
      return idx >= 0 ? row[idx] : undefined;
    };

    const customerName = String(get("顾客姓名") || "").trim();
    const eye = String(get("眼别") || "").trim();

    // 跳过有眼别但无任何度数的行（Excel 空行模板）
    const _sph = get("球镜") ?? get("SPH") ?? get("球镜SPH");
    const _cyl = get("柱镜") ?? get("CYL") ?? get("柱镜CYL");
    const _axis = get("轴位") ?? get("AXIS") ?? get("轴位AXIS");
    if (eye && (_sph == null || String(_sph).trim() === "") && (_cyl == null || String(_cyl).trim() === "") && (_axis == null || String(_axis).trim() === "")) continue;
    const productModel = String(get("产品型号") || "").trim();
    const sph = get("球镜") ?? get("SPH") ?? get("球镜SPH");
    const cyl = get("柱镜") ?? get("CYL") ?? get("柱镜CYL");
    const axis = get("轴位") ?? get("AXIS") ?? get("轴位AXIS");
    const qty = get("数量（副）") || get("数量") || 1;
    const remark = String(get("备注") || "").trim();
    const contact = String(get("联系人") || "").trim();
    const phone = String(get("联系电话") || "").trim();
    const address = String(get("收货地址") || "").trim();

    // 填充顾客姓名（Excel 中同组可能只填第一行）
    const name = customerName || lastCustomerName;
    if (customerName) lastCustomerName = customerName;

    // 无顾客名的行：有备注则附加到上一个 patient，否则跳过
    if (!name) {
      if (remark && lastCustomerName) {
        const prev = patients.find(p => p.customerName === lastCustomerName);
        if (prev && !prev.remark.includes(remark)) {
          prev.remark = prev.remark ? prev.remark + "；" + remark : remark;
        }
      }
      continue;
    }

    // 收集订单级联系信息（取第一个非空值）
    if (!orderContact && contact) orderContact = contact;
    if (!orderPhone && phone) orderPhone = phone;
    if (!orderAddress && address) orderAddress = address;

    // 查找已有患者或新建
    let patient = patients.find(p => p.customerName === name);
    if (!patient) {
      patient = { customerName: name, sku: productModel, quantity: Number(qty) || 1, eyes: [], assembly: false, remark: "" };
      patients.push(patient);
    }
    if (productModel) patient.sku = productModel;
    if (remark && !patient.remark.includes(remark)) {
      patient.remark = patient.remark ? patient.remark + "；" + remark : remark;
    }

    // 添加眼别
    if (eye) {
      const toRx = (v) => {
        if (v == null || v === "") return "0";
        const s = String(v).trim().toUpperCase();
        if (s === "PL" || s === "PLANO" || s.includes("平光")) return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.round(n * 4) / 4);
      };
      const toAxis = (v) => {
        if (v == null || v === "") return "0";
        const n = Number(v);
        return isNaN(n) ? "0" : String(Math.min(180, Math.max(0, Math.round(n))));
      };
      patient.eyes.push({
        side: eye.includes("右") ? "右眼" : eye.includes("左") ? "左眼" : eye,
        sph: toRx(sph),
        cyl: toRx(cyl),
        axis: toAxis(axis),
      });
    }
  }

  // 4. SKU 校验
  const allSkus = await getSkusWithInventory();
  const modelSkus = getModelSkus(allSkus);
  const skuSet = new Set(modelSkus.map(s => s.sku));
  for (const p of patients) {
    if (!p.sku) p.sku = modelSkus[0]?.sku || "";
    if (!skuSet.has(p.sku)) {
      warnings.push(`SKU "${p.sku}" 未在产品目录中，已保留原值`);
    }
  }

  if (patients.length === 0) {
    warnings.push("未找到有效数据行，请检查列名是否包含「顾客姓名」「眼别」「球镜」等");
  }

  const result = { patients, warnings, contact: orderContact, phone: orderPhone, address: orderAddress };
  if (_excelCache.size >= 50) _excelCache.delete(_excelCache.keys().next().value);
  _excelCache.set(fileHash, result);
  return result;
}

// ─── 代理商管理 ──────────────────────────────────────────────────────────────

let _agentsCache = null;
let _agentsCacheTime = 0;

async function loadAgents() {
  if (Date.now() - _agentsCacheTime < 30000 && _agentsCache) return _agentsCache;
  try {
    const records = await listRecords(TABLES.agent);
    _agentsCache = records
      .filter(r => {
        const status = r.fields["状态"];
        return !status || status === "启用"; // 没有状态字段或状态=启用
      })
      .map(r => ({
        id: r.fields["代理商ID"],
        name: r.fields["代理商名称"],
        token: r.fields["下单Token"],
        phone: r.fields["手机号"] || "",
        address: r.fields["地址"] || "",
        crm_id: r.fields["CRM_ID"] || "",
      }));
    _agentsCacheTime = Date.now();
    return _agentsCache;
  } catch (e) {
    console.error("loadAgents error:", e.message);
    return _agentsCache || [];
  }
}

async function findAgent(token) {
  if (!token) return null;
  const agents = await loadAgents();
  return agents.find(a => a.token === token) || null;
}

// ─── 飞书 API ───────────────────────────────────────────────────────────────

let _feishuToken = "";
let _feishuTokenTime = 0;

async function getFeishuToken() {
  if (Date.now() - _feishuTokenTime < 7000 * 1000 && _feishuToken) return _feishuToken;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.FEISHU_APP_ID, app_secret: ENV.FEISHU_APP_SECRET }),
  });
  let json;
  try { json = await res.json(); } catch { return _feishuToken; }
  if (json.tenant_access_token) {
    _feishuToken = json.tenant_access_token;
    _feishuTokenTime = Date.now();
  }
  return _feishuToken;
}

async function feishuApi(method, path, body) {
  const token = await getFeishuToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => "");
    console.error(`  飞书 API 非 JSON 响应 [${method} ${path}]: HTTP ${res.status} ${text.slice(0, 200)}`);
    return null;
  }
  if (json.code !== 0) {
    console.error(`  飞书 API 错误 [${method} ${path}]:`, json.msg);
    // token 失效 → 清空缓存，下次请求自动刷新
    if (json.code === 99991663 || /invalid access token/i.test(json.msg || "")) {
      _feishuToken = "";
      _feishuTokenTime = 0;
    }
    return null;
  }
  return json.data;
}

async function listRecords(tableId) {
  const records = [];
  let pageToken = "";
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : "?page_size=100";
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records${qs}`);
    if (!data) break;
    if (data.items) records.push(...data.items);
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return records;
}

async function createRecord(tableId, fields) {
  return feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
}

async function batchCreateRecords(tableId, records) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, { records: batch });
    if (!res) return false;
  }
  return true;
}

async function updateRecord(tableId, recordId, fields) {
  return feishuApi("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
}

// ─── SKU + 库存缓存 ──────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5分钟
let _skuCache = { data: null, time: 0 };

// 产品目录（静态，不含库存数字 — 库存判定走 stock_detail 表）
const SKU_CATALOG = [
  { sku: "Ultra双效", name: "Ultra双效", type: "备货品" },
  { sku: "D8", name: "D8", type: "备货品" },
  { sku: "时空之眼A", name: "时空之眼A", type: "备货品" },
  { sku: "时空之眼B", name: "时空之眼B", type: "备货品" },
  { sku: "时空之眼PRO", name: "时空之眼PRO", type: "备货品" },
  { sku: "时空之眼MAX", name: "时空之眼MAX", type: "备货品" },
  { sku: "小旋风", name: "小旋风", type: "备货品" },
];

async function getSkusWithInventory() {
  if (_skuCache.data && Date.now() - _skuCache.time < CACHE_TTL) {
    return _skuCache.data;
  }
  _skuCache = { data: SKU_CATALOG, time: Date.now() };
  return SKU_CATALOG;
}

// ─── 产品级 SKU 过滤（无空格 = 产品级，有空格 = 处方级） ──────────────────────

function getModelSkus(allSkus) {
  return allSkus.filter(s => !s.sku.includes(" "));
}

// ─── 度数级库存缓存 ────────────────────────────────────────────────────────
// key = "SKU|SPH|CYL"（SPH/CYL 保留两位小数），value = { stock, recordId }
const STOCK_TTL = 2 * 60 * 1000; // 2 分钟
let _stockCache = { map: null, time: 0 };

async function getStockMap(fresh = false) {
  if (fresh) _stockCache = { map: null, time: 0 };
  if (_stockCache.map && Date.now() - _stockCache.time < STOCK_TTL) return _stockCache.map;
  const rows = await listRecords(TABLES.stock_detail);
  const map = new Map();
  for (const r of rows) {
    const f = r.fields || {};
    const sku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : (Array.isArray(f["SKU编号"]) ? f["SKU编号"][0]?.text : "");
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const stock = Number(f["当前库存"]) || 0;
    if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
    map.set(`${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`, { stock, recordId: r.record_id });
  }
  _stockCache = { map, time: Date.now() };
  return map;
}

function clearStockCache() { _stockCache = { map: null, time: 0 }; }

// ─── 共用辅助函数 ────────────────────────────────────────────────────────────
const rawVal = (v) => Array.isArray(v) ? (v[0]?.text ?? v[0] ?? "") : (v ?? "");
const fmt = (v) => {
  if (v === "" || v === null || v === undefined) return "--";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return (n >= 0 ? "+" : "") + n.toFixed(2);
};
const fmtAxis = (v) => (v === "" || v === null || v === undefined || Number(v) === 0) ? "--" : `${v}`;

async function findOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const d = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${encoded}`
  );
  return (d?.items || [])[0] || null;
}

async function advanceOrderWorkflow(recordId, stepKey) {
  const rec = await getRecord(TABLES.order, recordId);
  const wf = parseWorkflow(rec.fields["流程步骤"]);
  advanceWorkflow(wf, stepKey);
  await updateRecord(TABLES.order, recordId, { "流程步骤": JSON.stringify(wf) });
  return wf;
}

// ─── Per-key 异步锁 ─────────────────────────────────────────────────────────
// 序列化对同一 SKU|SPH|CYL 的并发扣减，避免 lost update
const _locks = new Map(); // key → Promise（链尾）
async function withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  _locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); }
  finally { release(); if (_locks.get(key) === next) _locks.delete(key); }
}

// ─── 幂等存储 ───────────────────────────────────────────────────────────────
// 防止双击/重试导致重复下单
const IDEMPOTENCY_TTL = 10 * 60 * 1000;
const _idempotency = new Map(); // clientRequestId → { time, response }
function getIdempotent(id) {
  if (!id) return null;
  const c = _idempotency.get(id);
  if (c && Date.now() - c.time < IDEMPOTENCY_TTL) return c.response;
  return null;
}
function setIdempotent(id, resp) {
  if (!id) return;
  _idempotency.set(id, { time: Date.now(), response: resp });
  if (_idempotency.size > 10000) {
    const now = Date.now();
    for (const [k, v] of _idempotency) { if (now - v.time > IDEMPOTENCY_TTL) _idempotency.delete(k); }
  }
}

let _dashCache = null;
const _execLog = []; // 规则执行历史（内存，最多200条）
const MAX_EXEC_LOG = 200;

// ─── 度数级库存扣减（锁内 fresh read + write） ─────────────────────────────
async function deductStockDetail(sku, sph, cyl, qty) {
  const key = `${sku}|${Number(sph).toFixed(2)}|${Number(cyl).toFixed(2)}`;
  const map = await getStockMap();
  const info = map.get(key);
  if (!info) return { success: false, reason: "not_found" };

  return withLock(key, async () => {
    // 锁内 fresh read — 只 GET 单条记录（~200ms，不拉全表）
    const freshData = await feishuApi("GET",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/${info.recordId}`
    );
    const currentStock = Number(freshData?.record?.fields?.["当前库存"]) || 0;

    const deductQty = Math.min(currentStock, qty);
    if (deductQty <= 0) {
      console.log(`  ⏭️ 无库存可扣: ${key}，走生产`);
      return { success: true, newStock: 0, deducted: 0 };
    }

    const newStock = currentStock - deductQty;
    const now = Date.now();

    const patchRes = await feishuApi("PUT",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/${info.recordId}`,
      { fields: { "当前库存": newStock, "最近出库": now } }
    );
    if (!patchRes) {
      console.error(`  ⚠️ 库存扣减写入失败: ${key}`);
      return { success: false, reason: "write_failed" };
    }

    clearStockCache();
    console.log(`  📉 度数扣减: ${key} -${deductQty} → ${newStock}`);
    return { success: true, newStock, deducted: deductQty };
  });
}

// ─── 代理商本地库存缓存 ─────────────────────────────────────────────────────
// 每个代理商独立缓存，key = "SKU|SPH.toFixed(2)|CYL.toFixed(2)"
// value = { owned, consigned, total, consignDate }
const AGENT_STOCK_TTL = 2 * 60 * 1000; // 2 分钟
let _agentStockCaches = {}; // { agentId: { map, time } }

async function getAgentStockMap(agentId) {
  if (!TABLES.agent_stock) return null; // 表未配置则跳过
  const cached = _agentStockCaches[agentId];
  if (cached?.map && Date.now() - cached.time < AGENT_STOCK_TTL) return cached.map;

  const encoded = encodeURIComponent(`"${agentId}"`);
  const data = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_stock}/records?page_size=500&filter=CurrentValue.[agent_id]=${encoded}`
  );
  const map = new Map();
  for (const r of data?.items || []) {
    const f = r.fields || {};
    const sku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : (Array.isArray(f["SKU编号"]) ? f["SKU编号"][0]?.text : "");
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const owned = Number(f["自有库存"]) || 0;
    const consigned = Number(f["寄售库存"]) || 0;
    if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
    const key = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
    const consignDate = f["寄售入库日期"] || null;
    map.set(key, { owned, consigned, total: owned + consigned, consignDate });
  }
  _agentStockCaches[agentId] = { map, time: Date.now() };
  return map;
}

function clearAgentStockCache(agentId) {
  delete _agentStockCaches[agentId];
}

function inRange(x, [lo, hi]) { return x >= lo && x <= hi; }

// 度数级交期判定 — 返回 { deliveryType, days, promiseDate, available, stock, agentStock? }
// agentId 可选：有则优先查代理商本地库存，无则走厂家总仓
async function estimateDeliveryByRx(sku, sph, cyl, qty, agentId) {
  const now = Date.now();
  const sphN = Number(sph);
  const cylN = Number(cyl);

  // 超出常规备货度数范围 → 定制
  if (!Number.isFinite(sphN) || !Number.isFinite(cylN) ||
      !inRange(sphN, STD_SPH_RANGE) || !inRange(cylN, STD_CYL_RANGE)) {
    return { deliveryType: "定制7-10天", days: 10, promiseDate: now + 10 * 86400000, available: false, stock: 0 };
  }

  const key = `${sku}|${sphN.toFixed(2)}|${cylN.toFixed(2)}`;

  // 优先查代理商本地库存
  if (agentId) {
    const agentMap = await getAgentStockMap(agentId);
    if (agentMap) {
      const aStock = agentMap.get(key);
      if (aStock && aStock.total > 0) {
        const result = {
          deliveryType: aStock.total >= qty ? "有货1-2天" : "排产5-7天",
          days: aStock.total >= qty ? 2 : 7,
          promiseDate: now + (aStock.total >= qty ? 2 : 7) * 86400000,
          available: aStock.total >= qty,
          stock: aStock.total,
          agentStock: { owned: aStock.owned, consigned: aStock.consigned },
        };
        return result;
      }
    }
  }

  // 无代理商库存或代理商库存为0 → 走厂家总仓
  const map = await getStockMap();
  const stock = (map.get(key) || {}).stock ?? 0;

  if (stock >= qty) {
    return { deliveryType: "有货1-2天", days: 2, promiseDate: now + 2 * 86400000, available: true, stock };
  }
  return { deliveryType: "排产5-7天", days: 7, promiseDate: now + 7 * 86400000, available: false, stock };
}

// ─── 代理商库存扣减（先自有后寄售） ────────────────────────────────────────
// 返回 { deducted, ownedUsed, consignedUsed, ledgerRecords }
async function deductAgentStock(agentId, sku, sph, cyl, qty) {
  if (!TABLES.agent_stock || !TABLES.consignment_ledger) return { deducted: 0 };

  const key = `${sku}|${Number(sph).toFixed(2)}|${Number(cyl).toFixed(2)}`;
  const agentMap = await getAgentStockMap(agentId);
  if (!agentMap) return { deducted: 0 };

  const stockInfo = agentMap.get(key);
  if (!stockInfo || stockInfo.total <= 0) return { deducted: 0 };

  const deductQty = Math.min(qty, stockInfo.total);
  let ownedUsed = Math.min(deductQty, stockInfo.owned);
  let consignedUsed = deductQty - ownedUsed;

  // 查找记录 record_id 做更新
  const encoded = encodeURIComponent(`"${agentId}"`);
  const data = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_stock}/records?page_size=500&filter=CurrentValue.[agent_id]=${encoded}`
  );
  let recordId = null;
  for (const r of data?.items || []) {
    const f = r.fields || {};
    const rKey = `${f["SKU编号"]}|${Number(f["SPH"]).toFixed(2)}|${Number(f["CYL"]).toFixed(2)}`;
    if (rKey === key) { recordId = r.record_id; break; }
  }

  if (!recordId) return { deducted: 0 };

  // 更新库存
  const newOwned = stockInfo.owned - ownedUsed;
  const newConsigned = stockInfo.consigned - consignedUsed;
  await api("PATCH",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_stock}/records/${recordId}`,
    { fields: { "自有库存": newOwned, "寄售库存": newConsigned } }
  );

  // 清缓存
  clearAgentStockCache(agentId);

  // 写寄售流水
  const ledgerRecords = [];
  if (ownedUsed > 0) {
    ledgerRecords.push({
      fields: {
        "流水号": `OUT-${agentId}-${sku}-${key}-${Date.now()}-OWNED`,
        "agent_id": agentId,
        "类型": "消耗",
        "SKU编号": sku,
        "SPH": Number(sph),
        "CYL": Number(cyl),
        "数量": -ownedUsed,
        "备注": "自有库存消耗",
      },
    });
  }
  if (consignedUsed > 0) {
    ledgerRecords.push({
      fields: {
        "流水号": `OUT-${agentId}-${sku}-${key}-${Date.now()}-CONSIGN`,
        "agent_id": agentId,
        "类型": "消耗",
        "SKU编号": sku,
        "SPH": Number(sph),
        "CYL": Number(cyl),
        "数量": -consignedUsed,
        "备注": "寄售库存消耗",
      },
    });
  }

  return { deducted: deductQty, ownedUsed, consignedUsed, ledgerRecords };
}

// ─── 生成编号 ──────────────────────────────────────────────────────────────

function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${d}-${r}`;
}

function genCustomerId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(2).toString("hex").toUpperCase();
  return `CUS-${d}-${r}`;
}

// ─── 客户管理 ──────────────────────────────────────────────────────────────

async function getOrCreateCustomer(agentName) {
  const encoded = encodeURIComponent(`"${agentName}"`);
  const res = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.customer}/records?page_size=1&filter=CurrentValue.[客户名称]=${encoded}`
  );
  if (res?.items?.length > 0) {
    return res.items[0].fields["客户ID"] || "";
  }
  const newId = genCustomerId();
  await createRecord(TABLES.customer, {
    客户ID: newId, 客户名称: agentName, 来源系统: "代理商门户",
  });
  return newId;
}

// ─── 客户名缓存 ──────────────────────────────────────────────────────────────

const _customerCache = {};

async function getCustomerNames(agentId) {
  if (_customerCache[agentId] && Date.now() - _customerCache[agentId].time < 10 * 60 * 1000) {
    return _customerCache[agentId].data;
  }

  const encoded = encodeURIComponent(`"${agentId}"`);
  const names = new Set();
  let pageToken = "";
  while (true) {
    let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const res = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
    if (!res) break;
    for (const r of res.items || []) {
      const name = r.fields["顾客姓名"];
      if (name) names.add(name);
    }
    if (!res.has_more) break;
    pageToken = res.page_token;
  }

  const result = [...names].sort();
  _customerCache[agentId] = { data: result, time: Date.now() };
  return result;
}

// ─── 终端客户缓存 ────────────────────────────────────────────────────────

const _terminalCustomerCache = {};

async function getTerminalCustomers(agentId) {
  if (_terminalCustomerCache[agentId] && Date.now() - _terminalCustomerCache[agentId].time < 10 * 60 * 1000) {
    return _terminalCustomerCache[agentId].data;
  }

  // 从订单表获取该代理商历史下的顾客姓名
  const encoded = encodeURIComponent(`"${agentId}"`);
  const orderNames = new Set();
  let pageToken = "";
  while (true) {
    let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const res = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
    if (!res) break;
    for (const r of res.items || []) {
      const name = r.fields["顾客姓名"];
      if (name) orderNames.add(name);
    }
    if (!res.has_more) break;
    pageToken = res.page_token;
  }

  // 从终端客户表获取完整信息
  const allCustomers = await listRecords(TABLES.customer);
  const result = [];
  for (const r of allCustomers) {
    const name = r.fields["客户名称"];
    if (!name) continue;
    // 匹配条件：名称在订单历史中出现过，或者是有联系信息的CRM同步客户
    const isCrmSync = r.fields["来源系统"] === "CRM同步";
    const hasContactInfo = r.fields["联系人"] || r.fields["联系电话"] || r.fields["收货地址"];
    if (orderNames.has(name) || isCrmSync || hasContactInfo) {
      result.push({
        id: r.fields["客户ID"] || "",
        name,
        contact: r.fields["联系人"] || "",
        phone: r.fields["联系电话"] || "",
        address: r.fields["收货地址"] || "",
      });
    }
  }
  result.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  _terminalCustomerCache[agentId] = { data: result, time: Date.now() };
  return result;
}

// ─── 飞书通知 ──────────────────────────────────────────────────────────────

async function sendNotify(agentName, summary, orderNo) {
  if (!ENV.FEISHU_WEBHOOK_URL) return;
  try {
    await fetch(ENV.FEISHU_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          header: { title: { tag: "plain_text", content: "📋 新订单待处理" }, template: "blue" },
          elements: [{
            tag: "markdown",
            content: `**代理商：** ${agentName}\n**订单号：** ${orderNo}\n**摘要：** ${summary}\n\n请登录飞书多维表查看。`,
          }],
        },
      }),
    });
  } catch (e) {
    console.error("通知发送失败:", e.message);
  }
}

// ─── 飞书 App 卡片通知（群聊）──────────────────────────────────────────

let _notifyToken = "", _notifyTokenTime = 0;
async function getNotifyToken() {
  if (Date.now() - _notifyTokenTime < 7000000 && _notifyToken) return _notifyToken;
  if (!ENV.NOTIFY_APP_ID || !ENV.NOTIFY_APP_SECRET) return null;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ENV.NOTIFY_APP_ID, app_secret: ENV.NOTIFY_APP_SECRET }),
  });
  let json;
  try { json = await r.json(); } catch { return null; }
  if (json.tenant_access_token) {
    _notifyToken = json.tenant_access_token;
    _notifyTokenTime = Date.now();
  }
  return _notifyToken;
}

async function sendFeishuCard(card) {
  const chatId = ENV.NOTIFY_CHAT_ID;
  if (!chatId) return;
  try {
    const token = await getNotifyToken();
    if (!token) return;
    await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) }),
    });
  } catch (e) {
    console.error("飞书卡片通知失败:", e.message);
  }
}

function shipCard({ orderNo, customerName, sku, agentName, courierName, trackingNo, lensCount }) {
  return {
    header: { title: { tag: "plain_text", content: "🚚 订单已发货" }, template: "blue" },
    elements: [
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
        { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
        { is_short: true, text: { tag: "lark_md", content: `**镜片数**\n${lensCount} 片` } },
      ]},
      { tag: "hr" },
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**快递公司**\n${courierName}` } },
        { is_short: true, text: { tag: "lark_md", content: `**快递单号**\n\`${trackingNo}\`` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
      ]},
      { tag: "note", elements: [{ tag: "plain_text", content: `发货时间：${new Date().toLocaleString("zh-CN")} | 高视星供应链系统` }] },
    ],
  };
}

function deliveredCard({ orderNo, customerName, sku, agentName, signedAt }) {
  return {
    header: { title: { tag: "plain_text", content: "✅ 消费者已签收" }, template: "green" },
    elements: [
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**订单号**\n${orderNo}` } },
        { is_short: true, text: { tag: "lark_md", content: `**顾客**\n${customerName}` } },
      ]},
      { tag: "div", fields: [
        { is_short: true, text: { tag: "lark_md", content: `**SKU**\n${sku}` } },
        { is_short: true, text: { tag: "lark_md", content: `**代理商**\n${agentName}` } },
      ]},
      { tag: "hr" },
      { tag: "markdown", content: `🎉 **订单全流程完成！**\n下单 → 生产 → 发货 → **签收 ✓**\n签收时间：${signedAt}` },
    ],
  };
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

// 允许的跨域来源（从 .env 读取，支持逗号分隔多个）
const ALLOWED_ORIGINS = (ENV.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

function setCorsHeader(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
    // 已配置来源 or 本地开发未配置时允许
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  // 未在白名单内的来源不设 CORS header，浏览器会拒绝
}

function jsonRes(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

function parsePagination(url, defaultPageSize = 50, maxPageSize = 200) {
  const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(url.searchParams.get("pageSize")) || defaultPageSize));
  return { page, pageSize };
}

// 默认请求体上限 1MB，Excel 上传端点单独校验 5MB
const DEFAULT_BODY_LIMIT = 1 * 1024 * 1024;

function readBody(req, limitBytes = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on("data", chunk => {
      received += chunk.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error(`请求体过大（限制 ${Math.round(limitBytes / 1024)}KB）`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("无效的 JSON")); }
    });
  });
}

// ─── Rate Limiting（基于 IP，内存滑动窗口）────────────────────────────────
const _rateLimitMap = new Map(); // ip → { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟
const RATE_LIMIT_MAX = 60;              // 通用端点：60次/分钟

// 验真端点专用：防止镜片码枚举
const VERIFY_RATE_LIMIT_MAX = 20;       // 20次/分钟

function checkRateLimit(ip, maxPerWindow = RATE_LIMIT_MAX) {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // 新窗口
    _rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  _rateLimitMap.set(ip, entry);
  return entry.count <= maxPerWindow;
}

// 定期清理过期条目（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) _rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(val) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function isAdmin(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const adminToken = url.searchParams.get("admin") || "";
  const envToken = ENV.ADMIN_TOKEN || "";
  if (!envToken || !adminToken) return false;
  try {
    const a = Buffer.from(adminToken.padEnd(64), "utf-8").slice(0, 64);
    const b = Buffer.from(envToken.padEnd(64), "utf-8").slice(0, 64);
    return timingSafeEqual(a, b) && adminToken === envToken;
  } catch {
    return false;
  }
}

// ─── 打印机配置 ──────────────────────────────────────────────────────────

const PRINTER_CONFIG_PATH = resolve(__dirname, "printer_config.json");
let _printerConfig = null;
let _printerConfigTime = 0;
const PRINTER_CONFIG_TTL = 30_000; // 30s 缓存

function loadPrinterConfig() {
  const now = Date.now();
  if (_printerConfig && now - _printerConfigTime < PRINTER_CONFIG_TTL) return _printerConfig;
  try {
    _printerConfig = JSON.parse(readFileSync(PRINTER_CONFIG_PATH, "utf-8"));
  } catch {
    _printerConfig = {
      default_connection: "tcp",
      tcp: { enabled: true, host: "192.168.0.208", port: 9100, timeout_ms: 5000 },
      usb: { enabled: false, bridge_url: "http://localhost:9101" },
      printer_model: "ZT410", dpi: 203,
      label_width_mm: 75, label_height_mm: 40,
      auto_print_on_ship: false, copies: 1,
    };
  }
  _printerConfigTime = now;
  return _printerConfig;
}

function savePrinterConfig(config) {
  writeFileSync(PRINTER_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  _printerConfig = config;
  _printerConfigTime = Date.now();
}

// ─── ZPL 标签生成（斑马打印机 ZPL II，75×40mm @ 203dpi = 600×320dots）────────

function buildZpl(rec) {
  const f = rec.fields || rec;
  const orderNo = f["订单编号"] || "";
  const customerName = f["顾客姓名"] || "";
  const sku = f["产品型号"] || "";
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeLabel = isRight ? "R" : "L";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const lensCode = f["镜片码"] || "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";
  const verifyUrl = `${getServerBaseUrl()}/verify/${lensCode}`;

  const zpl = [
    "^XA",
    "^CI28",
    "^PW600",
    "^LL320",
    "",
    `^FO30,10^BY2^BCN,70,Y,N,N^FD${orderNo}^FS`,
    `^FO30,90^A0N,20,20^FD${orderNo}^FS`,
    `^FO30,120^A0N,24,24^FD${customerName}^FS`,
    `^FO280,120^A0N,18,18^FD${sku}^FS`,
    `^FO30,155^A0N,30,30^FD${eyeLabel} ${eye}^FS`,
    "^FO30,192^A0N,16,16^FDSPH^FS",
    "^FO130,192^A0N,16,16^FDCYL^FS",
    "^FO230,192^A0N,16,16^FDAXIS^FS",
    `^FO30,214^A0N,24,24^FD${fmt(sph)}^FS`,
    `^FO130,214^A0N,24,24^FD${fmt(cyl)}^FS`,
    `^FO230,214^A0N,24,24^FD${fmtAxis(axis)}^FS`,
    `^FO450,10^BQN,2,4^FDQA,${verifyUrl}^FS`,
    "^FO468,135^A0N,12,12^FDQR验真^FS",
    `^FO30,250^A0N,18,18^FD${lensCode}^FS`,
    "^FO30,238^GB530,1,1^FS",
    "^FO30,278^A0N,18,18^FDGAUSH | CLEAR^FS",
    `^FO250,278^A0N,14,14^FD${agentId} ${agentName}^FS`,
    "^XZ",
  ].join("\n");

  return zpl;
}

// ─── 打印机通信 ──────────────────────────────────────────────────────────

async function sendTcpZpl(zplString, host, port = 9100, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => {
      sock.write(Buffer.from(zplString, "utf-8"), () => {
        sock.end();
        resolve({ ok: true, method: "tcp", host, port });
      });
    });
    sock.on("error", (err) => reject(new Error(`TCP 打印失败 (${host}:${port}): ${err.message}`)));
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`TCP 连接超时 (${host}:${port})`)); });
  });
}

async function sendUsbZpl(zplString, bridgeUrl) {
  const res = await fetch(`${bridgeUrl}/print`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: zplString,
  });
  if (!res.ok) throw new Error(`USB 桥接失败: ${res.status}`);
  return res.json();
}

async function sendZplToPrinter(zplString) {
  const config = loadPrinterConfig();
  const conn = config.default_connection || "tcp";
  if (conn === "tcp" && config.tcp?.enabled) {
    return sendTcpZpl(zplString, config.tcp.host, config.tcp.port, config.tcp.timeout_ms);
  }
  if (conn === "usb" && config.usb?.enabled) {
    return sendUsbZpl(zplString, config.usb.bridge_url);
  }
  throw new Error(`打印机未配置或未启用 (connection=${conn})`);
}

// ─── 打印队列（Mac 拉模式）───────────────────────────────────────────────────

function buildTestZpl() {
  return [
    "^XA", "^CI28", "^PW600", "^LL320",
    "^FO170,20^A0N,36,36^FDGAUSH TEST^FS",
    "^FO30,70^BY2^BCN,70,Y,N,N^FDTEST-PRINT^FS",
    "^FO30,155^A0N,22,22^FD测试标签 / Test Label^FS",
    "^FO30,185^A0N,18,18^FD" + new Date().toLocaleString("zh-CN") + "^FS",
    "^FO30,215^A0N,16,16^FD打印机: " + loadPrinterConfig().printer_model + "^FS",
    "^FO450,70^BQN,2,3^FDQA,https://gaushclear.com^FS",
    "^XZ",
  ].join("\n");
}

const printQueue = new Map();
let _pqSeq = 0;

// ─── 工作流步骤 ──────────────────────────────────────────────────────────

const STEP_ORDER = ["submitted", "confirmed", "producing", "qc_done", "labeled", "packed", "shipped", "received"];
const STEP_LABELS = {
  submitted: "已下单", confirmed: "已确认", producing: "生产中",
  qc_done: "质检完成", labeled: "标签已打印", packed: "已打包",
  shipped: "已发货", received: "已签收",
};
const STATUS_STEP_KEY = { "待处理": "submitted", "已确认": "confirmed", "生产中": "producing", "已发货": "shipped", "已签收": "received" };

function parseWorkflow(jsonStr) {
  try { return JSON.parse(jsonStr || "{}"); }
  catch { return { current: 0, steps: {} }; }
}

function advanceWorkflow(wf, stepKey) {
  if (!wf.steps) wf.steps = {};
  const targetIdx = STEP_ORDER.indexOf(stepKey);
  if (targetIdx < 0) return { wf, ok: false, error: `未知步骤: ${stepKey}` };
  // 幂等：已存在的步骤直接跳过
  if (wf.steps[stepKey]) return { wf, ok: true, skipped: true };
  // 校验：只能前进一步（允许从 confirmed 直接到 producing，因为 confirm 端点同时设置两步）
  const currentIdx = wf.current || 0;
  if (targetIdx > currentIdx + 1 && !(stepKey === "producing" && wf.steps["confirmed"])) {
    return { wf, ok: false, error: `不能跳步: 当前 ${STEP_ORDER[currentIdx]}(${currentIdx})，目标 ${stepKey}(${targetIdx})` };
  }
  wf.steps[stepKey] = { ts: Date.now() };
  wf.current = Math.max(currentIdx, targetIdx);
  return { wf, ok: true };
}

// ─── 镜片明细 CRUD ──────────────────────────────────────────────────────

async function createLensDetail(orderNo, fields) {
  return createRecord(TABLES.lens_detail, {
    "订单编号": orderNo,
    ...fields,
  });
}

async function batchCreateLensDetails(records) {
  return batchCreateRecords(TABLES.lens_detail, records);
}

// ─── 镜片码分配（下单即生成） ─────────────────────────────────────────────────

async function assignLensCodes(orderNo, customerName) {
  let lensDetails = await getLensDetailsByOrder(orderNo);
  // 按客户名过滤（②-1）
  if (customerName) {
    lensDetails = lensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName);
  }
  const lensCodes = [];
  for (const rec of lensDetails) {
    const existingCode = rec.fields["镜片码"];
    if (existingCode) { lensCodes.push(existingCode); continue; }
    const code = genLensCode();
    await updateRecord(TABLES.lens_detail, rec.record_id, {
      "镜片码": code,
      "订单状态": "生产中",
    });
    await generateQRPng(code);
    lensCodes.push(code);
    console.log(`  镜片码生成: ${orderNo} → ${code}`);
  }
  return lensCodes;
}

async function getLensDetailsByOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const data = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
  );
  const items = data?.items || [];
  items.sort((a, b) => {
    const ea = a.fields["眼别"] || "", eb = b.fields["眼别"] || "";
    if (ea === eb) return 0;
    if (ea.includes("右")) return -1;
    return 1;
  });
  return items;
}

// ─── QR 溯源码 ──────────────────────────────────────────────────────────────

function genLensCode() {
  return randomBytes(8).toString("hex").toUpperCase();
}

function getServerBaseUrl() {
  return ENV.SERVER_BASE_URL || `http://localhost:${PORT}`;
}

async function generateQRPng(lensCode) {
  const url = `${getServerBaseUrl()}/verify/${lensCode}`;
  mkdirSync(QR_DIR, { recursive: true });
  const filePath = resolve(QR_DIR, `${lensCode}.png`);
  await QRCode.toFile(filePath, url, {
    errorCorrectionLevel: "H",
    width: 400,
    margin: 2,
  });
  return filePath;
}

// 生成工厂 Excel 文件
// orderInfoMap: { [orderNo]: { remark, address, contact, phone, quantity } } 每个订单独立的信息
// 兼容旧调用：也支持单个 info 对象 { remark, address, contact, phone }
function buildFactoryExcel(records, orderNo, orderInfoMap = {}) {
  const isMap = orderInfoMap && !orderInfoMap.remark && !orderInfoMap.address;
  const getInfo = (recOrderNo) => {
    if (!isMap) return orderInfoMap; // 旧格式：单个 info
    return orderInfoMap[recOrderNo] || Object.values(orderInfoMap)[0] || {};
  };
  const sorted = [...records].sort((a, b) => {
    const nameCmp = String(a.fields["顾客姓名"] || "").localeCompare(String(b.fields["顾客姓名"] || ""), "zh-CN");
    if (nameCmp !== 0) return nameCmp;
    const ea = a.fields["眼别"] || "", eb = b.fields["眼别"] || "";
    if (ea.includes("右") && !eb.includes("右")) return -1;
    if (!ea.includes("右") && eb.includes("右")) return 1;
    return 0;
  });
  const rows = sorted.map(rec => {
    const f = rec.fields;
    const info = getInfo(f["订单编号"] || "");
    return {
      "订单号": f["订单编号"] || "",
      "顾客": f["顾客姓名"] || "",
      "产品型号": f["产品型号"] || "",
      "数量": info.quantity || Number(f["数量"]) || 1,
      "眼别": f["眼别"] || "",
      "球镜SPH": f["球镜SPH"] != null ? Number(f["球镜SPH"]).toFixed(2) : "",
      "柱镜CYL": f["柱镜CYL"] != null ? Number(f["柱镜CYL"]).toFixed(2) : "",
      "轴位AXIS": f["轴位AXIS"] != null ? Number(f["轴位AXIS"]).toFixed(0) : "",
      "镜片码": f["镜片码"] || "",
      "是否装配": f["是否装配"] || "",
      "联系人": info.contact || "",
      "联系电话": info.phone || "",
      "收货地址": info.address || "",
      "备注": f["备注"] || info.remark || "",
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 6 },
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, `订单${orderNo}`.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ─── 随货同行单 HTML 模板 ──────────────────────────────────────────────────────

function slipHTML(order) {
  const { orderNo, customerName, agentName, agentId, shipDate, promiseDate,
          courierName, trackingNo, rows } = order;
  const base = getServerBaseUrl();

  const eyeRow = (r) => {
    const lc = r.lensCode || "—";
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=64x64&ecc=M&data=${encodeURIComponent(base + "/verify/" + lc)}`;
    return `
    <tr>
      <td class="eye ${r.eye === "左眼" ? "eye-l" : "eye-r"}">${r.eye === "左眼" ? "L<br><span>左眼</span>" : "R<br><span>右眼</span>"}</td>
      <td class="sku">${r.sku || "—"}</td>
      <td class="rx">${r.sph || "—"}</td>
      <td class="rx">${r.cyl || "—"}</td>
      <td class="rx">${r.axis || "—"}</td>
      <td class="lc"><span class="lc-code">${lc}</span></td>
      <td class="qr-cell"><img src="${qr}" alt="QR" width="52" height="52"></td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>随货同行单 ${orderNo}</title>
<style>
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 10pt; color: #1a1a2e; background: #fff; }
  .header { display: flex; align-items: flex-end; justify-content: space-between;
            border-bottom: 1.5pt solid #c0392b; padding-bottom: 4mm; margin-bottom: 5mm; }
  .brand { display: flex; flex-direction: column; gap: 1mm; }
  .brand-name { font-size: 18pt; font-weight: 900; letter-spacing: 3px; color: #c0392b; }
  .brand-sub  { font-size: 7.5pt; color: #888; letter-spacing: 1.5px; }
  .doc-title  { text-align: right; }
  .doc-title h1 { font-size: 16pt; font-weight: 800; letter-spacing: 4px; color: #1a1a2e; }
  .doc-title p  { font-size: 7pt; color: #aaa; margin-top: 1mm; letter-spacing: 1px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm;
          background: #fdf5f5; border: 0.5pt solid #f0d0d0; border-radius: 2mm;
          padding: 4mm 5mm; margin-bottom: 5mm; }
  .meta-item { display: flex; flex-direction: column; gap: 0.8mm; }
  .meta-label { font-size: 6pt; color: #aaa; text-transform: uppercase; letter-spacing: 1px; }
  .meta-value { font-size: 10pt; font-weight: 700; color: #1a1a2e; }
  .meta-value.mono { font-family: "Courier New", monospace; font-size: 9pt; }
  .meta-value.red  { color: #c0392b; }
  .rx-title { font-size: 8pt; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
              color: #c0392b; margin-bottom: 2.5mm; padding-left: 2mm;
              border-left: 2pt solid #c0392b; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  thead th { background: #1a1a2e; color: white; font-size: 7pt; font-weight: 600;
             letter-spacing: 0.5px; padding: 2.5mm 3mm; text-align: center; }
  thead th:first-child { text-align: left; padding-left: 4mm; }
  tbody tr { border-bottom: 0.4pt solid #eee; }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.eye { width: 14mm; font-size: 16pt; font-weight: 900; text-align: center;
           padding: 3mm 0; line-height: 1; }
  td.eye span { font-size: 6pt; font-weight: 400; display: block; margin-top: 0.5mm; }
  td.eye-r { color: #c0392b; }
  td.eye-l { color: #2980b9; }
  td.sku  { padding: 3mm; font-size: 8pt; font-weight: 600; }
  td.rx   { padding: 3mm; text-align: center; font-family: "Courier New",monospace;
            font-size: 11pt; font-weight: 700; color: #c0392b; }
  td.lc   { padding: 3mm; }
  .lc-code { font-family: "Courier New",monospace; font-size: 7.5pt; font-weight: 700;
             background: #1a1a2e; color: #fff; padding: 1mm 2mm; border-radius: 1mm; letter-spacing: 1px; }
  td.qr-cell { padding: 2mm; text-align: center; width: 18mm; }
  .logistics { display: flex; gap: 5mm; margin-bottom: 6mm; }
  .logistics-box { flex: 1; border: 0.5pt solid #ddd; border-radius: 2mm; padding: 4mm; }
  .logistics-box h3 { font-size: 7pt; font-weight: 700; letter-spacing: 1.5px;
                       text-transform: uppercase; color: #888; margin-bottom: 3mm; }
  .tracking-no { font-family: "Courier New",monospace; font-size: 14pt; font-weight: 900;
                 color: #1a1a2e; letter-spacing: 2px; }
  .courier-name { font-size: 9pt; color: #555; margin-top: 1mm; }
  .sign-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; margin-bottom: 6mm; }
  .sign-box { border: 0.5pt solid #ddd; border-radius: 2mm; padding: 4mm; min-height: 22mm; }
  .sign-box h3 { font-size: 7pt; color: #aaa; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 2mm; }
  .sign-box .sign-line { border-bottom: 0.5pt solid #ccc; margin: 10mm 2mm 2mm; }
  .sign-box .sign-hint { font-size: 6pt; color: #ccc; text-align: center; }
  .footer { border-top: 0.5pt solid #eee; padding-top: 3mm; display: flex;
            justify-content: space-between; align-items: center; }
  .footer-left { font-size: 6.5pt; color: #bbb; }
  .footer-right { font-size: 6pt; color: #ccc; font-family: "Courier New",monospace; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
  .print-btn { position: fixed; bottom: 20px; right: 20px; padding: 10px 20px;
               background: #c0392b; color: white; border: none; border-radius: 6px;
               font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">打印 / 导出 PDF</button>
<div class="header">
  <div class="brand">
    <div class="brand-name">GAUSH | CLEAR</div>
    <div class="brand-sub">高视星 · 镜片溯源系统</div>
  </div>
  <div class="doc-title">
    <h1>随货同行单</h1>
    <p>PACKING SLIP / DELIVERY NOTE</p>
  </div>
</div>
<div class="meta">
  <div class="meta-item">
    <div class="meta-label">订单号 Order No.</div>
    <div class="meta-value mono red">${orderNo}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">顾客 Customer</div>
    <div class="meta-value">${customerName}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">代理商 Agent</div>
    <div class="meta-value">${agentName} <span style="font-size:7pt;color:#aaa">${agentId}</span></div>
  </div>
  <div class="meta-item">
    <div class="meta-label">发货日期 Ship Date</div>
    <div class="meta-value">${shipDate}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">承诺交期 Promise Date</div>
    <div class="meta-value">${promiseDate || "—"}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">镜片数量 Qty</div>
    <div class="meta-value red">${rows.length} 片</div>
  </div>
</div>
<div class="rx-title">处方参数 Prescription</div>
<table>
  <thead><tr><th>眼别</th><th>SKU / 型号</th><th>SPH 球镜</th><th>CYL 柱镜</th><th>AXIS 轴位</th><th>镜片码 Lens Code</th><th>溯源</th></tr></thead>
  <tbody>${rows.map(eyeRow).join("\n")}</tbody>
</table>
<div class="logistics">
  <div class="logistics-box">
    <h3>物流信息 Shipping</h3>
    <div class="tracking-no">${trackingNo || "—"}</div>
    <div class="courier-name">${courierName || "—"}</div>
  </div>
  <div class="logistics-box" style="flex:2">
    <h3>温馨提示 Notes</h3>
    <p style="font-size:8pt;color:#555;line-height:1.8">
      1. 请在签收前检查包装完好性，如有破损请拒收并联系代理商。<br>
      2. 扫描各镜片上的二维码可查询溯源信息及真伪验证。<br>
      3. 如有疑问请联系：<strong>${agentName}</strong>
    </p>
  </div>
</div>
<div class="sign-section">
  <div class="sign-box">
    <h3>发货方签章 Shipper</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">高视星 / GAUSH CLEAR</div>
  </div>
  <div class="sign-box">
    <h3>代理商签章 Agent</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">${agentName}</div>
  </div>
  <div class="sign-box">
    <h3>顾客签收 Customer Sign</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">签收日期：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</div>
  </div>
</div>
<div class="footer">
  <div class="footer-left">高视星镜片溯源系统 GAUSH CLEAR Supply Chain v1.0 &nbsp;|&nbsp; 本单据随货附带，请妥善保存</div>
  <div class="footer-right">打印时间 ${new Date().toLocaleString("zh-CN")} &nbsp;|&nbsp; ${orderNo}</div>
</div>
</body></html>`;
}

function batchSlipHTML({ agentId, agentName, trackingNo, courierName, shipDate, orders }) {
  const base = getServerBaseUrl();
  const allRows = [];
  for (const o of orders) {
    for (const r of o.rows) {
      allRows.push({ ...r, orderNo: o.orderNo, customerName: o.customerName });
    }
  }
  // 按顾客姓名分组排序，同一人的右眼在上、左眼在下
  allRows.sort((a, b) => {
    const nameCmp = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
    if (nameCmp !== 0) return nameCmp;
    // 同一人：右眼在前
    const aR = a.eye?.includes("右") ? 0 : 1;
    const bR = b.eye?.includes("右") ? 0 : 1;
    return aR - bR;
  });

  const eyeRow = (r, i) => {
    const lc = r.lensCode || "—";
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=56x56&ecc=M&data=${encodeURIComponent(base + "/verify/" + lc)}`;
    const isR = r.eye?.includes("右");
    const showName = i === 0 || allRows[i - 1]?.customerName !== r.customerName;
    return `
    <tr>
      <td class="order-no">${showName ? `${r.orderNo}<br><span class="cname">${r.customerName}</span>` : ""}</td>
      <td class="eye ${isR ? "eye-r" : "eye-l"}">${isR ? "R" : "L"}<br><span>${isR ? "右眼" : "左眼"}</span></td>
      <td class="sku">${r.sku || "—"}</td>
      <td class="rx">${r.sph || "—"}</td>
      <td class="rx">${r.cyl || "—"}</td>
      <td class="rx">${r.axis || "—"}</td>
      <td class="lc"><span class="lc-code">${lc}</span></td>
      <td class="qr-cell"><img src="${qr}" alt="QR" width="48" height="48"></td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>合单随货同行单 — ${agentName}</title>
<style>
  @page { size: A4; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 9.5pt; color: #1a1a2e; background:#fff; }
  .header { display:flex; align-items:flex-end; justify-content:space-between;
            border-bottom:1.5pt solid #c0392b; padding-bottom:3.5mm; margin-bottom:4mm; }
  .brand-name { font-size:17pt; font-weight:900; letter-spacing:3px; color:#c0392b; }
  .brand-sub  { font-size:7pt; color:#888; letter-spacing:1.5px; margin-top:0.8mm; }
  .doc-title h1 { font-size:15pt; font-weight:800; letter-spacing:4px; text-align:right; }
  .doc-title p  { font-size:6.5pt; color:#aaa; text-align:right; margin-top:0.8mm; }
  .meta { display:grid; grid-template-columns:repeat(5,1fr); gap:2.5mm;
          background:#fdf5f5; border:0.5pt solid #f0d0d0; border-radius:2mm;
          padding:3.5mm 5mm; margin-bottom:4mm; }
  .meta-label { font-size:5.5pt; color:#aaa; text-transform:uppercase; letter-spacing:1px; margin-bottom:0.5mm; }
  .meta-value { font-size:9.5pt; font-weight:700; }
  .meta-value.mono { font-family:"Courier New",monospace; font-size:8.5pt; }
  .meta-value.red  { color:#c0392b; }
  .rx-title { font-size:7.5pt; font-weight:700; letter-spacing:2px; text-transform:uppercase;
              color:#c0392b; margin-bottom:2mm; padding-left:2mm; border-left:2pt solid #c0392b; }
  table { width:100%; border-collapse:collapse; margin-bottom:5mm; font-size:8.5pt; }
  thead th { background:#1a1a2e; color:#fff; font-size:6.5pt; font-weight:600;
             padding:2mm 2.5mm; text-align:center; letter-spacing:0.5px; }
  thead th:first-child { text-align:left; padding-left:3mm; }
  tbody tr { border-bottom:0.4pt solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody tr:hover { background:#fef5f5; }
  td.order-no { padding:2.5mm 3mm; font-size:7pt; font-family:"Courier New",monospace; white-space:nowrap; }
  td.order-no .cname { font-family:"PingFang SC","Microsoft YaHei",sans-serif; font-size:8pt; font-weight:700; color:#1a1a2e; }
  td.eye { width:11mm; font-size:14pt; font-weight:900; text-align:center; padding:2mm 0; line-height:1; }
  td.eye span { font-size:5.5pt; font-weight:400; display:block; }
  td.eye-r { color:#c0392b; }
  td.eye-l { color:#2980b9; }
  td.sku  { padding:2.5mm; font-size:7.5pt; font-weight:600; }
  td.rx   { padding:2.5mm; text-align:center; font-family:"Courier New",monospace;
            font-size:10pt; font-weight:700; color:#c0392b; }
  td.lc   { padding:2.5mm; }
  .lc-code { font-family:"Courier New",monospace; font-size:6.5pt; font-weight:700;
             background:#1a1a2e; color:#fff; padding:0.8mm 1.5mm; border-radius:1mm; letter-spacing:1px; }
  td.qr-cell { padding:1.5mm; text-align:center; width:16mm; }
  .logistics { display:flex; gap:4mm; margin-bottom:5mm; }
  .logistics-box { flex:1; border:0.5pt solid #ddd; border-radius:2mm; padding:3.5mm; }
  .logistics-box h3 { font-size:6.5pt; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#888; margin-bottom:2.5mm; }
  .tracking-no { font-family:"Courier New",monospace; font-size:13pt; font-weight:900; color:#1a1a2e; letter-spacing:2px; }
  .courier-name { font-size:8.5pt; color:#555; margin-top:1mm; }
  .sign-section { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4mm; margin-bottom:5mm; }
  .sign-box { border:0.5pt solid #ddd; border-radius:2mm; padding:3.5mm; min-height:20mm; }
  .sign-box h3 { font-size:6.5pt; color:#aaa; letter-spacing:1px; text-transform:uppercase; margin-bottom:1.5mm; }
  .sign-box .sign-line { border-bottom:0.5pt solid #ccc; margin:8mm 2mm 1.5mm; }
  .sign-box .sign-hint { font-size:5.5pt; color:#ccc; text-align:center; }
  .footer { border-top:0.5pt solid #eee; padding-top:2.5mm; display:flex; justify-content:space-between; align-items:center; }
  .footer-left  { font-size:6pt; color:#bbb; }
  .footer-right { font-size:5.5pt; color:#ccc; font-family:"Courier New",monospace; }
  @media print { body{-webkit-print-color-adjust:exact;print-color-adjust:exact;} .no-print{display:none;} }
  .print-btn { position:fixed; bottom:20px; right:20px; padding:10px 20px; background:#c0392b;
               color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer;
               box-shadow:0 4px 12px rgba(0,0,0,.2); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">打印 / 导出 PDF</button>
<div class="header">
  <div class="brand">
    <div class="brand-name">GAUSH | CLEAR</div>
    <div class="brand-sub">高视星 · 镜片溯源系统</div>
  </div>
  <div class="doc-title">
    <h1>合单随货同行单</h1>
    <p>CONSOLIDATED PACKING SLIP / DELIVERY NOTE</p>
  </div>
</div>
<div class="meta">
  <div><div class="meta-label">代理商 Agent</div><div class="meta-value red">${agentName}</div><div style="font-size:6pt;color:#aaa;margin-top:0.5mm">${agentId}</div></div>
  <div><div class="meta-label">发货日期 Ship Date</div><div class="meta-value">${shipDate}</div></div>
  <div><div class="meta-label">订单数 Orders</div><div class="meta-value red">${orders.length} 单</div></div>
  <div><div class="meta-label">镜片数量 Qty</div><div class="meta-value red">${allRows.length} 片</div></div>
  <div><div class="meta-label">快递单号 Tracking</div><div class="meta-value mono">${trackingNo || "—"}</div></div>
</div>
<div class="rx-title">处方明细 Prescription Details — 共 ${allRows.length} 片</div>
<table>
  <thead><tr><th>订单号 / 顾客</th><th>眼别</th><th>SKU</th><th>SPH</th><th>CYL</th><th>AXIS</th><th>镜片码</th><th>溯源</th></tr></thead>
  <tbody>${allRows.map(eyeRow).join("\n")}</tbody>
</table>
<div class="logistics">
  <div class="logistics-box">
    <h3>物流信息 Shipping</h3>
    <div class="tracking-no">${trackingNo || "—"}</div>
    <div class="courier-name">${courierName || "—"}</div>
  </div>
  <div class="logistics-box" style="flex:3">
    <h3>订单汇总 Order Summary</h3>
    <table style="margin:0;font-size:7.5pt">
      <thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:1.5mm;color:#555;font-weight:600">SKU</th><th style="padding:1.5mm;color:#555;font-weight:600">片数</th></tr></thead>
      <tbody>
        ${(() => { const skuQty = {}; for (const r of allRows) { skuQty[r.sku || "—"] = (skuQty[r.sku || "—"] || 0) + 1; } return Object.entries(skuQty).map(([sku, qty]) => `<tr><td style="padding:1.5mm;font-weight:600">${sku}</td><td style="padding:1.5mm;text-align:center;font-weight:700;color:#c0392b">${qty}</td></tr>`).join(""); })()}
      </tbody>
    </table>
  </div>
</div>
<div class="sign-section">
  <div class="sign-box">
    <h3>发货方签章 Shipper</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">高视星 / GAUSH CLEAR</div>
  </div>
  <div class="sign-box">
    <h3>代理商签收 Agent</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">${agentName}</div>
  </div>
  <div class="sign-box">
    <h3>签收日期 Date</h3>
    <div class="sign-line"></div>
    <div class="sign-hint">　　年　　月　　日</div>
  </div>
</div>
<div class="footer">
  <div class="footer-left">高视星 GAUSH CLEAR Supply Chain v1.0 &nbsp;|&nbsp; 本单据随货附带，请妥善保存 &nbsp;|&nbsp; ${agentName} 专属包裹</div>
  <div class="footer-right">打印时间 ${new Date().toLocaleString("zh-CN")}</div>
</div>
</body></html>`;
}

// 生成可打印 HTML 标签（QR 内嵌为 base64 data URL）
async function buildLabelHtml(record, orderNo) {
  const f = record.fields;
  const lensCode = f["镜片码"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeColor = isRight ? "#c0392b" : "#1a6fb5";
  const eyeLabel = isRight ? "R  右眼" : "L  左眼";
  const eyeBg = isRight ? "#fff5f5" : "#f0f7ff";
  const sku = f["产品型号"] || "";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:75mm 40mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:75mm;height:40mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:6pt;background:#fff;overflow:hidden}
.label{width:75mm;height:40mm;display:flex;flex-direction:column;border:.3mm solid #ddd}
.header{display:flex;align-items:center;justify-content:space-between;background:${eyeColor};color:#fff;padding:.8mm 2mm;height:6.5mm;flex-shrink:0}
.eye-badge{font-size:9pt;font-weight:900;letter-spacing:1px}
.brand{font-size:6.5pt;font-weight:700;letter-spacing:1.5px;opacity:.92}
.order-no{font-size:5pt;opacity:.85;font-family:monospace}
.body{display:flex;flex:1;padding:1mm 1.5mm .8mm;gap:1.5mm;background:${eyeBg}}
.info{flex:1;display:flex;flex-direction:column;gap:.4mm;min-width:0}
.customer-row{display:flex;align-items:baseline;gap:1.5mm;border-bottom:.2mm solid ${eyeColor}44;padding-bottom:.8mm;margin-bottom:.4mm}
.customer-name{font-size:8pt;font-weight:800;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:24mm}
.sku-name{font-size:5.5pt;color:${eyeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-grid{display:grid;grid-template-columns:auto auto auto;column-gap:2mm;row-gap:.2mm;margin:.3mm 0}
.rx-label{font-size:4.5pt;color:#888;text-transform:uppercase;letter-spacing:.3px}
.rx-value{font-size:7.5pt;font-weight:700;color:#1a1a2e;font-family:"SF Mono","Consolas",monospace;line-height:1.1}
.rx-value.hl{color:${eyeColor}}
.meta-row{display:flex;gap:1.5mm;margin-top:.3mm;flex-wrap:wrap}
.meta-item{display:flex;align-items:center;gap:.6mm}
.meta-label{font-size:4.5pt;color:#aaa}
.meta-value{font-size:5.5pt;color:#444;font-weight:600}
.qr-col{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8mm;flex-shrink:0}
.qr-col img{width:15mm;height:15mm;display:block;border:.3mm solid #ddd;border-radius:1mm}
.qr-label{font-size:3.5pt;color:#bbb;text-align:center}
.footer{display:flex;align-items:center;justify-content:space-between;background:#f8f9fa;border-top:.2mm solid #e9ecef;padding:.6mm 2mm;height:5.5mm;flex-shrink:0}
.lens-code{font-family:"Courier New",monospace;font-size:5.5pt;font-weight:700;color:#495057;letter-spacing:1px}
.footer-meta{display:flex;flex-direction:column;align-items:flex-end}
.agent-tag{font-size:4pt;color:#ccc;margin-top:.2mm}
@media print{body{padding:0}}
</style></head><body>
<div class="label">
<div class="header"><div class="eye-badge">${eyeLabel}</div><div style="text-align:right"><div class="brand">GAUSH | CLEAR</div><div class="order-no">${orderNo}</div></div></div>
<div class="body"><div class="info">
<div class="customer-row"><div class="customer-name">${f["顾客姓名"]||""}</div><div class="sku-name">${sku}</div></div>
<div class="rx-grid">
<div class="rx-label">SPH</div><div class="rx-label">CYL</div><div class="rx-label">AXIS</div>
<div class="rx-value hl">${fmt(sph)}</div><div class="rx-value hl">${fmt(cyl)}</div><div class="rx-value">${fmtAxis(axis)}</div>
</div>
<div class="meta-row"><div class="meta-item"><span class="meta-label">渠道</span><span class="meta-value">${agentId}</span></div></div>
</div><div class="qr-col"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">扫码验真</div></div></div>
<div class="footer"><div class="lens-code">${lensCode}</div><div class="footer-meta"><div class="agent-tag">${agentName}</div></div></div>
</div></body></html>`;

  return { name: `labels/${orderNo}_${customer}_${eye}.html`, data: Buffer.from(html, "utf-8") };
}

// 从字段直接生成标签 HTML（兼容镜片明细表）
async function buildLabelHtmlFromFields(f, orderNo) {
  const lensCode = f["镜片码"];
  if (!lensCode) return null;

  const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
  const eye = f["眼别"] || "";
  const isRight = eye.includes("右");
  const eyeColor = isRight ? "#c0392b" : "#1a6fb5";
  const eyeLabel = isRight ? "R  右眼" : "L  左眼";
  const eyeBg = isRight ? "#fff5f5" : "#f0f7ff";
  const sku = f["产品型号"] || "";
  const sph = f["球镜SPH"] ?? "";
  const cyl = f["柱镜CYL"] ?? "";
  const axis = f["轴位AXIS"] ?? "";
  const agentName = f["代理商名称"] || "";
  const agentId = f["代理商ID"] || "";

  const qrDataUrl = await QRCode.toDataURL(
    `${getServerBaseUrl()}/verify/${lensCode}`,
    { errorCorrectionLevel: "H", width: 180, margin: 1 }
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${orderNo} ${customer} ${eye}</title>
<style>
@page{size:75mm 40mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:75mm;height:40mm;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:6pt;background:#fff;overflow:hidden}
.label{width:75mm;height:40mm;display:flex;flex-direction:column;border:.3mm solid #ddd}
.header{display:flex;align-items:center;justify-content:space-between;background:${eyeColor};color:#fff;padding:.8mm 2mm;height:6.5mm;flex-shrink:0}
.eye-badge{font-size:9pt;font-weight:900;letter-spacing:1px}
.brand{font-size:6.5pt;font-weight:700;letter-spacing:1.5px;opacity:.92}
.order-no{font-size:5pt;opacity:.85;font-family:monospace}
.body{display:flex;flex:1;padding:1mm 1.5mm .8mm;gap:1.5mm;background:${eyeBg}}
.info{flex:1;display:flex;flex-direction:column;gap:.4mm;min-width:0}
.customer-row{display:flex;align-items:baseline;gap:1.5mm;border-bottom:.2mm solid ${eyeColor}44;padding-bottom:.8mm;margin-bottom:.4mm}
.customer-name{font-size:8pt;font-weight:800;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:24mm}
.sku-name{font-size:5.5pt;color:${eyeColor};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rx-grid{display:grid;grid-template-columns:auto auto auto;column-gap:2mm;row-gap:.2mm;margin:.3mm 0}
.rx-label{font-size:4.5pt;color:#888;text-transform:uppercase;letter-spacing:.3px}
.rx-value{font-size:7.5pt;font-weight:700;color:#1a1a2e;font-family:"SF Mono","Consolas",monospace;line-height:1.1}
.rx-value.hl{color:${eyeColor}}
.meta-row{display:flex;gap:1.5mm;margin-top:.3mm;flex-wrap:wrap}
.meta-item{display:flex;align-items:center;gap:.6mm}
.meta-label{font-size:4.5pt;color:#aaa}
.meta-value{font-size:5.5pt;color:#444;font-weight:600}
.qr-col{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8mm;flex-shrink:0}
.qr-col img{width:15mm;height:15mm;display:block;border:.3mm solid #ddd;border-radius:1mm}
.qr-label{font-size:3.5pt;color:#bbb;text-align:center}
.footer{display:flex;align-items:center;justify-content:space-between;background:#f8f9fa;border-top:.2mm solid #e9ecef;padding:.6mm 2mm;height:5.5mm;flex-shrink:0}
.lens-code{font-family:"Courier New",monospace;font-size:5.5pt;font-weight:700;color:#495057;letter-spacing:1px}
.footer-meta{display:flex;flex-direction:column;align-items:flex-end}
.agent-tag{font-size:4pt;color:#ccc;margin-top:.2mm}
@media print{body{padding:0}}
</style></head><body>
<div class="label">
<div class="header"><div class="eye-badge">${eyeLabel}</div><div style="text-align:right"><div class="brand">GAUSH | CLEAR</div><div class="order-no">${orderNo}</div></div></div>
<div class="body"><div class="info">
<div class="customer-row"><div class="customer-name">${f["顾客姓名"]||""}</div><div class="sku-name">${sku}</div></div>
<div class="rx-grid">
<div class="rx-label">SPH</div><div class="rx-label">CYL</div><div class="rx-label">AXIS</div>
<div class="rx-value hl">${fmt(sph)}</div><div class="rx-value hl">${fmt(cyl)}</div><div class="rx-value">${fmtAxis(axis)}</div>
</div>
<div class="meta-row"><div class="meta-item"><span class="meta-label">渠道</span><span class="meta-value">${agentId}</span></div></div>
</div><div class="qr-col"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">扫码验真</div></div></div>
<div class="footer"><div class="lens-code">${lensCode}</div><div class="footer-meta"><div class="agent-tag">${agentName}</div></div></div>
</div></body></html>`;

  return { orderNo, customer, eye, lensCode, html };
}

// 构建工厂导出 ZIP
// orderInfo: { remark, address, contact, phone } 来自订单主表
async function buildFactoryZip(records, orderNo, orderInfo = {}) {
  const files = [];

  // Excel 文件
  try {
    files.push({ name: `订单_${orderNo}.xlsx`, data: buildFactoryExcel(records, orderNo, orderInfo) });
  } catch (e) { console.error("⚠️ Excel 生成失败:", e.message); }

  // QR + 标签
  for (const rec of records) {
    const f = rec.fields;
    const lensCode = f["镜片码"];
    if (!lensCode) continue;

    const customer = (f["顾客姓名"] || "unknown").replace(/[\/\\:*?"<>|]/g, "_");
    const eye = f["眼别"] || "unknown";

    const qrPath = resolve(QR_DIR, `${lensCode}.png`);
    if (existsSync(qrPath)) {
      files.push({ name: `qrcodes/${lensCode}.png`, data: readFileSync(qrPath) });
    }

    const labelEntry = await buildLabelHtml(rec, orderNo);
    if (labelEntry) files.push(labelEntry);
  }

  // 说明文件
  const labelCount = files.filter(f => f.name.startsWith("labels/")).length;
  const qrCount = files.filter(f => f.name.startsWith("qrcodes/")).length;
  const readme = `工厂打印包 — 订单 ${orderNo}
${"=".repeat(34)}

本压缩包包含：
  订单_${orderNo}.xlsx    订单数据（Excel，可导入工厂系统）
  qrcodes/                ${qrCount} 个原始二维码图片
  labels/                 ${labelCount} 个可打印标签（HTML 格式）

标签使用方法：
  1. 在浏览器中打开 labels/ 下的 HTML 文件
  2. Ctrl+P（Mac: Cmd+P）打印
  3. 推荐标签纸：7.5cm × 4cm

注意事项：
  - 每个镜片码全球唯一，请勿复制或重复使用
  - 消费者扫描二维码即可验证产品真伪
  - Excel 包含完整处方参数，可直接用于生产排产
`;
  files.push({ name: "说明.txt", data: Buffer.from(readme, "utf-8") });

  return buildZipBuffer(files);
}

// 最小 ZIP 实现（Store 模式，不压缩）
function buildZipBuffer(fileEntries) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  const parts = [];

  for (const entry of fileEntries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = entry.data;
    const crc = crc32(data);

    // Local file header
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // compression (store)
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);         // crc32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    nameBuf.copy(local, 30);

    parts.push(local, data);

    // Central directory header
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // compression
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(crc, 16);        // crc32
    central.writeUInt32LE(data.length, 20);// compressed size
    central.writeUInt32LE(data.length, 24);// uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra field length
    central.writeUInt16LE(0, 32);          // file comment length
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attributes
    central.writeUInt32LE(0, 38);          // external attributes
    central.writeUInt32LE(offset, 42);     // relative offset of local header
    nameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralDirOffset = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...parts, centralDirBuf, eocd]);
}

// CRC32 查找表
const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = _crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 确保镜片码字段存在
async function ensureLensCodeField() {
  const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/fields`);
  if (data?.items?.some(f => f.field_name === "镜片码")) return;
  await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/fields`, {
    field_name: "镜片码",
    type: 1, // 文本
  });
  console.log("  已创建飞书字段: 镜片码");
}

// ─── 路由处理 ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
  res.end(readFileSync(filePath));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const start = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const token = url.searchParams.get("t") || "";

  // CORS
  setCorsHeader(req, res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate Limiting（全局）
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const verifyLimit = pathname.startsWith("/verify/") ? VERIFY_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  if (!checkRateLimit(clientIp, verifyLimit)) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "请求过于频繁，请稍后再试" }));
    return logReq(req, 429, start);
  }

  try {
    // ── 静态页面 ──
    if (pathname === "/login" || pathname === "/login.html") {
      serveStatic(res, resolve(__dirname, "public/login.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/admin" || pathname === "/admin-login" || pathname === "/admin-login.html") {
      serveStatic(res, resolve(__dirname, "public/admin-login.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/" || pathname === "/order" || pathname === "/order.html") {
      serveStatic(res, resolve(__dirname, "public/order.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/track" || pathname === "/track.html") {
      serveStatic(res, resolve(__dirname, "public/track.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/labels" || pathname === "/labels.html") {
      serveStatic(res, resolve(__dirname, "public/labels.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/control" || pathname === "/control.html") {
      serveStatic(res, resolve(__dirname, "public/control.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/inventory" || pathname === "/inventory.html") {
      serveStatic(res, resolve(__dirname, "public/inventory.html"));
      return logReq(req, 200, start);
    }

    // ── 静态资源 ──
    if (pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname.startsWith("/qrcodes/")) {
      serveStatic(res, resolve(__dirname, "public", pathname.slice(1)));
      return logReq(req, 200, start);
    }

    // ── 健康检查 ──
    if (pathname === "/health") {
      const checks = { feishu_token: false, bitable_read: false, agent_count: 0, uptime_seconds: Math.floor(process.uptime()) };
      try {
        const t = await getFeishuToken();
        checks.feishu_token = !!t;
        if (t) {
          const agents = await loadAgents();
          checks.agent_count = agents.length;
          checks.bitable_read = agents.length > 0;
        }
      } catch {}
      const ok = checks.feishu_token && checks.bitable_read && checks.agent_count > 0;
      jsonRes(res, ok ? 200 : 503, { ok, checks });
      return logReq(req, ok ? 200 : 503, start);
    }

    // ── 运维 API（需 admin 权限）──
    if (pathname.startsWith("/ops/")) {
      if (!isAdmin(req)) { jsonRes(res, 403, { error: "需要管理员权限" }); return logReq(req, 403, start); }

      // GET /ops/logs?tail=50
      if (pathname === "/ops/logs" && req.method === "GET") {
        const n = Math.min(Number(url.searchParams.get("tail")) || 50, 500);
        jsonRes(res, 200, { logs: _reqLog.slice(-n) });
        return logReq(req, 200, start);
      }

      // GET /ops/check-token
      if (pathname === "/ops/check-token" && req.method === "GET") {
        const result = { feishu: false, bitable: false, error: "" };
        try {
          const t = await getFeishuToken();
          result.feishu = !!t;
          if (t) {
            const agents = await loadAgents();
            result.bitable = agents.length > 0;
            result.agent_count = agents.length;
          }
        } catch (e) { result.error = e.message; }
        jsonRes(res, 200, result);
        return logReq(req, 200, start);
      }

      // POST /ops/restart
      if (pathname === "/ops/restart" && req.method === "POST") {
        jsonRes(res, 200, { ok: true, message: "服务重启中..." });
        logReq(req, 200, start);
        console.log("  ⚡ 运维指令：服务重启（/ops/restart）");
        setTimeout(() => process.exit(1), 500);
        return;
      }

      jsonRes(res, 404, { error: "未知运维指令" });
      return logReq(req, 404, start);
    }

    // ── API: 代理商信息 ──
    if (pathname === "/api/agent") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      jsonRes(res, 200, { id: agent.id, name: agent.name });
      return logReq(req, 200, start);
    }

    // ── API: SKU列表 + 库存状态 ──
    if (pathname === "/api/skus") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const allSkus = await getSkusWithInventory();
      const modelsOnly = url.searchParams.has("models");
      const result = modelsOnly ? getModelSkus(allSkus) : allSkus;
      jsonRes(res, 200, result);
      return logReq(req, 200, start);
    }

    // ── API: 交期预估 ──
    if (pathname === "/api/delivery-estimate") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const skuId = url.searchParams.get("sku") || "";
      const qty = Number(url.searchParams.get("qty")) || 0;
      const sphRaw = url.searchParams.get("sph");
      const cylRaw = url.searchParams.get("cyl");

      if (!skuId || qty <= 0) {
        jsonRes(res, 400, { error: "请提供有效的 SKU 和数量" });
        return logReq(req, 400, start);
      }
      if (qty > 100) {
        jsonRes(res, 400, { error: "单笔数量不能超过 100" });
        return logReq(req, 400, start);
      }

      if (sphRaw === null || cylRaw === null) {
        jsonRes(res, 400, { error: "请提供度数（sph 和 cyl）" });
        return logReq(req, 400, start);
      }

      // 所有 SKU 统一度数级判定（传入 agentId 优先查代理商库存）
      const est = await estimateDeliveryByRx(skuId, sphRaw, cylRaw, qty, agent.id);
      jsonRes(res, 200, { ...est, promiseDateFormatted: formatDate(est.promiseDate) });
      return logReq(req, 200, start);
    }

    // ── API: 客户名列表（兼容：返回名称数组）──
    if (pathname === "/api/customers") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const names = await getCustomerNames(agent.id);
      jsonRes(res, 200, { customers: names });
      return logReq(req, 200, start);
    }

    // ── API: 终端客户列表（含联系人/电话/地址）──
    if (pathname === "/api/terminal-customers") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const customers = await getTerminalCustomers(agent.id);
      jsonRes(res, 200, { customers });
      return logReq(req, 200, start);
    }

    // ── API: 提交订单 ──
    if (pathname === "/api/submit" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const payload = await readBody(req);
      const { address, patients, terminalCustomer, clientRequestId } = payload;

      // 幂等检查 — 防止双击/重试
      if (clientRequestId) {
        const cached = getIdempotent(clientRequestId);
        if (cached) { jsonRes(res, 200, cached); return logReq(req, 200, start); }
      }

      if (!terminalCustomer?.name?.trim()) {
        jsonRes(res, 400, { error: "请填写终端客户" });
        return logReq(req, 400, start);
      }
      if (!terminalCustomer?.contact?.trim()) {
        jsonRes(res, 400, { error: "请填写联系人" });
        return logReq(req, 400, start);
      }
      if (!terminalCustomer?.phone?.trim()) {
        jsonRes(res, 400, { error: "请填写联系电话" });
        return logReq(req, 400, start);
      }
      if (!address?.trim()) {
        jsonRes(res, 400, { error: "请填写收货地址" });
        return logReq(req, 400, start);
      }
      if (!Array.isArray(patients) || patients.length === 0) {
        jsonRes(res, 400, { error: "请至少填写一位患者信息" });
        return logReq(req, 400, start);
      }

      const skus = await getSkusWithInventory();
      const modelSkus = getModelSkus(skus);

      // 预校验：收集所有患者错误，有任何错误则整体拒绝
      const validationErrors = [];
      for (let i = 0; i < patients.length; i++) {
        const p = patients[i];
        const label = `患者${i + 1}（${p.customerName || "未填姓名"}）`;
        if (!p.customerName?.trim()) { validationErrors.push(`${label}：缺少顾客姓名`); continue; }
        if (!p.sku) { validationErrors.push(`${label}：缺少产品型号`); continue; }
        if (!p.quantity || p.quantity <= 0) { validationErrors.push(`${label}：数量必须大于 0`); continue; }
        if (!Array.isArray(p.eyes) || p.eyes.length === 0) { validationErrors.push(`${label}：请至少填写一只眼的处方`); continue; }
        const skuMatch = skus.find(s => s.sku === p.sku);
        if (!skuMatch) { validationErrors.push(`${label}：产品型号 "${p.sku}" 不在产品目录中`); }
      }
      if (validationErrors.length > 0) {
        jsonRes(res, 400, { error: "部分数据无效，请检查后重新提交", details: validationErrors });
        return logReq(req, 400, start);
      }

      const customerId = await getOrCreateCustomer(agent.name);
      const orderNo = genOrderNo();
      const now = Date.now();
      const orderRecords = [];    // 订单主表记录
      const lensRecords = [];     // 镜片明细表记录
      const deductionPlan = [];   // 库存扣减计划（预检+实际扣减共用）
      const items = [];
      let totalLenses = 0;

      for (const p of patients) {
        const { customerName, sku, quantity, eyes, assembly, remark } = p;

        // 交期取双眼中最慢的（优先查代理商本地库存）
        let est = { deliveryType: "定制7-10天", days: 10, promiseDate: now + 10 * 86400000 };
        for (const eye of eyes) {
          if (eye.sph != null && eye.cyl != null) {
            const eyeEst = await estimateDeliveryByRx(sku, eye.sph, eye.cyl, quantity, agent.id);
            if (eyeEst.days > est.days) est = eyeEst;
          }
        }
        const lensCount = eyes.length;

        // 写入订单主表（每笔患者 = 1 行）
        orderRecords.push({
          fields: {
            "订单编号": orderNo,
            "产品型号": sku,
            "数量": quantity * lensCount,
            "订单状态": "待处理",
            "预计交期": est.promiseDate,
            "下单日期": now,
            "顾客姓名": customerName.trim(),
            "代理商名称": agent.name,
            "代理商ID": agent.id,
            "收货地址": address.trim(),
            "订单来源": "代理商门户",
            "客户ID": customerId,
            "是否装配": assembly !== false ? "是" : "否",
            ...(terminalCustomer?.name ? { "终端客户": terminalCustomer.name } : {}),
            ...(terminalCustomer?.contact ? { "联系人": terminalCustomer.contact } : {}),
            ...(terminalCustomer?.phone ? { "联系电话": terminalCustomer.phone } : {}),
            ...(remark?.trim() ? { "备注": remark.trim() } : {}),
          },
        });

        // 写入镜片明细表（每眼 = 1 行）
        for (const eye of eyes) {
          lensRecords.push({
            fields: {
              "订单编号": orderNo,
              "眼别": eye.side || "",
              "球镜SPH": Number(eye.sph) || 0,
              "柱镜CYL": Number(eye.cyl) || 0,
              "轴位AXIS": Number(eye.axis) || 0,
              "是否装配": assembly !== false ? "是" : "否",
              "产品型号": sku,
              "顾客姓名": customerName.trim(),
              "代理商名称": agent.name,
              "代理商ID": agent.id,
              "订单状态": "待处理",
            },
          });
          totalLenses++;
          // 收集扣减计划（不在此时扣减）
          if (eye.sph != null && eye.cyl != null) {
            deductionPlan.push({ sku, sph: eye.sph, cyl: eye.cyl, qty: quantity });
          }
        }

        items.push({
          sku,
          skuName: sku,
          quantity,
          lensCount: quantity * lensCount,
          customerName: customerName.trim(),
          deliveryType: est.deliveryType,
          promiseDate: est.promiseDate,
          promiseDateFormatted: formatDate(est.promiseDate),
        });
      }

      if (orderRecords.length === 0) {
        jsonRes(res, 400, { error: "没有有效的订单数据" });
        return logReq(req, 400, start);
      }

      // ── 写入订单主表（库存不足时照常下单，交期自动变长） ──
      const okOrder = await batchCreateRecords(TABLES.order, orderRecords);
      if (!okOrder) {
        jsonRes(res, 500, { error: "写入飞书失败（订单主表），请重试" });
        return logReq(req, 500, start);
      }

      // ── 写入镜片明细表 ──
      if (lensRecords.length > 0) {
        const okLens = await batchCreateRecords(TABLES.lens_detail, lensRecords);
        if (!okLens) {
          console.error(`  ⚠️ 镜片明细写入失败，订单 ${orderNo} 主表已写入`);
        }
      }

      // ── 库存扣减（订单已写入，锁内再检+扣减） ──
      const deductErrors = [];
      for (const d of deductionPlan) {
        const result = await deductStockDetail(d.sku, d.sph, d.cyl, d.qty);
        if (!result.success) {
          deductErrors.push({ ...d, reason: result.reason });
        }
      }
      // 代理商库存扣减（先自有后寄售），写寄售流水
      for (const d of deductionPlan) {
        const deductResult = await deductAgentStock(agent.id, d.sku, d.sph, d.cyl, d.qty);
        if (deductResult.ledgerRecords?.length > 0) {
          await batchCreateRecords(TABLES.consignment_ledger, deductResult.ledgerRecords);
        }
      }
      if (deductErrors.length > 0) {
        console.error(`  ⚠️ 订单 ${orderNo} 部分库存扣减失败:`, deductErrors);
        // 标记订单备注（best effort）
        try {
          const errNote = deductErrors.map(e => `${e.sku} SPH=${e.sph} CYL=${e.cyl}(${e.reason})`).join(", ");
          for (const rec of orderRecords) {
            rec.fields["备注"] = (rec.fields["备注"] || "") + ` [系统] 库存扣减失败: ${errNote}`;
          }
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          for (const rec of d?.items || []) {
            await updateRecord(TABLES.order, rec.record_id, { "备注": `[系统] 库存扣减异常需人工处理: ${errNote}` });
          }
        } catch { /* best effort */ }
      }

      // 镜片码+QR 异步生成（不阻塞下单返回），带重试
      (async () => {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const codes = await assignLensCodes(orderNo);
            if (codes.length > 0) {
              console.log(`  镜片码已生成: ${orderNo} → ${codes.join(", ")}`);
            }
            break;
          } catch (e) {
            console.error(`  镜片码生成失败 (尝试 ${attempt}/${maxRetries}): ${orderNo}`, e.message);
            if (attempt === maxRetries) {
              try {
                const encoded = encodeURIComponent(`"${orderNo}"`);
                const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
                for (const rec of d?.items || []) {
                  await updateRecord(TABLES.order, rec.record_id, { "备注": `[系统] 镜片码生成失败，请人工处理` });
                }
              } catch { /* 标记失败不影响主流程 */ }
            }
          }
        }
      })();

      // 通知
      const summary = items.map(i => `${i.skuName}×${i.quantity}(${i.deliveryType})`).join("、");
      sendNotify(agent.name, summary, orderNo);

      // 清除客户名缓存
      delete _customerCache[agent.id];
      delete _terminalCustomerCache[agent.id];

      const responseData = {
        success: true,
        orderNo,
        items,
        summary: { totalPatients: patients.length, totalLenses },
      };
      setIdempotent(clientRequestId, responseData);
      jsonRes(res, 200, responseData);
      return logReq(req, 200, start);
    }

    // ── API: 代理商库存明细 ──
    if (pathname === "/api/agent-stock") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const agentMap = await getAgentStockMap(agent.id);
      if (!agentMap) {
        jsonRes(res, 200, { stock: [], hasAgentStock: false });
        return logReq(req, 200, start);
      }

      const stock = [];
      for (const [key, info] of agentMap) {
        const [sku, sph, cyl] = key.split("|");
        stock.push({
          sku, sph, cyl,
          owned: info.owned,
          consigned: info.consigned,
          total: info.total,
          consignDate: info.consignDate,
        });
      }
      jsonRes(res, 200, { stock, hasAgentStock: true });
      return logReq(req, 200, start);
    }

    // ── API: 管理端 — 寄售账龄报告 ──
    if (pathname === "/api/admin/consignment-report") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      if (!TABLES.agent_stock) {
        jsonRes(res, 200, { report: [], message: "代理商库存表未配置" });
        return logReq(req, 200, start);
      }

      const records = await listRecords(TABLES.agent_stock);
      const now = Date.now();
      const report = [];

      for (const r of records) {
        const f = r.fields || {};
        const consigned = Number(f["寄售库存"]) || 0;
        if (consigned <= 0) continue;

        const consignDate = f["寄售入库日期"];
        const ageDays = consignDate ? Math.floor((now - consignDate) / 86400000) : null;
        let status = "正常";
        if (ageDays !== null) {
          if (ageDays >= 90) status = "到期转收入";
          else if (ageDays >= 60) status = "即将到期";
        }

        report.push({
          agentId: f["agent_id"],
          sku: f["SKU编号"],
          sph: f["SPH"],
          cyl: f["CYL"],
          owned: Number(f["自有库存"]) || 0,
          consigned,
          consignDate: consignDate ? new Date(consignDate).toISOString().slice(0, 10) : null,
          ageDays,
          status,
        });
      }

      // 按账龄降序排列
      report.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
      jsonRes(res, 200, { report });
      return logReq(req, 200, start);
    }

    // ── API: 管理端 — 月度对账单生成 ──
    if (pathname === "/api/admin/monthly-statement") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      if (!TABLES.consignment_ledger || !TABLES.monthly_statement) {
        jsonRes(res, 200, { statements: [], message: "寄售流水表或对账单表未配置" });
        return logReq(req, 200, start);
      }

      const monthParam = url.searchParams.get("month"); // "2026-04"
      if (!monthParam) {
        jsonRes(res, 400, { error: "请提供月份参数 ?month=2026-04" });
        return logReq(req, 400, start);
      }

      // 读取该月的消耗流水
      const allLedger = await listRecords(TABLES.consignment_ledger);
      const monthConsumptions = {};
      for (const r of allLedger) {
        const f = r.fields || {};
        if (f["类型"] !== "消耗") continue;
        const created = f["操作时间"];
        if (!created) continue;
        const recMonth = new Date(created).toISOString().slice(0, 7);
        if (recMonth !== monthParam) continue;

        const agentId = f["agent_id"];
        const sku = f["SKU编号"];
        const key = `${agentId}|${sku}`;
        if (!monthConsumptions[key]) {
          monthConsumptions[key] = { agent: agentId, sku, qty: 0 };
        }
        monthConsumptions[key].qty += Math.abs(Number(f["数量"]) || 0);
      }

      // 汇总成对账单
      const statements = Object.values(monthConsumptions).map(s => ({
        fields: {
          "代理商": s.agent,
          "月份": monthParam,
          "SKU编号": s.sku,
          "消耗数量": s.qty,
          "单价": 0, // 需要业务确认价格后填写
          "金额": 0,
          "状态": "待确认",
        },
      }));

      if (statements.length > 0) {
        await batchCreateRecords(TABLES.monthly_statement, statements);
      }

      jsonRes(res, 200, { generated: statements.length, month: monthParam });
      return logReq(req, 200, start);
    }

    // ── API: 订单列表（筛选+分页+统计） ──
    if (pathname === "/api/orders") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const filterStatus = url.searchParams.get("status") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const filterSearch = url.searchParams.get("search") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 20));

      // 获取该代理商的全部订单
      const encoded = encodeURIComponent(`"${agent.id}"`);
      let allRecords = [];
      let pageToken = "";
      while (true) {
        let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
        if (pageToken) qs += `&page_token=${pageToken}`;
        const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
        if (!data) break;
        allRecords.push(...(data.items || []));
        if (!data.has_more) break;
        pageToken = data.page_token;
      }

      // 转换格式
      let orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          sku: f["产品型号"] || "",
          skuDisplay: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          customerName: f["顾客姓名"] || "",
          date: f["下单日期"] || f["同步时间"] || null,
          promiseDate: f["预计交期"] || null,
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      // 统计（过滤前）
      const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "待处理").length,
        producing: orders.filter(o => o.status === "生产中").length,
        shipped: orders.filter(o => o.status === "已发货").length,
        received: orders.filter(o => o.status === "已签收").length,
      };

      // 筛选
      orders = applyOrderFilters(orders, { filterStatus, filterSku, filterFrom, filterTo, filterSearch });

      // 排序（最新的在前）
      orders.sort((a, b) => (b.date || 0) - (a.date || 0));

      // 分页
      const totalPages = Math.ceil(orders.length / pageSize) || 1;
      const paged = orders.slice((page - 1) * pageSize, page * pageSize);

      jsonRes(res, 200, { orders: paged, stats, page, pageSize, totalPages, totalFiltered: orders.length });
      return logReq(req, 200, start);
    }

    // ── API: 单个订单详情 ──
    if (pathname.startsWith("/api/order/") && pathname.split("/").length === 4) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = pathname.split("/").pop();
      if (!orderNo) {
        jsonRes(res, 400, { error: "缺少订单号" });
        return logReq(req, 400, start);
      }

      const encoded = encodeURIComponent(`"${orderNo}"`);
      const data = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
      );

      if (!data?.items?.length) {
        jsonRes(res, 404, { error: "未找到该订单" });
        return logReq(req, 404, start);
      }

      // 验证权限：只能查自己的订单
      const firstItem = data.items[0];
      if (firstItem.fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权查看此订单" });
        return logReq(req, 403, start);
      }

      const items = data.items.map(r => {
        const f = r.fields;
        return {
          customerName: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          remark: f["备注"] || "",
        };
      });

      // 从镜片明细表获取处方数据，合并到 items
      const lensDetails = await getLensDetailsByOrder(orderNo);
      const lenses = lensDetails.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          lensCode: f["镜片码"] || "",
          status: f["订单状态"] || "",
          customerName: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
        };
      });

      // 如果有镜片明细，用镜片明细替换 items（含处方数据），并合并备注
      const remarkMap = {};
      for (const it of items) {
        if (it.customerName && it.remark) remarkMap[it.customerName] = it.remark;
      }
      const displayItems = lenses.length > 0 ? lenses.map(l => ({
        ...l,
        remark: remarkMap[l.customerName] || "",
      })) : items;

      jsonRes(res, 200, {
        orderNo,
        date: firstItem.fields["下单日期"] || firstItem.fields["同步时间"],
        address: firstItem.fields["收货地址"] || "",
        status: firstItem.fields["订单状态"] || "",
        courier: firstItem.fields["物流公司"] || "",
        trackingNo: firstItem.fields["快递单号"] || "",
        shipTime: firstItem.fields["发货时间"] || null,
        items: displayItems,
        lenses,
      });
      return logReq(req, 200, start);
    }

    // ── API: CSV 导出 ──
    if (pathname === "/api/orders/export") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      // 复用 orders 查询逻辑，不分页
      const filterStatus = url.searchParams.get("status") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";

      const encoded = encodeURIComponent(`"${agent.id}"`);
      let allRecords = [];
      let pageToken = "";
      while (true) {
        let qs = `?page_size=100&filter=CurrentValue.[代理商ID]=${encoded}`;
        if (pageToken) qs += `&page_token=${pageToken}`;
        const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records${qs}`);
        if (!data) break;
        allRecords.push(...(data.items || []));
        if (!data.has_more) break;
        pageToken = data.page_token;
      }

      let rows = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          sku: f["产品型号"] || "",
          qty: Number(f["数量"]) || 1,
          agent: f["代理商名称"] || "",
          terminalCustomer: f["终端客户"] || "",
          contact: f["联系人"] || "",
          phone: f["联系电话"] || "",
          assembly: f["是否装配"] || "",
          status: f["订单状态"] || "",
          date: f["下单日期"] ? formatDate(f["下单日期"]) : "",
          promiseDate: f["预计交期"] ? formatDate(f["预计交期"]) : "",
          courier: f["物流公司"] || "",
          trackingNo: f["快递单号"] || "",
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      // rows 中 date 已格式化为字符串，转换回时间戳以复用过滤函数
      rows = rows.map(r => ({ ...r, date: r.date ? new Date(r.date).getTime() || null : null }));
      rows = applyOrderFilters(rows, { filterStatus, filterSku, filterFrom, filterTo });
      // 还原 date 为格式化字符串
      rows = rows.map(r => ({ ...r, date: r.date ? formatDate(r.date) : "" }));

      rows.sort((a, b) => a.orderNo.localeCompare(b.orderNo));

      const headers = ["订单号","顾客","终端客户","联系人","电话","产品型号","数量","是否装配","代理商","状态","下单日期","预计交期","物流公司","快递单号","收货地址","备注"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        csvRows.push([r.orderNo, r.customer, r.terminalCustomer, r.contact, r.phone, r.sku, r.qty, r.assembly, r.agent, r.status, r.date, r.promiseDate, r.courier, r.trackingNo, r.address, r.remark].map(csvEscape).join(","));
      }

      const csv = "\uFEFF" + csvRows.join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=orders-${agent.id}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      res.end(csv);
      return logReq(req, 200, start);
    }

    // ── API: 查询订单镜片码 ──
    const lensCodesMatch = pathname.match(/^\/api\/order\/([^/]+)\/lens-codes$/);
    if (lensCodesMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(lensCodesMatch[1]);
      const encodedLC = encodeURIComponent(`"${orderNo}"`);
      const dataLC = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encodedLC}`
      );
      if (!dataLC?.items?.length) { jsonRes(res, 200, { lensCodes: [] }); return logReq(req, 200, start); }

      if (dataLC.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权查看" }); return logReq(req, 403, start);
      }

      const codes = dataLC.items.map(r => r.fields["镜片码"]).filter(Boolean);
      jsonRes(res, 200, { lensCodes: codes });
      return logReq(req, 200, start);
    }

    // ── API: 确认订单 → 生成镜片码 + QR ──
    const confirmMatch = pathname.match(/^\/api\/order\/([^/]+)\/confirm$/);
    if (confirmMatch && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(confirmMatch[1]);

      // 查飞书订单
      const encoded2 = encodeURIComponent(`"${orderNo}"`);
      const data2 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded2}`
      );
      if (!data2?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      // 权限校验
      if (data2.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权操作此订单" }); return logReq(req, 403, start);
      }

      // 确保镜片码字段存在
      await ensureLensCodeField();

      // 幂等：调用 assignLensCodes，已有码的自动跳过
      const lensCodes = await assignLensCodes(orderNo);

      // 更新主表状态为生产中（无论镜片码是否已存在）
      if (data2.items.length > 0) {
        await updateRecord(TABLES.order, data2.items[0].record_id, {
          "订单状态": "生产中",
          ...(lensCodes.length > 0 ? { "镜片码": lensCodes.join(",") } : {}),
        });
      }

      jsonRes(res, 200, { success: true, orderNo, lensCodes });
      return logReq(req, 200, start);
    }

    // ── API: 下载 QR 码 ──
    const qrMatch = pathname.match(/^\/api\/order\/([^/]+)\/qrcode$/);
    if (qrMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(qrMatch[1]);
      const encoded3 = encodeURIComponent(`"${orderNo}"`);
      const data3 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded3}`
      );
      if (!data3?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      const codes = data3.items.map(r => r.fields["镜片码"]).filter(Boolean);
      if (codes.length === 0) { jsonRes(res, 400, { error: "该订单尚未生成镜片码，请先确认订单" }); return logReq(req, 400, start); }

      // 返回第一个镜片的 QR（可扩展为批量下载 ZIP）
      const filePath = resolve(QR_DIR, `${codes[0]}.png`);
      if (!existsSync(filePath)) { jsonRes(res, 404, { error: "QR 文件不存在" }); return logReq(req, 404, start); }
      serveStatic(res, filePath);
      return logReq(req, 200, start);
    }

    // ── API: 工厂导出 ZIP ──
    const zipMatch = pathname.match(/^\/api\/order\/([^/]+)\/factory-zip$/);
    if (zipMatch) {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(zipMatch[1]);
      const encoded4 = encodeURIComponent(`"${orderNo}"`);
      const data4 = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=1&filter=CurrentValue.[订单编号]=${encoded4}`
      );
      if (!data4?.items?.length) { jsonRes(res, 404, { error: "未找到该订单" }); return logReq(req, 404, start); }

      if (data4.items[0].fields["代理商ID"] !== agent.id) {
        jsonRes(res, 403, { error: "无权操作此订单" }); return logReq(req, 403, start);
      }

      const of4 = data4.items[0].fields;
      const orderInfo4 = {
        remark: of4["备注"] || "",
        address: of4["收货地址"] || "",
        contact: of4["联系人"] || "",
        phone: of4["联系电话"] || "",
        quantity: Number(of4["数量"]) || 1,
      };
      const lensRecords4 = await getLensDetailsByOrder(orderNo);
      const zipBuf = await buildFactoryZip(lensRecords4, orderNo, orderInfo4);

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=factory-${orderNo}.zip`,
      });
      res.end(zipBuf);
      return logReq(req, 200, start);
    }

    // ── 验真页面（无 auth）──
    const verifyMatch = pathname.match(/^\/verify\/([A-Fa-f0-9]+)$/);
    if (verifyMatch) {
      const lensCode = verifyMatch[1].toUpperCase();
      // 先从镜片明细表精确匹配镜片码（每行一个码）
      const encodedLc = encodeURIComponent(`"${lensCode}"`);
      const lcData = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=1&filter=CurrentValue.[镜片码]=${encodedLc}`
      );

      let found = false;
      let orderInfo = {};
      let eyes = [];
      if (lcData?.items?.length > 0) {
        found = true;
        const lf = lcData.items[0].fields;
        const srcOrderNo = lf["订单编号"] || "";
        const srcCustomer = lf["顾客姓名"] || "";

        const skuCode = lf["产品型号"] || "";
        const skus = await getSkusWithInventory();
        const skuMatch = skus.find(s => s.sku === skuCode);
        orderInfo = {
          orderNo: srcOrderNo,
          customerName: srcCustomer,
          skuName: skuMatch?.name || skuCode,
        };

        // 同订单同客户同产品的眼别匹配（避免同名不同处方混入）
        const srcSku = lf["产品型号"] || "";
        const allLens = await getLensDetailsByOrder(srcOrderNo);
        const samePair = allLens.filter(r =>
          (r.fields["顾客姓名"] || "") === srcCustomer &&
          (r.fields["产品型号"] || "") === srcSku
        );
        eyes = samePair.map(r => ({
          side: r.fields["眼别"] || "",
          sph: r.fields["球镜SPH"] ?? "",
          cyl: r.fields["柱镜CYL"] ?? "",
          axis: r.fields["轴位AXIS"] ?? "",
          lensCode: r.fields["镜片码"] || "",
        }));

        // 获取订单创建时间
        const orderEnc = encodeURIComponent(`"${srcOrderNo}"`);
        const orderData = await feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=1&filter=CurrentValue.[订单编号]=${orderEnc}`
        );
        const orderRecord = orderData?.items?.[0];
        if (orderRecord?.created_time) {
          orderInfo.createTime = new Date(orderRecord.created_time * 1000).toLocaleString("zh-CN");
        }
      }

      // 读取 verify.html 模板并渲染（所有动态值均做 HTML 转义防注入）
      let html = readFileSync(resolve(__dirname, "public/verify.html"), "utf-8");
      html = html.replace("{{FOUND}}", found ? "true" : "false");
      html = html.replace("{{HERO_CLASS}}", found ? "hero-ok" : "hero-fail");
      html = html.replace("{{LENS_CODE}}", escapeHtml(lensCode));
      html = html.replace("{{ORDER_NO}}", escapeHtml(orderInfo.orderNo || ""));
      html = html.replace("{{CUSTOMER_NAME}}", escapeHtml(orderInfo.customerName || ""));
      html = html.replace("{{SKU_NAME}}", escapeHtml(orderInfo.skuName || ""));

      // 生成双眼处方行
      const eyeRows = eyes.map(e => {
        const cls = e.side.includes("左") ? "eye-L" : "eye-R";
        return `<tr>
        <td><span class="eye-tag ${cls}">${escapeHtml(e.side)}</span></td>
        <td class="rx-num">${escapeHtml(String(e.sph ?? "—"))}</td>
        <td class="rx-num">${escapeHtml(String(e.cyl ?? "—"))}</td>
        <td class="rx-num">${escapeHtml(String(e.axis ?? "—"))}</td>
      </tr>`;
      }).join("\n");
      html = html.replace("{{EYE_ROWS}}", eyeRows);

      // 生成镜片码列表
      const codeHtml = eyes.map(e => `<span class="lens-code-item"><span class="lens-code-side">${escapeHtml(e.side)}</span> <span class="mono">${escapeHtml(e.lensCode)}</span></span>`).join("\n");
      html = html.replace("{{LENS_CODES}}", codeHtml);

      html = html.replace("{{NOW}}", escapeHtml(orderInfo.createTime || new Date().toLocaleString("zh-CN")));

      res.writeHead(found ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return logReq(req, found ? 200 : 404, start);
    }

    // ── 管理端 API（简单密码鉴权） ──────────────────────────────────────

    // GET /api/admin/orders — 全部订单列表（管理端，无代理商过滤）
    if (pathname === "/api/admin/orders") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const filterStatus = url.searchParams.get("status") || "";
      const filterAgent = url.searchParams.get("agent") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterAssembly = url.searchParams.get("assembly") || "";
      const filterQ = url.searchParams.get("q") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 50));

      const allRecords = await listRecords(TABLES.order);

      let orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customerName: f["顾客姓名"] || "",
          agentName: f["代理商名称"] || "",
          agentId: f["代理商ID"] || "",
          sku: f["产品型号"] || "",
          quantity: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          date: f["下单日期"] || f["同步时间"] || null,
          lensCode: f["镜片码"] || "",
          assembly: f["是否装配"] || "",
          remark: f["备注"] || "",
        };
      });

      // 统计
      const agents = [...new Set(orders.map(o => o.agentName).filter(Boolean))].sort();
      const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "待处理").length,
        producing: orders.filter(o => o.status === "生产中").length,
        shipped: orders.filter(o => o.status === "已发货").length,
        received: orders.filter(o => o.status === "已签收").length,
      };

      // 筛选
      orders = applyOrderFilters(orders, { filterStatus, filterAgent, filterSku, filterFrom, filterTo, filterQ });
      if (filterAssembly) orders = orders.filter(o => o.assembly === filterAssembly);

      orders.sort((a, b) => (b.date || 0) - (a.date || 0));
      const totalPages = Math.ceil(orders.length / pageSize) || 1;
      const paged = orders.slice((page - 1) * pageSize, page * pageSize);

      jsonRes(res, 200, { orders: paged, stats, agents, page, pageSize, totalPages, totalFiltered: orders.length });
      return logReq(req, 200, start);
    }

    // GET /api/admin/order/:orderNo/lens-details — 获取某订单镜片明细
    const adminLensMatch = pathname.match(/^\/api\/admin\/order\/([^/]+)\/lens-details$/);
    if (adminLensMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNo = decodeURIComponent(adminLensMatch[1]);
      const details = await getLensDetailsByOrder(orderNo);
      const lenses = details.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"] ?? "",
          cyl: f["柱镜CYL"] ?? "",
          axis: f["轴位AXIS"] ?? "",
          lensCode: f["镜片码"] || "",
          sku: f["产品型号"] || "",
          customerName: f["顾客姓名"] || "",
          status: f["订单状态"] || "",
        };
      });
      jsonRes(res, 200, { orderNo, lenses });
      return logReq(req, 200, start);
    }

    // GET /api/admin/labels/batch — 批量生成标签 HTML
    const adminLabelsMatch = pathname.match(/^\/api\/admin\/labels\/batch$/);
    if (adminLabelsMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const allLabels = [];

      for (const orderNo of orderNos) {
        const details = await getLensDetailsByOrder(orderNo);
        for (const rec of details) {
          const f = rec.fields;
          if (!f["镜片码"]) continue;
          const html = await buildLabelHtmlFromFields(f, orderNo);
          if (html) allLabels.push(html);
        }
      }

      jsonRes(res, 200, { labels: allLabels, count: allLabels.length });
      return logReq(req, 200, start);
    }

    // GET /api/admin/batch-zip — 批量导出 ZIP（多订单合并为一个 ZIP）
    const batchZipMatch = pathname.match(/^\/api\/admin\/batch-zip$/);
    if (batchZipMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const allFiles = [];
      const allDetails = [];   // 合并所有订单的镜片记录
      const orderInfoMap = {}; // orderNo → orderInfo

      for (const orderNo of orderNos) {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) continue;

        // 按顾客姓名过滤（④-6），支持逗号分隔多客户名
        if (customerFilter) {
          const names = customerFilter.split(",").map(s => s.trim()).filter(Boolean);
          details = details.filter(r => names.includes(r.fields["顾客姓名"] || ""));
        }
        if (!details.length) continue;

        // 获取订单主表：备注、收货地址、联系人、联系电话、数量
        // 每个订单号独立查询，避免多订单混用信息
        if (!orderInfoMap[orderNo]) {
          const orderEnc = encodeURIComponent(`"${orderNo}"`);
          const orderData = await feishuApi("GET",
            `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${orderEnc}`
          );
          let orderItems = orderData?.items || [];
          // 按客户名过滤，只取被选中患者的备注
          if (customerFilter) {
            const names = customerFilter.split(",").map(s => s.trim()).filter(Boolean);
            orderItems = orderItems.filter(r => names.includes(r.fields["顾客姓名"] || ""));
          }
          const allRemarks = orderItems.map(r => r.fields["备注"] || "").filter(Boolean);
          const of = orderItems[0]?.fields || {};
          orderInfoMap[orderNo] = {
            remark: [...new Set(allRemarks)].join("；"),
            address: of["收货地址"] || "",
            contact: of["联系人"] || "",
            phone: of["联系电话"] || "",
            quantity: Number(of["数量"]) || 1,
          };
        }

        allDetails.push(...details);

        // QR + 标签按订单分子目录
        const prefix = orderNos.length > 1 ? `${orderNo}/` : "";
        for (const rec of details) {
          const f = rec.fields;
          const lensCode = f["镜片码"];
          if (!lensCode) continue;

          const qrPath = resolve(QR_DIR, `${lensCode}.png`);
          if (existsSync(qrPath)) {
            allFiles.push({ name: `${prefix}qrcodes/${lensCode}.png`, data: readFileSync(qrPath) });
          }

          const labelEntry = await buildLabelHtml(rec, orderNo);
          if (labelEntry) {
            allFiles.push({ name: `${prefix}${labelEntry.name}`, data: labelEntry.data });
          }
        }
      }

      // 合并所有订单到一个 Excel（④-5）
      if (allDetails.length > 0) {
        try {
          const excelName = orderNos.length > 1 ? `订单_合并_${orderNos.length}单.xlsx` : `订单_${orderNos[0]}.xlsx`;
          const excelBuf = buildFactoryExcel(allDetails, orderNos.join("+"), orderInfoMap);
          if (excelBuf && excelBuf.length > 0) {
            allFiles.push({ name: excelName, data: excelBuf });
          } else {
            console.error(`⚠️ Excel buffer 为空 (${allDetails.length} 条记录)`);
          }
        } catch (e) { console.error("⚠️ Excel 生成失败:", e.message, e.stack); }
      } else {
        console.error(`⚠️ batch-zip: allDetails 为空, orders=${orderNos.join(",")}, customerFilter=${customerFilter}`);
      }

      if (!allFiles.length) { jsonRes(res, 404, { error: "所选订单无镜片数据" }); return logReq(req, 404, start); }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const readme = `工厂导出包 — ${dateStr}\n共 ${orderNos.length} 个订单\n`;
      allFiles.push({ name: "说明.txt", data: Buffer.from(readme, "utf-8") });

      const zipBuf = buildZipBuffer(allFiles);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="factory-export-${dateStr}.zip"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(zipBuf);
      return logReq(req, 200, start);
    }

    // POST /api/admin/confirm — 确认订单（批量，可按客户维度）
    if (pathname === "/api/admin/confirm" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只确认该客户
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const results = [];
      for (const orderNo of orderNos) {
        try {
          // 查订单主表记录
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤（②-1）
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          // 生成镜片码（幂等，按客户过滤）
          const lensCodes = await assignLensCodes(orderNo, customerName);

          // 更新状态为生产中 + 回写镜片码（合并已有码，不覆盖其他客户的码）
          for (const rec of records) {
            const existingCodes = String(rec.fields["镜片码"] || "").split(",").filter(Boolean);
            const mergedCodes = [...new Set([...existingCodes, ...lensCodes])];
            await updateRecord(TABLES.order, rec.record_id, {
              "订单状态": "生产中",
              ...(mergedCodes.length > 0 ? { "镜片码": mergedCodes.join(",") } : {}),
            });
          }
          // 推进工作流步骤
          try {
            for (const rec of records) {
              const wf = parseWorkflow(rec.fields["流程步骤"]);
              advanceWorkflow(wf, "confirmed");
              advanceWorkflow(wf, "producing");
              await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(wf) });
            }
          } catch (e) { console.error("⚠️ 工作流更新失败(confirm):", e.message); }
          results.push({ orderNo, ok: true, lensCodes });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // GET /api/admin/ship-preview — 发货前预览清单（处方明细+收货信息）
    if (pathname === "/api/admin/ship-preview" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNosParam = url.searchParams.get("orderNos") || "";
      const customerParam = url.searchParams.get("customer") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }
      const previewOrderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const previewCustomers = customerParam ? customerParam.split(",").map(s => s.trim()) : [];
      try {
        const orders = [];
        for (const orderNo of previewOrderNos) {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (previewCustomers.length) records = records.filter(r => previewCustomers.includes(r.fields["顾客姓名"] || ""));
          if (!records.length) continue;
          const custMap = {};
          for (const rec of records) {
            const cn = rawVal(rec.fields["顾客姓名"]) || "未知";
            if (!custMap[cn]) custMap[cn] = rec;
          }
          const lensDetails = await getLensDetailsByOrder(orderNo);
          for (const [custName, rec] of Object.entries(custMap)) {
            const f = rec.fields;
            const filtered = previewCustomers.length ? lensDetails.filter(r => previewCustomers.includes(r.fields["顾客姓名"] || "")) : lensDetails;
            const rows = filtered.map(r => {
              const lf = r.fields;
              return {
                eye: rawVal(lf["眼别"]) || "—",
                sku: rawVal(lf["产品型号"]),
                sph: lf["球镜SPH"] ?? "",
                cyl: lf["柱镜CYL"] ?? "",
                axis: lf["轴位AXIS"] ?? "",
                lensCode: rawVal(lf["镜片码"]),
              };
            }).sort((a, b) => a.eye.includes("右") ? -1 : 1);
            orders.push({
              orderNo,
              customerName: custName,
              agentName: rawVal(f["代理商名称"]),
              agentId: rawVal(f["代理商ID"]),
              contact: rawVal(f["联系人"]),
              phone: rawVal(f["联系电话"]),
              address: rawVal(f["收货地址"]),
              remark: rawVal(f["备注"]),
              quantity: Number(f["数量"]) || 0,
              rows,
            });
          }
        }
        jsonRes(res, 200, { orders });
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // GET /api/admin/slip/:orderNo — 单订单随货同行单 HTML
    const slipMatch = pathname.match(/^\/api\/admin\/slip\/([^/]+)$/);
    if (slipMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNo = slipMatch[1];
      const customerFilter = url.searchParams.get("customer") || "";
      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const [d, allLensDetails] = await Promise.all([
          feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`),
          getLensDetailsByOrder(orderNo),
        ]);
        if (!d?.items?.length) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }
        // 如果传了 customer，用该顾客的订单记录和镜片明细
        let orderRec = d.items[0];
        let lensDetails = allLensDetails;
        if (customerFilter) {
          const matched = d.items.find(r => rawVal(r.fields["顾客姓名"]) === customerFilter);
          if (matched) orderRec = matched;
          lensDetails = allLensDetails.filter(r => rawVal(r.fields["顾客姓名"]) === customerFilter);
        }
        const f0 = orderRec.fields;
        const rows = lensDetails.map((r, i) => {
          const f = r.fields;
          return {
            eye: rawVal(f["眼别"]) || (i === 0 ? "右眼" : "左眼"),
            sku: rawVal(f["产品型号"]),
            sph: f["球镜SPH"] ?? "",
            cyl: f["柱镜CYL"] ?? "",
            axis: f["轴位AXIS"] ?? "",
            lensCode: rawVal(f["镜片码"]),
          };
        }).sort((a, b) => a.eye.includes("右") ? -1 : 1);
        const html = slipHTML({
          orderNo,
          customerName: rawVal(f0["顾客姓名"]),
          agentName: rawVal(f0["代理商名称"]),
          agentId: rawVal(f0["代理商ID"]),
          shipDate: f0["发货时间"] ? new Date(f0["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
          promiseDate: f0["预计交期"] ? new Date(f0["预计交期"]).toLocaleDateString("zh-CN") : "",
          courierName: rawVal(f0["物流公司"]),
          trackingNo: rawVal(f0["快递单号"]),
          rows,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // GET /api/admin/slip-batch — 批量合单随货同行单（按日期+代理商）
    if (pathname === "/api/admin/slip-batch" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const dateStr = url.searchParams.get("date") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const agentId = url.searchParams.get("agent") || "";
      try {
        let filter = `CurrentValue.[快递单号]!=""`;
        if (agentId) filter += `&&CurrentValue.[代理商ID]="${agentId}"`;
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=500&filter=${encodeURIComponent(filter)}`);
        const records = d?.items || [];
        // 按日期过滤（发货时间在当天范围内）
        const dayStart = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")).getTime();
        const dayEnd = dayStart + 86400000;
        const filtered = records.filter(r => {
          const shipTime = r.fields["发货时间"];
          return shipTime && shipTime >= dayStart && shipTime < dayEnd;
        });
        if (!filtered.length) { jsonRes(res, 404, { error: `${dateStr} 无已发货记录` }); return logReq(req, 404, start); }
        // 按代理商+快递单号分组
        const agentMap = {};
        for (const r of filtered) {
          const f = r.fields;
          const aid = rawVal(f["代理商ID"]) || "UNKNOWN";
          const tracking = rawVal(f["快递单号"]);
          const key = `${aid}__${tracking}`;
          if (!agentMap[key]) agentMap[key] = { agentId: aid, agentName: rawVal(f["代理商名称"]) || aid,
            trackingNo: tracking, courierName: rawVal(f["物流公司"]),
            shipDate: f["发货时间"] ? new Date(f["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
            records: [] };
          agentMap[key].records.push(r);
        }
        const groups = Object.values(agentMap);
        // 单分组直接返回通行单 HTML
        if (groups.length === 1) {
          const g = groups[0];
          // 收集所有订单号
          const orderNos = [...new Set(g.records.map(r => rawVal(r.fields["订单编号"])))];
          // 并行查询所有订单的镜片明细
          const allLens = await Promise.all(orderNos.map(no => getLensDetailsByOrder(no)));
          // 按顾客姓名分组（镜片明细表自带顾客姓名）
          const customerMap = {};
          for (const lensDetails of allLens) {
            for (const ld of lensDetails) {
              const f = ld.fields;
              const cname = rawVal(f["顾客姓名"]) || "未知";
              if (!customerMap[cname]) customerMap[cname] = { orderNo: rawVal(f["订单编号"]) || "—", customerName: cname, rows: [] };
              customerMap[cname].rows.push({ eye: rawVal(f["眼别"]) || "—", sku: rawVal(f["产品型号"]),
                sph: f["球镜SPH"] ?? "", cyl: f["柱镜CYL"] ?? "", axis: f["轴位AXIS"] ?? "",
                lensCode: rawVal(f["镜片码"]) });
            }
          }
          // 每人的右眼在上、左眼在下
          for (const c of Object.values(customerMap)) {
            c.rows.sort((a, b) => a.eye.includes("右") ? -1 : 1);
          }
          const html = batchSlipHTML({ ...g, orders: Object.values(customerMap) });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return logReq(req, 200, start);
        }
        // 多分组：返回汇总页，每组一个可点击卡片
        let listHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>随货同行单汇总 ${dateStr}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding:40px;background:#f5f5f5}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;max-width:1200px;margin:0 auto}
.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;transition:box-shadow .2s}
.card:hover{box-shadow:0 4px 16px rgba(0,0,0,.15)}
.card h3{margin:0 0 8px;color:#c0392b;font-size:14pt}
.card p{margin:4px 0;color:#666;font-size:10pt}
h1{max-width:1200px;margin:0 auto 24px;color:#1a1a2e;font-size:18pt}
.btn{display:inline-block;margin-top:12px;padding:6px 16px;background:#c0392b;color:#fff;border:none;border-radius:4px;font-size:10pt;text-decoration:none}
a{color:inherit;text-decoration:none}</style></head><body>
<h1>随货同行单汇总 — ${dateStr}</h1><div class="cards">`;
        for (const g of groups) {
          const totalRows = g.records.length;
          listHtml += `<a class="card" href="/api/admin/slip-batch?date=${dateStr}&agent=${g.agentId}"><h3>${g.agentName}</h3>
<p>代理商 ID：${g.agentId}</p><p>快递单号：${g.trackingNo || "—"}</p><p>物流公司：${g.courierName || "—"}</p>
<p>发货 ${totalRows} 条记录</p><span class="btn">查看通行单 →</span></a>`;
        }
        listHtml += `</div></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(listHtml);
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // POST /api/admin/ship — 发货（逐单或批量，可按客户维度）
    if (pathname === "/api/admin/ship" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只发该客户
      const courierKey = payload.courier || ""; // 可选指定快递
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      // 快递公司配置
      const COURIERS_WEB = {
        sf: { name: "顺丰速运", icon: "🚚" },
        zt: { name: "中通快递", icon: "📦" },
        yd: { name: "韵达快递", icon: "📮" },
        jd: { name: "京东快递", icon: "🔷" },
      };
      function genTrackingNoWeb(key) {
        const prefix = { sf: "SF", zt: "75", yd: "YD", jd: "JD" };
        const p = prefix[key] || "SF";
        const digits = String(parseInt(randomBytes(6).toString("hex"), 16)).slice(0, 12).padStart(12, "0");
        return p + digits;
      }
      function autoSelectCourierWeb(agentId) {
        const map = { "AG-003": "sf", "AG-006": "sf", "AG-005": "zt" };
        return map[agentId] || "sf";
      }

      const results = [];
      const now = Date.now();

      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤（③-1）
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          const f0 = records[0].fields;
          const agentId = rawVal(f0["代理商ID"]) || "";
          const ck = courierKey || autoSelectCourierWeb(agentId);
          const courier = COURIERS_WEB[ck] || COURIERS_WEB.sf;
          const trackingNo = genTrackingNoWeb(ck);

          for (const rec of records) {
            await updateRecord(TABLES.order, rec.record_id, {
              "物流公司": courier.name,
              "快递单号": trackingNo,
              "发货时间": now,
              "物流状态": "已发货",
              "订单状态": "已发货",
            });
          }

          // 同步镜片明细表状态
          const shipLensDetails = await getLensDetailsByOrder(orderNo);
          const shipFilteredLens = customerName
            ? shipLensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : shipLensDetails;
          for (const rec of shipFilteredLens) {
            await updateRecord(TABLES.lens_detail, rec.record_id, { "订单状态": "已发货" });
          }

          // 推进工作流步骤 → shipped
          try {
            for (const rec of records) {
              const wf = parseWorkflow(rec.fields["流程步骤"]);
              advanceWorkflow(wf, "shipped");
              await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(wf) });
            }
          } catch (e) { console.error("⚠️ 工作流更新失败(ship):", e.message); }

          // 飞书发货卡片
          const custName = rawVal(f0["顾客姓名"]) || "";
          const sku = rawVal(f0["产品型号"]) || "";
          const agentName = rawVal(f0["代理商名称"]) || "";
          sendFeishuCard(shipCard({
            orderNo, customerName: custName, sku, agentName,
            courierName: courier.name, trackingNo,
            lensCount: Number(f0["数量"]) || 0,
          })).catch(e => console.error("发货通知失败:", e.message));

          results.push({ orderNo, ok: true, courier: courier.name, trackingNo });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/deliver — 签收（批量，可按客户维度）
    if (pathname === "/api/admin/deliver" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || ""; // 可选：只签收该客户
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const now = Date.now();
      const results = [];

      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名过滤
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }

          for (const rec of records) {
            await updateRecord(TABLES.order, rec.record_id, {
              "订单状态": "已签收",
              "物流状态": "已签收",
              "签收时间": now,
            });
          }

          // 同步镜片明细表状态
          const deliverLensDetails = await getLensDetailsByOrder(orderNo);
          const deliverFilteredLens = customerName
            ? deliverLensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : deliverLensDetails;
          for (const rec of deliverFilteredLens) {
            await updateRecord(TABLES.lens_detail, rec.record_id, { "订单状态": "已签收" });
          }

          // 推进工作流步骤 → received
          try {
            for (const rec of records) {
              const wf = parseWorkflow(rec.fields["流程步骤"]);
              advanceWorkflow(wf, "received");
              await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(wf) });
            }
          } catch (e) { console.error("⚠️ 工作流更新失败(deliver):", e.message); }

          // 飞书签收卡片
          const f0 = records[0].fields;
          const signedAt = new Date(now).toLocaleString("zh-CN");
          sendFeishuCard(deliveredCard({
            orderNo,
            customerName: rawVal(f0["顾客姓名"]) || "",
            sku: rawVal(f0["产品型号"]) || "",
            agentName: rawVal(f0["代理商名称"]) || "",
            signedAt,
          })).catch(e => console.error("签收通知失败:", e.message));

          results.push({ orderNo, ok: true });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // ── 标签打印 API ─────────────────────────────────────────────────────────

    // POST /api/admin/print-label — 生成 ZPL 发送斑马打印机
    if (pathname === "/api/admin/print-label" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNo = (payload.orderNo || "").trim();
      const customerName = payload.customerName || "";
      const eye = payload.eye || ""; // "右眼" or "左眼" or "" (all)
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) { jsonRes(res, 404, { error: "未找到镜片明细" }); return logReq(req, 404, start); }
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        if (!details.length) { jsonRes(res, 404, { error: "过滤后无匹配镜片" }); return logReq(req, 404, start); }

        const config = loadPrinterConfig();
        const copies = config.copies || 1;
        const results = [];

        for (const rec of details) {
          if (!rec.fields["镜片码"]) continue;
          const zpl = buildZpl(rec);
          for (let i = 0; i < copies; i++) {
            const r = await sendZplToPrinter(zpl);
            results.push({ lensCode: rec.fields["镜片码"], eye: rec.fields["眼别"], ...r });
          }
        }

        // 自动推进工作流步骤 → labeled
        try {
          const orderEnc = encodeURIComponent(`"${orderNo}"`);
          const od = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${orderEnc}`);
          for (const rec of (od?.items || [])) {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            const adv = advanceWorkflow(wf, "labeled");
            if (adv.ok && !adv.skipped) {
              await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(adv.wf) });
            }
          }
        } catch (e) { console.error("⚠️ 工作流更新失败(labeled):", e.message); }

        jsonRes(res, 200, { ok: true, orderNo, lensCount: results.length, results });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // POST /api/admin/print-label/preview — 返回 ZPL 文本（不实际打印）
    if (pathname === "/api/admin/print-label/preview" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNo = (payload.orderNo || "").trim();
      const customerName = payload.customerName || "";
      const eye = payload.eye || "";
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        const zpls = details.filter(r => r.fields["镜片码"]).map(r => ({
          lensCode: r.fields["镜片码"],
          eye: r.fields["眼别"],
          zpl: buildZpl(r),
        }));
        jsonRes(res, 200, { ok: true, orderNo, count: zpls.length, zpls });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // POST /api/admin/printer/test — 发送测试标签
    if (pathname === "/api/admin/printer/test" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      try {
        const result = await sendZplToPrinter(buildTestZpl());
        jsonRes(res, 200, { ok: true, ...result });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { ok: false, error: e.message });
        return logReq(req, 500, start);
      }
    }

    // GET /api/admin/printer/config — 读取打印机配置
    if (pathname === "/api/admin/printer/config" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      jsonRes(res, 200, loadPrinterConfig());
      return logReq(req, 200, start);
    }

    // POST /api/admin/printer/config — 更新打印机配置
    if (pathname === "/api/admin/printer/config" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const current = loadPrinterConfig();
      const merged = { ...current, ...body };
      // 深合并 tcp/usb 子对象
      if (body.tcp) merged.tcp = { ...current.tcp, ...body.tcp };
      if (body.usb) merged.usb = { ...current.usb, ...body.usb };
      savePrinterConfig(merged);
      jsonRes(res, 200, { ok: true, config: merged });
      return logReq(req, 200, start);
    }

    // GET /api/admin/printer/status — 检查打印机连通性
    if (pathname === "/api/admin/printer/status" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const config = loadPrinterConfig();
      const status = { model: config.printer_model, connection: config.default_connection };
      if (config.tcp?.enabled) {
        try {
          await sendTcpZpl("^XA^FO10,10^A0N,20,20^FDPING^FS^XZ", config.tcp.host, config.tcp.port, 3000);
          status.tcp = { ok: true, host: config.tcp.host, port: config.tcp.port };
        } catch (e) {
          status.tcp = { ok: false, host: config.tcp.host, port: config.tcp.port, error: e.message };
        }
      }
      if (config.usb?.enabled) {
        try {
          const r = await fetch(`${config.usb.bridge_url}/status`, { signal: AbortSignal.timeout(3000) });
          status.usb = { ok: r.ok, bridge: config.usb.bridge_url };
        } catch (e) {
          status.usb = { ok: false, bridge: config.usb.bridge_url, error: e.message };
        }
      }
      jsonRes(res, 200, status);
      return logReq(req, 200, start);
    }

    // ── 打印队列 API（Mac 拉模式）────────────────────────────────────────────

    // POST /api/admin/print-queue — 入队打印任务
    if (pathname === "/api/admin/print-queue" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const type = payload.type || "zpl";

      if (type === "test") {
        const id = `pq-${Date.now()}-${++_pqSeq}`;
        printQueue.set(id, { id, type: "zpl", zpl: buildTestZpl(), orderNo: "TEST-PRINT", customerName: "", eye: "", lensCode: "", status: "pending", ts: Date.now() });
        jsonRes(res, 200, { ok: true, jobId: id, type: "test" });
        return logReq(req, 200, start);
      }

      if (type === "slip") {
        const slipUrl = payload.slipUrl || "";
        if (!slipUrl) { jsonRes(res, 400, { error: "缺少 slipUrl" }); return logReq(req, 400, start); }
        const id = `pq-${Date.now()}-${++_pqSeq}`;
        printQueue.set(id, { id, type: "slip", slipUrl, title: payload.title || "通行单", status: "pending", ts: Date.now() });
        jsonRes(res, 200, { ok: true, jobId: id, type: "slip" });
        return logReq(req, 200, start);
      }

      const orderNo = (payload.orderNo || "").trim();
      const customerName = payload.customerName || "";
      const eye = payload.eye || "";
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) { jsonRes(res, 404, { error: "未找到镜片明细" }); return logReq(req, 404, start); }
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        if (!details.length) { jsonRes(res, 404, { error: "过滤后无匹配镜片" }); return logReq(req, 404, start); }

        const config = loadPrinterConfig();
        const copies = config.copies || 1;
        const jobIds = [];

        for (const rec of details) {
          if (!rec.fields["镜片码"]) continue;
          const zpl = buildZpl(rec);
          for (let i = 0; i < copies; i++) {
            const id = `pq-${Date.now()}-${++_pqSeq}`;
            printQueue.set(id, {
              id, type: "zpl", zpl, orderNo, customerName: rec.fields["顾客姓名"] || "",
              eye: rec.fields["眼别"] || "", lensCode: rec.fields["镜片码"] || "",
              status: "pending", ts: Date.now(),
            });
            jobIds.push(id);
          }
        }
        jsonRes(res, 200, { ok: true, orderNo, lensCount: jobIds.length, jobIds });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // GET /api/admin/print-queue/poll — Mac 守护进程拉取待打印任务
    if (pathname === "/api/admin/print-queue/poll" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const jobs = [...printQueue.values()].filter(j => j.status === "pending").slice(0, 20);
      jsonRes(res, 200, { jobs });
      return logReq(req, 200, start);
    }

    // POST /api/admin/print-queue/:id/done — Mac 打完后回写完成
    const pqDoneMatch = pathname.match(/^\/api\/admin\/print-queue\/([^/]+)\/done$/);
    if (pqDoneMatch && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const id = pqDoneMatch[1];
      const job = printQueue.get(id);
      if (!job) { jsonRes(res, 404, { error: "任务不存在" }); return logReq(req, 404, start); }
      const body = await readBody(req);
      job.status = body?.error ? "error" : "done";
      job.doneAt = Date.now();
      if (body?.error) job.error = body.error;

      // 推进工作流 → labeled（仅 ZPL 类型，同订单无 pending 即可推进）
      if (job.type === "zpl" && job.orderNo) {
        const hasPending = [...printQueue.values()]
          .some(j => j !== job && j.type === "zpl" && j.orderNo === job.orderNo && j.status === "pending");
        if (!hasPending) {
          try {
            const orderEnc = encodeURIComponent(`"${job.orderNo}"`);
            const od = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${orderEnc}`);
            for (const rec of (od?.items || [])) {
              const wf = parseWorkflow(rec.fields["流程步骤"]);
              const adv = advanceWorkflow(wf, "labeled");
              if (adv.ok && !adv.skipped) {
                await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(adv.wf) });
              }
            }
          } catch (e) { console.error("⚠️ 工作流更新失败(labeled):", e.message); }
        }
      }

      setTimeout(() => printQueue.delete(id), 60_000);
      jsonRes(res, 200, { ok: true });
      return logReq(req, 200, start);
    }

    // GET /api/admin/print-queue — 队列状态（UI 用）
    if (pathname === "/api/admin/print-queue" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      let pending = 0, done = 0, error = 0;
      for (const j of printQueue.values()) {
        if (j.status === "pending") pending++;
        else if (j.status === "done") done++;
        else error++;
      }
      jsonRes(res, 200, { total: pending + done + error, pending, done, error });
      return logReq(req, 200, start);
    }

    // ── 工作流步骤 API ────────────────────────────────────────────────────────

    // GET /api/admin/workflow/:orderNo — 查询工作流状态
    const workflowMatch = pathname.match(/^\/api\/admin\/workflow\/([^/]+)$/);
    if (workflowMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNo = decodeURIComponent(workflowMatch[1]);
      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${encoded}`);
        const rec = (d?.items || [])[0];
        if (!rec) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }
        let wf = parseWorkflow(rec.fields["流程步骤"]);
        if (!wf.steps || Object.keys(wf.steps).length === 0) {
          const lastStep = STATUS_STEP_KEY[rec.fields["订单状态"]] || "submitted";
          const statusIdx = STEP_ORDER.indexOf(lastStep);
          wf = { current: statusIdx, steps: {} };
          for (let i = 0; i <= statusIdx; i++) {
            wf.steps[STEP_ORDER[i]] = { ts: i === 0 ? (rec.fields["下单日期"] || Date.now()) : null };
          }
        }
        // 补充标签显示
        const stepsWithLabels = {};
        for (const [k, v] of Object.entries(wf.steps || {})) {
          stepsWithLabels[k] = { ...v, label: STEP_LABELS[k] || k };
        }
        jsonRes(res, 200, {
          orderNo,
          current: wf.current || 0,
          currentLabel: STEP_LABELS[STEP_ORDER[wf.current || 0]] || "",
          steps: stepsWithLabels,
          stepOrder: STEP_ORDER,
          stepLabels: STEP_LABELS,
        });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // POST /api/admin/workflow/step — 推进工作流步骤
    if (pathname === "/api/admin/workflow/step" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const orderNo = (body.orderNo || "").trim();
      const step = (body.step || "").trim();
      if (!orderNo || !step) { jsonRes(res, 400, { error: "需要 orderNo 和 step" }); return logReq(req, 400, start); }
      if (!STEP_ORDER.includes(step)) { jsonRes(res, 400, { error: `未知步骤: ${step}，可选: ${STEP_ORDER.join(", ")}` }); return logReq(req, 400, start); }

      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${encoded}`);
        const rec = (d?.items || [])[0];
        if (!rec) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }

        const wf = parseWorkflow(rec.fields["流程步骤"]);
        const adv = advanceWorkflow(wf, step);
        if (!adv.ok) { jsonRes(res, 400, { error: adv.error }); return logReq(req, 400, start); }

        await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(adv.wf) });
        jsonRes(res, 200, { ok: true, orderNo, step, label: STEP_LABELS[step], current: adv.wf.current, skipped: adv.skipped || false });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // ── 自然语言搜索（纯代码解析，不依赖 AI）──────────────────────────────────
    if (pathname === "/api/admin/ai-search" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const query = (payload.query || "").trim();
      if (!query) { jsonRes(res, 400, { error: "请输入搜索内容" }); return logReq(req, 400, start); }

      const filters = {};
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;

      function fmtISO(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      }

      // 状态匹配
      if (/超期|逾期|晚了|慢了|积压/.test(query)) {
        // 不设 status，前端用超期筛选
      } else if (/待处理|未确认|待确认|pending/.test(query)) {
        filters.status = "待处理";
      } else if (/生产中|在做|生产|producing/.test(query)) {
        filters.status = "生产中";
      } else if (/已发货|已发|发货|shipped/.test(query)) {
        filters.status = "已发货";
      } else if (/已签收|签收|收到|received/.test(query)) {
        filters.status = "已签收";
      }

      // 日期匹配
      if (/今天|今日/.test(query)) {
        filters.from = todayStr;
        filters.to = todayStr;
      } else if (/昨天/.test(query)) {
        const d = new Date(now); d.setDate(d.getDate() - 1);
        filters.from = filters.to = fmtISO(d);
      } else if (/本周|这周/.test(query)) {
        const d = new Date(now);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1);
        filters.from = fmtISO(d);
        filters.to = todayStr;
      } else if (/上周/.test(query)) {
        const d = new Date(now);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1 - 7);
        filters.from = fmtISO(d);
        const e = new Date(d); e.setDate(e.getDate() + 6);
        filters.to = fmtISO(e);
      } else if (/本月|这个月/.test(query)) {
        filters.from = `${yyyy}-${mm}-01`;
        filters.to = todayStr;
      } else if (/上月|上个月/.test(query)) {
        const d = new Date(yyyy, now.getMonth() - 1, 1);
        const e = new Date(yyyy, now.getMonth(), 0);
        filters.from = fmtISO(d);
        filters.to = fmtISO(e);
      } else {
        // 匹配 "最近N天"
        const recentMatch = query.match(/最近(\d+)天/);
        if (recentMatch) {
          const d = new Date(now);
          d.setDate(d.getDate() - parseInt(recentMatch[1]));
          filters.from = fmtISO(d);
          filters.to = todayStr;
        }
        // 匹配月份 "3月" "三月"
        const monthMap = {"一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10,"十一":11,"十二":12};
        const monthMatch = query.match(/(\d{1,2}|一|二|三|四|五|六|七|八|九|十[一二]?)月/);
        if (monthMatch) {
          let m = parseInt(monthMatch[1]) || monthMap[monthMatch[1]];
          if (m >= 1 && m <= 12) {
            filters.from = `${yyyy}-${String(m).padStart(2,"0")}-01`;
            const lastDay = new Date(yyyy, m, 0).getDate();
            filters.to = `${yyyy}-${String(m).padStart(2,"0")}-${lastDay}`;
          }
        }
      }

      // 代理商匹配（模糊匹配）
      const allRecs = await listRecords(TABLES.order);
      const agentNames = [...new Set(allRecs.map(r => r.fields["代理商名称"]).filter(Boolean))];
      for (const name of agentNames) {
        if (query.includes(name)) {
          filters.agent = name;
          break;
        }
      }

      // 订单号或关键词匹配
      const orderNoMatch = query.match(/ORD-[A-Z0-9-]+/i);
      if (orderNoMatch) {
        filters.q = orderNoMatch[0].toUpperCase();
      } else if (!filters.status && !filters.from && !filters.agent) {
        // 纯文本搜索：可能是顾客名
        const cleaned = query.replace(/的|订单|显示|查找|找|搜索|查看|哪些|个/g, "").trim();
        if (cleaned.length > 0 && cleaned.length < 20) {
          filters.q = cleaned;
        }
      }

      if (Object.keys(filters).length === 0) {
        jsonRes(res, 200, { filters: { error: "无法理解查询内容，试试：待处理订单 / 深圳视力康 / 上周 / 超期" } });
      } else {
        jsonRes(res, 200, { filters });
      }
      return logReq(req, 200, start);
    }

    // ── AI 异常检测 ──────────────────────────────────────────────────────────────
    if (pathname === "/api/admin/ai-anomaly" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const allRecords = await listRecords(TABLES.order);
      const lensRecords = await listRecords(TABLES.lens_detail);
      const now = Date.now();
      const anomalies = [];

      // 1. 超期订单
      for (const r of allRecords) {
        const f = r.fields;
        const status = f["订单状态"] || "";
        const date = f["下单日期"];
        if (!date) continue;
        const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (status === "待处理" && days > 3) {
          anomalies.push({ type: "overdue", severity: "warning", orderNo: f["订单编号"], msg: `待处理 ${days} 天（标准≤3天）`, field: "订单状态" });
        }
        if (status === "生产中" && days > 7) {
          anomalies.push({ type: "overdue", severity: "danger", orderNo: f["订单编号"], msg: `生产中 ${days} 天（标准≤7天）`, field: "订单状态" });
        }
      }

      // 2. 处方异常检测
      const sphRanges = {}; // agentId → [min, max]
      const cylRanges = {};
      for (const r of lensRecords) {
        const f = r.fields;
        const agentId = f["代理商ID"] || "unknown";
        const sph = Number(f["球镜SPH"]) || 0;
        const cyl = Number(f["柱镜CYL"]) || 0;
        if (!sphRanges[agentId]) { sphRanges[agentId] = [sph, sph]; cylRanges[agentId] = [cyl, cyl]; }
        sphRanges[agentId][0] = Math.min(sphRanges[agentId][0], sph);
        sphRanges[agentId][1] = Math.max(sphRanges[agentId][1], sph);
        cylRanges[agentId][0] = Math.min(cylRanges[agentId][0], cyl);
        cylRanges[agentId][1] = Math.max(cylRanges[agentId][1], cyl);
      }

      // 检查极端值
      for (const r of lensRecords) {
        const f = r.fields;
        const sph = Number(f["球镜SPH"]) || 0;
        const cyl = Number(f["柱镜CYL"]) || 0;
        const orderNo = f["订单编号"] || "";
        const agentId = f["代理商ID"] || "unknown";

        if (Math.abs(sph) > 12) {
          anomalies.push({ type: "prescription", severity: "warning", orderNo, msg: `SPH ${sph} 超出常规范围(±12)，请确认处方`, field: "球镜SPH" });
        }
        if (Math.abs(cyl) > 4) {
          anomalies.push({ type: "prescription", severity: "warning", orderNo, msg: `CYL ${cyl} 超出常规范围(±4)，请确认处方`, field: "柱镜CYL" });
        }
        const axis = Number(f["轴位AXIS"]) || 0;
        if (cyl !== 0 && axis === 0) {
          anomalies.push({ type: "prescription", severity: "danger", orderNo, msg: `有柱镜值(${cyl})但轴位为0，请确认`, field: "轴位AXIS" });
        }
      }

      // 3. 重复镜片码检测
      const codeCount = {};
      for (const r of lensRecords) {
        const code = r.fields["镜片码"];
        if (code) { codeCount[code] = (codeCount[code] || 0) + 1; }
      }
      for (const [code, count] of Object.entries(codeCount)) {
        if (count > 1) {
          const related = lensRecords.filter(r => r.fields["镜片码"] === code).map(r => r.fields["订单编号"]);
          anomalies.push({ type: "duplicate", severity: "danger", orderNo: related[0], msg: `镜片码 ${code} 重复 ${count} 次（订单: ${[...new Set(related)].join(", ")}）`, field: "镜片码" });
        }
      }

      jsonRes(res, 200, { total: anomalies.length, anomalies: anomalies.slice(0, 50) });
      return logReq(req, 200, start);
    }

    // ── 数据问答（纯代码规则匹配）────────────────────────────────────────────
    if (pathname === "/api/admin/ai-qa" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const q = (payload.question || "").trim();
      if (!q) { jsonRes(res, 400, { error: "请输入问题" }); return logReq(req, 400, start); }

      const allRecords = await listRecords(TABLES.order);
      const now = Date.now();
      const orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          agent: f["代理商名称"] || "",
          sku: f["产品型号"] || "",
          qty: Number(f["数量"]) || 1,
          status: f["订单状态"] || "",
          date: f["下单日期"] || null,
        };
      });

      // 统计
      const statusCounts = {};
      let totalDays = 0, daysCount = 0;
      const agentCounts = {};
      const skuCounts = {};
      const overdueList = [];
      const monthCounts = {};

      for (const o of orders) {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        if (o.agent) agentCounts[o.agent] = (agentCounts[o.agent] || 0) + 1;
        if (o.sku) skuCounts[o.sku] = (skuCounts[o.sku] || 0) + o.qty;
        if (o.date) {
          const days = Math.floor((now - o.date) / (1000 * 60 * 60 * 24));
          totalDays += days; daysCount++;
          if ((o.status === "待处理" && days > 3) || (o.status === "生产中" && days > 7)) {
            overdueList.push({ orderNo: o.orderNo, status: o.status, days, agent: o.agent });
          }
          const d = new Date(o.date);
          const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
          monthCounts[mk] = (monthCounts[mk] || 0) + 1;
        }
      }

      const avgDays = daysCount ? Math.round(totalDays / daysCount) : 0;
      const nowDate = new Date();
      const thisMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,"0")}`;
      const thisMonthCount = monthCounts[thisMonthKey] || 0;

      // 排行榜
      const agentSorted = Object.entries(agentCounts).sort((a,b) => b[1]-a[1]);
      const skuSorted = Object.entries(skuCounts).sort((a,b) => b[1]-a[1]);

      let answer = "";

      // 规则匹配常见问题
      if (/总.*多少|共.*多少|多少.*订单|几单|订单.*量|订单.*数/.test(q)) {
        answer = `当前共 ${orders.length} 个订单。其中待处理 ${statusCounts["待处理"]||0}、生产中 ${statusCounts["生产中"]||0}、已发货 ${statusCounts["已发货"]||0}、已签收 ${statusCounts["已签收"]||0}。`;
      } else if (/本月|这个月|当月/.test(q) && /多少|几单|数量/.test(q)) {
        answer = `本月（${thisMonthKey}）新增 ${thisMonthCount} 单。`;
      } else if (/代理商.*多|谁.*多|排名|最多/.test(q)) {
        if (agentSorted.length > 0) {
          const top3 = agentSorted.slice(0, 3).map(([name, count], i) => `${i+1}. ${name}：${count}单`).join("；");
          answer = `代理商排名：${top3}。`;
        }
      } else if (/SKU|产品|型号|卖.*好|销量|热卖/.test(q)) {
        if (skuSorted.length > 0) {
          const top3 = skuSorted.slice(0, 3).map(([name, count], i) => `${i+1}. ${name}：${count}片`).join("；");
          answer = `SKU销量排名：${top3}。`;
        }
      } else if (/超期|逾期|积压|慢/.test(q)) {
        if (overdueList.length === 0) {
          answer = "当前没有超期订单，一切正常。";
        } else {
          const items = overdueList.slice(0, 5).map(o => `${o.orderNo}（${o.status} ${o.days}天）`).join("、");
          answer = `共 ${overdueList.length} 个超期订单：${items}${overdueList.length > 5 ? "等" : ""}。建议立即处理。`;
        }
      } else if (/平均.*天|交期|周期|周转/.test(q)) {
        answer = `平均订单天数 ${avgDays} 天（从下单到当前）。待处理平均待确认时间需结合具体数据分析。`;
      } else if (/待处理|未确认/.test(q)) {
        const pending = orders.filter(o => o.status === "待处理");
        const pendingOverdue = pending.filter(o => o.date && (now - o.date) > 3*86400000);
        answer = `待处理订单 ${pending.length} 个，其中 ${pendingOverdue.length} 个超期（>3天）。`;
      } else if (/生产中|在产|在做/.test(q)) {
        const producing = orders.filter(o => o.status === "生产中");
        const prodOverdue = producing.filter(o => o.date && (now - o.date) > 7*86400000);
        answer = `生产中订单 ${producing.length} 个，其中 ${prodOverdue.length} 个超期（>7天）。`;
      } else if (/已发货|发货/.test(q)) {
        answer = `已发货订单 ${statusCounts["已发货"]||0} 个。`;
      } else if (/已签收|签收/.test(q)) {
        answer = `已签收订单 ${statusCounts["已签收"]||0} 个。`;
      } else {
        answer = `可以问我：本月订单量多少 / 哪个代理商下单最多 / 哪个SKU卖得最好 / 超期订单有哪些 / 平均交期多少天 / 待处理订单。`;
      }

      jsonRes(res, 200, { question: q, answer });
      return logReq(req, 200, start);
    }

    // ── AI 智能建议 ──────────────────────────────────────────────────────────────
    if (pathname === "/api/admin/ai-suggest" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const allRecords = await listRecords(TABLES.order);
      const now = Date.now();
      const suggestions = [];

      const orders = allRecords.map(r => {
        const f = r.fields;
        return {
          orderNo: f["订单编号"] || "",
          customer: f["顾客姓名"] || "",
          agent: f["代理商名称"] || "",
          sku: f["产品型号"] || "",
          status: f["订单状态"] || "",
          date: f["下单日期"] || null,
          remark: f["备注"] || "",
        };
      });

      // 统计
      const overduePending = orders.filter(o => o.status === "待处理" && o.date && (now - o.date) > 3 * 86400000);
      const overdueProducing = orders.filter(o => o.status === "生产中" && o.date && (now - o.date) > 7 * 86400000);
      const pendingCount = orders.filter(o => o.status === "待处理").length;
      const producingCount = orders.filter(o => o.status === "生产中").length;
      const todayCount = orders.filter(o => {
        if (!o.date) return false;
        const d = new Date(o.date);
        const t = new Date();
        return d.toDateString() === t.toDateString();
      }).length;

      if (overduePending.length > 0) {
        suggestions.push({
          priority: "high",
          action: "批量确认超期待处理订单",
          detail: `${overduePending.length} 个待处理订单已超3天，建议立即确认进入生产`,
          orderNos: overduePending.slice(0, 20).map(o => o.orderNo),
          actionType: "confirm",
        });
      }
      if (overdueProducing.length > 0) {
        suggestions.push({
          priority: "high",
          action: "跟进超期生产订单",
          detail: `${overdueProducing.length} 个生产中订单已超7天，建议联系工厂确认进度`,
          orderNos: overdueProducing.slice(0, 20).map(o => o.orderNo),
          actionType: "follow-up",
        });
      }
      if (producingCount > 0) {
        suggestions.push({
          priority: "medium",
          action: "导出工厂包",
          detail: `${producingCount} 个生产中订单可导出ZIP给工厂`,
          actionType: "export-zip",
        });
      }
      if (pendingCount === 0 && producingCount === 0) {
        suggestions.push({
          priority: "low",
          action: "当前无待办",
          detail: `所有订单已处理完毕，今日新增 ${todayCount} 单`,
          actionType: "none",
        });
      }

      jsonRes(res, 200, { suggestions });
      return logReq(req, 200, start);
    }

    // ── Excel 处方解析 ─────────────────────────────────────────────────────────
    if (pathname === "/api/excel-parse" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const contentLength = parseInt(req.headers["content-length"] || "0");
      if (contentLength > 5 * 1024 * 1024) {
        jsonRes(res, 413, { error: "文件过大，请限制在 5MB 以内" });
        return logReq(req, 413, start);
      }

      const payload = await readBody(req);
      if (!payload.file?.data) {
        jsonRes(res, 400, { error: "请提供 Excel 文件" });
        return logReq(req, 400, start);
      }

      const result = await handleExcelUpload(payload.file);
      jsonRes(res, 200, result);
      return logReq(req, 200, start);
    }

    // ── Admin 控制中心 API ─────────────────────────────────────────────────

    // GET /api/admin/rules — 读取当前规则配置 + 元数据
    if (pathname === "/api/admin/rules" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      let config = {};
      try { config = JSON.parse(readFileSync(resolve(__dirname, "rules_config.json"), "utf-8")); } catch {}
      jsonRes(res, 200, { config, manifest: RULE_MANIFEST });
      return logReq(req, 200, start);
    }

    // POST /api/admin/rules — 更新单条规则参数
    if (pathname === "/api/admin/rules" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.rule || !body.param) { jsonRes(res, 400, { error: "需要 rule 和 param 字段" }); return logReq(req, 400, start); }
      const configPath = resolve(__dirname, "rules_config.json");
      let config = {};
      try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
      if (!config[body.rule]) config[body.rule] = {};
      config[body.rule][body.param] = body.value;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      jsonRes(res, 200, { ok: true, rule: body.rule, param: body.param, value: body.value });
      return logReq(req, 200, start);
    }

    // POST /api/admin/execute-rule — 执行业务规则（child_process）
    if (pathname === "/api/admin/execute-rule" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const rule = body.rule || "";
      if (!rule || !/^rule\d+$/.test(rule)) { jsonRes(res, 400, { error: "需要有效的 rule 编号，如 rule13" }); return logReq(req, 400, start); }
      const args = ["automations.js", rule];
      if (body.dryRun) args.push("--dry-run");
      if (body.fresh) args.push("--fresh");
      const t0 = Date.now();
      const child = spawn("node", args, { cwd: __dirname, timeout: 60000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", d => stdout += d);
      child.stderr.on("data", d => stderr += d);
      child.on("close", code => {
        const ms = Date.now() - t0;
        _execLog.unshift({ rule, ts: Date.now(), ms, exitCode: code, dryRun: !!body.dryRun, stdout: stdout.trim().slice(0, 500), stderr: stderr.trim().slice(0, 500) });
        if (_execLog.length > MAX_EXEC_LOG) _execLog.length = MAX_EXEC_LOG;
        jsonRes(res, 200, { rule, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, ms });
        logReq(req, 200, start);
      });
      child.on("error", err => {
        jsonRes(res, 500, { error: err.message, stdout: stdout.trim(), stderr: stderr.trim() });
        logReq(req, 500, start);
      });
      return;
    }

    // GET /api/admin/dashboard — 系统概览指标（2分钟缓存）
    if (pathname === "/api/admin/dashboard" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const now = Date.now();
      if (!_dashCache || (now - _dashCache.ts > 2 * 60 * 1000)) {
        const [stockRows, prodRows, agentRows, orderRows] = await Promise.all([
          listRecords(TABLES.stock_detail),
          listRecords(TABLES.production).catch(() => []),
          listRecords(TABLES.agent).catch(() => []),
          listRecords(TABLES.order).catch(() => []),
        ]);
        let totalStock = 0, belowSafety = 0;
        const skuStats = {};
        const topDeficits = [];
        for (const r of stockRows) {
          const stock = Number(r.fields["当前库存"] || 0);
          const safety = Number(r.fields["安全库存"] || 0);
          const sku = r.fields["SKU编号"] || "未知";
          totalStock += stock;
          if (!skuStats[sku]) skuStats[sku] = { stock: 0, safety: 0, below: 0, total: 0 };
          skuStats[sku].stock += stock;
          skuStats[sku].safety += safety;
          skuStats[sku].total++;
          if (stock < safety) {
            belowSafety++;
            skuStats[sku].below++;
            topDeficits.push({ sku, sph: r.fields["SPH"], cyl: r.fields["CYL"], stock, safety, gap: safety - stock });
          }
        }
        topDeficits.sort((a, b) => b.gap - a.gap);
        const prodStatus = {};
        for (const r of prodRows) {
          const s = r.fields["状态"] || "未知";
          prodStatus[s] = (prodStatus[s] || 0) + 1;
        }
        const pendingReplenish = prodRows.filter(r => r.fields["回补状态"] === "待回补").length;
        const recentOrders = prodRows
          .sort((a, b) => (b.fields["预计完成日"] || 0) - (a.fields["预计完成日"] || 0))
          .slice(0, 10)
          .map(r => ({
            工单号: r.fields["工单号"] || "",
            产品型号: r.fields["产品型号"] || "",
            SPH: r.fields["SPH"],
            CYL: r.fields["CYL"],
            建议产量: r.fields["建议产量"],
            状态: r.fields["状态"],
            预计完成日: r.fields["预计完成日"],
          }));

        // 订单指标
        const orderMetrics = { total: orderRows.length, byStatus: {}, todayCount: 0, overdue: 0 };
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayTs = todayStart.getTime();
        const OVERDUE_MS = 24 * 60 * 60 * 1000;
        for (const r of orderRows) {
          const st = r.fields["订单状态"] || "未知";
          orderMetrics.byStatus[st] = (orderMetrics.byStatus[st] || 0) + 1;
          const date = r.fields["下单日期"];
          if (date && date >= todayTs) orderMetrics.todayCount++;
          if (st === "待处理" && date && (now - date > OVERDUE_MS)) orderMetrics.overdue++;
        }

        // 打印队列状态
        let printPending = 0, printDone = 0, printError = 0;
        for (const j of printQueue.values()) {
          if (j.status === "pending") printPending++;
          else if (j.status === "done") printDone++;
          else printError++;
        }

        // 告警汇总（从各数据源聚合）
        const alerts = [];
        if (orderMetrics.overdue > 0) alerts.push({ level: "error", icon: "📋", msg: `${orderMetrics.overdue} 个订单超24h未处理`, ts: now });
        const p = orderMetrics.byStatus["待处理"] || 0;
        if (p > 20) alerts.push({ level: "warn", icon: "📋", msg: `待处理订单积压 ${p} 单`, ts: now });
        if (belowSafety > 0) alerts.push({ level: "warn", icon: "📦", msg: `${belowSafety} 个度数低于安全库存`, ts: now });
        if (pendingReplenish > 0) alerts.push({ level: "warn", icon: "🏭", msg: `${pendingReplenish} 个排产单待回补`, ts: now });
        if (printError > 0) alerts.push({ level: "error", icon: "🖨", msg: `${printError} 个打印任务失败`, ts: now });
        alerts.sort((a, b) => (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1));

        _dashCache = { ts: now, data: {
          totalStock, belowSafety, totalStockRows: stockRows.length,
          prodStatus, pendingReplenish, agentCount: agentRows.length,
          recentOrders, skuStats, topDeficits: topDeficits.slice(0, 15),
          orderMetrics, printQueue: { pending: printPending, done: printDone, error: printError },
          alerts,
        }};
      }
      jsonRes(res, 200, { ..._dashCache.data, cached: now - _dashCache.ts < 1000 ? false : true, cacheAge: Math.round((now - _dashCache.ts) / 1000) });
      return logReq(req, 200, start);
    }

    // POST /api/admin/ai-chat — AI Agent 对话
    if (pathname === "/api/admin/ai-chat" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.message) { jsonRes(res, 400, { error: "需要 message 字段" }); return logReq(req, 400, start); }
      let config = {};
      try { config = JSON.parse(readFileSync(resolve(__dirname, "rules_config.json"), "utf-8")); } catch {}
      const systemPrompt = `你是眼镜库存管理系统的 AI 助手，深度理解以下业务规则和数据模型。

## 系统架构
三系统：CRM（客户管理）→ 订单系统（下单/物流/验真）→ 库存系统（度数级库存/排产/寄售）
存储：飞书多维表格 Bitable，无自建 DB
技术栈：Node.js + 原生 HTML，端口 3210

## 14 条业务规则
${Object.entries(RULE_MANIFEST).map(([k, v]) => {
  const cfg = config[k] || {};
  const paramStr = Object.entries(v.params).map(([pk, pv]) => `  - ${pv.label}(${pk}): ${cfg[pk] ?? "未设置"}`).join("\n");
  return `### ${k}: ${v.name}\n${v.desc}${paramStr ? "\n当前配置:\n" + paramStr : "\n无可配参数"}`;
}).join("\n\n")}

## 数据模型
- stock_detail (度数级库存): SKU × SPH × CYL 唯一组合，字段：当前库存、安全库存、最近出库
- production (排产表): 工单号=SKU|SPH|CYL|日期，状态=待确认/生产中/完成
- stock_plan (备库参数): SPH × CYL 占比，公式：理论备库 = max(ceil(月预测 × 季节系数 × 2 × 占比), 1)
- blank_inventory (毛坯库存): 批次级，SKU × CYL
- mold (模具台账): 单模，总寿命/已使用/剩余寿命
- agent_stock (代理商库存): 自有/寄售分拆
- consignment_ledger (寄售流水): 入库/消耗/到期转收入
7 SKU: Ultra双效, D8, 时空之眼A/B/PRO/MAX, 小旋风
度数范围: SPH 0~-6.00, CYL 0~-2.00, 步长 0.25
交期三档: 有货1-2天 / 排产5-7天 / 定制7-10天

## 你的能力
- 解释规则含义和影响
- 建议参数调整方案
- 分析库存和排产数据
- 帮助诊断问题
回答简明扼要，中文。`;
      const reply = await callMiMo(systemPrompt, body.message);
      jsonRes(res, 200, { reply });
      return logReq(req, 200, start);
    }

    // ── 库存管理系统 API ──

    // POST /api/admin/stock-movement — 提交出入库单据
    if (pathname === "/api/admin/stock-movement" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.type || !body.source || !Array.isArray(body.lines) || !body.lines.length) {
        jsonRes(res, 400, { error: "需要 type/source/lines 字段" }); return logReq(req, 400, start);
      }
      if (!["入库", "出库"].includes(body.type)) {
        jsonRes(res, 400, { error: "type 必须是 入库 或 出库" }); return logReq(req, 400, start);
      }
      const validSources = body.type === "入库"
        ? ["采购到货", "生产回补", "退货退回", "盘点补录"]
        : ["订单发货", "报废损耗", "调拨出库", "盘点差异"];
      if (!validSources.includes(body.source)) {
        jsonRes(res, 400, { error: `来源去向无效: ${body.source}` }); return logReq(req, 400, start);
      }
      const docNo = `MOV-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomBytes(2).toString("hex").toUpperCase()}`;
      const stockMap = await getStockMap();
      const results = [];
      const movementRecords = [];
      for (const line of body.lines) {
        if (!line.sku || line.sph == null || line.cyl == null || !line.qty || line.qty <= 0) {
          jsonRes(res, 400, { error: "行数据不完整: 需要 sku/sph/cyl/qty(>0)" }); return logReq(req, 400, start);
        }
        const key = `${line.sku}|${Number(line.sph).toFixed(2)}|${Number(line.cyl).toFixed(2)}`;
        await withLock(key, async () => {
          const info = stockMap.get(key);
          if (!info) {
            results.push({ sku: line.sku, sph: line.sph, cyl: line.cyl, error: "库存记录不存在" });
            return;
          }
          // 锁内 fresh read — 只 GET 单条记录（同 deductStockDetail 模式）
          const freshData = await feishuApi("GET",
            `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/${info.recordId}`
          );
          const oldStock = Number(freshData?.record?.fields?.["当前库存"]) || 0;
          const newStock = body.type === "入库" ? oldStock + line.qty : Math.max(0, oldStock - line.qty);
          await updateRecord(TABLES.stock_detail, info.recordId, { "当前库存": newStock });
          results.push({ sku: line.sku, sph: line.sph, cyl: line.cyl, oldStock, newStock, qty: line.qty });
          movementRecords.push({ fields: {
            "单据号": docNo, "类型": body.type, "来源去向": body.source,
            "SKU编号": line.sku, "SPH": Number(line.sph), "CYL": Number(line.cyl),
            "数量": line.qty, "变动前库存": oldStock, "变动后库存": newStock,
            "关联单号": body.refNo || "", "备注": body.note || "", "操作人": "admin",
          }});
        });
      }
      clearStockCache();
      let batchOk = true;
      if (movementRecords.length) {
        batchOk = await batchCreateRecords(TABLES.stock_movement, movementRecords);
        if (!batchOk) console.error(`  ⚠️ 流水写入失败: ${docNo} (${movementRecords.length} 行)`);
      }
      console.log(`  库存单据 ${docNo}: ${body.type}/${body.source}, ${movementRecords.length} 行`);
      jsonRes(res, batchOk ? 200 : 500, { ok: batchOk, docNo, results });
      return logReq(req, batchOk ? 200 : 500, start);
    }

    // GET /api/admin/stock-movements — 流水列表（按单据号聚合）
    if (pathname === "/api/admin/stock-movements" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const type = url.searchParams.get("type");
      const { page, pageSize } = parsePagination(url);
      let records = await listRecords(TABLES.stock_movement);
      if (type) records = records.filter(r => r.fields["类型"] === type);
      records.sort((a, b) => (b.fields["创建时间"] || 0) - (a.fields["创建时间"] || 0));
      const docMap = {};
      for (const r of records) {
        const d = r.fields["单据号"] || "未知";
        if (!docMap[d]) docMap[d] = { docNo: d, type: r.fields["类型"], source: r.fields["来源去向"],
          note: r.fields["备注"], time: r.fields["创建时间"], lines: 0, totalQty: 0 };
        docMap[d].lines++;
        docMap[d].totalQty += Number(r.fields["数量"] || 0);
      }
      const docs = Object.values(docMap).sort((a, b) => (b.time || 0) - (a.time || 0));
      const total = docs.length;
      const items = docs.slice((page - 1) * pageSize, page * pageSize);
      jsonRes(res, 200, { total, page, pageSize, items });
      return logReq(req, 200, start);
    }

    // GET /api/admin/stock-movement/:docNo — 单据详情
    if (pathname.startsWith("/api/admin/stock-movement/") && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const docNo = decodeURIComponent(pathname.slice("/api/admin/stock-movement/".length));
      const records = await listRecords(TABLES.stock_movement);
      const lines = records.filter(r => r.fields["单据号"] === docNo).map(r => ({
        sku: r.fields["SKU编号"], sph: r.fields["SPH"], cyl: r.fields["CYL"],
        qty: r.fields["数量"], oldStock: r.fields["变动前库存"], newStock: r.fields["变动后库存"],
      }));
      jsonRes(res, 200, { docNo, lines });
      return logReq(req, 200, start);
    }

    // GET /api/admin/stock-detail — 库存列表（筛选+分页）
    if (pathname === "/api/admin/stock-detail" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const sku = url.searchParams.get("sku");
      const search = url.searchParams.get("search");
      const { page, pageSize } = parsePagination(url);
      let rows = await listRecords(TABLES.stock_detail);
      let items = rows.map(r => {
        const f = r.fields || {};
        return { recordId: r.record_id, sku: f["SKU编号"] || "", sph: f["SPH"], cyl: f["CYL"],
          currentStock: Number(f["当前库存"] || 0), safetyStock: Number(f["安全库存"] || 0),
          lastOutbound: f["最近出库"] };
      });
      if (sku) items = items.filter(i => i.sku === sku);
      if (search) {
        const s = search.toLowerCase();
        items = items.filter(i => i.sku.toLowerCase().includes(s) ||
          String(i.sph).includes(s) || String(i.cyl).includes(s));
      }
      const total = items.length;
      const totalStock = items.reduce((s, i) => s + i.currentStock, 0);
      const belowSafety = items.filter(i => i.currentStock < i.safetyStock).length;
      const skuBreakdown = {};
      for (const i of items) {
        if (!skuBreakdown[i.sku]) skuBreakdown[i.sku] = { stock: 0, total: 0 };
        skuBreakdown[i.sku].stock += i.currentStock;
        skuBreakdown[i.sku].total++;
      }
      items.sort((a, b) => a.sku.localeCompare(b.sku) || (a.sph || 0) - (b.sph || 0) || (a.cyl || 0) - (b.cyl || 0));
      const paged = items.slice((page - 1) * pageSize, page * pageSize);
      jsonRes(res, 200, { total, page, pageSize, items: paged, summary: { totalStock, belowSafety, skuBreakdown } });
      return logReq(req, 200, start);
    }

    // GET /api/admin/production-orders — 排产工单列表
    if (pathname === "/api/admin/production-orders" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const status = url.searchParams.get("status");
      const sku = url.searchParams.get("sku");
      const { page, pageSize } = parsePagination(url);
      let rows = await listRecords(TABLES.production);
      let items = rows.map(r => {
        const f = r.fields || {};
        return { recordId: r.record_id, workOrderNo: f["工单号"] || "", sku: f["产品型号"] || "",
          sph: f["SPH"], cyl: f["CYL"], suggestedOutput: f["建议产量"],
          status: f["状态"] || "", estimatedCompletion: f["预计完成日"],
          replenishmentStatus: f["回补状态"] || "" };
      });
      if (status && status !== "all") items = items.filter(i => i.status === status);
      if (sku) items = items.filter(i => i.sku === sku);
      items.sort((a, b) => (b.estimatedCompletion || 0) - (a.estimatedCompletion || 0));
      const total = items.length;
      const paged = items.slice((page - 1) * pageSize, page * pageSize);
      jsonRes(res, 200, { total, page, pageSize, items: paged });
      return logReq(req, 200, start);
    }

    // POST /api/admin/production-orders/update — 更新工单状态
    if (pathname === "/api/admin/production-orders/update" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.recordId || !body.status) {
        jsonRes(res, 400, { error: "需要 recordId/status 字段" }); return logReq(req, 400, start);
      }
      const validStatuses = ["待确认", "生产中", "完成"];
      if (!validStatuses.includes(body.status)) {
        jsonRes(res, 400, { error: `状态必须是: ${validStatuses.join("/")}` }); return logReq(req, 400, start);
      }
      const fields = { "状态": body.status };
      if (body.status === "完成") fields["实际完成日"] = Date.now();
      await updateRecord(TABLES.production, body.recordId, fields);
      jsonRes(res, 200, { ok: true, recordId: body.recordId, newStatus: body.status });
      return logReq(req, 200, start);
    }

    // GET /api/admin/blank-inventory — 毛坯库存列表
    if (pathname === "/api/admin/blank-inventory" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const sku = url.searchParams.get("sku");
      let rows = await listRecords(TABLES.blank_inventory);
      let items = rows.map(r => {
        const f = r.fields || {};
        return { recordId: r.record_id, batchNo: f["批次号"] || "", sku: f["SKU编号"] || "",
          cyl: f["CYL档位"], quantity: f["数量"], consumed: f["已消耗"],
          arrivalDate: f["到货日期"], status: f["状态"] || "" };
      });
      if (sku) items = items.filter(i => i.sku === sku);
      jsonRes(res, 200, { total: items.length, items });
      return logReq(req, 200, start);
    }

    // GET /api/admin/mold — 模具台账列表
    if (pathname === "/api/admin/mold" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const sku = url.searchParams.get("sku");
      let rows = await listRecords(TABLES.mold);
      let items = rows.map(r => {
        const f = r.fields || {};
        return { recordId: r.record_id, moldId: f["模具编号"] || "", sku: f["SKU编号"] || "",
          totalLife: f["总寿命"], used: f["已使用"], remaining: f["剩余寿命"],
          status: f["状态"] || "" };
      });
      if (sku) items = items.filter(i => i.sku === sku);
      jsonRes(res, 200, { total: items.length, items });
      return logReq(req, 200, start);
    }

    // GET /api/admin/agent-stock-admin — 全代理商库存列表
    if (pathname === "/api/admin/agent-stock-admin" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const agentId = url.searchParams.get("agentId");
      const sku = url.searchParams.get("sku");
      let rows = await listRecords(TABLES.agent_stock);
      let items = rows.map(r => {
        const f = r.fields || {};
        return { recordId: r.record_id, agentId: f["agent_id"] || "", sku: f["SKU编号"] || "",
          sph: f["SPH"], cyl: f["CYL"], ownedStock: Number(f["自有库存"] || 0),
          consignedStock: Number(f["寄售库存"] || 0), consignDate: f["寄售日期"] };
      });
      if (agentId) items = items.filter(i => i.agentId === agentId);
      if (sku) items = items.filter(i => i.sku === sku);
      jsonRes(res, 200, { total: items.length, items });
      return logReq(req, 200, start);
    }

    if (pathname === "/api/admin/alerts" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const alerts = [];
      const now = Date.now();
      const OVERDUE_MS = 24 * 60 * 60 * 1000;
      const [orderRows, stockRows, prodRows] = await Promise.all([
        listRecords(TABLES.order).catch(e => { console.error("[alerts] order scan failed:", e.message); return []; }),
        listRecords(TABLES.stock_detail).catch(e => { console.error("[alerts] stock scan failed:", e.message); return []; }),
        listRecords(TABLES.production).catch(e => { console.error("[alerts] production scan failed:", e.message); return []; }),
      ]);
      for (const r of orderRows) {
        if (alerts.length >= 50) break;
        if (r.fields["订单状态"] === "待处理" && r.fields["下单日期"] && (now - r.fields["下单日期"] > OVERDUE_MS)) {
          const age = Math.round((now - r.fields["下单日期"]) / 3600000);
          alerts.push({ level: "error", icon: "📋", msg: `${r.fields["订单编号"]} ${r.fields["顾客姓名"]} 超期${age}h (${r.fields["代理商名称"]})`, ts: now });
        }
      }
      let belowCount = 0;
      for (const r of stockRows) {
        if (Number(r.fields["当前库存"] || 0) < Number(r.fields["安全库存"] || 0)) belowCount++;
      }
      if (belowCount > 0) alerts.push({ level: "warn", icon: "📦", msg: `${belowCount} 个度数组合低于安全库存`, ts: now });
      const pending = prodRows.filter(r => r.fields["回补状态"] === "待回补").length;
      if (pending > 0) alerts.push({ level: "warn", icon: "🏭", msg: `${pending} 个排产单待回补`, ts: now });
      const failedExecs = _execLog.filter(e => e.exitCode !== 0).slice(0, 5);
      for (const e of failedExecs) {
        alerts.push({ level: "error", icon: "⚙️", msg: `${e.rule} 执行失败 (exit ${e.exitCode})`, ts: e.ts });
      }
      alerts.sort((a, b) => {
        const lv = (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1);
        return lv !== 0 ? lv : b.ts - a.ts;
      });
      jsonRes(res, 200, { total: alerts.length, alerts });
      return logReq(req, 200, start);
    }

    if (pathname === "/api/admin/execution-history" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
      jsonRes(res, 200, { total: _execLog.length, items: _execLog.slice(0, limit) });
      return logReq(req, 200, start);
    }

    // ── 404 ──
    jsonRes(res, 404, { error: "Not found" });
    logReq(req, 404, start);

  } catch (err) {
    console.error("Server error:", err);
    jsonRes(res, 500, { error: "服务器内部错误" });
    logReq(req, 500, start);
  }
});

// ─── 公共订单过滤函数（避免三处重复逻辑）────────────────────────────────────
function applyOrderFilters(orders, { filterStatus, filterSku, filterFrom, filterTo, filterSearch, filterAgent, filterQ } = {}) {
  if (filterStatus) orders = orders.filter(o => o.status === filterStatus);
  if (filterSku) orders = orders.filter(o => o.sku === filterSku);
  if (filterAgent) orders = orders.filter(o => o.agentName === filterAgent);
  if (filterFrom) {
    const fromTs = new Date(filterFrom).getTime();
    if (!isNaN(fromTs)) orders = orders.filter(o => o.date && o.date >= fromTs);
  }
  if (filterTo) {
    const toTs = new Date(filterTo + "T23:59:59").getTime();
    if (!isNaN(toTs)) orders = orders.filter(o => o.date && o.date <= toTs);
  }
  const q = filterSearch || filterQ || "";
  if (q) {
    const s = q.trim().toLowerCase();
    orders = orders.filter(o =>
      o.orderNo.toLowerCase().includes(s) ||
      (o.customerName || "").toLowerCase().includes(s)
    );
  }
  return orders;
}

const _reqLog = [];
function logReq(req, status, start) {
  const line = `${req.method} ${req.url} → ${status} (${Date.now() - start}ms)`;
  console.log(`  ${line}`);
  _reqLog.push(line);
  if (_reqLog.length > 500) _reqLog.shift();
}

server.listen(PORT, () => {
  console.log(`\n🚀 代理商门户启动: http://localhost:${PORT}`);
  console.log(`   下单页: http://localhost:${PORT}/order?t=<token>`);
  console.log(`   追踪页: http://localhost:${PORT}/track?t=<token>`);
  console.log(`\n   按 Ctrl+C 停止\n`);
});
