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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { spawn } from "child_process";
import QRCode from "qrcode";
import XLSX from "xlsx";
import { TABLES } from "./shared/tables.js";
import * as feishuMod from "./lib/feishu.js";
import * as printerMod from "./lib/printer.js";
import * as notifyMod from "./lib/notify.js";
import * as stockMod from "./lib/stock.js";
import * as stockResolverMod from "./lib/stock-resolver.js";
import * as stateRouterMod from "./lib/state-router.js";
import { rawVal, fmt, fmtAxis, parsePagination } from "./lib/helpers.js";
import * as templatesMod from "./lib/templates.js";
import { buildFactoryExcel, buildZipBuffer, buildLabelExportExcel } from "./lib/factory-export.js";
import * as batchImportMod from "./lib/batch-import.js";
import { genOrderNo as genMergeOrderNo, buildMergeOrderRecords, buildMergeLensRecords } from "./lib/batch-merge.js";
import { checkExportStatus, logExport, getOrderExportStatus, listExportLogs } from "./lib/export-log.js";
import { getAgentAnnualVolume, calculateStarTrail, calculateStarTier, getECPLeaderboard } from "./lib/starmap-aggregator.js";
import { lookupBySphCyl, lookupBySerial, getAllEntries, getSupportedSkus } from "./lib/sku-serial.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;
const BASE = "https://open.feishu.cn/open-apis";
const QR_DIR = resolve(__dirname, "public", "qrcodes");
const DRAFTS_DIR = resolve(__dirname, "drafts");
const DRAFT_SYNC_INTERVAL = 2 * 60 * 1000; // 后台轮询间隔 2 分钟
const DRAFT_AGE_MIN = 3 * 60 * 1000;        // 草稿创建至少 3 分钟后才同步（代理商编辑窗口）

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

// ─── 模块导入 ──────────────────────────────────────────────────────────

const { feishuApi, listRecords, filterRecords, searchRecords, createRecord, batchCreateRecords, updateRecord, batchUpdateRecords, getFeishuToken } = feishuMod;
const { loadPrinterConfig, savePrinterConfig, buildZpl, buildTestZpl, sendTcpZpl, sendZplToPrinter } = printerMod;
const { sendNotify, sendFeishuCard, shipCard, deliveredCard } = notifyMod;
const { getStockMap, clearStockCache, deductStockDetail, reserveStock, releaseReservation, convertReservation, getAgentStockMap, estimateDeliveryByRx, deductAgentStock, queryStockByRx } = stockMod;
const { resolveStock } = stockResolverMod;
const { routeConfirm, summarizeStock } = stateRouterMod;
const { slipHTML, buildLabelHtml, buildLabelHtmlFromFields, buildPrintPage, picklistHTML, binSortKey } = templatesMod;

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

  // 2. 找表头行（包含"顾客姓名"或"姓名"或"眼别"的行）
  let headerIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    if (allRows[i].some(c => { const s = String(c || ""); return s.includes("顾客姓名") || s.includes("客户姓名") || s === "姓名" || s.includes("眼别"); })) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    // 兜底：用第一行当表头
    headerIdx = 0;
  }

  const headers = allRows[headerIdx].map(c => String(c || "").trim());

  // 列名模糊匹配表（规范名 → 可接受变体，来自 excel_merger.py COLUMN_ALIASES）
  const COLUMN_ALIASES = {
    "顾客姓名": ["顾客姓名","姓名","患者姓名","客户姓名","配镜人","name"],
    "眼别":     ["眼别","眼","左右眼","OD/OS","eye"],
    "球镜SPH":  ["球镜SPH","球镜","SPH","S","sph","近视","度数"],
    "柱镜CYL":  ["柱镜CYL","柱镜","CYL","C","cyl","散光"],
    "轴位AXIS": ["轴位AXIS","轴位","轴向","AXIS","A","axis","轴"],
    "产品型号": ["产品型号","型号","产品","SKU","product"],
    "数量":     ["数量","数量(片)","数量（副）","片数","副数","qty"],
    "代理商名称":["代理商名称","代理商","经销商","dealer"],
    "终端门店": ["终端门店","终端客户","客户","门店","机构"],
    "联系人":   ["联系人","收件人","收货人"],
    "联系电话": ["联系电话","电话","手机","phone"],
    "收货地址": ["收货地址","地址","送货地址","address"],
    "备注":     ["备注","说明","remark","特殊要求"],
  };

  // 规范化列名：将 headers 映射为规范名称 → 列索引（大小写不敏感）
  const canonIndex = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (aliases.some(a => a.toLowerCase() === h)) {
        canonIndex[canonical] = i;
        break;
      }
    }
  }

  // 模糊匹配列（支持多别名，大小写不敏感）
  const findCol = (...names) => {
    // 优先从 canonIndex 查找匹配
    for (const name of names) {
      const nl = name.toLowerCase();
      for (const [canonical, idx] of Object.entries(canonIndex)) {
        const aliases = COLUMN_ALIASES[canonical] || [];
        if (canonical.toLowerCase() === nl || aliases.some(a => a.toLowerCase() === nl)) {
          return idx;
        }
      }
    }
    // 兜底：模糊匹配（startsWith / includes）
    for (const name of names) {
      const nl = name.toLowerCase();
      let idx = headers.findIndex(h => h.toLowerCase() === nl);
      if (idx >= 0) return idx;
      idx = headers.findIndex(h => h.toLowerCase().startsWith(nl) || h.toLowerCase().includes(nl));
      if (idx >= 0) return idx;
    }
    return -1;
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

    const get = (...names) => {
      const idx = findCol(...names);
      return idx >= 0 ? row[idx] : undefined;
    };

    const customerName = String(get("顾客姓名", "姓名", "客户姓名", "配镜人") || "").trim();
    const eye = String(get("眼别", "眼", "左右眼") || "").trim();

    // 跳过有眼别但无任何度数的行（Excel 空行模板）
    const _sph = get("球镜", "SPH", "球镜SPH", "近视", "度数");
    const _cyl = get("柱镜", "CYL", "柱镜CYL", "散光");
    const _axis = get("轴位", "AXIS", "轴位AXIS", "轴");
    if (eye && (_sph == null || String(_sph).trim() === "") && (_cyl == null || String(_cyl).trim() === "") && (_axis == null || String(_axis).trim() === "")) continue;
    const productModel = String(get("产品型号", "型号", "产品", "SKU") || "").trim();
    const sph = get("球镜", "SPH", "球镜SPH", "近视", "度数");
    const cyl = get("柱镜", "CYL", "柱镜CYL", "散光");
    const axis = get("轴位", "AXIS", "轴位AXIS", "轴");
    const qty = get("数量（副）", "数量", "副数", "片数") || 1;
    const remark = String(get("备注", "说明", "特殊要求") || "").trim();
    const contact = String(get("联系人", "收货人") || "").trim();
    const phone = String(get("联系电话", "电话", "手机") || "").trim();
    const address = String(get("收货地址", "地址", "送货地址") || "").trim();

    // 填充顾客姓名（Excel 中同组可能只填第一行）
    const name = customerName || lastCustomerName;
    if (customerName) lastCustomerName = customerName;

    // 跳过备注行、合计行等非患者数据行
    if (customerName && /^(备注|合计|客户名称|下单日期|收货地址|联系人|电话)/.test(customerName)) continue;

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

    // 查找已有患者或新建（同名+同型号+眼别不冲突 → 合并双眼；否则新建 patient）
    let patient = null;
    if (productModel) {
      for (let i = patients.length - 1; i >= 0; i--) {
        const p = patients[i];
        if (p.customerName !== name || p.sku !== productModel) continue;
        if (!eye) { patient = p; break; }
        const existingSides = p.eyes.map(e => e.side);
        if (!existingSides.includes(eye)) { patient = p; break; }
        break;
      }
    }
    if (!patient && !productModel) {
      // 空产品型号（延续行）→ 匹配同名最新患者
      for (let i = patients.length - 1; i >= 0; i--) {
        if (patients[i].customerName === name) { patient = patients[i]; break; }
      }
    }
    if (!patient) {
      const pairIndex = patients.filter(p => p.customerName === name).length + 1;
      patient = { customerName: name, sku: productModel, quantity: Number(qty) || 1, eyes: [], assembly: false, remark: "", pairIndex };
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

  // 统一眼别排序：右眼在前，左眼在后
  for (const p of patients) {
    p.eyes.sort((a, b) => (a.side === "右眼" ? 0 : 1) - (b.side === "右眼" ? 0 : 1));
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
  if (Date.now() - _agentsCacheTime < 300000 && _agentsCache) return _agentsCache;
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
        yearly_target: Number(r.fields["年度目标"] || 0),
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
  const tokenBuf = Buffer.from(token);
  for (const a of agents) {
    const aBuf = Buffer.from(a.token || "");
    if (aBuf.length !== tokenBuf.length) continue;
    if (timingSafeEqual(aBuf, tokenBuf)) return a;
  }
  return null;
}

// ─── 飞书 API ───────────────────────────────────────────────────────────────


// ─── SKU + 库存缓存 ──────────────────────────────────────────────────────────

// 产品目录硬编码（一年更新一次，改这里即可）
const SKU_CATALOG = [
  { sku: "Ultra双效", name: "Ultra双效" },
  { sku: "D8", name: "D8" },
  { sku: "时空之眼A", name: "时空之眼A" },
  { sku: "时空之眼B", name: "时空之眼B" },
  { sku: "时空之眼PRO", name: "时空之眼PRO" },
  { sku: "时空之眼MAX", name: "时空之眼MAX" },
  { sku: "小旋风", name: "小旋风" },
];

async function getSkusWithInventory() {
  return SKU_CATALOG;
}

// ─── 库存条码 ──────────────────────────────────────────────────────────────
const SKU_ABBR = {
  ULT: "Ultra双效", D8: "D8",
  TKAA: "时空之眼A", TKAB: "时空之眼B",
  TKAP: "时空之眼PRO", TKAM: "时空之眼MAX",
  XFJ: "小旋风",
};
const SKU_ABBR_INV = Object.fromEntries(Object.entries(SKU_ABBR).map(([k, v]) => [v, k]));

function decodeBarcode(str) {
  const parts = str.toUpperCase().split("-");
  if (parts.length < 3) return null;
  const cylCode = parts.pop();
  const sphCode = parts.pop();
  const abbr = parts.join("-");
  const sku = SKU_ABBR[abbr];
  if (!sku) return null;
  const sph = -parseInt(sphCode, 10) / 100;
  const cyl = -parseInt(cylCode, 10) / 100;
  if (!Number.isFinite(sph) || !Number.isFinite(cyl)) return null;
  return { sku, sph, cyl };
}

function encodeBarcode(sku, sph, cyl) {
  const abbr = SKU_ABBR_INV[sku] || sku.replace(/\W/g, "").toUpperCase().slice(0, 4);
  const sphCode = String(Math.round(Math.abs(Number(sph)) * 100)).padStart(3, "0");
  const cylCode = String(Math.round(Math.abs(Number(cyl)) * 100)).padStart(3, "0");
  return `${abbr}-${sphCode}-${cylCode}`;
}

// ─── 产品级 SKU 过滤（无空格 = 产品级，有空格 = 处方级） ──────────────────────

function getModelSkus(allSkus) {
  return allSkus.filter(s => !s.sku.includes(" "));
}

// ─── 共用辅助函数（rawVal/fmt/fmtAxis/parsePagination 已移至 lib/helpers.js）──

async function findOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const d = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${encoded}`
  );
  return (d?.items || [])[0] || null;
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

// ─── 模块初始化（依赖 fmt/withLock，必须在它们之后）────────────────────────

feishuMod.init({ base: BASE, appToken: APP_TOKEN, env: ENV });
printerMod.init({
  configPath: resolve(__dirname, "printer_config.json"),
  serverBaseUrl: () => ENV.SERVER_BASE_URL || `http://localhost:${PORT}`,
  fmtFn: fmt, fmtAxisFn: fmtAxis,
});
notifyMod.init({ env: ENV });
stockMod.init({ feishuApi, listRecords, filterRecords, withLock, tables: TABLES, appToken: APP_TOKEN, stdSphRange: STD_SPH_RANGE, stdCylRange: STD_CYL_RANGE });
stockResolverMod.init({ getStockMap, stdSphRange: STD_SPH_RANGE, stdCylRange: STD_CYL_RANGE });
templatesMod.init({ getServerBaseUrl: () => ENV.SERVER_BASE_URL || `http://localhost:${PORT}` });

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

// ─── 批量发货存储 ───────────────────────────────────────────────────────────
const BULK_DIR = resolve(DRAFTS_DIR, "bulk");

function genBulkNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = randomBytes(3).toString("hex").toUpperCase();
  return `BLK-${d}-${r}`;
}

function saveBulk(data) {
  if (!existsSync(BULK_DIR)) mkdirSync(BULK_DIR, { recursive: true });
  writeFileSync(resolve(BULK_DIR, `${data.blkNo}.json`), JSON.stringify(data, null, 2), "utf8");
}

function loadBulk(blkNo) {
  const p = resolve(BULK_DIR, `${blkNo}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function listBulks({ agentId = "", status = "" } = {}) {
  if (!existsSync(BULK_DIR)) return [];
  return readdirSync(BULK_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => { try { return JSON.parse(readFileSync(resolve(BULK_DIR, f), "utf8")); } catch { return null; } })
    .filter(d => d && (!agentId || d.agentId === agentId) && (!status || d.status === status))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ─── 草稿存储 ──────────────────────────────────────────────────────────────
function draftPath(orderNo) {
  return resolve(DRAFTS_DIR, `${orderNo}.json`);
}

function saveDraft(orderNo, agent, payload) {
  const draft = {
    orderNo,
    agentId: agent.id,
    agentName: agent.name,
    status: "draft",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    syncedAt: 0,
    retryCount: 0,
    lastError: null,
    payload,
  };
  writeFileSync(draftPath(orderNo), JSON.stringify(draft, null, 2));
  return draft;
}

function loadDraft(orderNo) {
  const fp = draftPath(orderNo);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, "utf8")); } catch { return null; }
}

function deleteDraft(orderNo) {
  const fp = draftPath(orderNo);
  if (existsSync(fp)) unlinkSync(fp);
}

function listDrafts(agentId) {
  if (!existsSync(DRAFTS_DIR)) return [];
  const files = readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json"));
  const drafts = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(resolve(DRAFTS_DIR, f), "utf8"));
      if (!agentId || d.agentId === agentId) drafts.push(d);
    } catch {}
  }
  return drafts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// 后台同步：将草稿写入 Bitable
async function processPendingDrafts() {
  if (!existsSync(DRAFTS_DIR)) return;
  const files = readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".failed.json"));
  const now = Date.now();
  for (const f of files) {
    const fp = resolve(DRAFTS_DIR, f);
    let draft;
    try {
      draft = JSON.parse(readFileSync(fp, "utf8"));
      // 跳过近期修改的草稿（给代理商编辑窗口）
      if (now - draft.updatedAt < DRAFT_AGE_MIN) continue;
      // 跳过超过 10 次重试的
      if (draft.retryCount >= 10) {
        console.error(`  草稿 ${draft.orderNo} 重试超过 10 次，放弃同步`);
        // 重命名为 .failed 避免重复处理
        writeFileSync(fp + ".failed", JSON.stringify(draft));
        unlinkSync(fp);
        continue;
      }
    } catch {
      // 损坏的草稿文件，删除
      try { unlinkSync(fp); } catch {}
      continue;
    }

    const { orderNo, agentName, agentId, payload } = draft;
    const { address, patients, terminalCustomer } = payload;
    console.log(`  → 同步草稿 ${orderNo} (${agentName})`);

    // 幂等检查：订单已存在则跳过，防止超时重试导致重复写入
    const existCheck = await feishuApi("GET",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=1&filter=CurrentValue.[订单编号]="${orderNo}"`
    ).catch(() => null);
    if (existCheck?.items?.length > 0) {
      unlinkSync(fp);
      console.log(`  ⏭️ 草稿 ${orderNo} 已存在，跳过重复写入`);
      continue;
    }

    try {
      const customerId = await getOrCreateCustomer(agentName);
      const now = Date.now();
      const orderRecords = [];
      const lensRecords = [];

      // 预查定价：批量获取本单涉及的所有 agentId+SKU 价格
      const priceMap = await getPricingMap(agentId, patients.map(p => p.sku));
      for (const p of patients) {
        const { customerName, sku, quantity, eyes, assembly, remark, pairIndex } = p;
        const sortedEyes = [...eyes].sort((a, b) => {
          const order = s => s === "右眼" ? 0 : s === "左眼" ? 1 : 2;
          return order(a.side) - order(b.side);
        });
        const lensCount = eyes.length;

        const unitPrice = priceMap.get(`${agentId}-${sku}`) || 0;
        const amount = unitPrice * quantity * lensCount;
        orderRecords.push({
          fields: {
            "订单编号": orderNo,
            "产品型号": sku,
            "数量": quantity * lensCount,
            "订单状态": "已下单",
            "下单日期": now,
            "顾客姓名": customerName.trim(),
            "序号": pairIndex || 1,
            "代理商名称": agentName,
            "代理商ID": agentId,
            "收货地址": address.trim(),
            "订单来源": "代理商门户",
            "客户ID": customerId,
            "是否装配": assembly !== false ? "是" : "否",
            "单价": unitPrice,
            "金额": amount,
            ...(terminalCustomer?.name ? { "终端门店": terminalCustomer.name } : {}),
            ...(terminalCustomer?.contact ? { "联系人": terminalCustomer.contact } : {}),
            ...(terminalCustomer?.phone ? { "联系电话": terminalCustomer.phone } : {}),
            ...(remark?.trim() ? { "备注": remark.trim() } : {}),
          },
        });

        for (const eye of sortedEyes) {
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
              "序号": pairIndex || 1,
              "代理商名称": agentName,
              "代理商ID": agentId,
              "订单状态": "已下单",
            },
          });
        }
      }

      // 顺序写入：订单主表成功后才写镜片明细，避免部分写入导致幽灵记录
      const okOrder = await batchCreateRecords(TABLES.order, orderRecords);
      if (!okOrder) throw new Error("写入订单主表失败");
      const okLens = lensRecords.length > 0 ? await batchCreateRecords(TABLES.lens_detail, lensRecords) : true;
      if (!okLens) console.error(`  ⚠️ 镜片明细写入失败 ${orderNo}`);

      // 删除草稿文件
      unlinkSync(fp);
      console.log(`  ✅ 草稿同步完成: ${orderNo}`);
    } catch (e) {
      draft.retryCount = (draft.retryCount || 0) + 1;
      draft.lastError = e.message;
      writeFileSync(fp, JSON.stringify(draft, null, 2));
      console.error(`  ❌ 草稿同步失败 ${orderNo} (尝试 ${draft.retryCount}/10): ${e.message}`);
    }
  }
}

// ─── 定价查询 ──────────────────────────────────────────────────────────────

const _pricingCache = new Map(); // key=agentId-sku, value={price, ts}
const PRICING_TTL = 5 * 60 * 1000; // 5分钟缓存

async function getPricingMap(agentId, skus) {
  const map = new Map();
  if (!TABLES.agent_pricing) return map;

  const now = Date.now();
  const uncached = [];
  for (const sku of skus) {
    const key = `${agentId}-${sku}`;
    const cached = _pricingCache.get(key);
    if (cached && now - cached.ts < PRICING_TTL) {
      map.set(key, cached.price);
    } else {
      uncached.push(sku);
    }
  }
  if (uncached.length === 0) return map;

  // 批量查询该代理商的所有定价
  try {
    const encoded = encodeURIComponent(`"${agentId}"`);
    const data = await feishuApi("GET",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_pricing}/records?page_size=500&filter=CurrentValue.[代理商ID]=${encoded}`
    );
    for (const rec of (data?.items || [])) {
      const f = rec.fields;
      const sku = f["产品型号"] || "";
      const price = Number(f["单价"]) || 0;
      const cacheKey = `${agentId}-${sku}`;
      _pricingCache.set(cacheKey, { price, ts: now });
      if (uncached.includes(sku)) map.set(cacheKey, price);
    }
  } catch (e) {
    console.warn("⚠️ 定价查询失败:", e.message);
  }
  return map;
}

// ─── 客户管理 ──────────────────────────────────────────────────────────────

async function getOrCreateCustomer(agentName) {
  const encoded = encodeURIComponent(`"${agentName}"`);
  const res = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.customer}/records?page_size=1&filter=CurrentValue.[门店名称]=${encoded}`
  );
  if (res?.items?.length > 0) {
    return res.items[0].fields["客户ID"] || "";
  }
  const newId = genCustomerId();
  await createRecord(TABLES.customer, {
    客户ID: newId, 门店名称: agentName, 来源系统: "代理商门户",
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
    const name = r.fields["门店名称"];
    if (!name) continue;
    // 仅显示此代理商历史下单过的客户
    if (orderNames.has(name)) {
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

// ─── 终端门店管理 ────────────────────────────────────────────────────────────

let _storesCache = null;
let _storesCacheTime = 0;

async function loadStores() {
  if (Date.now() - _storesCacheTime < 300000 && _storesCache) return _storesCache;
  try {
    const records = await listRecords(TABLES.customer);
    _storesCache = records.map(r => ({
      id: rawVal(r.fields["客户ID"]) || "",
      name: rawVal(r.fields["门店名称"]) || "",
      contact: rawVal(r.fields["联系人"]) || "",
      phone: rawVal(r.fields["联系电话"]) || "",
      address: rawVal(r.fields["收货地址"]) || "",
      city: rawVal(r.fields["所在城市"]) || "",
      binCode: rawVal(r.fields["仓位"]) || "",
    })).filter(s => s.name);
    _storesCacheTime = Date.now();
  } catch (e) {
    console.error("loadStores error:", e.message);
    _storesCache = _storesCache || [];
  }
  return _storesCache;
}
function clearStoresCache() { _storesCacheTime = 0; }
async function getStoreByName(name) {
  if (!name) return null;
  const stores = await loadStores();
  return stores.find(s => s.name === name) || null;
}

// ─── 验真缓存 ──────────────────────────────────────────────────────────────
const _verifyCache = new Map();
const VERIFY_TTL = 24 * 60 * 60 * 1000;
let _verifyTemplate = null;

// ─── 镜片明细内存缓存（启动时全量加载，验真零 API） ─────────────────────────
const _lensCache = new Map(); // lensCode → { orderNo, customer, sku, pairIndex, side, sph, cyl, axis }
let _lensCacheReady = false;

// 订单列表缓存（全表扫描结果，60秒 TTL）
let _ordersCache = { data: null, ts: 0 };
const ORDERS_CACHE_TTL = 60000;
function invalidateOrdersCache() { _ordersCache = { data: null, ts: 0 }; }

async function warmLensCache() {
  try {
    const items = [];
    let pageToken = "";
    while (true) {
      let qs = "?page_size=500";
      if (pageToken) qs += `&page_token=${pageToken}`;
      const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records${qs}`);
      if (!data) break;
      items.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
    }
    for (const r of items) {
      const lc = r.fields["镜片码（唯一）"];
      if (!lc) continue;
      _lensCache.set(lc, {
        orderNo: r.fields["订单编号"] || "",
        customer: r.fields["顾客姓名"] || "",
        sku: r.fields["产品型号"] || "",
        pairIndex: Number(r.fields["序号"] || 1),
        side: r.fields["眼别"] || "",
        sph: r.fields["球镜SPH"] ?? "",
        cyl: r.fields["柱镜CYL"] ?? "",
        axis: r.fields["轴位AXIS"] ?? "",
      });
    }
    _lensCacheReady = true;
    console.log(`   镜片缓存预热完成: ${_lensCache.size} 条`);
  } catch (e) {
    console.warn("⚠️ 镜片缓存预热失败:", e.message);
  }
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
const RATE_LIMIT_MAX = 120;              // 通用端点：120次/分钟

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
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── 规则配置缓存 ────────────────────────────────────────────────────────

const RULES_CONFIG_PATH = resolve(__dirname, "rules_config.json");
let _rulesConfigCache = null;
let _rulesConfigCacheTime = 0;
const RULES_CONFIG_TTL = 30_000;

function loadRulesConfig() {
  const now = Date.now();
  if (_rulesConfigCache && now - _rulesConfigCacheTime < RULES_CONFIG_TTL) return _rulesConfigCache;
  try {
    _rulesConfigCache = JSON.parse(readFileSync(RULES_CONFIG_PATH, "utf-8"));
  } catch {
    _rulesConfigCache = {};
  }
  _rulesConfigCacheTime = now;
  return _rulesConfigCache;
}

function saveRulesConfig(config) {
  writeFileSync(RULES_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  _rulesConfigCache = config;
  _rulesConfigCacheTime = Date.now();
}

// ─── 打印队列（Mac 拉模式）───────────────────────────────────────────────────

const printQueue = new Map();
let _pqSeq = 0;

// ─── 仓位分配（扫码分仓）───────────────────────────────────────────────────
const binStore = new Map(); // addressKey → { bin, address, orders: [], lensCodes: [], ts }
let _binSeq = 0;

function toRoman(n) {
  const v = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const s = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
  let r = "";
  for (let i = 0; i < v.length; i++) {
    while (n >= v[i]) { r += s[i]; n -= v[i]; }
  }
  return r;
}

// ─── bin_map 地址→仓位匹配 ───────────────────────────────────────────────
let binMapEntries = []; // [{ binCode, keywords: [str], remark }]
let _tempBinCounter = 0;
const _tempBinMap = new Map(); // addrClean → tempBinCode

async function loadBinMap() {
  try {
    const res = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.bin_map}/records?page_size=100`);
    const items = res?.items || [];
    binMapEntries = items.map(r => ({
      binCode: rawVal(r.fields["仓位编号"]) || "",
      keywords: String(rawVal(r.fields["地址关键词"]) || "").split(/[,，]/).map(s => s.trim()).filter(Boolean),
      remark: rawVal(r.fields["备注"]) || "",
    })).filter(b => b.binCode && b.keywords.length);
    console.log(`✅ 仓位映射已加载: ${binMapEntries.length} 条`);
  } catch (e) {
    console.warn("⚠️ 加载仓位映射失败:", e.message);
    binMapEntries = [];
  }
}

function matchBin(address) {
  if (!address) return "";
  const addrClean = address.replace(/\s+/g, "");
  for (const entry of binMapEntries) {
    if (entry.keywords.some(kw => addrClean.includes(kw))) return entry.binCode;
  }
  if (!_tempBinMap.has(addrClean)) {
    _tempBinCounter++;
    _tempBinMap.set(addrClean, `T-${String(_tempBinCounter).padStart(3, "0")}`);
  }
  return _tempBinMap.get(addrClean);
}

// ─── 工作流步骤 ──────────────────────────────────────────────────────────

const STEP_ORDER = ["submitted", "confirmed", "producing", "labeled", "shipped", "delivered"];
const STEP_LABELS = {
  submitted: "已下单", confirmed: "待处理", producing: "生产中",
  labeled: "打标签", shipped: "已发货", delivered: "已签收",
};
const STATUS_STEP_KEY = { "已下单": "submitted", "待处理": "confirmed", "生产中": "producing", "打标签": "labeled", "已发货": "shipped", "已签收": "delivered" };

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
  if (targetIdx > currentIdx + 1 && !(stepKey === "producing" && wf.steps["confirmed"]) && !(stepKey === "packed" && (wf.steps["producing"] || wf.steps["labeled"]))) {
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

async function assignLensCodes(orderNo, customerName, pairIndex) {
  let lensDetails = await getLensDetailsByOrder(orderNo);
  // 按客户名+序号过滤
  if (customerName) {
    lensDetails = lensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName);
  }
  if (pairIndex) {
    lensDetails = lensDetails.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
  }
  const lensCodes = [];
  for (const rec of lensDetails) {
    const existingCode = rec.fields["镜片码（唯一）"];
    if (existingCode) { lensCodes.push(existingCode); continue; }
    const code = genLensCode();
    await updateRecord(TABLES.lens_detail, rec.record_id, {
      "镜片码（唯一）": code,
      "订单状态": "待处理",
      "镜片码状态": "active",
    });
    await generateQRPng(code);
    lensCodes.push(code);
    console.log(`  镜片码生成: ${orderNo} → ${code}`);
  }
  return lensCodes;
}

async function getLensDetailsByOrder(orderNo) {
  const encoded = encodeURIComponent(`"${orderNo}"`);
  const items = [];
  let pageToken = "";
  while (true) {
    let qs = `?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`;
    if (pageToken) qs += `&page_token=${pageToken}`;
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records${qs}`);
    if (!data) break;
    items.push(...(data.items || []));
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  const indexed = items.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const ca = a.r.fields["顾客姓名"] || "", cb = b.r.fields["顾客姓名"] || "";
    const nc = ca.localeCompare(cb, "zh-CN");
    if (nc !== 0) return nc;
    const pa = Number(a.r.fields["序号"] || 1), pb = Number(b.r.fields["序号"] || 1);
    if (pa !== pb) return pa - pb;
    const sa = String(a.r.fields["产品型号"] || ""), sb = String(b.r.fields["产品型号"] || "");
    if (sa !== sb) return sa.localeCompare(sb, "zh-CN");
    const ea = a.r.fields["眼别"] || "", eb = b.r.fields["眼别"] || "";
    if (ea.includes("右") && !eb.includes("右")) return -1;
    if (!ea.includes("右") && eb.includes("右")) return 1;
    return a.i - b.i; // 稳定排序：保持原始配对顺序
  });
  return indexed.map(x => x.r);
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

// ─── 工厂导出（Excel + ZIP）已移至 lib/factory-export.js ─────────────────────

// 构建工厂导出 ZIP（buildFactoryExcel + buildZipBuffer 已移至 lib/factory-export.js）
async function buildFactoryZip(records, orderNo, orderInfo = {}) {
  const files = [];
  try {
    files.push({ name: `订单_${orderNo}.xlsx`, data: buildFactoryExcel(records, orderNo, orderInfo) });
  } catch (e) { console.error("⚠️ Excel 生成失败:", e.message); }
  const labelEntries = await Promise.all(records.map(async (rec) => {
    const f = rec.fields;
    const lensCode = f["镜片码（唯一）"];
    if (!lensCode) return [];
    const qrPath = resolve(QR_DIR, `${lensCode}.png`);
    const qrFile = existsSync(qrPath)
      ? [{ name: `qrcodes/${lensCode}.png`, data: readFileSync(qrPath) }]
      : [];
    const labelEntry = await buildLabelHtml(rec, orderNo);
    return labelEntry ? [...qrFile, labelEntry] : qrFile;
  }));
  files.push(...labelEntries.flat());
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

// 确保镜片码字段存在
async function ensureField(fieldName, fieldDef, tableId = TABLES.order) {
  const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  if (data?.items?.some(f => f.field_name === fieldName)) return;
  await feishuApi("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, { field_name: fieldName, ...fieldDef });
  console.log(`  已创建飞书字段: ${fieldName} (table=${tableId})`);
}

// 确保单选字段包含指定选项
async function ensureFieldOption(tableId, fieldName, optionName) {
  const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
  const field = data?.items?.find(f => f.field_name === fieldName);
  if (!field) return;
  const options = field.property?.options || [];
  if (options.some(o => o.name === optionName)) return;
  // 添加新选项
  options.push({ name: optionName });
  await feishuApi("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields/${field.field_id}`, {
    field_name: fieldName,
    type: field.type,
    property: { options },
  });
  console.log(`  已添加字段选项: ${fieldName} → ${optionName}`);
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

  // Rate Limiting（全局）— 仅当直连来自反向代理（localhost）时信任 x-forwarded-for
  const directIp = req.socket.remoteAddress || "";
  const isFromProxy = directIp === "127.0.0.1" || directIp === "::1" || directIp === "::ffff:127.0.0.1";
  const clientIp = isFromProxy
    ? (req.headers["x-forwarded-for"]?.split(",")[0].trim() || directIp)
    : directIp;
  const verifyLimit = pathname.startsWith("/verify/") ? VERIFY_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  // 静态资源不限速（QR 码图片/css/js）
  if (pathname.startsWith("/qrcodes/") || pathname.startsWith("/css/") || pathname.startsWith("/js/")) {
    // 跳过限速
  } else if (!checkRateLimit(clientIp, verifyLimit)) {
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
    if (pathname === "/") {
      serveStatic(res, resolve(__dirname, "public/portal.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/order" || pathname === "/order.html") {
      serveStatic(res, resolve(__dirname, "public/order.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/track" || pathname === "/track.html") {
      serveStatic(res, resolve(__dirname, "public/track.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/orders" || pathname === "/orders.html" || pathname === "/labels" || pathname === "/labels.html") {
      serveStatic(res, resolve(__dirname, "public/orders.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/labels-print" || pathname === "/labels-print.html") {
      serveStatic(res, resolve(__dirname, "public/labels-print.html"));
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
    if (pathname === "/flow-inventory") {
      serveStatic(res, resolve(__dirname, "public/flow-inventory.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/batch-import" || pathname === "/batch-import.html") {
      serveStatic(res, resolve(__dirname, "public/batch-import.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/batch-merge" || pathname === "/batch-merge.html") {
      serveStatic(res, resolve(__dirname, "public/batch-merge.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/qr-gallery" || pathname === "/qr-gallery.html") {
      serveStatic(res, resolve(__dirname, "public/qr-gallery.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/inventory-barcode" || pathname === "/inventory-barcode.html") {
      serveStatic(res, resolve(__dirname, "public/inventory-barcode.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/inventory-inbound" || pathname === "/inventory-inbound.html") {
      serveStatic(res, resolve(__dirname, "public/inventory-inbound.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/inventory-outbound" || pathname === "/inventory-outbound.html") {
      serveStatic(res, resolve(__dirname, "public/inventory-outbound.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/bulk-order" || pathname === "/bulk-order.html") {
      serveStatic(res, resolve(__dirname, "public/bulk-order.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/bulk-labels" || pathname === "/bulk-labels.html") {
      serveStatic(res, resolve(__dirname, "public/bulk-labels.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/bulk-statement" || pathname === "/bulk-statement.html") {
      serveStatic(res, resolve(__dirname, "public/bulk-statement.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/verify" || pathname === "/verify.html") {
      serveStatic(res, resolve(__dirname, "public/verify.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/summer" || pathname === "/summer.html") {
      serveStatic(res, resolve(__dirname, "public/summer.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/summer-plan" || pathname === "/summer-plan.html") {
      serveStatic(res, resolve(__dirname, "public/summer-plan.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/summer-stock" || pathname === "/summer-stock.html") {
      serveStatic(res, resolve(__dirname, "public/summer-stock.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/summer-stock-tool" || pathname === "/summer-stock-tool.html") {
      serveStatic(res, resolve(__dirname, "public/summer-stock-tool.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/starmap" || pathname === "/starmap.html") {
      serveStatic(res, resolve(__dirname, "public/starmap-combined.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/ecp-board" || pathname === "/ecp-board.html") {
      serveStatic(res, resolve(__dirname, "public/ecp-board.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/biz-dashboard" || pathname === "/biz-dashboard.html") {
      serveStatic(res, resolve(__dirname, "public/biz-dashboard.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/distributor-dashboard" || pathname === "/distributor-dashboard.html") {
      serveStatic(res, resolve(__dirname, "public/distributor-dashboard.html"));
      return logReq(req, 200, start);
    }
    if (pathname === "/diagnose" || pathname === "/diagnose.html") {
      serveStatic(res, resolve(__dirname, "public/diagnose.html"));
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

    // ── API: 代理商列表（批量导入页用） ──
    if (pathname === "/api/agents" && req.method === "GET") {
      const agents = await loadAgents();
      jsonRes(res, 200, { agents });
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

    // ── API: 终端门店列表（含仓位，供下单页门店选择） ──
    if (pathname === "/api/terminal-stores" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const stores = await loadStores();
      jsonRes(res, 200, { stores });
      return logReq(req, 200, start);
    }

    // ── API: 提交订单（本地草稿 + 后台同步）──
    if (pathname === "/api/submit" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      const payload = await readBody(req);
      const { address, patients, terminalCustomer, clientRequestId, orderNo: existingOrderNo } = payload;

      // 幂等检查 — 防止双击/重试
      if (!clientRequestId) {
        jsonRes(res, 400, { error: "缺少 clientRequestId，请升级客户端" });
        return logReq(req, 400, start);
      }
      const cached = getIdempotent(clientRequestId);
      if (cached) { jsonRes(res, 200, cached); return logReq(req, 200, start); }

      if (!terminalCustomer?.name?.trim()) {
        jsonRes(res, 400, { error: "请填写终端门店" });
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

      // 是编辑已有草稿还是新建
      const orderNo = existingOrderNo || genOrderNo();

      // 保存草稿到本地
      saveDraft(orderNo, agent, payload);

      // 构建返回
      let totalLenses = 0;
      const items = [];
      for (const p of patients) {
        const lensCount = (p.eyes || []).length;
        totalLenses += p.quantity * lensCount;
        items.push({ sku: p.sku, skuName: p.sku, quantity: p.quantity, lensCount: p.quantity * lensCount, customerName: p.customerName?.trim() });
      }

      const responseData = {
        success: true,
        orderNo,
        draft: true,
        items,
        summary: { totalPatients: patients.length, totalLenses },
      };
      setIdempotent(clientRequestId, responseData);

      // 清除客户名缓存
      delete _customerCache[agent.id];
      delete _terminalCustomerCache[agent.id];

      jsonRes(res, 200, responseData);
      return logReq(req, 200, start);
    }

    // ── API: 草稿列表 ──
    if (pathname === "/api/drafts" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const drafts = listDrafts(agent.id).map(d => ({
        orderNo: d.orderNo,
        agentName: d.agentName,
        status: "待同步",
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        patientCount: d.payload?.patients?.length || 0,
        summary: d.payload?.patients?.map(p => `${p.customerName||'?'} ${p.sku}×${p.quantity}`) || [],
      }));
      jsonRes(res, 200, { drafts });
      return logReq(req, 200, start);
    }

    // ── API: 单个草稿详情 ──
    if (pathname.startsWith("/api/draft/") && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const orderNo = pathname.split("/").pop();
      if (!orderNo) { jsonRes(res, 400, { error: "缺少订单号" }); return logReq(req, 400, start); }
      const draft = loadDraft(orderNo);
      if (!draft) { jsonRes(res, 404, { error: "草稿不存在" }); return logReq(req, 404, start); }
      if (draft.agentId !== agent.id) { jsonRes(res, 403, { error: "无权查看" }); return logReq(req, 403, start); }
      jsonRes(res, 200, { orderNo: draft.orderNo, ...draft.payload });
      return logReq(req, 200, start);
    }

    // ── API: 删除草稿 ──
    if (pathname.startsWith("/api/draft/") && req.method === "DELETE") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const orderNo = pathname.split("/").pop();
      if (!orderNo) { jsonRes(res, 400, { error: "缺少订单号" }); return logReq(req, 400, start); }
      const draft = loadDraft(orderNo);
      if (!draft) { jsonRes(res, 404, { error: "草稿不存在" }); return logReq(req, 404, start); }
      if (draft.agentId !== agent.id) { jsonRes(res, 403, { error: "无权删除" }); return logReq(req, 403, start); }
      deleteDraft(orderNo);
      jsonRes(res, 200, { success: true });
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

      // 获取该代理商的全部订单 from Bitable
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
          deliveryType: f["交期类型"] || "",
          address: f["收货地址"] || "",
          remark: f["备注"] || "",
        };
      });

      // 合并本地草稿
      const drafts = listDrafts(agent.id);
      for (const d of drafts) {
        for (const p of d.payload?.patients || []) {
          orders.push({
            orderNo: d.orderNo,
            sku: p.sku || "",
            skuDisplay: p.sku || "",
            quantity: (p.quantity || 1) * (p.eyes?.length || 1),
            status: "已下单",
            customerName: p.customerName || "",
            date: d.createdAt,
            promiseDate: null,
            deliveryType: "",
            address: d.payload?.address || "",
            remark: "",
            _draft: true,
          });
        }
      }

      // 统计（过滤前）
      const stats = {
        total: orders.length,
        ordered: orders.filter(o => o.status === "已下单").length,
        pending: orders.filter(o => o.status === "待处理").length,
        producing: orders.filter(o => o.status === "生产中").length,
        labeled: orders.filter(o => o.status === "打标签").length,
        shipped: orders.filter(o => o.status === "已发货").length,
        draft: orders.filter(o => o._draft).length,
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

      // 并行请求订单表 + 镜片明细表
      const [data, lensDetails] = await Promise.all([
        feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`
        ),
        getLensDetailsByOrder(orderNo),
      ]);

      if (!data?.items?.length) {
        // 没找到 Bitable 记录，查草稿
        const draft = loadDraft(orderNo);
        if (draft && draft.agentId === agent.id) {
          const p = draft.payload;
          const items = (p.patients || []).flatMap(pt => {
            return (pt.eyes || []).map(eye => ({
              customerName: pt.customerName || "",
              sku: pt.sku || "",
              eye: eye.side || "",
              sph: eye.sph,
              cyl: eye.cyl,
              axis: eye.axis,
              remark: pt.remark || "",
              status: "已下单",
            }));
          });
          jsonRes(res, 200, {
            orderNo,
            date: draft.createdAt,
            address: p.address || "",
            status: "已下单",
            courier: "", trackingNo: "", shipTime: null,
            promiseDate: null, deliveryType: "",
            items, lenses: items,
          });
          return logReq(req, 200, start);
        }
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
      const lenses = lensDetails.map(r => {
        const f = r.fields;
        return {
          eye: f["眼别"] || "",
          sph: f["球镜SPH"],
          cyl: f["柱镜CYL"],
          axis: f["轴位AXIS"],
          lensCode: f["镜片码（唯一）"] || "",
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
        promiseDate: firstItem.fields["预计交期"] || null,
        deliveryType: firstItem.fields["交期类型"] || "",
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
          terminalCustomer: f["终端门店"] || "",
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

      const headers = ["订单号","顾客","终端门店","联系人","电话","产品型号","数量","是否装配","代理商","状态","下单日期","预计交期","物流公司","快递单号","收货地址","备注"];
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

      const codes = dataLC.items.map(r => r.fields["镜片码（唯一）"]).filter(Boolean);
      jsonRes(res, 200, { lensCodes: codes });
      return logReq(req, 200, start);
    }

    // ── API: /api/order/:no/confirm 已废弃，由 /api/admin/confirm 统一处理 ──

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

      const codes = data3.items.map(r => r.fields["镜片码（唯一）"]).filter(Boolean);
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

      // 1. 检查结果缓存
      const cached = _verifyCache.get(lensCode);
      if (cached && Date.now() - cached.ts < VERIFY_TTL) {
        res.writeHead(cached.found ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(cached.html);
        return logReq(req, cached.found ? 200 : 404, start);
      }

      let found = false;
      let orderInfo = {};
      let eyes = [];

      // 2. 内存缓存查询（零 API）
      if (_lensCacheReady && _lensCache.has(lensCode)) {
        found = true;
        const src = _lensCache.get(lensCode);
        const skus = await getSkusWithInventory();
        const skuMatch = skus.find(s => s.sku === src.sku);
        orderInfo = { orderNo: src.orderNo, customerName: src.customer, skuName: skuMatch?.name || src.sku };

        // 从内存缓存中找同对镜片
        for (const [lc, rec] of _lensCache) {
          if (rec.orderNo === src.orderNo && rec.customer === src.customer && rec.pairIndex === src.pairIndex) {
            eyes.push({ side: rec.side, sph: rec.sph, cyl: rec.cyl, axis: rec.axis, lensCode: lc });
          }
        }
        eyes.sort((a, b) => a.side.includes("右") ? -1 : 1);
      } else {
        // 3. 回退：API 查询（缓存未就绪或新镜片码）
        const encodedLc = encodeURIComponent(`"${lensCode}"`);
        const lcData = await feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=1&filter=CurrentValue.[镜片码（唯一）]=${encodedLc}`
        );
        if (lcData?.items?.length > 0) {
          found = true;
          const lf = lcData.items[0].fields;

          // 作废码检查：显示"已作废"页面
          if (lf["镜片码状态"] === "void") {
            const replacementCode = lf["替换码"] || "";
            let voidHtml = _verifyTemplate || readFileSync(resolve(__dirname, "public/verify.html"), "utf-8");
            voidHtml = voidHtml.replace("{{FOUND}}", "true");
            voidHtml = voidHtml.replace("{{HERO_CLASS}}", "hero-fail");
            voidHtml = voidHtml.replace("{{LENS_CODE}}", escapeHtml(lensCode));
            voidHtml = voidHtml.replace("{{ORDER_NO_DISPLAY}}", "display:none");
            voidHtml = voidHtml.replace("{{ORDER_NO}}", "");
            voidHtml = voidHtml.replace("{{CUSTOMER_NAME}}", "");
            voidHtml = voidHtml.replace("{{SKU_NAME}}", replacementCode ? `该镜片已作废，换货码为 ${replacementCode}` : "该镜片已作废");
            voidHtml = voidHtml.replace("{{EYE_ROWS}}", `<tr><td colspan="4" style="text-align:center;color:#e74c3c;font-weight:bold">已作废 — 请使用新镜片码</td></tr>`);
            voidHtml = voidHtml.replace("{{LENS_CODES}}", `<span class="lens-code-item"><span class="mono">${escapeHtml(lensCode)}</span> → <span class="mono">${escapeHtml(replacementCode)}</span></span>`);
            voidHtml = voidHtml.replace("{{NOW}}", escapeHtml(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })));
            _verifyCache.set(lensCode, { html: voidHtml, found: true, ts: Date.now() });
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(voidHtml);
            return logReq(req, 200, start);
          }
          const srcOrderNo = lf["订单编号"] || "";
          const srcCustomer = lf["顾客姓名"] || "";
          const srcSku = lf["产品型号"] || "";
          const srcPi = Number(lf["序号"] || 1);

          const skus = await getSkusWithInventory();
          const skuMatch = skus.find(s => s.sku === srcSku);
          orderInfo = { orderNo: srcOrderNo, customerName: srcCustomer, skuName: skuMatch?.name || srcSku };

          const orderEnc2 = encodeURIComponent(`"${srcOrderNo}"`);
          const pairData = await feishuApi("GET",
            `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=20&filter=CurrentValue.[订单编号]=${orderEnc2}`
          );
          const samePair = (pairData?.items || []).filter(r =>
            (r.fields["顾客姓名"] || "") === srcCustomer &&
            Number(r.fields["序号"] || 1) === srcPi
          );
          eyes = samePair.map(r => ({
            side: r.fields["眼别"] || "",
            sph: r.fields["球镜SPH"] ?? "",
            cyl: r.fields["柱镜CYL"] ?? "",
            axis: r.fields["轴位AXIS"] ?? "",
            lensCode: r.fields["镜片码（唯一）"] || "",
          }));
          eyes.sort((a, b) => a.side.includes("右") ? -1 : 1);
        }
      }

      // 模板缓存
      if (!_verifyTemplate) _verifyTemplate = readFileSync(resolve(__dirname, "public/verify.html"), "utf-8");
      let html = _verifyTemplate;
      const isBulk = (orderInfo.orderNo || "").startsWith("BLK-");
      html = html.replace("{{FOUND}}", found ? "true" : "false");
      html = html.replace("{{HERO_CLASS}}", found ? "hero-ok" : "hero-fail");
      html = html.replace("{{LENS_CODE}}", escapeHtml(lensCode));
      // 批量单不向消费者暴露内部单号和代理商名
      html = html.replace("{{ORDER_NO_DISPLAY}}", isBulk ? "display:none" : "");
      html = html.replace("{{ORDER_NO}}", isBulk ? "" : escapeHtml(orderInfo.orderNo || ""));
      html = html.replace("{{CUSTOMER_NAME}}", isBulk ? "" : escapeHtml(orderInfo.customerName || ""));
      html = html.replace("{{SKU_NAME}}", escapeHtml(orderInfo.skuName || ""));

      let eyeRows;
      if (isBulk) {
        // 批量单：不分眼别，直接展示处方一行
        const e = eyes[0] || {};
        eyeRows = `<tr>
        <td></td>
        <td class="rx-num">${escapeHtml(fmt(e.sph ?? ""))}</td>
        <td class="rx-num">${escapeHtml(fmt(e.cyl ?? ""))}</td>
        <td class="rx-num">—</td>
      </tr>`;
      } else {
        eyeRows = eyes.map(e => {
          const cls = e.side.includes("左") ? "eye-L" : "eye-R";
          return `<tr>
        <td><span class="eye-tag ${cls}">${escapeHtml(e.side)}</span></td>
        <td class="rx-num">${escapeHtml(fmt(e.sph))}</td>
        <td class="rx-num">${escapeHtml(fmt(e.cyl))}</td>
        <td class="rx-num">${escapeHtml(fmtAxis(e.axis))}</td>
      </tr>`;
        }).join("\n");
      }
      html = html.replace("{{EYE_ROWS}}", eyeRows);

      const codeHtml = isBulk
        ? `<span class="lens-code-item"><span class="mono">${escapeHtml(lensCode)}</span></span>`
        : eyes.map(e => `<span class="lens-code-item"><span class="lens-code-side">${escapeHtml(e.side)}</span> <span class="mono">${escapeHtml(e.lensCode)}</span></span>`).join("\n");
      html = html.replace("{{LENS_CODES}}", codeHtml);
      html = html.replace("{{NOW}}", escapeHtml(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })));

      // 写入缓存
      _verifyCache.set(lensCode, { html, found, ts: Date.now() });
      if (_verifyCache.size > 5000) _verifyCache.delete(_verifyCache.keys().next().value);

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
      const filterSupplier = url.searchParams.get("supplier") || "";
      const filterStock = url.searchParams.get("stock") || "";
      const filterQ = url.searchParams.get("q") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(9999, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 50));

      // 命中缓存则跳过全表扫描
      let orders;
      if (_ordersCache.data && Date.now() - _ordersCache.ts < ORDERS_CACHE_TTL) {
        orders = _ordersCache.data;
      } else {
        const allRecords = await listRecords(TABLES.order);
        orders = allRecords.map(r => {
          const f = r.fields;
          const address = f["收货地址"] || "";
          return {
            orderNo: f["订单编号"] || "",
            customerName: f["顾客姓名"] || "",
            agentName: f["代理商名称"] || "",
            agentId: f["代理商ID"] || "",
            sku: f["产品型号"] || "",
            quantity: Number(f["数量"]) || 1,
            status: f["订单状态"] || "",
            date: f["下单日期"] || f["同步时间"] || null,
            lensCode: f["镜片码（唯一）"] || "",
            assembly: f["是否装配"] || "",
            remark: f["备注"] || "",
            pairIndex: f["序号"] || 1,
            deliveryType: f["交期类型"] || "",
            supplier: f["供应商厂家"] || "",
            stockStatus: f["库存状态"] || "",
            binCode: rawVal(f["仓位"]) || matchBin(address),
            address,
          };
        });
        _ordersCache = { data: orders, ts: Date.now() };
      }

      // 统计
      const agents = [...new Set(orders.map(o => o.agentName).filter(Boolean))].sort();
      const suppliers = [...new Set(orders.map(o => o.supplier).filter(Boolean))].sort();
      const stats = {
        total: orders.length,
        ordered: orders.filter(o => o.status === "已下单").length,
        pending: orders.filter(o => o.status === "待处理").length,
        producing: orders.filter(o => o.status === "生产中").length,
        labeled: orders.filter(o => o.status === "打标签").length,
        shipped: orders.filter(o => o.status === "已发货").length,
      };

      // 筛选
      orders = applyOrderFilters(orders, { filterStatus, filterAgent, filterSku, filterFrom, filterTo, filterQ });
      if (filterAssembly) orders = orders.filter(o => o.assembly === filterAssembly);
      if (filterSupplier) orders = orders.filter(o => o.supplier === filterSupplier);
      if (filterStock) {
        const want = filterStock === "yes" ? "有库存" : filterStock === "no" ? "无库存" : filterStock;
        orders = orders.filter(o => (o.stockStatus || "") === want);
      }

      orders.sort((a, b) => (b.date || 0) - (a.date || 0));
      const totalPages = Math.ceil(orders.length / pageSize) || 1;
      const paged = orders.slice((page - 1) * pageSize, page * pageSize);

      jsonRes(res, 200, { orders: paged, stats, agents, suppliers, page, pageSize, totalPages, totalFiltered: orders.length });
      return logReq(req, 200, start);
    }

    // GET /api/admin/orders-fast — 快速订单列表（飞书服务端筛选，不拉全表）
    if (pathname === "/api/admin/orders-fast") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const filterStatus = url.searchParams.get("status") || "";
      const filterAgent = url.searchParams.get("agent") || "";
      const filterSku = url.searchParams.get("sku") || "";
      const filterAssembly = url.searchParams.get("assembly") || "";
      const filterSupplier = url.searchParams.get("supplier") || "";
      const filterStock = url.searchParams.get("stock") || "";
      const filterQ = url.searchParams.get("q") || "";
      const filterFrom = url.searchParams.get("from") || "";
      const filterTo = url.searchParams.get("to") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const pageSize = Math.min(9999, Math.max(1, parseInt(url.searchParams.get("pageSize")) || 50));

      // 构建飞书 filter 条件
      const conditions = [];
      if (filterStatus) conditions.push({ field_name: "订单状态", operator: "is", value: [filterStatus] });
      if (filterAgent) conditions.push({ field_name: "代理商名称", operator: "is", value: [filterAgent] });
      if (filterSku) conditions.push({ field_name: "产品型号", operator: "is", value: [filterSku] });
      if (filterAssembly) conditions.push({ field_name: "是否装配", operator: "is", value: [filterAssembly] });
      if (filterSupplier) conditions.push({ field_name: "供应商厂家", operator: "is", value: [filterSupplier] });
      if (filterStock) {
        const want = filterStock === "yes" ? "有库存" : filterStock === "no" ? "无库存" : filterStock;
        conditions.push({ field_name: "库存状态", operator: "is", value: [want] });
      }
      if (filterFrom) conditions.push({ field_name: "下单日期", operator: "isGreaterEqual", value: [filterFrom] });
      if (filterTo) conditions.push({ field_name: "下单日期", operator: "isLessEqual", value: [filterTo + "T23:59:59"] });

      // 关键词搜索：订单号走订单编号 contains，其他走顾客姓名 contains
      if (filterQ) {
        const q = filterQ.trim();
        if (/^ord-/i.test(q)) {
          conditions.push({ field_name: "订单编号", operator: "contains", value: [q] });
        } else {
          conditions.push({ field_name: "顾客姓名", operator: "contains", value: [q] });
        }
      }

      const filter = conditions.length > 0
        ? { conjunction: "and", conditions }
        : undefined;

      // 无筛选时优先走缓存（复用 /api/admin/orders 的缓存）
      if (conditions.length === 0 &&
          _ordersCache.data && Date.now() - _ordersCache.ts < ORDERS_CACHE_TTL) {
        let orders = _ordersCache.data;
        const stats = {
          total: orders.length,
          ordered: orders.filter(o => o.status === "已下单").length,
          pending: orders.filter(o => o.status === "待处理").length,
          producing: orders.filter(o => o.status === "生产中").length,
          labeled: orders.filter(o => o.status === "打标签").length,
          shipped: orders.filter(o => o.status === "已发货").length,
        };
        orders.sort((a, b) => (b.date || 0) - (a.date || 0));
        const agents = [...new Set(orders.map(o => o.agentName).filter(Boolean))].sort();
        const suppliers = [...new Set(orders.map(o => o.supplier).filter(Boolean))].sort();
        const totalPages = Math.ceil(orders.length / pageSize) || 1;
        const paged = orders.slice((page - 1) * pageSize, page * pageSize);
        jsonRes(res, 200, { orders: paged, stats, agents, suppliers, page, pageSize, totalPages, totalFiltered: orders.length });
        return logReq(req, 200, start);
      }

      try {
        const allRecords = await searchRecords(TABLES.order, {
          filter,
          sort: [{ field_name: "下单日期", desc: true }],
          pageSize: 500,
        });

        let orders = allRecords.map(r => {
          const f = r.fields;
          const address = rawVal(f["收货地址"]) || "";
          return {
            orderNo: rawVal(f["订单编号"]) || "",
            customerName: rawVal(f["顾客姓名"]) || "",
            agentName: rawVal(f["代理商名称"]) || "",
            agentId: rawVal(f["代理商ID"]) || "",
            sku: rawVal(f["产品型号"]) || "",
            quantity: Number(f["数量"]) || 1,
            status: rawVal(f["订单状态"]) || "",
            date: f["下单日期"] || f["同步时间"] || null,
            lensCode: rawVal(f["镜片码（唯一）"]) || "",
            assembly: rawVal(f["是否装配"]) || "",
            remark: rawVal(f["备注"]) || "",
            pairIndex: f["序号"] || 1,
            deliveryType: rawVal(f["交期类型"]) || "",
            supplier: rawVal(f["供应商厂家"]) || "",
            stockStatus: rawVal(f["库存状态"]) || "",
            binCode: rawVal(f["仓位"]) || matchBin(address),
            address,
          };
        });

        // 写入缓存（与 /api/admin/orders 共享，无筛选时为全量数据）
        if (!filter && !filterQ) {
          _ordersCache = { data: orders, ts: Date.now() };
        }

        // 关键词搜索（飞书 filter 不支持 OR 跨字段，需客户端补筛）
        if (filterQ) {
          const s = filterQ.trim().toLowerCase();
          orders = orders.filter(o =>
            o.orderNo.toLowerCase().includes(s) ||
            (o.customerName || "").toLowerCase().includes(s)
          );
        }

        // 统计（用缓存的全量数据，避免每次重新查）
        let stats;
        if (_ordersCache.data && Date.now() - _ordersCache.ts < ORDERS_CACHE_TTL) {
          const all = _ordersCache.data;
          stats = {
            total: all.length,
            ordered: all.filter(o => o.status === "已下单").length,
            pending: all.filter(o => o.status === "待处理").length,
            producing: all.filter(o => o.status === "生产中").length,
            labeled: all.filter(o => o.status === "打标签").length,
            shipped: all.filter(o => o.status === "已发货").length,
          };
        } else {
          // 无缓存时用当前结果的统计（不准确但不影响功能）
          stats = {
            total: orders.length,
            ordered: orders.filter(o => o.status === "已下单").length,
            pending: orders.filter(o => o.status === "待处理").length,
            producing: orders.filter(o => o.status === "生产中").length,
            labeled: orders.filter(o => o.status === "打标签").length,
            shipped: orders.filter(o => o.status === "已发货").length,
          };
        }

        const agents = [...new Set(orders.map(o => o.agentName).filter(Boolean))].sort();
        const suppliers = [...new Set(orders.map(o => o.supplier).filter(Boolean))].sort();
        const totalPages = Math.ceil(orders.length / pageSize) || 1;
        const paged = orders.slice((page - 1) * pageSize, page * pageSize);

        jsonRes(res, 200, { orders: paged, stats, agents, suppliers, page, pageSize, totalPages, totalFiltered: orders.length });
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
      }
      return logReq(req, 200, start);
    }

    // GET /api/admin/diagnose — 订单诊断
    if (pathname === "/api/admin/diagnose") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNo = url.searchParams.get("orderNo") || "";
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        // 查订单主表
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const orderData = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
        const orderRecords = orderData?.items || [];

        // 查镜片明细
        const lensDetails = await getLensDetailsByOrder(orderNo);

        // 查草稿
        const draftPath = resolve(DRAFTS_DIR, `${orderNo}.json`);
        const failedDraftPath = draftPath + ".failed";
        let draft = null;
        if (existsSync(draftPath)) {
          try { draft = JSON.parse(readFileSync(draftPath, "utf8")); } catch {}
        } else if (existsSync(failedDraftPath)) {
          try { draft = { ...JSON.parse(readFileSync(failedDraftPath, "utf8")), failed: true }; } catch {}
        }

        // 自动诊断
        const issues = [];
        const info = [];

        if (orderRecords.length === 0 && !draft) {
          issues.push("订单不存在且无草稿");
        }

        if (draft) {
          info.push(`草稿存在${draft.failed ? "（已失败）" : "（待同步）"}, 创建于 ${new Date(draft.createdAt).toLocaleString("zh-CN")}, 重试 ${draft.retryCount || 0} 次`);
          if (draft.lastError) info.push(`最后错误: ${draft.lastError}`);
        }

        if (orderRecords.length > 0) {
          const orderStatus = orderRecords[0].fields["订单状态"] || "";
          const orderLensCode = orderRecords[0].fields["镜片码"] || "";
          info.push(`订单状态: ${orderStatus}, 镜片码字段: ${orderLensCode || "(空)"}`);

          if (lensDetails.length === 0) {
            issues.push("镜片明细为空 — 草稿同步时未创建 lens_detail 记录");
          }

          for (const lens of lensDetails) {
            const lensCode = lens.fields["镜片码（唯一）"] || "";
            const lensStatus = lens.fields["订单状态"] || "";
            const eye = lens.fields["眼别"] || "";
            info.push(`镜片明细 ${eye}: 状态=${lensStatus}, 镜片码=${lensCode || "(空)"}`);

            if (orderStatus === "打标签" && !lensCode) {
              issues.push(`${eye} 状态已是"打标签"但无镜片码 — 可能通过 update-field 直接改状态，跳过了 confirm 赋码`);
            }
            if (lensCode && !orderLensCode) {
              issues.push(`${eye} 有镜片码 ${lensCode} 但订单主表镜片码字段为空 — 码未回写到订单表`);
            }
            if (lensStatus !== orderStatus && lensStatus && orderStatus) {
              issues.push(`${eye} 镜片状态"${lensStatus}"与订单状态"${orderStatus}"不一致`);
            }
          }

          // 检查 QR 图片
          for (const lens of lensDetails) {
            const lc = lens.fields["镜片码（唯一）"] || "";
            if (lc) {
              const qrPath = resolve(QR_DIR, `${lc}.png`);
              if (!existsSync(qrPath)) {
                issues.push(`镜片码 ${lc} 的 QR 图片缺失`);
              }
            }
          }
        }

        jsonRes(res, 200, {
          orderNo,
          found: orderRecords.length > 0,
          orderCount: orderRecords.length,
          lensCount: lensDetails.length,
          draftExists: !!draft,
          draftFailed: draft?.failed || false,
          info,
          issues,
          status: issues.length === 0 ? "正常" : "有问题",
        });
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
      }
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
          lensCode: f["镜片码（唯一）"] || "",
          sku: f["产品型号"] || "",
          customerName: f["顾客姓名"] || "",
          pairIndex: f["序号"] || 1,
          status: f["订单状态"] || "",
        };
      });
      jsonRes(res, 200, { orderNo, lenses });
      return logReq(req, 200, start);
    }

    // GET /api/admin/labels/batch — 批量生成标签 HTML（按顾客维度）
    const adminLabelsMatch = pathname.match(/^\/api\/admin\/labels\/batch$/);
    if (adminLabelsMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const allLabels = [];

      for (const orderNo of orderNos) {
        let details = await getLensDetailsByOrder(orderNo);
        if (customerFilter) {
          const names = customerFilter.split(",").map(s => s.trim()).filter(Boolean);
          details = details.filter(r => names.includes(r.fields["顾客姓名"] || ""));
        }
        const enc = encodeURIComponent(`"${orderNo}"`);
        const orderRes = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${enc}`);
        const batchBinMap = {};
        for (const rec of (orderRes?.items || [])) {
          const cn = rec.fields["顾客姓名"] || "";
          const pi = Number(rec.fields["序号"] || 1);
          const bc = matchBin(rec.fields["收货地址"] || "");
          if (bc) {
            batchBinMap[`${cn}|${pi}`] = bc;
            if (!batchBinMap["_"]) batchBinMap["_"] = bc;
          }
        }
        for (const rec of details) {
          const f = rec.fields;
          if (!f["镜片码（唯一）"]) continue;
          const binCode = batchBinMap[`${f["顾客姓名"]||""}|${Number(f["序号"]||1)}`] || batchBinMap["_"] || "";
          const html = await buildLabelHtmlFromFields(f, orderNo, { binCode });
          if (html) allLabels.push(html);
        }
      }

      jsonRes(res, 200, { labels: allLabels, count: allLabels.length });
      return logReq(req, 200, start);
    }

    // GET /api/admin/labels/print — 批量生成可打印标签 HTML 页面
    const adminLabelsPrintMatch = pathname.match(/^\/api\/admin\/labels\/print$/);
    if (adminLabelsPrintMatch) {
      if (!isAdmin(req)) { res.writeHead(302, { Location: `/admin-login` }); res.end(); return logReq(req, 302, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("请提供 orderNos 参数"); return logReq(req, 200, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const pairFilter = Number(url.searchParams.get("pairIndex")) || 0;
      const customerNames = customerFilter ? customerFilter.split(",").map(s => s.trim()).filter(Boolean) : [];

      const [detailSets, orderRecordSets] = await Promise.all([
        Promise.all(orderNos.map(async (orderNo) => {
          let details = await getLensDetailsByOrder(orderNo);
          if (customerNames.length) details = details.filter(r => customerNames.includes(r.fields["顾客姓名"] || ""));
          if (pairFilter) details = details.filter(r => Number(r.fields["序号"] || 1) === Number(pairFilter));
          return details.filter(r => r.fields["镜片码（唯一）"]).map(rec => ({ fields: rec.fields, orderNo }));
        })),
        Promise.all(orderNos.map(async (orderNo) => {
          const enc = encodeURIComponent(`"${orderNo}"`);
          const r = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${enc}`);
          return { orderNo, items: r?.items || [] };
        })),
      ]);
      const printBinMap = {};
      for (const { orderNo, items } of orderRecordSets) {
        for (const rec of items) {
          const cn = rec.fields["顾客姓名"] || "";
          const pi = Number(rec.fields["序号"] || 1);
          const bc = matchBin(rec.fields["收货地址"] || "");
          if (bc) {
            printBinMap[`${orderNo}|${cn}|${pi}`] = bc;
            if (!printBinMap[orderNo]) printBinMap[orderNo] = bc;
          }
        }
      }
      const allRecords = detailSets.flat().map(r => ({
        ...r,
        binCode: printBinMap[`${r.orderNo}|${r.fields["顾客姓名"]||""}|${Number(r.fields["序号"]||1)}`]
               || printBinMap[r.orderNo] || "",
      }));

      const html = await buildPrintPage(allRecords);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html || "<p>无标签数据</p>");
      return logReq(req, 200, start);
    }

    // GET /api/admin/labels/export-excel — 导出标签 Excel（供其他打印机识别）
    const exportExcelMatch = pathname.match(/^\/api\/admin\/labels\/export-excel$/);
    if (exportExcelMatch) {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const pairFilter = Number(url.searchParams.get("pairIndex")) || 0;
      const customerNames = customerFilter ? customerFilter.split(",").map(s => s.trim()).filter(Boolean) : [];
      // 支持按订单号分组的客户过滤（orderCustomers=ORD-1:c1,c2|ORD-2:c3）
      const orderCustomersParam = url.searchParams.get("orderCustomers") || "";
      const orderCustomerMap = {};
      if (orderCustomersParam) {
        orderCustomersParam.split("|").forEach(part => {
          const idx = part.indexOf(":");
          if (idx > 0) {
            const orderNo = part.slice(0, idx).trim();
            const customers = part.slice(idx + 1).split(",").map(s => s.trim()).filter(Boolean);
            if (orderNo && customers.length) orderCustomerMap[orderNo] = customers;
          }
        });
      }

      // 并行读取镜片明细 + 订单主表（获取日期）
      const [lensResults, orderResults] = await Promise.all([
        Promise.all(orderNos.map(orderNo => getLensDetailsByOrder(orderNo))),
        Promise.all(orderNos.map(orderNo => {
          const orderEnc = encodeURIComponent(`"${orderNo}"`);
          return feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${orderEnc}`);
        })),
      ]);

      const allDetails = [];
      const dateMap = {};
      const labelInfoMap = {};
      for (let i = 0; i < orderNos.length; i++) {
        const orderNo = orderNos[i];
        let details = lensResults[i];
        // 优先使用按订单号分组的客户过滤，避免跨订单错乱
        const perOrderCustomers = orderCustomerMap[orderNo];
        if (perOrderCustomers) {
          details = details.filter(r => perOrderCustomers.includes((r.fields["顾客姓名"] || "").trim()));
        } else if (customerNames.length) {
          details = details.filter(r => customerNames.includes((r.fields["顾客姓名"] || "").trim()));
        }
        if (pairFilter) details = details.filter(r => Number(r.fields["序号"] || 1) === pairFilter);
        details = details.filter(r => r.fields["镜片码（唯一）"]);
        // 过滤迁移记录（无眼别+无SPH）
        details = details.filter(r => {
          const eye = rawVal(r.fields["眼别"]);
          const sph = r.fields["球镜SPH"];
          return eye || (sph !== '' && sph != null && sph !== '');
        });

        // 提取订单日期
        const orderRecords = orderResults[i]?.items || [];
        for (const rec of orderRecords) {
          const of = rec.fields;
          const cn = of["顾客姓名"] || "";
          const pi = Number(of["序号"] || 1);
          const dateKey = `${orderNo}|${cn}|${pi}`;
          if (!dateMap[dateKey]) {
            const rawDate = of["创建时间"] || of["发货时间"] || "";
            if (rawDate) {
              const d = new Date(rawDate);
              dateMap[dateKey] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            }
          }
        }
        if (!dateMap[orderNo] && orderRecords[0]) {
          const rawDate = orderRecords[0].fields["创建时间"] || "";
          if (rawDate) {
            const d = new Date(rawDate);
            dateMap[orderNo] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          }
        }

        // 补充镜片明细中缺失的顾客姓名（从订单主表获取）
        const custByPair = {};
        for (const rec of orderRecords) {
          const cn = rec.fields["顾客姓名"] || "";
          const pi = Number(rec.fields["序号"] || 1);
          if (cn) custByPair[`${orderNo}|${pi}`] = cn;
          const infoKey = `${orderNo}|${cn}|${pi}`;
          if (!labelInfoMap[infoKey]) {
            labelInfoMap[infoKey] = {
              contact: rec.fields["联系人"] || "",
              phone: rec.fields["联系电话"] || "",
              address: rec.fields["收货地址"] || "",
              remark: rec.fields["备注"] || "",
            };
          }
        }
        for (const d of details) {
          if (!d.fields["顾客姓名"]) {
            const pi = Number(d.fields["序号"] || 1);
            d.fields["顾客姓名"] = custByPair[`${orderNo}|${pi}`] || orderRecords[0]?.fields["顾客姓名"] || "";
          }
        }

        allDetails.push(...details);
      }

      if (!allDetails.length) { jsonRes(res, 404, { error: "所选订单无镜片数据（可能未确认或已过滤）" }); return logReq(req, 404, start); }

      // 从 labelInfoMap 中的地址推算仓位编号
      const binCodeMap = {};
      for (const [key, info] of Object.entries(labelInfoMap)) {
        if (info.address) binCodeMap[key] = matchBin(info.address);
      }

      const excelName = orderNos.length > 1 ? `标签数据_${orderNos.length}单.xlsx` : `标签数据_${orderNos[0]}.xlsx`;
      const asciiName = orderNos.length > 1 ? `labels-${orderNos.length}.xlsx` : `${orderNos[0]}-labels.xlsx`;
      const excelBuf = buildFactoryExcel(allDetails, orderNos.join("+"), labelInfoMap, dateMap, binCodeMap);

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(excelName)}`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(excelBuf);
      return logReq(req, 200, start);
    }

    // GET /api/admin/batch-zip — 批量导出 Excel（按顾客维度）
    const batchZipMatch = pathname.match(/^\/api\/admin\/batch-zip$/);
    if (batchZipMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos 参数" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      const customerFilter = url.searchParams.get("customer") || "";
      const pairFilter = Number(url.searchParams.get("pairIndex")) || 0;
      const allDetails = [];
      const skipped = [];
      const orderInfoMap = {}; // "orderNo|customerName|pairIndex" → { remark, address, contact, phone, quantity }
      const dateMap = {};

      const t0 = Date.now();

      // 并行读取所有订单的镜片明细 + 订单主表
      const [lensResults, orderResults] = await Promise.all([
        Promise.all(orderNos.map(orderNo => getLensDetailsByOrder(orderNo))),
        Promise.all(orderNos.map(orderNo => {
          const orderEnc = encodeURIComponent(`"${orderNo}"`);
          return feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${orderEnc}`);
        })),
      ]);
      const t1 = Date.now();

      // 构建 orderNo → 订单记录缓存
      const orderCache = {};
      orderNos.forEach((orderNo, i) => { orderCache[orderNo] = orderResults[i]?.items || []; });

      for (let i = 0; i < orderNos.length; i++) {
        const orderNo = orderNos[i];
        let details = lensResults[i];
        if (!details.length) { skipped.push(orderNo); continue; }

        // 按顾客姓名过滤，支持逗号分隔多客户名
        if (customerFilter) {
          const names = customerFilter.split(",").map(s => s.trim()).filter(Boolean);
          details = details.filter(r => names.includes((r.fields["顾客姓名"] || "").trim()));
        }
        if (pairFilter) {
          details = details.filter(r => Number(r.fields["序号"] || 1) === Number(pairFilter));
        }
        if (!details.length) { skipped.push(orderNo); continue; }

        // 从缓存读取订单主表信息（不再重复查询）
        const customerPairs = [...new Set(details.map(r => `${r.fields["顾客姓名"] || ""}|${r.fields["序号"] || 1}`))];
        for (const cp of customerPairs) {
          const [customerName, piStr] = cp.split("|");
          const pi = Number(piStr) || 1;
          const infoKey = `${orderNo}|${customerName}|${pi}`;
          if (orderInfoMap[infoKey]) continue;
          const customerRec = orderCache[orderNo].find(r =>
            (r.fields["顾客姓名"] || "") === customerName && Number(r.fields["序号"] || 1) === Number(pi)
          );
          const of = customerRec?.fields || {};
          orderInfoMap[infoKey] = {
            remark: of["备注"] || "",
            address: of["收货地址"] || "",
            contact: of["联系人"] || "",
            phone: of["联系电话"] || "",
            quantity: Number(of["数量"]) || 1,
          };
          if (!dateMap[infoKey]) {
            const rawDate = of["创建时间"] || of["发货时间"] || "";
            if (rawDate) {
              const d = new Date(rawDate);
              dateMap[infoKey] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            }
          }
        }
        if (!dateMap[orderNo] && orderCache[orderNo][0]) {
          const rawDate = orderCache[orderNo][0].fields["创建时间"] || "";
          if (rawDate) {
            const d = new Date(rawDate);
            dateMap[orderNo] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          }
        }

        allDetails.push(...details);
      }

      if (skipped.length) console.log(`  ⚠️ batch-zip: 跳过 ${skipped.length} 个无匹配数据的订单: ${skipped.join(", ")}`);
      if (!allDetails.length) { jsonRes(res, 404, { error: `所选 ${orderNos.length} 个订单均无匹配镜片数据（可能未确认或已过滤）`, skipped }); return logReq(req, 404, start); }

      // 生成 Excel
      const excelName = orderNos.length > 1 ? `订单_合并_${orderNos.length}单.xlsx` : `订单_${orderNos[0]}.xlsx`;
      const asciiName = orderNos.length > 1 ? `orders-${orderNos.length}.xlsx` : `${orderNos[0]}.xlsx`;
      const excelBuf = buildFactoryExcel(allDetails, orderNos.join("+"), orderInfoMap, dateMap);
      if (!excelBuf || !excelBuf.length) { jsonRes(res, 500, { error: "Excel 生成失败" }); return logReq(req, 500, start); }
      const t2 = Date.now();

      // 导出成功后，批量更新"待处理"→"生产中"（复用已缓存的订单数据 + 镜片数据）
      const allOrderUpdates = [];
      const allLensUpdates = [];
      for (let i = 0; i < orderNos.length; i++) {
        const orderNo = orderNos[i];
        const pendingRecords = orderCache[orderNo].filter(r => (r.fields["订单状态"] || "") === "待处理");
        for (const rec of pendingRecords) {
          const wf = parseWorkflow(rec.fields["流程步骤"]);
          advanceWorkflow(wf, "producing");
          allOrderUpdates.push({ record_id: rec.record_id, fields: { "订单状态": "生产中", "流程步骤": JSON.stringify(wf) } });
        }
        if (pendingRecords.length > 0) {
          const pendingLens = lensResults[i].filter(r => (r.fields["订单状态"] || "") === "待处理");
          for (const lens of pendingLens) {
            allLensUpdates.push({ record_id: lens.record_id, fields: { "订单状态": "生产中" } });
          }
        }
      }
      // 并行批量写入订单主表 + 镜片明细表
      await Promise.all([
        allOrderUpdates.length > 0 ? batchUpdateRecords(TABLES.order, allOrderUpdates) : Promise.resolve(),
        allLensUpdates.length > 0 ? batchUpdateRecords(TABLES.lens_detail, allLensUpdates) : Promise.resolve(),
      ]);
      const t3 = Date.now();
      console.log(`  batch-zip ${orderNos.length}单: 读取=${t1-t0}ms Excel=${t2-t1}ms 状态更新=${t3-t2}ms 总计=${t3-t0}ms`);

      // 记录导出日志（异步，不阻塞响应）
      const lensCodes = allDetails.map(d => d.fields["镜片码（唯一）"] || "").filter(Boolean);
      logExport("factory", orderNos, {
        lensCodes,
        filename: excelName,
        remark: `导出 ${orderNos.length} 单，${lensCodes.length} 片镜片`,
      }).catch(e => console.error("记录工厂导出日志失败:", e.message));

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(excelName)}`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(excelBuf);
      return logReq(req, 200, start);
    }

    // GET /api/admin/statement — 代理商对账单
    if (pathname === "/api/admin/statement" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const agentId = url.searchParams.get("agentId") || "";
      const startTime = Number(url.searchParams.get("startTime")) || 0;
      const endTime = Number(url.searchParams.get("endTime")) || Date.now();
      if (!agentId) { jsonRes(res, 400, { error: "请提供 agentId" }); return logReq(req, 400, start); }

      try {
        // 查询该代理商在时间范围内已发货的订单
        const filter = `AND(CurrentValue.[代理商ID]="${agentId}",CurrentValue.[订单状态]="已发货")`;
        const allRecords = [];
        let pageToken = "";
        do {
          const qs = `page_size=500&filter=${encodeURIComponent(filter)}${pageToken ? `&page_token=${pageToken}` : ""}`;
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?${qs}`);
          allRecords.push(...(d?.items || []));
          pageToken = d?.has_more ? d.page_token : "";
        } while (pageToken);

        // 按发货时间过滤
        const filtered = allRecords.filter(r => {
          const shipTime = r.fields["发货时间"];
          if (!shipTime) return false;
          return shipTime >= startTime && shipTime <= endTime;
        });

        if (!filtered.length) {
          jsonRes(res, 404, { error: "该时间段内无已发货订单" });
          return logReq(req, 404, start);
        }

        // 获取镜片明细
        const orderNos = [...new Set(filtered.map(r => r.fields["订单编号"]))];
        const lensDetailsMap = {};
        await Promise.all(orderNos.map(async (orderNo) => {
          const details = await getLensDetailsByOrder(orderNo);
          lensDetailsMap[orderNo] = details || [];
        }));

        // 构建对账数据
        const statementRows = [];
        for (const rec of filtered) {
          const f = rec.fields;
          const orderNo = f["订单编号"];
          const customerName = f["顾客姓名"] || "";
          const pairIndex = f["序号"] || 1;
          const lensDetails = (lensDetailsMap[orderNo] || []).filter(r =>
            (r.fields["顾客姓名"] || "") === customerName && Number(r.fields["序号"] || 1) === Number(pairIndex)
          );

          for (const lens of lensDetails) {
            const lf = lens.fields;
            statementRows.push({
              orderNo,
              customerName,
              sku: f["产品型号"] || "",
              eye: lf["眼别"] || "",
              sph: lf["球镜SPH"] ?? "",
              cyl: lf["柱镜CYL"] ?? "",
              axis: lf["轴位AXIS"] ?? "",
              lensCode: lf["镜片码（唯一）"] || "",
              quantity: f["数量"] || 1,
              shipDate: f["发货时间"] ? new Date(f["发货时间"]).toLocaleDateString("zh-CN") : "",
              courierName: f["物流公司"] || "",
              trackingNo: f["快递单号"] || "",
              address: f["收货地址"] || "",
            });
          }
        }

        // 生成 Excel
        const XLSX = await import("xlsx");
        const wsData = [
          ["订单编号", "客户姓名", "产品型号", "眼别", "球镜SPH", "柱镜CYL", "轴位AXIS", "镜片码", "数量", "发货日期", "物流公司", "快递单号", "收货地址"],
          ...statementRows.map(r => [
            r.orderNo, r.customerName, r.sku, r.eye, r.sph, r.cyl, r.axis, r.lensCode,
            r.quantity, r.shipDate, r.courierName, r.trackingNo, r.address,
          ]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "对账单");
        const excelBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        const agentName = filtered[0]?.fields["代理商名称"] || agentId;
        const startDate = new Date(startTime).toISOString().slice(0, 10);
        const endDate = new Date(endTime).toISOString().slice(0, 10);
        const excelName = `对账单_${agentName}_${startDate}_${endDate}.xlsx`;

        // 记录导出日志（异步，不阻塞响应）
        logExport("statement", orderNos, {
          filename: excelName,
          remark: `${agentName} 对账单，${orderNos.length} 单，${statementRows.length} 片镜片，${startDate} 至 ${endDate}`,
        }).catch(e => console.error("记录对账单导出日志失败:", e.message));

        res.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(excelName)}"`,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(excelBuf);
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // GET /api/admin/export-logs — 查询导出记录
    if (pathname === "/api/admin/export-logs" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const type = url.searchParams.get("type") || "";
      const orderNo = url.searchParams.get("orderNo") || "";
      const startTime = Number(url.searchParams.get("startTime")) || 0;
      const endTime = Number(url.searchParams.get("endTime")) || 0;

      try {
        console.log(`  export-logs: TABLES.export_log = ${TABLES.export_log}`);
        const logs = await listExportLogs({ type, orderNo, startTime: startTime || undefined, endTime: endTime || undefined });
        jsonRes(res, 200, { logs });
        return logReq(req, 200, start);
      } catch (e) {
        console.error(`  export-logs error:`, e.message, e.stack);
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // GET /api/admin/export-status — 批量查询订单导出状态
    if (pathname === "/api/admin/export-status" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }

      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      try {
        const status = await getOrderExportStatus(orderNos);
        jsonRes(res, 200, { status });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // POST /api/admin/update-field — 内联更新订单字段（库存/供应商）
    if (pathname === "/api/admin/update-field" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const { orderNo, customerName, pairIndex, field, value } = payload;
      if (!orderNo || !field) { jsonRes(res, 400, { error: "缺少 orderNo 或 field" }); return logReq(req, 400, start); }

      const encoded = encodeURIComponent(`"${orderNo}"`);
      const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
      let records = d?.items || [];
      if (customerName) records = records.filter(r => (r.fields["顾客姓名"] || "").trim() === customerName.trim());
      if (pairIndex) records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
      if (!records.length) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }

      let updated = 0;
      for (const rec of records) {
        const res2 = await updateRecord(TABLES.order, rec.record_id, { [field]: value || "" });
        if (res2) updated++;
      }
      invalidateOrdersCache();
      jsonRes(res, 200, { ok: true, updated });
      return logReq(req, 200, start);
    }

    // GET /api/admin/order-stock-check — 确认前自动查库存+推荐供应商
    if (pathname === "/api/admin/order-stock-check" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNo = url.searchParams.get("orderNo") || "";
      const customerName = url.searchParams.get("customerName") || "";
      const pairIndex = Number(url.searchParams.get("pairIndex")) || 0;
      if (!orderNo) { jsonRes(res, 400, { error: "需要 orderNo" }); return logReq(req, 400, start); }

      try {
        let lensDetails = await getLensDetailsByOrder(orderNo);
        if (customerName) lensDetails = lensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (pairIndex) lensDetails = lensDetails.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));

        if (!lensDetails.length) {
          jsonRes(res, 200, { lenses: [], suggestedStockStatus: "无库存", suggestedSupplier: "", note: "无镜片明细" });
          return logReq(req, 200, start);
        }

        const lensInputs = lensDetails.map(r => {
          const f = r.fields || {};
          return { eye: rawVal(f["眼别"]) || "—", sku: rawVal(f["产品型号"]) || "", sph: Number(f["球镜SPH"]), cyl: Number(f["柱镜CYL"]) };
        });

        const stockResults = await resolveStock(lensInputs);
        const summary = summarizeStock(stockResults);

        const lenses = lensInputs.map((l, i) => ({
          eye: l.eye, sku: l.sku, sph: l.sph, cyl: l.cyl,
          stock: stockResults[i]?.stock ?? 0,
          status: stockResults[i]?.inStock ? "有库存" : "无库存",
        }));

        const config = loadRulesConfig();
        const supplierMap = config.supplier_map || {};
        const skuSet = new Set(lensInputs.map(l => l.sku).filter(Boolean));
        const mainSku = [...skuSet][0] || "";
        const mapping = supplierMap[mainSku] || {};
        const suggestedSupplier = summary.suggestedStockStatus === "无库存"
          ? (mapping.out_of_stock || mapping.in_stock || "")
          : "";

        jsonRes(res, 200, { lenses, suggestedStockStatus: summary.suggestedStockStatus, suggestedSupplier, note: summary.note });
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
      }
      return logReq(req, 200, start);
    }

    // POST /api/admin/confirm — 确认订单（批量，可按客户维度）
    if (pathname === "/api/admin/confirm" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      const stockStatus = payload.stockStatus || "";
      const supplier = payload.supplier || "";
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const results = [];
      // 并行读取所有 orderNo 的 Bitable 数据（多订单同时查，不串行等待）
      const orderReads = await Promise.all(orderNos.map(async (orderNo) => {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const [orderData, lensDetails] = await Promise.all([
          feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`),
          getLensDetailsByOrder(orderNo),
        ]);
        return { orderNo, records: orderData?.items || [], lensDetails };
      }));

      // 阶段1：校验+读取+库存检查（必须同步，用于确定目标状态）
      const prepared = await Promise.all(orderReads.map(async ({ orderNo, records: rawRecords, lensDetails }) => {
        try {
          let records = rawRecords;
          if (!records.length) return { orderNo, ok: false, error: "未找到" };

          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) return { orderNo, ok: false, error: `未找到客户 "${customerName}"` };
          }
          if (pairIndex) {
            records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
            if (!records.length) return { orderNo, ok: false, error: `未找到第${pairIndex}副` };
          }

          const badConfirm = records.filter(r => (r.fields["订单状态"] || "") !== "已下单");
          if (badConfirm.length) {
            const badStatus = [...new Set(badConfirm.map(r => r.fields["订单状态"] || "未知"))].join(",");
            return { orderNo, ok: false, error: `当前状态"${badStatus}"，仅"已下单"可确认` };
          }

          let matchedLens = lensDetails.filter(r => {
            if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
            if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
            return true;
          });

          const lensForStock = matchedLens.map(r => ({
            sku: rawVal(r.fields["产品型号"]) || "",
            sph: Number(r.fields["球镜SPH"]),
            cyl: Number(r.fields["柱镜CYL"]),
          }));
          const stockResults = await resolveStock(lensForStock);

          const existingSupplier = rawVal(records[0]?.fields["供应商厂家"] || "");
          let confirmTargetStatus, confirmWfStep, deliveryType;
          if (stockStatus) {
            confirmTargetStatus = stockStatus === "有库存" ? "打标签" : "待处理";
            confirmWfStep = stockStatus === "有库存" ? "labeled" : "confirmed";
            deliveryType = stockStatus === "有库存" ? "有货1-2天" : "排产5-7天";
          } else if (existingSupplier === "高清") {
            confirmTargetStatus = "打标签";
            confirmWfStep = "labeled";
            deliveryType = "有货1-2天";
          } else {
            const route = routeConfirm(stockResults);
            confirmTargetStatus = route.targetStatus;
            confirmWfStep = route.wfStep;
            deliveryType = route.deliveryType;
          }
          const effectiveStock = stockStatus || (existingSupplier === "高清" ? "有库存" : (stockResults.every(r => r.inStock) ? "有库存" : "无库存"));

          return { orderNo, ok: true, records, matchedLens, confirmTargetStatus, confirmWfStep, deliveryType, effectiveStock };
        } catch (e) {
          return { orderNo, ok: false, error: e.message };
        }
      }));

      // 立即返回响应
      for (const p of prepared) {
        if (!p.ok) results.push({ orderNo: p.orderNo, ok: false, error: p.error });
        else results.push({ orderNo: p.orderNo, ok: true, async: true, targetStatus: p.confirmTargetStatus });
      }
      jsonRes(res, 200, { results });
      logReq(req, 200, start);

      // 阶段2：后台执行赋码+写入（不阻塞响应）
      for (const p of prepared) {
        if (!p.ok) continue;
        const { orderNo, records, matchedLens, confirmTargetStatus, confirmWfStep, deliveryType, effectiveStock } = p;
        (async () => {
          try {
            const t0 = Date.now();
            const lensCodes = [];
            const lensUpdates = [];
            const qrPromises = [];
            for (const rec of matchedLens) {
              let code = rec.fields["镜片码（唯一）"];
              if (!code) {
                code = genLensCode();
                qrPromises.push(generateQRPng(code));
                console.log(`  镜片码生成: ${orderNo} → ${code}`);
              }
              lensCodes.push(code);
              lensUpdates.push({ record_id: rec.record_id, fields: { "镜片码（唯一）": code, "订单状态": confirmTargetStatus, "镜片码状态": "active" } });
            }
            if (qrPromises.length) await Promise.all(qrPromises);
            const t1 = Date.now();
            if (lensUpdates.length > 0) await batchUpdateRecords(TABLES.lens_detail, lensUpdates);
            const t2 = Date.now();

            for (const rec of matchedLens) {
              const lc = rec.fields["镜片码（唯一）"];
              if (!lc) continue;
              _lensCache.set(lc, {
                orderNo,
                customer: rec.fields["顾客姓名"] || customerName,
                sku: rec.fields["产品型号"] || "",
                pairIndex: Number(rec.fields["序号"] || 1),
                side: rec.fields["眼别"] || "",
                sph: rec.fields["球镜SPH"] ?? "",
                cyl: rec.fields["柱镜CYL"] ?? "",
                axis: rec.fields["轴位AXIS"] ?? "",
              });
            }

            const storeName = rawVal(records[0]?.fields["终端门店"]) || "";
            const store = await getStoreByName(storeName);
            const storeBinCode = store?.binCode || "";

            const orderUpdates = records.map(rec => {
              const existingCodes = String(rec.fields["镜片码"] || "").split(",").filter(Boolean);
              const mergedCodes = [...new Set([...existingCodes, ...lensCodes])];
              const wf = parseWorkflow(rec.fields["流程步骤"]);
              advanceWorkflow(wf, confirmWfStep);
              return {
                record_id: rec.record_id,
                fields: {
                  "订单状态": confirmTargetStatus,
                  ...(mergedCodes.length > 0 ? { "镜片码": mergedCodes.join(",") } : {}),
                  ...(deliveryType ? { "交期类型": deliveryType } : {}),
                  ...(effectiveStock ? { "库存状态": effectiveStock } : {}),
                  ...(supplier ? { "供应商厂家": supplier } : {}),
                  ...(storeBinCode ? { "仓位": storeBinCode } : {}),
                  "流程步骤": JSON.stringify(wf),
                },
              };
            });
            await batchUpdateRecords(TABLES.order, orderUpdates);
            const t3 = Date.now();
            console.log(`  confirm ${orderNo} [async]: 准备=${t1-t0}ms 镜片写=${t2-t1}ms 订单写=${t3-t2}ms 总计=${t3-t0}ms`);
            invalidateOrdersCache();
          } catch (e) {
            console.error(`  confirm ${orderNo} [async] 失败:`, e.message);
          }
        })();
      }
      return;
    }

    // POST /api/admin/batch-import — 批量赋码：解析 Excel → 写入镜片明细表 → 返回 Excel
    if (pathname === "/api/admin/batch-import" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req, 30 * 1024 * 1024);
      const { files } = payload;
      if (!files?.length) { jsonRes(res, 400, { error: "请提供文件" }); return logReq(req, 400, start); }

      const allRows = [];
      const bitableRecords = [];

      const findIdx = (headers, ...names) => {
        for (const name of names) {
          const nl = name.toLowerCase();
          const idx = headers.findIndex(h => h.toLowerCase() === nl || h.toLowerCase().startsWith(nl) || h.toLowerCase().includes(nl));
          if (idx >= 0) return idx;
        }
        return -1;
      };

      for (const file of files) {
        try {
          const buffer = Buffer.from(file.data, "base64");
          const workbook = XLSX.read(buffer, { type: "buffer" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          if (rows.length < 2) continue;

          // 找表头行（包含 球镜/SPH/产品型号 等关键词）
          let headerIdx = rows.findIndex(r => r.some(c => /球镜|SPH|产品型号|型号/i.test(String(c))));
          if (headerIdx < 0) headerIdx = 0;

          const headers = rows[headerIdx].map(c => String(c || "").trim());
          const iSph = findIdx(headers, "球镜SPH", "球镜", "SPH", "sph", "近视", "度数");
          const iCyl = findIdx(headers, "柱镜CYL", "柱镜", "CYL", "cyl", "散光");
          const iAxis = findIdx(headers, "轴位AXIS", "轴位", "AXIS", "axis");
          const iSku = findIdx(headers, "产品型号", "型号", "产品", "SKU");
          const iQty = findIdx(headers, "数量", "数量(片)", "数量（副）", "片数", "副数", "qty");

          if (iSph < 0 && iCyl < 0) continue;

          const toNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : Math.round(n * 4) / 4; };

          for (let r = headerIdx + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row.some(c => c != null && String(c).trim() !== "")) continue;

            const sph = iSph >= 0 ? row[iSph] : "";
            const cyl = iCyl >= 0 ? row[iCyl] : "";
            const axis = iAxis >= 0 ? row[iAxis] : "";
            const sku = iSku >= 0 ? String(row[iSku] || "").trim() : "";
            const qty = iQty >= 0 ? Math.max(1, Number(row[iQty]) || 1) : 1;

            if (sph === "" && cyl === "" && axis === "") continue;

            // 每个数量生成一个独立镜片码
            for (let q = 0; q < qty; q++) {
              const code = genLensCode();

              allRows.push({
                "产品型号": sku,
                "球镜SPH": sph !== "" ? toNum(sph).toFixed(2) : "",
                "柱镜CYL": cyl !== "" ? toNum(cyl).toFixed(2) : "",
                "轴位AXIS": axis !== "" ? Math.min(180, Math.max(0, Math.round(Number(axis)))) : "",
                "数量": qty,
                "镜片码": code,
                "验真网址": `https://lab.gaushclear.com/verify/${code}`,
              });

              bitableRecords.push({
                fields: {
                  "镜片码（唯一）": code,
                  "订单编号": genOrderNo(),
                  "球镜SPH": toNum(sph),
                  "柱镜CYL": toNum(cyl),
                  "轴位AXIS": Number(axis) || 0,
                  "产品型号": sku,
                  "序号": 1,
                  "订单状态": "生产中",
                },
              });
            }
          }
        } catch (e) {
          console.error(`  解析失败: ${file.name} - ${e.message}`);
        }
      }

      if (!allRows.length) {
        jsonRes(res, 400, { error: "未解析到镜片数据" });
        return logReq(req, 400, start);
      }

      // 写入镜片明细表
      if (bitableRecords.length > 0) {
        const ok = await batchCreateRecords(TABLES.lens_detail, bitableRecords);
        if (!ok) console.error("  镜片明细表写入失败");
        else console.log(`  写入镜片明细表: ${bitableRecords.length} 条`);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(allRows);
      ws["!cols"] = [
        { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
        { wch: 6 }, { wch: 18 }, { wch: 50 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "批量赋码");
      const buf = Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }));

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="batch-codes-${new Date().toISOString().slice(0,10)}.xlsx"`,
        "Content-Length": buf.length,
      });
      res.end(buf);
      return logReq(req, 200, start);
    }

    // POST /api/admin/batch-merge/parse — 解析多个Excel，返回预览数据
    if (pathname === "/api/admin/batch-merge/parse" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req, 30 * 1024 * 1024);
      const { files } = payload;
      if (!files || !Array.isArray(files) || files.length === 0) { jsonRes(res, 400, { error: "请提供文件" }); return logReq(req, 400, start); }

      const orders = [];
      const warnings = [];

      for (const file of files) {
        try {
          const parsed = await handleExcelUpload({ data: file.data });
          if (!parsed.patients.length) {
            warnings.push(`${file.name}: 未解析到有效数据`);
            continue;
          }

          const agentMatch = file.name.match(/AG(\d{3})/i);
          const agentId = agentMatch ? `AG${agentMatch[1]}` : "";
          const agents = await loadAgents();
          const agentInfo = agentId && agents.find(a => a.id === agentId);
          
          orders.push({
            file: file.name,
            agentId: agentId || (agents.length > 0 ? agents[0].id : ""),
            agentName: agentInfo?.name || (agents.length > 0 ? agents[0].name : ""),
            patients: parsed.patients,
            contact: parsed.contact,
            phone: parsed.phone,
            address: parsed.address,
            warnings: parsed.warnings,
          });

          if (parsed.warnings?.length) warnings.push(...parsed.warnings.map(w => `${file.name}: ${w}`));
        } catch (e) {
          warnings.push(`${file.name}: 解析失败 - ${e.message}`);
        }
      }

      jsonRes(res, 200, { success: true, orders, warnings });
      return logReq(req, 200, start);
    }

    // POST /api/admin/batch-merge/confirm — 确认后写入Bitable
    if (pathname === "/api/admin/batch-merge/confirm" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req, 30 * 1024 * 1024);
      const { orders } = payload;
      if (!orders?.length) { jsonRes(res, 400, { error: "请提供订单数据" }); return logReq(req, 400, start); }

      const allOrderRecords = [];
      const allLensRecords = [];
      let totalOrders = 0, totalLenses = 0;

      for (const order of orders) {
        const agentInfo = {
          id: order.agentId,
          name: order.agentName,
          contact: order.contact || "",
          phone: order.phone || "",
          address: order.address || "",
        };
        const orderNo = genMergeOrderNo();
        const orderRecords = buildMergeOrderRecords(order.patients, agentInfo, orderNo);
        const lensRecords = buildMergeLensRecords(order.patients, agentInfo, orderNo);

        allOrderRecords.push(...orderRecords);
        allLensRecords.push(...lensRecords);
        totalOrders += orderRecords.length;
        totalLenses += lensRecords.length;
      }

      if (allOrderRecords.length > 0) {
        const ok = await batchCreateRecords(TABLES.order, allOrderRecords);
        if (!ok) { jsonRes(res, 500, { success: false, error: "订单主表写入失败" }); return logReq(req, 500, start); }
      }
      if (allLensRecords.length > 0) {
        const ok = await batchCreateRecords(TABLES.lens_detail, allLensRecords);
        if (!ok) { jsonRes(res, 500, { success: false, error: "镜片明细表写入失败" }); return logReq(req, 500, start); }
      }

      jsonRes(res, 200, { success: true, orderCount: totalOrders, lensCount: totalLenses });
      return logReq(req, 200, start);
    }

    // GET /api/admin/lens-codes — 查询镜片码列表（QR 用）
    if (pathname === "/api/admin/lens-codes" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const records = await listRecords(TABLES.lens_detail, ["镜片码（唯一）","顾客姓名","眼别","产品型号"]);
      const codes = (records || []).map(r => ({
        code: r.fields["镜片码（唯一）"] || "",
        name: r.fields["顾客姓名"] || "",
        eye: r.fields["眼别"] || "",
        sku: r.fields["产品型号"] || "",
      })).filter(c => c.code);
      jsonRes(res, 200, { codes });
      return logReq(req, 200, start);
    }

    // POST /api/admin/revert — 退回上一步（生产中→待处理→已下单）
    if (pathname === "/api/admin/revert" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const REVERT_MAP = { "生产中": "待处理", "待处理": "已下单", "打标签": "已下单" };
      const results = [];
      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (customerName) records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
          if (pairIndex) records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          const currentStatus = records[0].fields["订单状态"] || "";
          const targetStatus = REVERT_MAP[currentStatus];
          if (!targetStatus) { results.push({ orderNo, ok: false, error: `状态"${currentStatus}"不可退回` }); continue; }

          // 更新订单主表状态
          for (const rec of records) {
            const updateFields = { "订单状态": targetStatus };
            // 退回到已下单时清除镜片码（无论从待处理还是打标签退回）
            if (targetStatus === "已下单") updateFields["镜片码"] = "";
            await updateRecord(TABLES.order, rec.record_id, updateFields);

            // 工作流回退
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            if (targetStatus === "待处理") {
              delete wf.steps?.producing;
              wf.current = Math.min(wf.current || 0, STEP_ORDER.indexOf("confirmed"));
            } else if (targetStatus === "已下单") {
              delete wf.steps?.confirmed;
              delete wf.steps?.producing;
              delete wf.steps?.labeled;
              wf.current = Math.min(wf.current || 0, STEP_ORDER.indexOf("submitted"));
            }
            await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(wf) });
          }

          // 同步镜片明细表
          const lensDetails = await getLensDetailsByOrder(orderNo);
          const matchedLens = lensDetails.filter(r => {
            if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
            if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
            return (r.fields["订单状态"] || "") === currentStatus;
          });
          for (const lens of matchedLens) {
            await updateRecord(TABLES.lens_detail, lens.record_id, { "订单状态": targetStatus });
          }

          // ── 释放预占库存 ──
          try {
            const releaseLenses = lensDetails.filter(r => {
              if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
              if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
              return true;
            });
            const releaseMap = new Map();
            for (const rec of releaseLenses) {
              const lf = rec.fields || {};
              const sku = rawVal(lf["产品型号"]) || "";
              const sph = Number(lf["球镜SPH"]);
              const cyl = Number(lf["柱镜CYL"]);
              if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
              const rKey = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
              releaseMap.set(rKey, (releaseMap.get(rKey) || 0) + 1);
            }
            for (const [rKey, qty] of releaseMap) {
              const [sku, sph, cyl] = rKey.split("|");
              await releaseReservation(sku, Number(sph), Number(cyl), qty);
            }
          } catch (e) {
            console.error(`  ⚠️ 释放预占库存异常(${orderNo}):`, e.message);
          }

          results.push({ orderNo, ok: true, from: currentStatus, to: targetStatus });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      invalidateOrdersCache();
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/modify-rx — 改单：修改处方（SPH/CYL/AXIS），自动退回已下单
    if (pathname === "/api/admin/modify-rx" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const { orderNo, customerName, pairIndex, lenses } = await readBody(req);
      if (!orderNo || !Array.isArray(lenses) || !lenses.length) { jsonRes(res, 400, { error: "请提供 orderNo 和 lenses" }); return logReq(req, 400, start); }
      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
        let records = (d?.items || []).filter(r => {
          if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
          if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
          return true;
        });
        if (!records.length) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }
        const currentStatus = records[0].fields["订单状态"] || "";
        if (currentStatus === "已发货" || currentStatus === "已签收" || currentStatus === "已退货") {
          jsonRes(res, 400, { error: `"${currentStatus}"状态不可改单` }); return logReq(req, 400, start);
        }
        if (currentStatus !== "已下单") {
          for (const rec of records) {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            delete wf.steps?.confirmed; delete wf.steps?.producing; delete wf.steps?.labeled;
            wf.current = Math.min(wf.current || 0, STEP_ORDER.indexOf("submitted"));
            await updateRecord(TABLES.order, rec.record_id, { "订单状态": "已下单", "镜片码": "", "流程步骤": JSON.stringify(wf) });
          }
          const allLens0 = await getLensDetailsByOrder(orderNo);
          for (const lens of allLens0) {
            if (customerName && (lens.fields["顾客姓名"] || "") !== customerName) continue;
            if (pairIndex && Number(lens.fields["序号"] || 1) !== Number(pairIndex)) continue;
            await updateRecord(TABLES.lens_detail, lens.record_id, { "订单状态": "已下单" });
          }
        }
        const allLens = await getLensDetailsByOrder(orderNo);
        for (const lens of allLens) {
          if (customerName && (lens.fields["顾客姓名"] || "") !== customerName) continue;
          if (pairIndex && Number(lens.fields["序号"] || 1) !== Number(pairIndex)) continue;
          const eye = lens.fields["眼别"] || "";
          const newRx = lenses.find(l => l.eye === eye);
          if (!newRx) continue;
          const upd = {};
          if (newRx.sph !== undefined && newRx.sph !== "") upd["球镜SPH"] = Number(newRx.sph);
          if (newRx.cyl !== undefined && newRx.cyl !== "") upd["柱镜CYL"] = Number(newRx.cyl);
          if (newRx.axis !== undefined && newRx.axis !== "") upd["轴位AXIS"] = Number(newRx.axis);
          if (Object.keys(upd).length) await updateRecord(TABLES.lens_detail, lens.record_id, upd);
        }
        invalidateOrdersCache();
        jsonRes(res, 200, { ok: true, orderNo, revertedFrom: currentStatus !== "已下单" ? currentStatus : null });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
      return logReq(req, 200, start);
    }

    // POST /api/admin/wrong-shipment — 发错货标记（备注打标，状态不变）
    if (pathname === "/api/admin/wrong-shipment" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const { orderNo, customerName, pairIndex, note } = await readBody(req);
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }
      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
        let records = (d?.items || []).filter(r => {
          if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
          if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
          return true;
        });
        if (!records.length) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }
        const dateStr = new Date().toISOString().slice(5, 10).replace("-", "/");
        const tag = note ? `【发错货 ${dateStr}】${note}` : `【发错货 ${dateStr}】`;
        for (const rec of records) {
          const existing = String(rec.fields["备注"] || "").trim();
          await updateRecord(TABLES.order, rec.record_id, { "备注": existing ? `${existing}\n${tag}` : tag });
        }
        invalidateOrdersCache();
        jsonRes(res, 200, { ok: true, orderNo, tag });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
      return logReq(req, 200, start);
    }

    // POST /api/admin/return-order — 退货（已发货/已签收→已退货）
    if (pathname === "/api/admin/return-order" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const { orderNo, customerName, pairIndex, reason } = await readBody(req);
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }
      try {
        const encoded = encodeURIComponent(`"${orderNo}"`);
        const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
        let records = (d?.items || []).filter(r => {
          if (customerName && (r.fields["顾客姓名"] || "") !== customerName) return false;
          if (pairIndex && Number(r.fields["序号"] || 1) !== Number(pairIndex)) return false;
          return true;
        });
        if (!records.length) { jsonRes(res, 404, { error: "未找到订单" }); return logReq(req, 404, start); }
        const currentStatus = records[0].fields["订单状态"] || "";
        if (currentStatus !== "已发货" && currentStatus !== "已签收") {
          jsonRes(res, 400, { error: `仅已发货/已签收可退货，当前"${currentStatus}"` }); return logReq(req, 400, start);
        }
        const dateStr = new Date().toISOString().slice(5, 10).replace("-", "/");
        const tag = reason ? `【退货 ${dateStr}】${reason}` : `【退货 ${dateStr}】`;
        for (const rec of records) {
          const existing = String(rec.fields["备注"] || "").trim();
          await updateRecord(TABLES.order, rec.record_id, { "订单状态": "已退货", "备注": existing ? `${existing}\n${tag}` : tag });
        }
        const lensDetails = await getLensDetailsByOrder(orderNo);
        for (const lens of lensDetails) {
          if (customerName && (lens.fields["顾客姓名"] || "") !== customerName) continue;
          if (pairIndex && Number(lens.fields["序号"] || 1) !== Number(pairIndex)) continue;
          await updateRecord(TABLES.lens_detail, lens.record_id, { "订单状态": "已退货" });
        }
        invalidateOrdersCache();
        jsonRes(res, 200, { ok: true, orderNo, from: currentStatus });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
      return logReq(req, 200, start);
    }

    // POST /api/admin/exchange-order — 换货赋码（旧码void + 新码生成 + 退换货登记）
    if (pathname === "/api/admin/exchange-order" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const { orderNo, eye, reason, responsibility } = await readBody(req);
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }
      if (!eye || !["左", "右", "双"].includes(eye)) { jsonRes(res, 400, { error: "请提供 eye: 左/右/双" }); return logReq(req, 400, start); }
      try {
        const lensDetails = await getLensDetailsByOrder(orderNo);
        if (!lensDetails.length) { jsonRes(res, 404, { error: "该订单无镜片明细" }); return logReq(req, 404, start); }

        // 筛选目标眼别
        const targets = lensDetails.filter(r => {
          if (eye === "双") return true;
          const side = r.fields["眼别"] || "";
          return eye === "左" ? side.includes("左") : side.includes("右");
        });
        if (!targets.length) { jsonRes(res, 404, { error: `未找到${eye}眼镜片` }); return logReq(req, 404, start); }

        const results = [];
        const exchangeRecords = [];
        const now = new Date().toISOString().slice(0, 10);

        for (const rec of targets) {
          const oldCode = rec.fields["镜片码（唯一）"];
          if (!oldCode) { results.push({ eye: rec.fields["眼别"], ok: false, error: "无镜片码" }); continue; }
          if (rec.fields["镜片码状态"] === "void") { results.push({ eye: rec.fields["眼别"], ok: false, error: "已作废" }); continue; }

          // 生成新码
          const newCode = genLensCode();
          await generateQRPng(newCode);

          // 旧码 → void，记录替换码
          await updateRecord(TABLES.lens_detail, rec.record_id, {
            "镜片码状态": "void",
            "替换码": newCode,
          });
          // 清除旧码的验真缓存和镜片缓存
          _verifyCache.delete(oldCode);
          _lensCache.delete(oldCode);

          // 新码 → 新记录
          const newRec = {
            "订单编号": orderNo,
            "镜片码（唯一）": newCode,
            "顾客姓名": rec.fields["顾客姓名"] || "",
            "产品型号": rec.fields["产品型号"] || "",
            "球镜SPH": rec.fields["球镜SPH"],
            "柱镜CYL": rec.fields["柱镜CYL"],
            "轴位AXIS": rec.fields["轴位AXIS"],
            "眼别": rec.fields["眼别"] || "",
            "序号": rec.fields["序号"] || 1,
            "订单状态": rec.fields["订单状态"] || "已下单",
            "镜片码状态": "active",
            "替换码": oldCode,
          };
          await createRecord(TABLES.lens_detail, newRec);

          // 更新缓存
          _lensCache.set(newCode, {
            orderNo,
            customer: rec.fields["顾客姓名"] || "",
            sku: rec.fields["产品型号"] || "",
            pairIndex: Number(rec.fields["序号"] || 1),
            side: rec.fields["眼别"] || "",
            sph: rec.fields["球镜SPH"] ?? "",
            cyl: rec.fields["柱镜CYL"] ?? "",
            axis: rec.fields["轴位AXIS"] ?? "",
          });

          // 更新订单主表镜片码字段
          const orderRecs = await feishuApi("GET",
            `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encodeURIComponent(`"${orderNo}"`)}`
          );
          for (const oRec of (orderRecs?.items || [])) {
            const codes = String(oRec.fields["镜片码"] || "").split(",").filter(Boolean);
            const idx = codes.indexOf(oldCode);
            if (idx >= 0) codes[idx] = newCode;
            else codes.push(newCode);
            await updateRecord(TABLES.order, oRec.record_id, { "镜片码": codes.join(",") });
          }

          results.push({ eye: rec.fields["眼别"], oldCode, newCode, ok: true });
          exchangeRecords.push({ oldCode, newCode, eye: rec.fields["眼别"] });
        }

        // 写退换货登记表
        if (exchangeRecords.length > 0 && TABLES.return_exchange) {
          const agent = lensDetails[0]?.fields["代理商"] || "";
          const sku = lensDetails[0]?.fields["产品型号"] || "";
          for (const ex of exchangeRecords) {
            await createRecord(TABLES.return_exchange, {
              "日期": Date.now(),
              "原订单号": orderNo,
              "代理商": agent,
              "产品型号": sku,
              "眼别": ex.eye,
              "类型": "换货",
              "原因": reason || "质量问题",
              "责任方": responsibility || "公司",
              "旧镜片码": ex.oldCode,
              "新镜片码": ex.newCode,
              "处理人": "系统",
            });
          }
        }

        invalidateOrdersCache();
        jsonRes(res, 200, { ok: true, orderNo, results });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
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
            const pi = rec.fields["序号"] || 1;
            const key = `${cn}|${pi}`;
            if (!custMap[key]) custMap[key] = rec;
          }
          const lensDetails = await getLensDetailsByOrder(orderNo);
          for (const [key, rec] of Object.entries(custMap)) {
            const [custName, piStr] = key.split("|");
            const pi = Number(piStr) || 1;
            const f = rec.fields;
            let filtered = previewCustomers.length ? lensDetails.filter(r => previewCustomers.includes(r.fields["顾客姓名"] || "")) : lensDetails;
            filtered = filtered.filter(r => Number(r.fields["序号"] || 1) === Number(pi));
            const rows = filtered.map(r => {
              const lf = r.fields;
              return {
                eye: rawVal(lf["眼别"]) || "—",
                sku: rawVal(lf["产品型号"]),
                customerName: rawVal(lf["顾客姓名"]) || "",
                sph: lf["球镜SPH"] ?? "",
                cyl: lf["柱镜CYL"] ?? "",
                axis: lf["轴位AXIS"] ?? "",
                lensCode: rawVal(lf["镜片码（唯一）"]),
              };
            }).sort((a, b) => {
              const nc = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
              if (nc !== 0) return nc;
              return a.eye.includes("右") ? -1 : 1;
            });
            orders.push({
              orderNo,
              customerName: custName,
              pairIndex: pi,
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
      const pairFilter = Number(url.searchParams.get("pairIndex")) || 0;
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
          const matched = d.items.find(r => rawVal(r.fields["顾客姓名"]) === customerFilter && (!pairFilter || Number(r.fields["序号"] || 1) === Number(pairFilter)));
          if (matched) orderRec = matched;
          lensDetails = allLensDetails.filter(r => rawVal(r.fields["顾客姓名"]) === customerFilter);
        }
        if (pairFilter) {
          lensDetails = lensDetails.filter(r => Number(r.fields["序号"] || 1) === Number(pairFilter));
        }
        const f0 = orderRec.fields;
        const rows = lensDetails
          .filter(r => {
            const f = r.fields;
            const eye = rawVal(f["眼别"]);
            const sph = f["球镜SPH"];
            // 过滤迁移记录（无眼别+无SPH）
            return eye || (sph !== '' && sph != null && sph !== '');
          })
          .map((r, i) => {
            const f = r.fields;
            return {
              eye: rawVal(f["眼别"]) || (i === 0 ? "右眼" : "左眼"),
              sku: rawVal(f["产品型号"]),
              customerName: rawVal(f["顾客姓名"]) || "",
              sph: f["球镜SPH"] ?? "",
              cyl: f["柱镜CYL"] ?? "",
              axis: f["轴位AXIS"] ?? "",
              lensCode: rawVal(f["镜片码（唯一）"]),
              pairIndex: f["序号"] || 1,
            };
          }).sort((a, b) => {
          const pi = (a.pairIndex || 1) - (b.pairIndex || 1);
          if (pi !== 0) return pi;
          const nc = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
          if (nc !== 0) return nc;
          return a.eye.includes("右") ? -1 : 1;
        });
        const html = slipHTML({
          orderNo,
          customerName: rawVal(f0["顾客姓名"]),
          agentName: rawVal(f0["代理商名称"]),
          agentId: rawVal(f0["代理商ID"]),
          shipDate: f0["发货时间"] ? new Date(f0["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
          promiseDate: f0["预计交期"] ? new Date(f0["预计交期"]).toLocaleDateString("zh-CN") : "",
          courierName: rawVal(f0["物流公司"]),
          trackingNo: rawVal(f0["快递单号"]),
          address: rawVal(f0["收货地址"]),
          binCode: matchBin(rawVal(f0["收货地址"]) || ""),
          rows,
        });

        // 记录通行单导出日志（异步，不阻塞响应）
        const lensCodes = rows.map(r => r.lensCode).filter(Boolean);
        logExport("slip", [orderNo], {
          lensCodes,
          filename: `通行单_${orderNo}`,
          remark: `生成随货同行单，${lensCodes.length} 片镜片`,
        }).catch(e => console.error("记录通行单导出日志失败:", e.message));

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // GET /api/admin/slip-batch — 批量随货同行单（按仓位分组）
    if (pathname === "/api/admin/slip-batch" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const adminToken = url.searchParams.get("admin") || "";
      const orderNosParam = url.searchParams.get("orderNos") || "";
      const binFilter = url.searchParams.get("bin") || "";
      try {
        let records;
        if (orderNosParam) {
          // 按选中的订单号拉取（打标签/已发货状态均可）
          const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
          records = [];
          for (const no of orderNos) {
            const enc = encodeURIComponent(`"${no}"`);
            const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${enc}`);
            if (d?.items) records.push(...d.items);
          }
        } else {
          // 无参数时拉全部打标签+已发货订单
          const allRecs = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=500`);
          records = (allRecs?.items || []).filter(r => {
            const s = rawVal(r.fields["订单状态"]) || "";
            return s === "打标签" || s === "已发货";
          });
        }
        if (!records.length) { jsonRes(res, 404, { error: "无打标签或已发货订单" }); return logReq(req, 404, start); }

        // 按终端门店分组（同门店一张单，不同门店即使同仓位也分开）
        const storeFilter = url.searchParams.get("store") || binFilter;
        const groupMap = {};
        for (const r of records) {
          const f = r.fields;
          const storeName = rawVal(f["终端门店"]) || "";
          const addr = rawVal(f["收货地址"]) || "";
          const binCode = rawVal(f["仓位"]) || matchBin(addr);
          const groupKey = storeName || addr || binCode || "default";
          if (!groupMap[groupKey]) groupMap[groupKey] = {
            groupKey, binCode, address: addr, storeName,
            trackingNo: rawVal(f["快递单号"]) || "", courierName: rawVal(f["物流公司"]) || "",
            shipDate: f["发货时间"] ? new Date(f["发货时间"]).toLocaleDateString("zh-CN") : new Date().toLocaleDateString("zh-CN"),
            records: [],
          };
          const orderNo = rawVal(f["订单编号"]) || "";
          if (!groupMap[groupKey].records.find(rr => rawVal(rr.fields["订单编号"]) === orderNo)) {
            groupMap[groupKey].records.push(r);
          }
        }
        let groups = Object.values(groupMap).sort((a, b) => (a.binCode || "").localeCompare(b.binCode || ""));
        if (storeFilter) groups = groups.filter(g => g.groupKey === storeFilter);
        if (!groups.length) { jsonRes(res, 404, { error: "无匹配门店" }); return logReq(req, 404, start); }

        // 单地址直接返回同行单
        if (groups.length === 1) {
          const g = groups[0];
          const orderNos = [...new Set(g.records.map(r => rawVal(r.fields["订单编号"])))];
          const allLens = await Promise.all(orderNos.map(no => getLensDetailsByOrder(no)));
          const rows = [];
          for (const lensDetails of allLens) {
            for (const ld of lensDetails) {
              const f = ld.fields;
              // 过滤迁移记录（无眼别+无SPH）
              const eye = rawVal(f["眼别"]);
              const sph = f["球镜SPH"];
              if (!eye && (sph === '' || sph == null || sph === '')) continue;
              rows.push({
                customerName: rawVal(f["顾客姓名"]) || "",
                eye: rawVal(f["眼别"]) || "—", sku: rawVal(f["产品型号"]),
                sph: f["球镜SPH"] ?? "", cyl: f["柱镜CYL"] ?? "", axis: f["轴位AXIS"] ?? "",
                lensCode: rawVal(f["镜片码（唯一）"]), pairIndex: f["序号"] || 1,
              });
            }
          }
          rows.sort((a, b) => {
            const nc = (a.customerName || "").localeCompare(b.customerName || "", "zh-CN");
            if (nc !== 0) return nc;
            return (a.pairIndex || 1) - (b.pairIndex || 1) || (a.eye.includes("右") ? -1 : 1);
          });
          const firstF = g.records[0].fields;
          const html = slipHTML({
            orderNos, address: g.address, binCode: g.binCode,
            agentName: rawVal(firstF["代理商名称"]) || "", agentId: rawVal(firstF["代理商ID"]) || "",
            shipDate: g.shipDate, courierName: g.courierName, trackingNo: g.trackingNo, rows,
          });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return logReq(req, 200, start);
        }

        // 多仓位：汇总页
        const title = orderNosParam ? "选中订单" : "待发货";
        const listHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>随货同行单汇总</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;padding:40px;background:#f5f5f5}
h1{max-width:900px;margin:0 auto 24px;color:#1a1a2e;font-size:18pt}
.cards{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.08);display:flex;justify-content:space-between;align-items:center}
.card:hover{box-shadow:0 4px 16px rgba(0,0,0,.15)}
.card h3{margin:0;font-size:12pt;color:#1a1a2e}
.card p{margin:4px 0 0;color:#999;font-size:10pt}
.btn{display:inline-block;padding:8px 20px;background:#c0392b;color:#fff;border:none;border-radius:6px;font-size:11pt;text-decoration:none}
.btn:hover{opacity:.9}
.empty{text-align:center;padding:60px;color:#ccc}</style></head><body>
<h1>随货同行单 — ${title}（${groups.length} 个门店）</h1><div class="cards">`;
        const cards = groups.map(g => {
          const orderNos = [...new Set(g.records.map(r => rawVal(r.fields["订单编号"])))];
          const binLabel = g.storeName || (g.binCode ? `仓位 ${g.binCode}` : g.address || "未知");
          const customerNames = [...new Set(g.records.map(r => rawVal(r.fields["顾客姓名"]) || "—"))].join("、");
          const url = `/api/admin/slip-batch?store=${encodeURIComponent(g.groupKey)}&orderNos=${encodeURIComponent(orderNos.join(","))}&admin=${adminToken}`;
          return `<div class="card"><div><h3>&#128205; ${binLabel}${g.binCode ? ` (${g.binCode})` : ""}</h3><p>${customerNames} · ${g.records.length} 副 · 订单 ${orderNos.join(", ")}</p></div><a class="btn" href="${url}" target="_blank">打印同行单</a></div>`;
        }).join("");
        const html = listHtml + cards + `</div></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // GET /api/admin/picklist — 配货单（按货位路径排序，仓库拣货用）
    if (pathname === "/api/admin/picklist" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNosParam = url.searchParams.get("orderNos") || "";
      if (!orderNosParam) { jsonRes(res, 400, { error: "缺少 orderNos" }); return logReq(req, 400, start); }
      const orderNos = orderNosParam.split(",").map(s => s.trim()).filter(Boolean);
      try {
        const allLensArrays = await Promise.all(orderNos.map(no => getLensDetailsByOrder(no)));
        const rows = allLensArrays.flat()
          .filter(r => {
            const eye = rawVal(r.fields["眼别"]);
            const sph = r.fields["球镜SPH"];
            return eye || (sph !== "" && sph != null);
          })
          .map(r => {
            const f = r.fields;
            const sku = rawVal(f["产品型号"]) || "";
            const sph = f["球镜SPH"] ?? 0;
            const cyl = f["柱镜CYL"] ?? 0;
            const entry = lookupBySphCyl(sku, sph, cyl);
            return {
              orderNo: rawVal(f["订单编号"]) || "",
              customer: rawVal(f["顾客姓名"]) || "",
              eye: rawVal(f["眼别"]) || "",
              sku, sph, cyl,
              serialNo: entry?.s || "—",
              bin: entry?.bin || "",
            };
          });
        rows.sort((a, b) => binSortKey(a.bin).localeCompare(binSortKey(b.bin)));
        const dateStr = new Date().toLocaleDateString("zh-CN");
        const html = picklistHTML(orderNos, rows, dateStr);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return logReq(req, 200, start);
      } catch (e) { jsonRes(res, 500, { error: e.message }); return logReq(req, 500, start); }
    }

    // POST /api/admin/pack — 打包（推进工作流到 packed，不改订单状态）
    if (pathname === "/api/admin/pack" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const results = [];
      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (customerName) records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
          if (pairIndex) records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          let packErr = "";
          for (const rec of records) {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            if (!wf.steps["producing"] && !wf.steps["labeled"]) { packErr = "尚未生产，无法打包"; break; }
            const r = advanceWorkflow(wf, "packed");
            if (!r.ok) { packErr = r.error; break; }
            await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(wf) });
          }
          if (packErr) { results.push({ orderNo, ok: false, error: packErr }); continue; }
          results.push({ orderNo, ok: true });
        } catch (e) { results.push({ orderNo, ok: false, error: e.message }); }
      }
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/ship — 发货（逐单或批量，可按客户维度）
    if (pathname === "/api/admin/ship" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      const courierKey = payload.courier || "";
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

          // 按客户名+序号过滤
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }
          if (pairIndex) {
            records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到第${pairIndex}副` }); continue; }
          }

          // 状态守卫："生产中"（供应商直发）或"打标签"（配货完成）均可发货
          const badShip = records.filter(r => !["生产中", "打标签"].includes(r.fields["订单状态"] || ""));
          if (badShip.length) {
            const badStatus = [...new Set(badShip.map(r => r.fields["订单状态"] || "未知"))].join(",");
            results.push({ orderNo, ok: false, error: `当前状态"${badStatus}"，仅"生产中"或"打标签"可发货` }); continue;
          }

          const f0 = records[0].fields;
          const agentId = rawVal(f0["代理商ID"]) || "";
          const ck = courierKey || autoSelectCourierWeb(agentId);
          const courier = COURIERS_WEB[ck] || COURIERS_WEB.sf;
          const trackingNo = payload.trackingNo || "";

          // ── 发货时扣库存 ──
          const stockStatusField = rawVal(f0["库存状态"]) || "";
          if (stockStatusField === "有库存" || stockStatusField === "无库存") {
            try {
              const shipLensForDeduct = await getLensDetailsByOrder(orderNo);
              let filteredForDeduct = customerName
                ? shipLensForDeduct.filter(r => (r.fields["顾客姓名"] || "") === customerName)
                : shipLensForDeduct;
              if (pairIndex) filteredForDeduct = filteredForDeduct.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));

              const movementLines = [];
              for (const lensRec of filteredForDeduct) {
                const lf = lensRec.fields || {};
                const lensSku = rawVal(lf["产品型号"]) || "";
                const lensSph = Number(lf["球镜SPH"]);
                const lensCyl = Number(lf["柱镜CYL"]);
                if (!lensSku || !Number.isFinite(lensSph) || !Number.isFinite(lensCyl)) continue;

                const result = await convertReservation(lensSku, lensSph, lensCyl, 1);
                if (result.deducted > 0) {
                  movementLines.push({ sku: lensSku, sph: lensSph, cyl: lensCyl, qty: result.deducted });
                }
              }

              if (movementLines.length > 0 && TABLES.stock_movement) {
                const docNo = `MOV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(2).toString("hex").toUpperCase()}`;
                const moveRecords = movementLines.map(l => ({
                  fields: {
                    "单据号": docNo, "类型": "出库", "来源去向": "订单发货",
                    "SKU编号": l.sku, "SPH": l.sph, "CYL": l.cyl, "数量": l.qty,
                    "关联单号": orderNo, "操作人": "系统自动",
                  },
                }));
                await batchCreateRecords(TABLES.stock_movement, moveRecords);
                console.log(`  📦 发货扣库存: ${orderNo} -${movementLines.length}片, 单据=${docNo}`);
              }
            } catch (e) {
              console.error(`  ⚠️ 发货扣库存异常(${orderNo}):`, e.message);
            }
          }

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
          let shipFilteredLens = customerName
            ? shipLensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : shipLensDetails;
          if (pairIndex) {
            shipFilteredLens = shipFilteredLens.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
          }
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
      invalidateOrdersCache();
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/deliver — 签收（批量，可按客户维度）
    if (pathname === "/api/admin/deliver" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNos = payload.orderNos || [];
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      if (!orderNos.length) { jsonRes(res, 400, { error: "请提供 orderNos" }); return logReq(req, 400, start); }

      const now = Date.now();
      const results = [];

      for (const orderNo of orderNos) {
        try {
          const encoded = encodeURIComponent(`"${orderNo}"`);
          const d = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=100&filter=CurrentValue.[订单编号]=${encoded}`);
          let records = d?.items || [];
          if (!records.length) { results.push({ orderNo, ok: false, error: "未找到" }); continue; }

          // 按客户名+序号过滤
          if (customerName) {
            records = records.filter(r => (r.fields["顾客姓名"] || "") === customerName);
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到客户 "${customerName}"` }); continue; }
          }
          if (pairIndex) {
            records = records.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
            if (!records.length) { results.push({ orderNo, ok: false, error: `未找到第${pairIndex}副` }); continue; }
          }

          // 校验：只有"已发货"状态才能签收
          const notShipped = records.filter(r => (r.fields["订单状态"] || "") !== "已发货");
          if (notShipped.length === records.length) {
            results.push({ orderNo, ok: false, error: "当前状态不可签收，需为已发货" }); continue;
          }
          const toSign = records.filter(r => (r.fields["订单状态"] || "") === "已发货");
          if (!toSign.length) { results.push({ orderNo, ok: false, error: "无已发货记录" }); continue; }

          // 写入订单主表：签收时间 + 状态 + 物流状态 + 工作流
          const orderUpdates = toSign.map(rec => {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            advanceWorkflow(wf, "delivered");
            return {
              record_id: rec.record_id,
              fields: { "订单状态": "已签收", "签收时间": now, "物流状态": "已签收", "流程步骤": JSON.stringify(wf) },
            };
          });
          await batchUpdateRecords(TABLES.order, orderUpdates);

          // 同步镜片明细表
          const lensDetails = await getLensDetailsByOrder(orderNo);
          let filteredLens = customerName
            ? lensDetails.filter(r => (r.fields["顾客姓名"] || "") === customerName)
            : lensDetails;
          if (pairIndex) filteredLens = filteredLens.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
          const lensUpdates = filteredLens
            .filter(r => (r.fields["订单状态"] || "") === "已发货")
            .map(r => ({ record_id: r.record_id, fields: { "订单状态": "已签收" } }));
          if (lensUpdates.length) await batchUpdateRecords(TABLES.lens_detail, lensUpdates);

          // 飞书签收卡片
          const f0 = toSign[0].fields;
          const signedAt = new Date(now).toLocaleString("zh-CN");
          sendFeishuCard(deliveredCard({
            orderNo,
            customerName: rawVal(f0["顾客姓名"]) || "",
            sku: rawVal(f0["产品型号"]) || "",
            agentName: rawVal(f0["代理商名称"]) || "",
            signedAt,
          })).catch(e => console.error("签收通知失败:", e.message));

          results.push({ orderNo, ok: true, signedAt });
        } catch (e) {
          results.push({ orderNo, ok: false, error: e.message });
        }
      }
      invalidateOrdersCache();
      jsonRes(res, 200, { results });
      return logReq(req, 200, start);
    }

    // POST /api/admin/auto-receipt — 7天自动签收（手动触发 / 定时任务共用）
    if (pathname === "/api/admin/auto-receipt" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      try {
        const days = Number(url.searchParams.get("days") || 7);
        const cutoff = Date.now() - days * 86400000;
        // 查询所有已发货订单
        const allOrders = await searchRecords(TABLES.order, {
          filter: { conjunction: "and", conditions: [
            { field_name: "订单状态", operator: "is", value: ["已发货"] },
          ]},
          fieldNames: ["订单编号", "订单状态", "发货日期", "顾客姓名", "流程步骤"],
        });
        // 筛选发货日期超过N天的
        const toSign = allOrders.filter(r => {
          const shipDate = r.fields["发货日期"];
          if (!shipDate) return false;
          const ts = typeof shipDate === "number" ? shipDate : new Date(shipDate).getTime();
          return ts < cutoff;
        });
        if (!toSign.length) { jsonRes(res, 200, { ok: true, message: `无超过${days}天未签收订单`, count: 0 }); return logReq(req, 200, start); }

        // 按订单号分组
        const grouped = {};
        for (const rec of toSign) {
          const orderNo = rec.fields["订单编号"];
          if (!grouped[orderNo]) grouped[orderNo] = [];
          grouped[orderNo].push(rec);
        }

        let signed = 0;
        const now = Date.now();
        for (const [orderNo, recs] of Object.entries(grouped)) {
          const updates = recs.map(rec => {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            advanceWorkflow(wf, "delivered");
            return { record_id: rec.record_id, fields: { "订单状态": "已签收", "签收时间": now, "物流状态": "已签收", "流程步骤": JSON.stringify(wf) } };
          });
          await batchUpdateRecords(TABLES.order, updates);
          signed += updates.length;

          // 同步镜片明细
          const lensDetails = await getLensDetailsByOrder(orderNo);
          const lensUpdates = lensDetails.filter(r => (r.fields["订单状态"] || "") === "已发货").map(r => ({ record_id: r.record_id, fields: { "订单状态": "已签收" } }));
          if (lensUpdates.length) await batchUpdateRecords(TABLES.lens_detail, lensUpdates);
        }
        invalidateOrdersCache();
        jsonRes(res, 200, { ok: true, message: `自动签收完成`, orders: Object.keys(grouped).length, records: signed });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
      return logReq(req, 200, start);
    }

    // GET /api/admin/reconciliation — 对账单生成（按代理商+日期范围汇总）
    if (pathname === "/api/admin/reconciliation" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const agentId = url.searchParams.get("agent") || "";
      const dateFrom = url.searchParams.get("from") || "";
      const dateTo = url.searchParams.get("to") || "";
      if (!agentId) { jsonRes(res, 400, { error: "请提供 agent 参数（代理商ID）" }); return logReq(req, 400, start); }

      try {
        // 1. 查询该代理商所有已签收订单
        const conditions = [
          { field_name: "代理商ID", operator: "is", value: [agentId] },
          { field_name: "订单状态", operator: "is", value: ["已签收"] },
        ];
        if (dateFrom) conditions.push({ field_name: "签收时间", operator: "isGreater", value: [new Date(dateFrom).getTime()] });
        if (dateTo) conditions.push({ field_name: "签收时间", operator: "isLess", value: [new Date(dateTo).getTime() + 86400000] });

        const signedOrders = await searchRecords(TABLES.order, {
          filter: { conjunction: "and", conditions },
          fieldNames: ["订单编号", "产品型号", "数量", "单价", "金额", "签收时间", "顾客姓名"],
        });

        // 汇总货款
        const orderDetails = [];
        let subtotal = 0;
        for (const rec of signedOrders) {
          const f = rec.fields;
          const price = Number(f["单价"]) || 0;
          const qty = Number(f["数量"]) || 0;
          const amount = Number(f["金额"]) || (price * qty);
          subtotal += amount;
          orderDetails.push({
            orderNo: f["订单编号"] || "",
            sku: f["产品型号"] || "",
            quantity: qty,
            unitPrice: price,
            amount,
            signedAt: f["签收时间"] ? new Date(f["签收时间"]).toISOString().slice(0, 10) : "",
            customer: f["顾客姓名"] || "",
          });
        }

        // 2. 查询退换货冲销
        let returnAmount = 0;
        if (TABLES.return_exchange) {
          const returnConditions = [{ field_name: "代理商", operator: "is", value: [agentId] }];
          if (dateFrom) returnConditions.push({ field_name: "日期", operator: "isGreater", value: [new Date(dateFrom).getTime()] });
          if (dateTo) returnConditions.push({ field_name: "日期", operator: "isLess", value: [new Date(dateTo).getTime() + 86400000] });

          const returns = await searchRecords(TABLES.return_exchange, {
            filter: { conjunction: "and", conditions: returnConditions },
            fieldNames: ["原订单号", "退款金额", "类型", "眼别"],
          });
          for (const rec of returns) {
            returnAmount += Number(rec.fields["退款金额"]) || 0;
          }
        }

        // 3. 查询返利抵扣（上季已确认的返利）
        let rebateAmount = 0;
        if (TABLES.rebate_record) {
          const rebateConditions = [
            { field_name: "代理商ID", operator: "is", value: [agentId] },
            { field_name: "状态", operator: "is", value: ["已确认"] },
          ];
          const rebates = await searchRecords(TABLES.rebate_record, {
            filter: { conjunction: "and", conditions: rebateConditions },
            fieldNames: ["应得返利金额", "季度", "状态"],
          });
          for (const rec of rebates) {
            rebateAmount += Number(rec.fields["应得返利金额"]) || 0;
          }
        }

        // 4. 计算本期实付
        const netAmount = subtotal - returnAmount - rebateAmount;

        // 5. 查询预存款余额
        let depositBalance = 0;
        if (TABLES.agent_deposit_log) {
          const depConditions = [{ field_name: "代理商ID", operator: "is", value: [agentId] }];
          const deposits = await searchRecords(TABLES.agent_deposit_log, {
            filter: { conjunction: "and", conditions: depConditions },
            fieldNames: ["金额"],
          });
          for (const rec of deposits) {
            depositBalance += Number(rec.fields["金额"]) || 0;
          }
        }

        jsonRes(res, 200, {
          ok: true,
          agentId,
          period: { from: dateFrom || "全部", to: dateTo || "至今" },
          summary: {
            subtotal,        // 货款小计
            returnAmount,    // 退货冲销
            rebateAmount,    // 返利抵扣
            netAmount,       // 本期实付
            depositBalance,  // 预存款余额
          },
          orderCount: signedOrders.length,
          orders: orderDetails,
        });
      } catch (e) { jsonRes(res, 500, { error: e.message }); }
      return logReq(req, 200, start);
    }

    // ── 标签打印 API ─────────────────────────────────────────────────────────

    // POST /api/admin/print-label — 生成 ZPL 发送斑马打印机
    if (pathname === "/api/admin/print-label" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const orderNo = (payload.orderNo || "").trim();
      const customerName = payload.customerName || "";
      const pairIndex = payload.pairIndex || 0;
      const eye = payload.eye || ""; // "右眼" or "左眼" or "" (all)
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) { jsonRes(res, 404, { error: "未找到镜片明细" }); return logReq(req, 404, start); }
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (pairIndex) details = details.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        if (!details.length) { jsonRes(res, 404, { error: "过滤后无匹配镜片" }); return logReq(req, 404, start); }

        const config = loadPrinterConfig();
        const copies = config.copies || 1;
        const results = [];

        for (const rec of details) {
          if (!rec.fields["镜片码（唯一）"]) continue;
          const zpl = buildZpl(rec);
          for (let i = 0; i < copies; i++) {
            const r = await sendZplToPrinter(zpl);
            results.push({ lensCode: rec.fields["镜片码（唯一）"], eye: rec.fields["眼别"], ...r });
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
      const pairIndex = payload.pairIndex || 0;
      const eye = payload.eye || "";
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (pairIndex) details = details.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        const zpls = details.filter(r => r.fields["镜片码（唯一）"]).map(r => ({
          lensCode: r.fields["镜片码（唯一）"],
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

    // POST /api/admin/scan-print — 扫码镜片码打印标签 + 状态变打标签
    if (pathname === "/api/admin/scan-print" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const lensCode = (payload.lensCode || "").trim().toUpperCase();
      if (!lensCode) { jsonRes(res, 400, { error: "请提供镜片码" }); return logReq(req, 400, start); }

      try {
        // 查镜片明细表
        const encoded = encodeURIComponent(`"${lensCode}"`);
        const lensRes = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=5&filter=CurrentValue.[镜片码（唯一）]=${encoded}`);
        const lensRecs = lensRes?.items || [];
        if (!lensRecs.length) { jsonRes(res, 404, { error: `未找到镜片码 ${lensCode}` }); return logReq(req, 404, start); }

        const lensRec = lensRecs[0];
        const orderNo = rawVal(lensRec.fields["订单编号"]) || "";
        if (!orderNo) { jsonRes(res, 400, { error: "镜片未关联订单" }); return logReq(req, 400, start); }

        // 查订单主表
        const orderEnc = encodeURIComponent(`"${orderNo}"`);
        const orderRes = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${orderEnc}`);
        const orderRecs = orderRes?.items || [];
        if (!orderRecs.length) { jsonRes(res, 404, { error: `未找到订单 ${orderNo}` }); return logReq(req, 404, start); }

        const currentStatus = rawVal(orderRecs[0].fields["订单状态"]) || "";
        const alreadyLabeled = currentStatus === "打标签" || currentStatus === "已发货";

        // 入队打印
        const zpl = buildZpl(lensRec);
        const jobId = `pq-${Date.now()}-${++_pqSeq}`;
        printQueue.set(jobId, {
          id: jobId, type: "zpl", zpl, orderNo,
          customerName: rawVal(lensRec.fields["顾客姓名"]) || "",
          eye: rawVal(lensRec.fields["眼别"]) || "",
          lensCode, status: "pending", ts: Date.now(),
        });

        // 更新镜片明细表 + 订单主表状态为打标签
        const results = { jobId, lensCode, orderNo, alreadyLabeled };
        if (!alreadyLabeled) {
          // 更新订单主表
          for (const rec of orderRecs) {
            const wf = parseWorkflow(rec.fields["流程步骤"]);
            advanceWorkflow(wf, "labeled");
            await updateRecord(TABLES.order, rec.record_id, {
              "订单状态": "打标签",
              "流程步骤": JSON.stringify(wf),
            });
          }
          // 同步镜片明细表
          await updateRecord(TABLES.lens_detail, lensRec.record_id, { "订单状态": "打标签" });
          results.statusChanged = true;
          console.log(`  扫码打印: ${lensCode} → ${orderNo} 状态 → 打标签`);
        } else {
          console.log(`  扫码打印: ${lensCode} → ${orderNo} 已打印过(${currentStatus})，仅重新入队`);
        }

        jsonRes(res, 200, { ok: true, ...results });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // ── 扫码分仓 API ────────────────────────────────────────────────────────

    // POST /api/admin/scan-bin — 扫码镜片码分配到仓位（按收货地址聚合）
    if (pathname === "/api/admin/scan-bin" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const payload = await readBody(req);
      const lensCode = (payload.lensCode || "").trim().toUpperCase();
      if (!lensCode) { jsonRes(res, 400, { error: "请提供镜片码" }); return logReq(req, 400, start); }

      try {
        // 查镜片明细表
        const encoded = encodeURIComponent(`"${lensCode}"`);
        const lensRes = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.lens_detail}/records?page_size=5&filter=CurrentValue.[镜片码（唯一）]=${encoded}`);
        const lensRecs = lensRes?.items || [];
        if (!lensRecs.length) { jsonRes(res, 404, { error: `未找到镜片码 ${lensCode}` }); return logReq(req, 404, start); }

        const lensRec = lensRecs[0];
        const orderNo = rawVal(lensRec.fields["订单编号"]) || "";
        const customerName = rawVal(lensRec.fields["顾客姓名"]) || "";
        const eye = rawVal(lensRec.fields["眼别"]) || "";
        if (!orderNo) { jsonRes(res, 400, { error: "镜片未关联订单" }); return logReq(req, 400, start); }

        // 查订单收货地址
        const orderEnc = encodeURIComponent(`"${orderNo}"`);
        const orderRes = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=10&filter=CurrentValue.[订单编号]=${orderEnc}`);
        const orderRecs = orderRes?.items || [];
        if (!orderRecs.length) { jsonRes(res, 404, { error: `未找到订单 ${orderNo}` }); return logReq(req, 404, start); }

        const address = rawVal(orderRecs[0].fields["收货地址"]) || "未知地址";
        // 地址归一化：去掉空格和标点差异
        const addrKey = address.replace(/\s+/g, "").replace(/[，,。.、/\\\-_]/g, "");

        // 已有仓位则复用，否则新增
        let binEntry = binStore.get(addrKey);
        const alreadyInBin = binEntry && binEntry.lensCodes.includes(lensCode);

        if (!binEntry) {
          _binSeq++;
          binEntry = { bin: toRoman(_binSeq), address, orders: [], lensCodes: [], ts: Date.now() };
          binStore.set(addrKey, binEntry);
        }

        if (!alreadyInBin) {
          binEntry.lensCodes.push(lensCode);
          // 避免同一订单重复记录
          if (!binEntry.orders.find(o => o.orderNo === orderNo && o.customerName === customerName)) {
            binEntry.orders.push({ orderNo, customerName, eye, lensCode, address, ts: Date.now() });
          }
        }

        jsonRes(res, 200, {
          ok: true, lensCode, orderNo, customerName, eye,
          bin: binEntry.bin, address: binEntry.address,
          alreadyInBin,
          totalBins: binStore.size,
          binLensCount: binEntry.lensCodes.length,
        });
        return logReq(req, 200, start);
      } catch (e) {
        jsonRes(res, 500, { error: e.message });
        return logReq(req, 500, start);
      }
    }

    // GET /api/admin/bin-summary — 查看仓位汇总
    if (pathname === "/api/admin/bin-summary" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const bins = [...binStore.values()]
        .sort((a, b) => a.bin.localeCompare(b.bin))
        .map(b => ({
          bin: b.bin, address: b.address,
          orderCount: b.orders.length,
          lensCount: b.lensCodes.length,
          orders: b.orders.map(o => ({ orderNo: o.orderNo, customerName: o.customerName, eye: o.eye })),
        }));
      jsonRes(res, 200, { totalBins: bins.length, totalOrders: bins.reduce((s, b) => s + b.orderCount, 0), bins });
      return logReq(req, 200, start);
    }

    // POST /api/admin/bin-reset — 清空仓位
    if (pathname === "/api/admin/bin-reset" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const count = binStore.size;
      binStore.clear();
      _binSeq = 0;
      jsonRes(res, 200, { ok: true, cleared: count });
      return logReq(req, 200, start);
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
      const pairIndex = payload.pairIndex || 0;
      const eye = payload.eye || "";
      const force = payload.force === true; // 强制打印，跳过重复检查
      if (!orderNo) { jsonRes(res, 400, { error: "请提供 orderNo" }); return logReq(req, 400, start); }

      try {
        let details = await getLensDetailsByOrder(orderNo);
        if (!details.length) { jsonRes(res, 404, { error: "未找到镜片明细" }); return logReq(req, 404, start); }
        if (customerName) details = details.filter(r => (r.fields["顾客姓名"] || "") === customerName);
        if (pairIndex) details = details.filter(r => Number(r.fields["序号"] || 1) === Number(pairIndex));
        if (eye) details = details.filter(r => (r.fields["眼别"] || "") === eye);
        if (!details.length) { jsonRes(res, 404, { error: "过滤后无匹配镜片" }); return logReq(req, 404, start); }

        // 检查导出记录：是否已打印过
        const lensCodes = details.map(r => r.fields["镜片码（唯一）"] || "").filter(Boolean);
        if (!force && lensCodes.length > 0) {
          const { exported } = await checkExportStatus([orderNo], "label");
          if (exported.length > 0) {
            jsonRes(res, 200, { 
              ok: true, orderNo, lensCount: 0, jobIds: [], 
              alreadyPrinted: true, 
              message: `订单 ${orderNo} 已打印过标签，如需重新打印请勾选"强制打印"` 
            });
            return logReq(req, 200, start);
          }
        }

        // 检查订单状态：已在打标签/已发货说明标签已打印过
        const orderEnc = encodeURIComponent(`"${orderNo}"`);
        const orderCheck = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=5&filter=CurrentValue.[订单编号]=${orderEnc}`);
        const currentStatus = rawVal((orderCheck?.items || [])[0]?.fields["订单状态"]) || "";
        const alreadyLabeled = currentStatus === "打标签" || currentStatus === "已发货";

        const config = loadPrinterConfig();
        const copies = config.copies || 1;
        const jobIds = [];

        for (const rec of details) {
          if (!rec.fields["镜片码（唯一）"]) continue;
          const zpl = buildZpl(rec);
          for (let i = 0; i < copies; i++) {
            const id = `pq-${Date.now()}-${++_pqSeq}`;
            printQueue.set(id, {
              id, type: "zpl", zpl, orderNo, customerName: rec.fields["顾客姓名"] || "",
              eye: rec.fields["眼别"] || "", lensCode: rec.fields["镜片码（唯一）"] || "",
              status: "pending", ts: Date.now(),
            });
            jobIds.push(id);
          }
        }
        jsonRes(res, 200, { ok: true, orderNo, lensCount: jobIds.length, jobIds, alreadyLabeled, currentStatus });
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
                await updateRecord(TABLES.order, rec.record_id, { "流程步骤": JSON.stringify(adv.wf), "订单状态": "打标签" });
              }
            }

            // 记录标签打印导出日志
            const lensCodes = [...printQueue.values()]
              .filter(j => j.type === "zpl" && j.orderNo === job.orderNo && j.status === "done")
              .map(j => j.lensCode)
              .filter(Boolean);
            logExport("label", [job.orderNo], {
              lensCodes,
              filename: `标签_${job.orderNo}`,
              remark: `打印 ${lensCodes.length} 片镜片标签`,
            }).catch(e => console.error("记录标签打印日志失败:", e.message));
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
      } else if (/打标签|配货|标签|labeled/.test(query)) {
        filters.status = "打标签";
      } else if (/已发货|已发|发货|shipped/.test(query)) {
        filters.status = "已发货";
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
        const code = r.fields["镜片码（唯一）"];
        if (code) { codeCount[code] = (codeCount[code] || 0) + 1; }
      }
      for (const [code, count] of Object.entries(codeCount)) {
        if (count > 1) {
          const related = lensRecords.filter(r => r.fields["镜片码（唯一）"] === code).map(r => r.fields["订单编号"]);
          anomalies.push({ type: "duplicate", severity: "danger", orderNo: related[0], msg: `镜片码 ${code} 重复 ${count} 次（订单: ${[...new Set(related)].join(", ")}）`, field: "镜片码（唯一）" });
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
          if ((o.status === "已下单" && days > 3) || (o.status === "待处理" && days > 5) || (o.status === "生产中" && days > 7)) {
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
        answer = `当前共 ${orders.length} 个订单。其中待处理 ${statusCounts["待处理"]||0}、生产中 ${statusCounts["生产中"]||0}、打标签 ${statusCounts["打标签"]||0}、已发货 ${statusCounts["已发货"]||0}。`;
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
      } else if (/已下单|待确认/.test(q)) {
        const ordered = orders.filter(o => o.status === "已下单");
        const orderedOverdue = ordered.filter(o => o.date && (now - o.date) > 3*86400000);
        answer = `已下单订单 ${ordered.length} 个，其中 ${orderedOverdue.length} 个超期（>3天）。`;
      } else if (/待处理|已确认/.test(q)) {
        const pending = orders.filter(o => o.status === "待处理");
        const pendingOverdue = pending.filter(o => o.date && (now - o.date) > 5*86400000);
        answer = `待处理订单 ${pending.length} 个，其中 ${pendingOverdue.length} 个超期（>5天）。`;
      } else if (/生产中|在产|在做/.test(q)) {
        const producing = orders.filter(o => o.status === "生产中");
        const prodOverdue = producing.filter(o => o.date && (now - o.date) > 7*86400000);
        answer = `生产中订单 ${producing.length} 个，其中 ${prodOverdue.length} 个超期（>7天）。`;
      } else if (/打标签|配货/.test(q)) {
        answer = `打标签订单 ${statusCounts["打标签"]||0} 个。`;
      } else if (/已发货|发货/.test(q)) {
        answer = `已发货订单 ${statusCounts["已发货"]||0} 个。`;
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
          action: "导出Excel给工厂",
          detail: `${producingCount} 个生产中订单可导出Excel给工厂`,
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
      let config = loadRulesConfig();
      jsonRes(res, 200, { config, manifest: RULE_MANIFEST });
      return logReq(req, 200, start);
    }

    // POST /api/admin/rules — 更新单条规则参数
    if (pathname === "/api/admin/rules" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.rule || !body.param) { jsonRes(res, 400, { error: "需要 rule 和 param 字段" }); return logReq(req, 400, start); }
      let config = loadRulesConfig();
      if (!config[body.rule]) config[body.rule] = {};
      config[body.rule][body.param] = body.value;
      saveRulesConfig(config);
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
          listRecords(TABLES.stock_detail, ["当前库存","预占库存","安全库存","SKU编号","SPH","CYL"]),
          listRecords(TABLES.production, ["状态","回补状态","工单号","产品型号","SPH","CYL","建议产量","预计完成日"]).catch(() => []),
          listRecords(TABLES.agent, ["状态"]).catch(() => []),
          listRecords(TABLES.order, ["订单状态","下单日期"]).catch(() => []),
        ]);
        let totalStock = 0, totalReserved = 0, belowSafety = 0;
        const skuStats = {};
        const topDeficits = [];
        for (const r of stockRows) {
          const stock = Number(r.fields["当前库存"] || 0);
          const reserved = Number(r.fields["预占库存"] || 0);
          const available = stock - reserved;
          const safety = Number(r.fields["安全库存"] || 0);
          const sku = r.fields["SKU编号"] || "未知";
          totalStock += stock;
          totalReserved += reserved;
          if (!skuStats[sku]) skuStats[sku] = { stock: 0, reserved: 0, available: 0, safety: 0, below: 0, total: 0 };
          skuStats[sku].stock += stock;
          skuStats[sku].reserved += reserved;
          skuStats[sku].available += available;
          skuStats[sku].safety += safety;
          skuStats[sku].total++;
          if (stock < safety) {
            belowSafety++;
            skuStats[sku].below++;
            topDeficits.push({ sku, sph: r.fields["SPH"], cyl: r.fields["CYL"], stock, reserved, available, safety, gap: safety - stock });
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
          if ((st === "已下单" || st === "待处理") && date && (now - date > OVERDUE_MS)) orderMetrics.overdue++;
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
        const o = orderMetrics.byStatus["已下单"] || 0;
        if (o > 20) alerts.push({ level: "warn", icon: "📋", msg: `已下单订单积压 ${o} 单`, ts: now });
        const p = orderMetrics.byStatus["待处理"] || 0;
        if (p > 20) alerts.push({ level: "warn", icon: "📋", msg: `待处理订单积压 ${p} 单`, ts: now });
        if (belowSafety > 0) alerts.push({ level: "warn", icon: "📦", msg: `${belowSafety} 个度数低于安全库存`, ts: now });
        if (pendingReplenish > 0) alerts.push({ level: "warn", icon: "🏭", msg: `${pendingReplenish} 个排产单待回补`, ts: now });
        if (printError > 0) alerts.push({ level: "error", icon: "🖨", msg: `${printError} 个打印任务失败`, ts: now });
        alerts.sort((a, b) => (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1));

        _dashCache = { ts: now, data: {
          totalStock, totalReserved, totalAvailable: totalStock - totalReserved, belowSafety, totalStockRows: stockRows.length,
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
      let config = loadRulesConfig();
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

    // POST /api/admin/procurement — 创建成品采购单
    if (pathname === "/api/admin/procurement" && req.method === "POST") {
      if (!TABLES.procurement) { jsonRes(res, 501, { error: "采购表尚未创建" }); return logReq(req, 501, start); }
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.sku || body.sph == null || body.cyl == null || !body.qty || body.qty <= 0) {
        jsonRes(res, 400, { error: "需要 sku/sph/cyl/qty(>0)" }); return logReq(req, 400, start);
      }
      const docNo = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomBytes(2).toString("hex").toUpperCase()}`;
      const result = await createRecord(TABLES.procurement, {
        "采购编号": docNo, "采购类型": "成品", "关联SKU": body.sku,
        "SPH": Number(body.sph), "CYL": Number(body.cyl), "数量": body.qty,
        "发起日期": Date.now(), "预计到货": body.expectedDate || Date.now() + 7 * 86400000,
        "状态": "已下单", "备注": body.note || "", "触发来源": "手动录入",
      });
      jsonRes(res, 200, { ok: true, docNo, recordId: result?.record?.record_id });
      return logReq(req, 200, start);
    }

    // POST /api/admin/procurement/:recordId/receive — 到货入库
    const recvMatch = pathname.match(/^\/api\/admin\/procurement\/([^/]+)\/receive$/);
    if (recvMatch && req.method === "POST") {
      if (!TABLES.procurement) { jsonRes(res, 501, { error: "采购表尚未创建" }); return logReq(req, 501, start); }
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const recordId = recvMatch[1];
      const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.procurement}/records/${recordId}`);
      if (!data?.record) { jsonRes(res, 404, { error: "采购记录不存在" }); return logReq(req, 404, start); }
      const f = data.record.fields || {};
      if (f["状态"] === "已到货") { jsonRes(res, 400, { error: "采购单已完成" }); return logReq(req, 400, start); }
      const sku = f["关联SKU"] || "";
      const sph = Number(f["SPH"]), cyl = Number(f["CYL"]), qty = Number(f["数量"]) || 0;
      if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl) || qty <= 0) {
        jsonRes(res, 400, { error: "采购单数据不完整" }); return logReq(req, 400, start);
      }
      const key = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
      let oldStock = 0, newStock = 0;
      const lockOk = await withLock(key, async () => {
        const info = await queryStockByRx(sku, sph, cyl);
        if (!info) return false;
        oldStock = info.stock;
        newStock = oldStock + qty;
        const ok = await updateRecord(TABLES.stock_detail, info.recordId, { "当前库存": newStock });
        if (ok) clearStockCache();
        return !!ok;
      });
      if (!lockOk) { jsonRes(res, 500, { error: "库存更新失败" }); return logReq(req, 500, start); }
      await updateRecord(TABLES.procurement, recordId, { "状态": "已到货" });
      const docNo = `MOV-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomBytes(2).toString("hex").toUpperCase()}`;
      await createRecord(TABLES.stock_movement, {
        "单据号": docNo, "类型": "入库", "来源去向": "采购到货",
        "SKU编号": sku, "SPH": sph, "CYL": cyl, "数量": qty,
        "变动前库存": oldStock, "变动后库存": newStock,
        "关联单号": f["采购编号"] || "", "备注": "成品采购到货", "操作人": "admin",
      });
      jsonRes(res, 200, { ok: true, docNo, sku, sph, cyl, qty, oldStock, newStock });
      return logReq(req, 200, start);
    }

    // GET /api/admin/procurements — 采购单列表
    if (pathname === "/api/admin/procurements" && req.method === "GET") {
      if (!TABLES.procurement) { jsonRes(res, 501, { error: "采购表尚未创建" }); return logReq(req, 501, start); }
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const typeFilter = url.searchParams.get("type") || "";
      const statusFilter = url.searchParams.get("status") || "";
      const { page, pageSize } = parsePagination(url);
      let rows = await listRecords(TABLES.procurement);
      if (typeFilter) rows = rows.filter(r => r.fields["采购类型"] === typeFilter);
      if (statusFilter) rows = rows.filter(r => r.fields["状态"] === statusFilter);
      rows.sort((a, b) => (b.fields["发起日期"] || 0) - (a.fields["发起日期"] || 0));
      const total = rows.length;
      const items = rows.slice((page - 1) * pageSize, page * pageSize).map(r => ({
        recordId: r.record_id, docNo: r.fields["采购编号"], type: r.fields["采购类型"],
        sku: r.fields["关联SKU"], sph: r.fields["SPH"], cyl: r.fields["CYL"],
        qty: r.fields["数量"], date: r.fields["发起日期"], expectedDate: r.fields["预计到货"],
        status: r.fields["状态"], source: r.fields["触发来源"], note: r.fields["备注"],
      }));
      jsonRes(res, 200, { total, page, pageSize, items });
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
        const stock = Number(f["当前库存"] || 0);
        const reserved = Number(f["预占库存"] || 0);
        return { recordId: r.record_id, sku: f["SKU编号"] || "", sph: f["SPH"], cyl: f["CYL"],
          currentStock: stock, reserved, available: stock - reserved,
          safetyStock: Number(f["安全库存"] || 0), lastOutbound: f["最近出库"] };
      });
      if (sku) items = items.filter(i => i.sku === sku);
      if (search) {
        const s = search.toLowerCase();
        items = items.filter(i => i.sku.toLowerCase().includes(s) ||
          String(i.sph).includes(s) || String(i.cyl).includes(s));
      }
      const total = items.length;
      const totalStock = items.reduce((s, i) => s + i.currentStock, 0);
      const totalReserved = items.reduce((s, i) => s + (i.reserved || 0), 0);
      const belowSafety = items.filter(i => i.currentStock < i.safetyStock).length;
      const skuBreakdown = {};
      for (const i of items) {
        if (!skuBreakdown[i.sku]) skuBreakdown[i.sku] = { stock: 0, reserved: 0, available: 0, total: 0 };
        skuBreakdown[i.sku].stock += i.currentStock;
        skuBreakdown[i.sku].reserved += (i.reserved || 0);
        skuBreakdown[i.sku].available += (i.available || 0);
        skuBreakdown[i.sku].total++;
      }
      items.sort((a, b) => a.sku.localeCompare(b.sku) || (a.sph || 0) - (b.sph || 0) || (a.cyl || 0) - (b.cyl || 0));
      const paged = items.slice((page - 1) * pageSize, page * pageSize);
      jsonRes(res, 200, { total, page, pageSize, items: paged, summary: { totalStock, totalReserved, totalAvailable: totalStock - totalReserved, belowSafety, skuBreakdown } });
      return logReq(req, 200, start);
    }

    // ── 批量发货 API ──

    // POST /api/bulk/preview — 库存预检（不写数据）
    if (pathname === "/api/bulk/preview" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!Array.isArray(body.lines) || !body.lines.length) {
        jsonRes(res, 400, { error: "需要 lines 字段" }); return logReq(req, 400, start);
      }
      const results = await Promise.all(body.lines.map(async line => {
        const info = await queryStockByRx(line.sku, line.sph, line.cyl);
        const available = info ? Math.max(0, info.available) : 0;
        const fulfillable = Math.min(Number(line.qty), available);
        return { sku: line.sku, sph: line.sph, cyl: line.cyl, qty: Number(line.qty),
          available, fulfillable, shortage: Number(line.qty) - fulfillable };
      }));
      jsonRes(res, 200, {
        lines: results,
        totalRequested: results.reduce((s, r) => s + r.qty, 0),
        totalFulfillable: results.reduce((s, r) => s + r.fulfillable, 0),
        totalShortage: results.reduce((s, r) => s + r.shortage, 0),
      });
      return logReq(req, 200, start);
    }

    // POST /api/bulk/submit — 创建批量单（预占库存+赋码+写lens_detail）
    if (pathname === "/api/bulk/submit" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      if (!body.agentId || !Array.isArray(body.lines) || !body.lines.length) {
        jsonRes(res, 400, { error: "需要 agentId 和 lines" }); return logReq(req, 400, start);
      }
      const blkNo = genBulkNo();
      const lensRecords = [];
      const lines = [];
      for (const line of body.lines) {
        const info = await queryStockByRx(line.sku, line.sph, line.cyl);
        const available = info ? Math.max(0, info.available) : 0;
        const fulfillable = Math.min(Number(line.qty), available);
        const lensCodes = [];
        if (fulfillable > 0) {
          await reserveStock(line.sku, line.sph, line.cyl, fulfillable);
          for (let i = 0; i < fulfillable; i++) {
            const lensCode = randomBytes(8).toString("hex").toUpperCase();
            lensCodes.push(lensCode);
            lensRecords.push({ fields: {
              "镜片码（唯一）": lensCode,
              "订单编号": blkNo,
              "产品型号": line.sku,
              "球镜SPH": Number(line.sph),
              "柱镜CYL": Number(line.cyl),
              "眼别": "-",
              "顾客姓名": body.agentName || body.agentId,
              "订单状态": "待出库",
              "序号": i + 1,
            }});
          }
        }
        lines.push({ sku: line.sku, sph: line.sph, cyl: line.cyl,
          requestedQty: Number(line.qty), fulfilledQty: fulfillable,
          shortage: Number(line.qty) - fulfillable, lensCodes });
      }
      if (lensRecords.length) {
        const ok = await batchCreateRecords(TABLES.lens_detail, lensRecords);
        if (!ok) { jsonRes(res, 500, { error: "镜片码写入失败" }); return logReq(req, 500, start); }
        for (const r of lensRecords) {
          generateQRPng(r.fields["镜片码（唯一）"]).catch(e => console.warn("  ⚠️ 批量QR:", e.message));
        }
      }
      const bulk = {
        blkNo, agentId: body.agentId, agentName: body.agentName || body.agentId,
        createdAt: Date.now(), status: "待出库", note: body.note || "", lines,
        totalRequested: lines.reduce((s, l) => s + l.requestedQty, 0),
        totalFulfilled: lines.reduce((s, l) => s + l.fulfilledQty, 0),
        trackingNo: "",
      };
      saveBulk(bulk);
      console.log(`  批量单 ${blkNo}: ${bulk.totalFulfilled}/${bulk.totalRequested}片 (${body.agentId})`);
      jsonRes(res, 200, { ok: true, blkNo, totalFulfilled: bulk.totalFulfilled,
        totalRequested: bulk.totalRequested, lines });
      return logReq(req, 200, start);
    }

    // POST /api/bulk/fulfill/:blkNo — 出库：扣库存+状态→已出库
    const bulkFulfillMatch = pathname.match(/^\/api\/bulk\/fulfill\/([^/]+)$/);
    if (bulkFulfillMatch && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const blkNo = decodeURIComponent(bulkFulfillMatch[1]);
      const bulk = loadBulk(blkNo);
      if (!bulk) { jsonRes(res, 404, { error: "批量单不存在" }); return logReq(req, 404, start); }
      if (bulk.status !== "待出库") { jsonRes(res, 400, { error: `状态不符: ${bulk.status}` }); return logReq(req, 400, start); }
      const docNo = `MOV-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${randomBytes(2).toString("hex").toUpperCase()}`;
      const movRecs = [];
      for (const line of bulk.lines) {
        if (!line.fulfilledQty) continue;
        await convertReservation(line.sku, line.sph, line.cyl, line.fulfilledQty);
        movRecs.push({ fields: {
          "单据号": docNo, "类型": "出库", "来源去向": "订单发货",
          "SKU编号": line.sku, "SPH": Number(line.sph), "CYL": Number(line.cyl),
          "数量": line.fulfilledQty, "关联单号": blkNo, "备注": "批量发货出库", "操作人": "admin",
        }});
      }
      if (movRecs.length) await batchCreateRecords(TABLES.stock_movement, movRecs);
      const details = await getLensDetailsByOrder(blkNo);
      if (details.length) {
        await batchUpdateRecords(TABLES.lens_detail, details.map(r => ({
          record_id: r.record_id, fields: { "订单状态": "已出库" }
        })));
      }
      saveBulk({ ...bulk, status: "已出库", stockMovementDocNo: docNo, fulfilledAt: Date.now() });
      console.log(`  批量出库 ${blkNo}: ${docNo}`);
      jsonRes(res, 200, { ok: true, blkNo, docNo });
      return logReq(req, 200, start);
    }

    // POST /api/bulk/ship/:blkNo — 录快递单号→已发货
    const bulkShipMatch = pathname.match(/^\/api\/bulk\/ship\/([^/]+)$/);
    if (bulkShipMatch && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const blkNo = decodeURIComponent(bulkShipMatch[1]);
      const bulk = loadBulk(blkNo);
      if (!bulk) { jsonRes(res, 404, { error: "批量单不存在" }); return logReq(req, 404, start); }
      if (bulk.status !== "已出库") { jsonRes(res, 400, { error: `状态不符: ${bulk.status}` }); return logReq(req, 400, start); }
      const body = await readBody(req);
      saveBulk({ ...bulk, status: "已发货", trackingNo: body.trackingNo || "", shippedAt: Date.now() });
      jsonRes(res, 200, { ok: true, blkNo, trackingNo: body.trackingNo });
      return logReq(req, 200, start);
    }

    // GET /api/bulk/list — 批量单列表
    if (pathname === "/api/bulk/list" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const agentId = url.searchParams.get("agentId") || "";
      const status = url.searchParams.get("status") || "";
      const bulks = listBulks({ agentId, status }).map(b => ({
        blkNo: b.blkNo, agentId: b.agentId, agentName: b.agentName,
        createdAt: b.createdAt, status: b.status, trackingNo: b.trackingNo || "",
        totalRequested: b.totalRequested, totalFulfilled: b.totalFulfilled,
        lineCount: (b.lines || []).length, note: b.note || "",
      }));
      jsonRes(res, 200, { total: bulks.length, items: bulks });
      return logReq(req, 200, start);
    }

    // GET /api/bulk/labels/:blkNo — 生成批量标签 HTML
    const bulkLabelsMatch = pathname.match(/^\/api\/bulk\/labels\/([^/]+)$/);
    if (bulkLabelsMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const blkNo = decodeURIComponent(bulkLabelsMatch[1]);
      const bulk = loadBulk(blkNo);
      if (!bulk) { jsonRes(res, 404, { error: "批量单不存在" }); return logReq(req, 404, start); }
      const details = await getLensDetailsByOrder(blkNo);
      const labelRecords = details.map(r => ({ fields: r.fields, orderNo: blkNo }));
      const html = await buildPrintPage(labelRecords);
      if (!html) { jsonRes(res, 500, { error: "标签生成失败" }); return logReq(req, 500, start); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return logReq(req, 200, start);
    }

    // GET /api/bulk/:blkNo — 批量单详情（必须在 list/labels 之后）
    const bulkDetailMatch = pathname.match(/^\/api\/bulk\/(BLK-[^/]+)$/);
    if (bulkDetailMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const blkNo = decodeURIComponent(bulkDetailMatch[1]);
      const bulk = loadBulk(blkNo);
      if (!bulk) { jsonRes(res, 404, { error: "批量单不存在" }); return logReq(req, 404, start); }
      jsonRes(res, 200, bulk);
      return logReq(req, 200, start);
    }

    // GET /api/inventory/sku/:barcode — 条码查SKU库存
    const skuBarcodeMatch = pathname.match(/^\/api\/inventory\/sku\/([^/]+)$/);
    if (skuBarcodeMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const barcode = decodeURIComponent(skuBarcodeMatch[1]).toUpperCase();
      const decoded = decodeBarcode(barcode);
      if (!decoded) { jsonRes(res, 400, { error: "条码格式无效" }); return logReq(req, 400, start); }
      const info = await queryStockByRx(decoded.sku, decoded.sph, decoded.cyl);
      if (!info) { jsonRes(res, 404, { error: "库存记录不存在" }); return logReq(req, 404, start); }
      jsonRes(res, 200, { barcode, sku: decoded.sku, sph: decoded.sph, cyl: decoded.cyl,
        currentStock: info.stock, reserved: info.reserved, available: info.available, recordId: info.recordId });
      return logReq(req, 200, start);
    }

    // GET /api/inventory/outbound-requirements/:orderNo — 订单出库需求
    const outboundReqMatch = pathname.match(/^\/api\/inventory\/outbound-requirements\/([^/]+)$/);
    if (outboundReqMatch && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const orderNo = decodeURIComponent(outboundReqMatch[1]);
      const details = await getLensDetailsByOrder(orderNo);
      if (!details.length) { jsonRes(res, 404, { error: "订单不存在或无镜片明细" }); return logReq(req, 404, start); }
      const reqMap = new Map();
      for (const r of details) {
        const f = r.fields;
        const sku = f["产品型号"] || "";
        const sph = Number(f["球镜SPH"] ?? 0);
        const cyl = Number(f["柱镜CYL"] ?? 0);
        if (!sku) continue;
        const barcode = encodeBarcode(sku, sph, cyl);
        if (!reqMap.has(barcode)) reqMap.set(barcode, { sku, sph, cyl, barcode, qty: 0 });
        reqMap.get(barcode).qty++;
      }
      jsonRes(res, 200, { orderNo, requirements: [...reqMap.values()] });
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
        if ((r.fields["订单状态"] === "已下单" || r.fields["订单状态"] === "待处理") && r.fields["下单日期"] && (now - r.fields["下单日期"] > OVERDUE_MS)) {
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

    // ── 库存消耗 & 生产建议 API ────────────────────────────────────────────────

    // GET /api/admin/consumption-summary — 每周库存消耗汇总
    if (pathname === "/api/admin/consumption-summary" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const daysBack = Number(url.searchParams.get("days") || 7);
      const filterSku = url.searchParams.get("sku") || "";
      const startDateStr = url.searchParams.get("startDate");
      const endDateStr = url.searchParams.get("endDate");
      const DAY = 24 * 60 * 60 * 1000;
      let curStart, curEnd;
      if (startDateStr && endDateStr) {
        curStart = new Date(startDateStr + "T00:00:00+08:00").getTime();
        curEnd = new Date(endDateStr + "T23:59:59+08:00").getTime();
      } else {
        const now = Date.now();
        curEnd = now;
        curStart = now - daysBack * DAY;
      }
      const span = curEnd - curStart;
      const prevEnd = curStart;
      const prevStart = curStart - span;

      const [orders, lenses, stockRows] = await Promise.all([
        listRecords(TABLES.order, ["订单编号", "订单状态", "发货时间"]),
        listRecords(TABLES.lens_detail, ["订单编号", "产品型号", "球镜SPH", "柱镜CYL"]),
        listRecords(TABLES.stock_detail, ["SKU编号", "SPH", "CYL", "当前库存", "安全库存", "序列号", "货位编号", "ABC分类"]),
      ]);

      const locMap = {};
      for (const r of stockRows) {
        const key = `${Number(r.fields["SPH"]||0).toFixed(2)}|${Number(r.fields["CYL"]||0).toFixed(2)}`;
        if (!locMap[key]) locMap[key] = { serialNo: r.fields["序列号"]||"", location: r.fields["货位编号"]||"", abc: r.fields["ABC分类"]||"" };
      }

      function aggregate(orders, lenses, start, end) {
        const shippedNos = new Set();
        let orderCount = 0;
        for (const r of orders) {
          const f = r.fields;
          const st = f["订单状态"];
          const shipTime = f["发货时间"];
          if ((st === "已发货" || st === "已签收") && shipTime >= start && shipTime < end) {
            shippedNos.add(f["订单编号"]);
            orderCount++;
          }
        }
        const bySku = {};
        const byDegree = {};
        let totalLenses = 0;
        for (const r of lenses) {
          const f = r.fields;
          if (!shippedNos.has(f["订单编号"])) continue;
          const sku = f["产品型号"] || "未知";
          if (filterSku && sku !== filterSku) continue;
          const sph = Number(f["球镜SPH"] || 0);
          const cyl = Number(f["柱镜CYL"] || 0);
          bySku[sku] = (bySku[sku] || 0) + 1;
          const degKey = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
          byDegree[degKey] = (byDegree[degKey] || 0) + 1;
          totalLenses++;
        }
        return { bySku, byDegree, totalLenses, orderCount };
      }

      const current = aggregate(orders, lenses, curStart, curEnd);
      const previous = aggregate(orders, lenses, prevStart, prevEnd);

      const skuStockMap = {};
      for (const r of stockRows) {
        const sku = r.fields["SKU编号"] || "未知";
        if (!skuStockMap[sku]) skuStockMap[sku] = { stock: 0, safety: 0, rows: 0 };
        skuStockMap[sku].stock += Number(r.fields["当前库存"] || 0);
        skuStockMap[sku].safety += Number(r.fields["安全库存"] || 0);
        skuStockMap[sku].rows++;
      }

      jsonRes(res, 200, { current, previous, skuStockMap, locMap, daysBack });
      return logReq(req, 200, start);
    }

    // GET /api/admin/production-suggestions — 生产补货建议（缺口 - 在途）
    if (pathname === "/api/admin/production-suggestions" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const [stockRows, prodRows] = await Promise.all([
        listRecords(TABLES.stock_detail, ["SKU编号", "SPH", "CYL", "当前库存", "安全库存", "序列号", "货位编号", "ABC分类"]),
        listRecords(TABLES.production, ["产品型号", "SPH", "CYL", "建议产量", "状态"]).catch(() => []),
      ]);

      const inTransitMap = {};
      for (const r of prodRows) {
        const st = r.fields["状态"];
        if (st !== "待确认" && st !== "生产中") continue;
        const key = `${r.fields["产品型号"]}|${Number(r.fields["SPH"] || 0).toFixed(2)}|${Number(r.fields["CYL"] || 0).toFixed(2)}`;
        inTransitMap[key] = (inTransitMap[key] || 0) + Number(r.fields["建议产量"] || 0);
      }

      const suggestions = [];
      for (const r of stockRows) {
        const f = r.fields;
        const sku = f["SKU编号"] || "未知";
        const sph = Number(f["SPH"] || 0);
        const cyl = Number(f["CYL"] || 0);
        const currentStock = Number(f["当前库存"] || 0);
        const safetyStock = Number(f["安全库存"] || 0);
        const gap = Math.max(safetyStock - currentStock, 0);
        if (gap <= 0) continue;
        const key = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
        const inTransit = inTransitMap[key] || 0;
        const netGap = Math.max(gap - inTransit, 0);
        if (netGap <= 0) continue;
        suggestions.push({ sku, sph, cyl, currentStock, safetyStock, gap, inTransit, netGap, serialNo: f["序列号"] || "", location: f["货位编号"] || "", abc: f["ABC分类"] || "" });
      }
      suggestions.sort((a, b) => b.netGap - a.netGap);
      jsonRes(res, 200, { total: suggestions.length, suggestions });
      return logReq(req, 200, start);
    }

    // POST /api/admin/production-orders/batch-create — 批量创建排产工单
    if (pathname === "/api/admin/production-orders/batch-create" && req.method === "POST") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const items = body.items;
      if (!Array.isArray(items) || !items.length) { jsonRes(res, 400, { error: "需要 items 数组" }); return logReq(req, 400, start); }

      const existingProd = await listRecords(TABLES.production, ["产品型号", "SPH", "CYL", "状态"]).catch(() => []);
      const activeKeys = new Set();
      for (const r of existingProd) {
        const st = r.fields["状态"];
        if (st === "待确认" || st === "生产中") {
          activeKeys.add(`${r.fields["产品型号"]}|${Number(r.fields["SPH"] || 0).toFixed(2)}|${Number(r.fields["CYL"] || 0).toFixed(2)}`);
        }
      }

      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      const toCreate = [];
      let skipped = 0;
      const seen = new Set();
      for (const it of items) {
        const key = `${it.sku}|${Number(it.sph).toFixed(2)}|${Number(it.cyl).toFixed(2)}`;
        if (activeKeys.has(key) || seen.has(key)) { skipped++; continue; }
        seen.add(key);
        toCreate.push({ fields: {
          "工单号": `${key}|${dateStr}`,
          "产品型号": it.sku,
          "SPH": Number(it.sph),
          "CYL": Number(it.cyl),
          "建议产量": Number(it.qty) || 1,
          "状态": "待确认",
          "生产类型": "备货生产",
          "触发原因": "手动补货建议",
        }});
      }
      if (toCreate.length) await batchCreateRecords(TABLES.production, toCreate);
      jsonRes(res, 200, { created: toCreate.length, skipped });
      return logReq(req, 200, start);
    }

    // ── 暑期计划 API ──────────────────────────────────────────────────────────

    // GET /api/summer-plan?t=xxx — 查询该代理商的暑期计划
    if (pathname === "/api/summer-plan" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const encoded = encodeURIComponent(`"${token}"`);
      const d = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encoded}`
      );
      const rec = (d?.items || [])[0];
      if (!rec) { jsonRes(res, 200, { plan: null }); return logReq(req, 200, start); }
      const f = rec.fields;
      jsonRes(res, 200, {
        plan: {
          recordId: rec.record_id,
          distributor_token: f.distributor_token || "",
          distributor_name: f.distributor_name || "",
          region: f.region || "",
          target_ultra: Number(f.target_ultra || 0),
          target_sky: Number(f.target_sky || 0),
          target_storm: Number(f.target_storm || 0),
          stock_ultra: Number(f.stock_ultra || 0),
          stock_sky: Number(f.stock_sky || 0),
          stock_storm: Number(f.stock_storm || 0),
          stores: f.stores || "[]",
          milestone_stock: f.milestone_stock || null,
          milestone_first_order: f.milestone_first_order || null,
          submitted_at: f.submitted_at || null,
          status: f.status || "草稿",
        }
      });
      return logReq(req, 200, start);
    }

    // POST /api/summer-plan?t=xxx — 创建或更新暑期计划
    if (pathname === "/api/summer-plan" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const { targets, stores, milestone_stock, milestone_first_order, status, region } = body;
      if (!targets) { jsonRes(res, 400, { error: "缺少 targets 字段" }); return logReq(req, 400, start); }

      const fields = {
        distributor_token: token,
        distributor_name: agent.name || "",
        region: region || "",
        target_ultra: Number(targets.ultra || 0),
        target_sky: Number(targets.sky || 0),
        target_storm: Number(targets.storm || 0),
        stores: typeof stores === "string" ? stores : JSON.stringify(stores || []),
        submitted_at: Date.now(),
        status: status || "已提交",
      };
      if (milestone_stock) fields.milestone_stock = milestone_stock;
      if (milestone_first_order) fields.milestone_first_order = milestone_first_order;

      // 查是否已有记录（upsert）
      const encoded = encodeURIComponent(`"${token}"`);
      const existing = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encoded}`
      );
      const existRec = (existing?.items || [])[0];
      let result;
      if (existRec) {
        result = await updateRecord(TABLES.summer_target, existRec.record_id, fields);
      } else {
        result = await createRecord(TABLES.summer_target, fields);
      }
      if (!result) { jsonRes(res, 500, { error: "写入失败" }); return logReq(req, 500, start); }
      jsonRes(res, 200, { ok: true, recordId: existRec?.record_id || result.record?.record_id });
      return logReq(req, 200, start);
    }

    // PATCH /api/summer-plan/stock?t=xxx — 备库页写回库存字段
    if (pathname === "/api/summer-plan/stock" && req.method === "PATCH") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const { stock_ultra, stock_sky, stock_storm, skuDetail } = body;

      const encoded = encodeURIComponent(`"${token}"`);
      const existing = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encoded}`
      );
      const existRec = (existing?.items || [])[0];
      if (!existRec) { jsonRes(res, 404, { error: "暑期计划不存在，请先填写计划" }); return logReq(req, 404, start); }

      const fields = {};
      if (stock_ultra !== undefined) fields.stock_ultra = Number(stock_ultra);
      if (stock_sky !== undefined) fields.stock_sky = Number(stock_sky);
      if (stock_storm !== undefined) fields.stock_storm = Number(stock_storm);
      if (skuDetail !== undefined) fields.stock_sku_json = typeof skuDetail === 'string' ? skuDetail : JSON.stringify(skuDetail);
      const result = await updateRecord(TABLES.summer_target, existRec.record_id, fields);
      if (!result) { jsonRes(res, 500, { error: "写入失败" }); return logReq(req, 500, start); }
      jsonRes(res, 200, { ok: true });
      return logReq(req, 200, start);
    }

    // POST /api/summer-policy?t=xxx — 确认政策 + 保存备注
    if (pathname === "/api/summer-policy" && req.method === "POST") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const { remark } = body;

      const encoded = encodeURIComponent(`"${token}"`);
      const existing = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encoded}`
      );
      const existRec = (existing?.items || [])[0];
      if (!existRec) { jsonRes(res, 404, { error: "暑期计划不存在，请先填写计划" }); return logReq(req, 404, start); }

      const fields = { policy_confirmed: Date.now() };
      if (remark !== undefined) fields.policy_remark = remark;
      const result = await updateRecord(TABLES.summer_target, existRec.record_id, fields);
      if (!result) { jsonRes(res, 500, { error: "写入失败" }); return logReq(req, 500, start); }
      jsonRes(res, 200, { ok: true });
      return logReq(req, 200, start);
    }

    // PATCH /api/summer-policy?t=xxx — 只保存备注（不更新确认状态）
    if (pathname === "/api/summer-policy" && req.method === "PATCH") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      const body = await readBody(req);
      const { remark } = body;

      const encoded = encodeURIComponent(`"${token}"`);
      const existing = await feishuApi("GET",
        `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encoded}`
      );
      const existRec = (existing?.items || [])[0];
      if (!existRec) { jsonRes(res, 404, { error: "暑期计划不存在，请先填写计划" }); return logReq(req, 404, start); }

      const fields = {};
      if (remark !== undefined) fields.policy_remark = remark;
      const result = await updateRecord(TABLES.summer_target, existRec.record_id, fields);
      if (!result) { jsonRes(res, 500, { error: "写入失败" }); return logReq(req, 500, start); }
      jsonRes(res, 200, { ok: true });
      return logReq(req, 200, start);
    }

    // GET /api/summer-dashboard?t=xxx — 看板聚合数据
    if (pathname === "/api/summer-dashboard" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }

      // 并行读三张表
      const encodedToken = encodeURIComponent(`"${token}"`);
      const [planData, orderData, stockData] = await Promise.all([
        feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=1&filter=CurrentValue.[distributor_token]=${encodedToken}`
        ),
        feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?page_size=500&filter=CurrentValue.[代理商ID]=${encodeURIComponent('"' + agent.id + '"')}`
        ),
        feishuApi("GET",
          `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records?page_size=200`
        ),
      ]);

      const planRec = (planData?.items || [])[0];
      const plan = planRec ? planRec.fields : null;

      // 暑期订单（7月1日~10月8日）
      const summerStart = new Date("2026-07-01").getTime();
      const summerEnd = new Date("2026-10-08T23:59:59").getTime();
      const orders = (orderData?.items || []).filter(r => {
        const d = r.fields["下单日期"];
        return d && d >= summerStart && d <= summerEnd;
      });

      // 各产品进货量（按SKU聚合）
      const skuInMap = {};
      for (const r of orders) {
        const sku = r.fields["产品型号"] || "";
        const qty = Number(r.fields["数量"] || 0);
        skuInMap[sku] = (skuInMap[sku] || 0) + qty;
      }
      const ultraIn = (skuInMap["Ultra双效"] || 0);
      const skyIn = Object.entries(skuInMap).filter(([k]) => k.startsWith("时空之眼")).reduce((s, [, v]) => s + v, 0);
      const stormIn = (skuInMap["小旋风"] || 0);
      const totalIn = ultraIn + skyIn + stormIn;

      // 目标
      const targetUltra = Number(plan?.target_ultra || 0);
      const targetSky = Number(plan?.target_sky || 0);
      const targetStorm = Number(plan?.target_storm || 0);
      const totalTarget = targetUltra + targetSky + targetStorm;

      // 月度趋势
      const monthMap = {};
      for (const r of orders) {
        const d = r.fields["下单日期"];
        if (!d) continue;
        const dt = new Date(d);
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
        monthMap[key] = (monthMap[key] || 0) + Number(r.fields["数量"] || 0);
      }
      const trend = Object.entries(monthMap).sort().map(([month, qty]) => ({ month, qty }));

      // 库存列表（当前代理商下，取前20个相关SKU）
      const stockItems = (stockData?.items || []).slice(0, 100).map(r => {
        const f = r.fields;
        return {
          sku: f["SKU编号"] || "",
          sph: f["SPH"],
          cyl: f["CYL"],
          stock: Number(f["当前库存"] || 0),
          monthly_out: Number(f["最近出库"] || 0),
        };
      }).filter(i => i.sku);

      // 待办提醒
      const today = Date.now();
      const alerts = [];
      const SUMMER_START = new Date("2026-07-01").getTime();
      const SUMMER_END = new Date("2026-10-08T23:59:59").getTime();
      const elapsed = Math.max(0, today - SUMMER_START);
      const total99 = SUMMER_END - SUMMER_START;
      const timeProgress = Math.min(1, elapsed / total99);

      for (const sku of stockItems.slice(0, 10)) {
        const dailyRate = sku.monthly_out / 30;
        if (dailyRate > 0 && sku.stock < dailyRate * 7) {
          const daysLeft = Math.floor(sku.stock / dailyRate);
          alerts.push({ level: "red", msg: `${sku.sku} 库存仅剩${sku.stock}片，预计${daysLeft}天断货` });
        }
      }
      if (plan?.milestone_stock) {
        const msDate = typeof plan.milestone_stock === "number" ? plan.milestone_stock : new Date(plan.milestone_stock).getTime();
        const daysToStock = Math.ceil((msDate - today) / 86400000);
        if (daysToStock > 0 && daysToStock <= 7) {
          alerts.push({ level: "orange", msg: `备货承诺节点还有${daysToStock}天，请确认备货安排` });
        }
      }
      if (totalTarget > 0 && timeProgress > 0.2) {
        const achieveRate = totalIn / totalTarget;
        if (achieveRate < timeProgress * 0.85) {
          alerts.push({ level: "red", msg: `暑期进度偏慢，当前完成率${(achieveRate*100).toFixed(0)}%，时间消耗${(timeProgress*100).toFixed(0)}%` });
        }
      }
      if (!plan) {
        alerts.push({ level: "blue", msg: "尚未填写暑期计划，请先完成计划填报" });
      }

      jsonRes(res, 200, {
        agent: { id: agent.id, name: agent.name },
        plan: plan ? {
          target_ultra: targetUltra, target_sky: targetSky, target_storm: targetStorm,
          stock_ultra: Number(plan.stock_ultra || 0), stock_sky: Number(plan.stock_sky || 0), stock_storm: Number(plan.stock_storm || 0),
          stores: plan.stores || "[]",
          milestone_stock: plan.milestone_stock,
          milestone_first_order: plan.milestone_first_order,
          status: plan.status || "",
        } : null,
        summary: { totalIn, totalTarget, ultraIn, skyIn, stormIn, targetUltra, targetSky, targetStorm },
        trend,
        stock: stockItems.slice(0, 20),
        alerts,
      });
      return logReq(req, 200, start);
    }

    // GET /api/admin/summer-export?admin=xxx — 下载所有代理商暑期SKU排产Excel
    if (pathname === "/api/admin/summer-export" && req.method === "GET") {
      const adminToken = url.searchParams.get("admin") || req.headers["x-admin-token"] || "";
      const ADMIN = process.env.ADMIN_TOKEN || "GaushOrderMock";
      if (!timingSafeEqual(Buffer.from(adminToken), Buffer.from(ADMIN))) {
        jsonRes(res, 401, { error: "无权限" }); return logReq(req, 401, start);
      }

      // 拉取全部暑期计划记录（分页，最多 500 条）
      let allRecs = [];
      let pageToken = "";
      do {
        const url = `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.summer_target}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ""}`;
        const data = await feishuApi("GET", url);
        allRecs = allRecs.concat(data?.items || []);
        pageToken = data?.page_token || "";
      } while (pageToken);

      // 排产总表：按产品+SPH+CYL聚合，汇总各代理商数量
      const skuMap = {};     // key = "产品|SPH|CYL" → { sku, sph, cyl, cls, total, agents:{name:qty} }
      const agentSummary = {}; // agentName → { ultra, sky, storm, total }
      const storeRows = [];  // 门店销售汇总

      for (const rec of allRecs) {
        const f = rec.fields;
        const agentName = f.distributor_name || f.distributor_token || "未知代理商";
        const status = f.status || "";
        const rawJson = typeof f.stock_sku_json === "string" ? f.stock_sku_json : "";

        let skuItems = [];
        if (rawJson) {
          try { skuItems = JSON.parse(rawJson); } catch (_) { skuItems = []; }
        }

        // 代理商汇总行
        if (!agentSummary[agentName]) agentSummary[agentName] = { ultra: 0, sky: 0, storm: 0, total: 0, status };
        agentSummary[agentName].status = status;

        for (const item of skuItems) {
          const qty = Number(item.qty || 0);
          const key = `${item.sku}|${item.sph}|${item.cyl}`;
          if (!skuMap[key]) skuMap[key] = { sku: item.sku, sph: item.sph, cyl: item.cyl, cls: item.cls || "", total: 0, agents: {} };
          skuMap[key].total += qty;
          skuMap[key].agents[agentName] = (skuMap[key].agents[agentName] || 0) + qty;

          // 代理商产品小计
          if (item.sku === "Ultra双效") agentSummary[agentName].ultra += qty;
          else if (item.sku === "时空之眼") agentSummary[agentName].sky += qty;
          else if (item.sku === "小旋风") agentSummary[agentName].storm += qty;
          agentSummary[agentName].total += qty;
        }

        // 门店销售数据
        let stores = [];
        try { stores = JSON.parse(typeof f.stores === "string" ? f.stores : "[]"); } catch (_) { stores = []; }
        for (const s of stores) {
          storeRows.push({ agent: agentName, store: s.name || "", target: Number(s.target || 0), actual: Number(s.actual || 0) });
        }
      }

      // 收集所有代理商名（用于列头）
      const agentNames = [...new Set(allRecs.map(r => r.fields.distributor_name || r.fields.distributor_token || "未知"))];

      // Sheet 1: 排产总表
      const prodHeader = ["产品", "SPH", "CYL", "ABC分类", "合计数量", ...agentNames];
      const prodRows = [prodHeader];
      for (const v of Object.values(skuMap).sort((a, b) => a.sku.localeCompare(b.sku) || a.sph - b.sph || a.cyl - b.cyl)) {
        prodRows.push([v.sku, v.sph, v.cyl, v.cls, v.total, ...agentNames.map(n => v.agents[n] || 0)]);
      }
      // 合计行
      const colTotals = ["", "", "", "合计", Object.values(skuMap).reduce((s, v) => s + v.total, 0),
        ...agentNames.map(n => Object.values(skuMap).reduce((s, v) => s + (v.agents[n] || 0), 0))];
      prodRows.push(colTotals);

      // Sheet 2: 代理商汇总
      const agentRows = [["代理商", "状态", "Ultra双效", "时空之眼", "小旋风", "合计"]];
      for (const [name, d] of Object.entries(agentSummary)) {
        agentRows.push([name, d.status, d.ultra, d.sky, d.storm, d.total]);
      }

      // Sheet 3: 门店销售
      const storeHeader = [["代理商", "门店名称", "暑期目标（片）", "实际销量（片）"]];
      const storeData = storeHeader.concat(storeRows.map(s => [s.agent, s.store, s.target, s.actual]));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prodRows), "排产总表");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agentRows), "代理商汇总");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(storeData), "门店销售");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const date = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`暑期备库排产汇总_${date}`)}.xlsx`,
        "Content-Length": buf.length,
      });
      res.end(buf);
      return logReq(req, 200, start);
    }

    // GET /api/admin/sku-serial-map — 序列号⇔SPH/CYL⇔货位 映射表（多型号）
    // ?sku=Ultra双效               → 该型号全量
    // ?sku=Ultra双效&serial=003    → 序列号查询
    // ?sku=Ultra双效&sph=-1&cyl=0  → 度数查询
    // 无参数                        → 返回已支持型号列表
    if (pathname === "/api/admin/sku-serial-map" && req.method === "GET") {
      if (!isAdmin(req)) { jsonRes(res, 401, { error: "无管理权限" }); return logReq(req, 401, start); }
      const skuParam    = url.searchParams.get("sku");
      const serialParam = url.searchParams.get("serial");
      const sphParam    = url.searchParams.get("sph");
      const cylParam    = url.searchParams.get("cyl");
      if (!skuParam) {
        jsonRes(res, 200, { supportedSkus: getSupportedSkus() });
      } else if (serialParam) {
        const entry = lookupBySerial(skuParam, serialParam);
        jsonRes(res, entry ? 200 : 404, entry ?? { error: "序列号不存在" });
      } else if (sphParam != null && cylParam != null) {
        const entry = lookupBySphCyl(skuParam, sphParam, cylParam);
        jsonRes(res, entry ? 200 : 404, entry ?? { error: "度数无对应序列号（尚未录入）" });
      } else {
        const entries = getAllEntries(skuParam);
        jsonRes(res, 200, { sku: skuParam, total: entries.length, entries });
      }
      return logReq(req, 200, start);
    }

    // ── 星图 API ──────────────────────────────────────────────────────────

    // GET /api/starmap/star-trail?t=xxx — 星轨模块：年度进度
    if (pathname === "/api/starmap/star-trail" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      try {
        const currentVolume = await getAgentAnnualVolume(agent.id, feishuMod);
        const trail = calculateStarTrail(agent, currentVolume, new Date());
        jsonRes(res, 200, trail);
      } catch (e) {
        console.error("star-trail error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/starmap/star-tier?t=xxx — 星级模块：返利档位
    if (pathname === "/api/starmap/star-tier" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      try {
        const currentVolume = await getAgentAnnualVolume(agent.id, feishuMod);
        const tier = calculateStarTier(agent, currentVolume);
        jsonRes(res, 200, tier);
      } catch (e) {
        console.error("star-tier error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/starmap/ecp-board?t=xxx — 星耀榜：ECP榜单
    if (pathname === "/api/starmap/ecp-board" && req.method === "GET") {
      const agent = await findAgent(token);
      if (!agent) { jsonRes(res, 401, { error: "无效链接" }); return logReq(req, 401, start); }
      try {
        const board = await getECPLeaderboard(agent.name, feishuMod);
        jsonRes(res, 200, board);
      } catch (e) {
        console.error("ecp-board error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 业务看板 API
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/biz-dashboard/overview — 公司看板概览
    if (pathname === "/api/biz-dashboard/overview" && req.method === "GET") {
      try {
        const startDate = url.searchParams.get("start") || "2026-01-01";
        const endDate = url.searchParams.get("end") || new Date().toISOString().slice(0, 10);

        // 读取所有订单
        const allOrders = await getAllOrders();
        const filtered = allOrders.filter(o => {
          const d = o.dateStr;
          return d && d >= startDate && d <= endDate;
        });

        // 聚合统计
        const totalOrders = filtered.length;
        const totalQty = filtered.reduce((s, o) => s + (o.quantity || 1), 0);

        // 按月统计
        const monthly = {};
        filtered.forEach(o => {
          const m = (o.dateStr || "").slice(0, 7);
          if (!monthly[m]) monthly[m] = { orders: 0, qty: 0 };
          monthly[m].orders++;
          monthly[m].qty += (o.quantity || 1);
        });

        // 按SKU统计
        const skuDist = {};
        filtered.forEach(o => {
          const sku = o.sku || "未知";
          if (!skuDist[sku]) skuDist[sku] = 0;
          skuDist[sku] += (o.quantity || 1);
        });

        // 按代理商统计
        const agentDist = {};
        filtered.forEach(o => {
          const agent = o.agentName || "未知";
          if (!agentDist[agent]) agentDist[agent] = { orders: 0, qty: 0 };
          agentDist[agent].orders++;
          agentDist[agent].qty += (o.quantity || 1);
        });

        // 按状态统计
        const statusDist = {};
        filtered.forEach(o => {
          const s = o.status || "未知";
          if (!statusDist[s]) statusDist[s] = 0;
          statusDist[s]++;
        });

        // 活跃代理商数
        const activeAgents = Object.keys(agentDist).length;

        // TOP10代理商
        const topAgents = Object.entries(agentDist)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 10);

        jsonRes(res, 200, {
          period: { start: startDate, end: endDate },
          summary: { totalOrders, totalQty, activeAgents },
          monthly: Object.entries(monthly).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month)),
          skuDist: Object.entries(skuDist).map(([sku, qty]) => ({ sku, qty })).sort((a, b) => b.qty - a.qty),
          topAgents,
          statusDist: Object.entries(statusDist).map(([status, count]) => ({ status, count })),
        });
      } catch (e) {
        console.error("biz-dashboard overview error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/biz-dashboard/agent/:name — 代理商看板
    if (pathname.match(/^\/api\/biz-dashboard\/agent\//) && req.method === "GET") {
      try {
        const agentName = decodeURIComponent(pathname.split("/api/biz-dashboard/agent/")[1]);
        const startDate = url.searchParams.get("start") || "2026-01-01";
        const endDate = url.searchParams.get("end") || new Date().toISOString().slice(0, 10);

        const allOrders = await getAllOrders();
        const agentOrders = allOrders.filter(o => {
          const d = o.dateStr;
          return o.agentName === agentName && d && d >= startDate && d <= endDate;
        });

        const totalOrders = agentOrders.length;
        const totalQty = agentOrders.reduce((s, o) => s + (o.quantity || 1), 0);

        // 按月统计
        const monthly = {};
        agentOrders.forEach(o => {
          const m = (o.dateStr || "").slice(0, 7);
          if (!monthly[m]) monthly[m] = { orders: 0, qty: 0 };
          monthly[m].orders++;
          monthly[m].qty += (o.quantity || 1);
        });

        // 按SKU统计
        const skuDist = {};
        agentOrders.forEach(o => {
          const sku = o.sku || "未知";
          if (!skuDist[sku]) skuDist[sku] = 0;
          skuDist[sku] += (o.quantity || 1);
        });

        // 按终端客户统计（大客户分析）
        const customerDist = {};
        agentOrders.forEach(o => {
          const customer = o.customerName || "未知";
          if (!customerDist[customer]) customerDist[customer] = { orders: 0, qty: 0 };
          customerDist[customer].orders++;
          customerDist[customer].qty += (o.quantity || 1);
        });

        const topCustomers = Object.entries(customerDist)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.qty - a.qty);

        jsonRes(res, 200, {
          agent: agentName,
          period: { start: startDate, end: endDate },
          summary: { totalOrders, totalQty },
          monthly: Object.entries(monthly).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month)),
          skuDist: Object.entries(skuDist).map(([sku, qty]) => ({ sku, qty })).sort((a, b) => b.qty - a.qty),
          topCustomers,
        });
      } catch (e) {
        console.error("biz-dashboard agent error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/biz-dashboard/manager/:name — 经理看板
    if (pathname.match(/^\/api\/biz-dashboard\/manager\//) && req.method === "GET") {
      try {
        const managerName = decodeURIComponent(pathname.split("/api/biz-dashboard/manager/")[1]);
        const startDate = url.searchParams.get("start") || "2026-01-01";
        const endDate = url.searchParams.get("end") || new Date().toISOString().slice(0, 10);

        // 获取该经理负责的代理商列表
        let managedAgents = [];
        try {
          const managerRecords = await listRecords(TABLES.sales_manager);
          const manager = managerRecords.find(r => (r.fields["经理姓名"] || "") === managerName);
          if (manager) {
            const agentList = manager.fields["负责代理商"] || "";
            managedAgents = agentList.split(",").map(s => s.trim()).filter(Boolean);
          }
        } catch (e) {
          console.warn("读取销售经理表失败:", e.message);
        }

        if (!managedAgents.length) {
          jsonRes(res, 200, {
            manager: managerName,
            period: { start: startDate, end: endDate },
            summary: { totalOrders: 0, totalQty: 0, agentCount: 0 },
            monthly: [],
            agentBreakdown: [],
          });
          return logReq(req, 200, start);
        }

        const allOrders = await getAllOrders();
        const managerOrders = allOrders.filter(o => {
          const d = o.dateStr;
          return managedAgents.includes(o.agentName) && d && d >= startDate && d <= endDate;
        });

        const totalOrders = managerOrders.length;
        const totalQty = managerOrders.reduce((s, o) => s + (o.quantity || 1), 0);

        // 按月统计
        const monthly = {};
        managerOrders.forEach(o => {
          const m = (o.dateStr || "").slice(0, 7);
          if (!monthly[m]) monthly[m] = { orders: 0, qty: 0 };
          monthly[m].orders++;
          monthly[m].qty += (o.quantity || 1);
        });

        // 按代理商统计
        const agentDist = {};
        managerOrders.forEach(o => {
          const agent = o.agentName || "未知";
          if (!agentDist[agent]) agentDist[agent] = { orders: 0, qty: 0 };
          agentDist[agent].orders++;
          agentDist[agent].qty += (o.quantity || 1);
        });

        const agentBreakdown = Object.entries(agentDist)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.qty - a.qty);

        jsonRes(res, 200, {
          manager: managerName,
          period: { start: startDate, end: endDate },
          summary: { totalOrders, totalQty, agentCount: managedAgents.length },
          monthly: Object.entries(monthly).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month)),
          agentBreakdown,
        });
      } catch (e) {
        console.error("biz-dashboard manager error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/biz-dashboard/key-accounts — 大客户看板
    if (pathname === "/api/biz-dashboard/key-accounts" && req.method === "GET") {
      try {
        const startDate = url.searchParams.get("start") || "2026-01-01";
        const endDate = url.searchParams.get("end") || new Date().toISOString().slice(0, 10);

        // 获取大客户列表
        let keyAccounts = [];
        try {
          const kaRecords = await listRecords(TABLES.key_account);
          keyAccounts = kaRecords.map(r => ({
            name: r.fields["客户名称"] || "",
            agent: r.fields["所属代理商"] || "",
            remark: r.fields["备注"] || "",
          })).filter(ka => ka.name);
        } catch (e) {
          console.warn("读取大客户表失败:", e.message);
        }

        if (!keyAccounts.length) {
          jsonRes(res, 200, {
            period: { start: startDate, end: endDate },
            summary: { totalOrders: 0, totalQty: 0, keyAccountCount: 0 },
            keyAccounts: [],
          });
          return logReq(req, 200, start);
        }

        const allOrders = await getAllOrders();
        const kaNames = keyAccounts.map(ka => ka.name);
        const kaOrders = allOrders.filter(o => {
          const d = o.dateStr;
          return kaNames.includes(o.customerName) && d && d >= startDate && d <= endDate;
        });

        const totalOrders = kaOrders.length;
        const totalQty = kaOrders.reduce((s, o) => s + (o.quantity || 1), 0);

        // 按大客户统计
        const kaDist = {};
        kaOrders.forEach(o => {
          const customer = o.customerName || "未知";
          if (!kaDist[customer]) kaDist[customer] = { orders: 0, qty: 0, agent: "" };
          kaDist[customer].orders++;
          kaDist[customer].qty += (o.quantity || 1);
        });

        // 补充代理商信息
        keyAccounts.forEach(ka => {
          if (kaDist[ka.name]) {
            kaDist[ka.name].agent = ka.agent;
          }
        });

        const kaBreakdown = Object.entries(kaDist)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.qty - a.qty);

        jsonRes(res, 200, {
          period: { start: startDate, end: endDate },
          summary: { totalOrders, totalQty, keyAccountCount: keyAccounts.length },
          keyAccounts: kaBreakdown,
        });
      } catch (e) {
        console.error("biz-dashboard key-accounts error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
      return logReq(req, 200, start);
    }

    // GET /api/biz-dashboard/lists — 获取所有列表（经理/代理商/大客户）
    if (pathname === "/api/biz-dashboard/lists" && req.method === "GET") {
      try {
        // 获取所有代理商
        const agentRecords = await listRecords(TABLES.agent);
        const agents = agentRecords.map(r => r.fields["代理商名称"] || r.fields["名称"] || "").filter(Boolean);

        // 获取所有销售经理
        let managers = [];
        try {
          const managerRecords = await listRecords(TABLES.sales_manager);
          managers = managerRecords.map(r => r.fields["经理姓名"] || "").filter(Boolean);
        } catch (e) {
          console.warn("读取销售经理表失败:", e.message);
        }

        // 获取所有大客户
        let keyAccounts = [];
        try {
          const kaRecords = await listRecords(TABLES.key_account);
          keyAccounts = kaRecords.map(r => r.fields["客户名称"] || "").filter(Boolean);
        } catch (e) {
          console.warn("读取大客户表失败:", e.message);
        }

        jsonRes(res, 200, { agents, managers, keyAccounts });
      } catch (e) {
        console.error("biz-dashboard lists error:", e.message);
        jsonRes(res, 500, { error: "数据获取失败" });
      }
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

// ─── 获取所有订单（业务看板用）────────────────────────────────────────────────
async function getAllOrders() {
  const allOrders = [];
  let pageToken = "";
  do {
    const params = pageToken ? `page_token=${pageToken}&page_size=500` : "page_size=500";
    const data = await feishuApi("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.order}/records?${params}`);
    const items = data.items || [];
    for (const r of items) {
      const f = r.fields;
      const rawDate = f["下单日期"] || f["创建时间"] || "";
      let date = 0, dateStr = "";
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          date = d.getTime();
          dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }
      }
      allOrders.push({
        orderNo: rawVal(f["订单编号"]) || "",
        customerName: rawVal(f["顾客姓名"]) || "",
        sku: rawVal(f["产品型号"]) || "",
        quantity: Number(f["数量"]) || 1,
        agentName: rawVal(f["代理商名称"]) || "",
        agentId: rawVal(f["代理商ID"]) || "",
        status: rawVal(f["订单状态"]) || "",
        date,
        dateStr,
      });
    }
    pageToken = data.page_token || "";
  } while (pageToken);
  return allOrders;
}

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

  // 确保草稿目录存在
  if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });

  // 扫描并处理过期草稿（启动时）
  setTimeout(() => {
    processPendingDrafts().then(n => console.log(`   草稿同步检查完成`)).catch(e => console.warn("⚠️ 草稿同步异常:", e.message));
  }, 5000);
  // 定时轮询
  setInterval(() => {
    processPendingDrafts().catch(e => console.warn("⚠️ 草稿同步异常:", e.message));
  }, DRAFT_SYNC_INTERVAL);

  // 预热库存缓存，避免首次 confirm 请求阻塞 10s+
  getStockMap().then(m => console.log(`   库存缓存预热完成: ${m.size} 条`)).catch(e => console.warn("⚠️ 库存缓存预热失败:", e.message));
  // 预热镜片缓存，验真零 API 调用
  warmLensCache().then(() => setInterval(warmLensCache, 10 * 60 * 1000)).catch(e => console.warn("⚠️ 镜片缓存预热失败:", e.message));

  // 7天自动签收定时任务：每天凌晨3点检查
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== 3 || now.getMinutes() !== 0) return;
    try {
      console.log("🕐 自动签收定时任务开始...");
      const cutoff = Date.now() - 7 * 86400000;
      const allOrders = await searchRecords(TABLES.order, {
        filter: { conjunction: "and", conditions: [{ field_name: "订单状态", operator: "is", value: ["已发货"] }] },
        fieldNames: ["订单编号", "订单状态", "发货日期", "流程步骤"],
      });
      const toSign = allOrders.filter(r => {
        const shipDate = r.fields["发货日期"];
        if (!shipDate) return false;
        const ts = typeof shipDate === "number" ? shipDate : new Date(shipDate).getTime();
        return ts < cutoff;
      });
      if (!toSign.length) { console.log("  自动签收：无超过7天未签收订单"); return; }
      const grouped = {};
      for (const rec of toSign) {
        const orderNo = rec.fields["订单编号"];
        if (!grouped[orderNo]) grouped[orderNo] = [];
        grouped[orderNo].push(rec);
      }
      let signed = 0;
      for (const [orderNo, recs] of Object.entries(grouped)) {
        const updates = recs.map(rec => {
          const wf = parseWorkflow(rec.fields["流程步骤"]);
          advanceWorkflow(wf, "delivered");
          return { record_id: rec.record_id, fields: { "订单状态": "已签收", "签收时间": Date.now(), "物流状态": "已签收", "流程步骤": JSON.stringify(wf) } };
        });
        await batchUpdateRecords(TABLES.order, updates);
        signed += updates.length;
        const lensDetails = await getLensDetailsByOrder(orderNo);
        const lensUpdates = lensDetails.filter(r => (r.fields["订单状态"] || "") === "已发货").map(r => ({ record_id: r.record_id, fields: { "订单状态": "已签收" } }));
        if (lensUpdates.length) await batchUpdateRecords(TABLES.lens_detail, lensUpdates);
      }
      invalidateOrdersCache();
      console.log(`  自动签收完成: ${Object.keys(grouped).length} 单, ${signed} 条记录`);
    } catch (e) { console.error("  自动签收异常:", e.message); }
  }, 60000);
  loadBinMap().catch(e => console.warn("⚠️ 仓位映射加载失败:", e.message));
  ensureField("供应商厂家", { type: 3, property: { options: [{ name: "高清" }, { name: "圣普" }, { name: "九次方" }, { name: "五彩" }, { name: "欧陆" }] } }).catch(e => console.warn("⚠️ 供应商厂家字段检查失败:", e.message));
  ensureField("库存状态", { type: 3, property: { options: [{ name: "有库存" }, { name: "无库存" }] } }).catch(e => console.warn("⚠️ 库存状态字段检查失败:", e.message));
  // 确保"订单状态"字段包含"已下单"选项
  ensureFieldOption(TABLES.order, "订单状态", "已下单").catch(e => console.warn("⚠️ 订单状态字段选项检查失败:", e.message));
  ensureFieldOption(TABLES.lens_detail, "订单状态", "已下单").catch(e => console.warn("⚠️ 镜片明细状态字段选项检查失败:", e.message));
  ensureFieldOption(TABLES.order, "订单状态", "打标签").catch(e => console.warn("⚠️ 订单状态字段选项检查失败:", e.message));
  ensureFieldOption(TABLES.lens_detail, "订单状态", "打标签").catch(e => console.warn("⚠️ 镜片明细状态字段选项检查失败:", e.message));
  ensureField("预占库存", { type: 2 }, TABLES.stock_detail).catch(e => console.warn("⚠️ 预占库存字段检查失败:", e.message));
  if (TABLES.procurement) {
    ensureField("SPH", { type: 2, property: { formatter: "0.00" } }, TABLES.procurement).catch(e => console.warn("⚠️ 采购SPH字段检查失败:", e.message));
    ensureField("CYL", { type: 2, property: { formatter: "0.00" } }, TABLES.procurement).catch(e => console.warn("⚠️ 采购CYL字段检查失败:", e.message));
  }
});
