/**
 * check_schema.js — Bitable 字段守卫
 *
 * 对比代码写入的字段名 vs Bitable 表实际字段，不一致就报错。
 * 用法：node check_schema.js
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { TABLES, APP_TOKEN } from "./shared/tables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 加载环境变量 ──────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(resolve(__dirname, "../shared/.env"), "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [k, ...v] = t.split("=");
  env[k.trim()] = v.join("=").trim();
}

// ─── 代码写入的字段（来源：全量审计 server.js / automations.js / logistics.js / sync_*.js / lib/stock.js / ai_analysis.js）──
const EXPECTED_FIELDS = {
  order: [
    "订单编号", "产品型号", "数量", "订单状态", "预计交期", "下单日期",
    "顾客姓名", "序号", "代理商名称", "代理商ID", "收货地址", "订单来源",
    "客户ID", "是否装配", "终端客户", "联系人", "联系电话", "备注",
    "镜片码", "承诺交货日", "物流公司", "快递单号", "发货时间", "物流状态",
    "流程步骤", "同步时间", "来源订单号", "签收时间", "实际完成日",
  ],
  lens_detail: [
    "订单编号", "眼别", "球镜SPH", "柱镜CYL", "轴位AXIS", "是否装配",
    "产品型号", "顾客姓名", "序号", "代理商名称", "代理商ID", "订单状态", "镜片码（唯一）",
  ],
  customer: [
    "客户ID", "客户名称", "来源系统", "客户类型", "联系人", "联系电话", "收货地址", "所在城市",
  ],
  agent: [
    "代理商ID", "代理商名称", "CRM_ID", "下单Token", "地址", "状态", "CRM同步时间", "来源系统",
  ],
  stock_detail: [
    "SKU编号", "SPH", "CYL", "当前库存", "最近出库",
  ],
  agent_stock: [
    "SKU编号", "SPH", "CYL", "自有库存", "寄售库存",
  ],
  consignment_ledger: [
    "流水号", "agent_id", "类型", "SKU编号", "SPH", "CYL", "数量", "备注",
  ],
  stock_movement: [
    "单据号", "类型", "来源去向", "SKU编号", "SPH", "CYL", "数量",
    "变动前库存", "变动后库存", "关联单号", "备注", "操作人",
  ],
  monthly_statement: [
    "代理商", "月份", "SKU编号", "消耗数量", "单价", "金额", "状态",
  ],
  finished_inventory: ["当前库存", "状态"],
  mold: ["模具编号", "SKU编号", "总寿命", "已使用", "剩余寿命", "状态"],
  production: [
    "周次", "产品型号", "建议产量", "生产类型", "触发原因", "状态",
    "分配车房", "已计模芯", "SPH", "CYL", "工单号", "预计完成日", "实际完成日", "回补状态",
  ],
  blank_inventory: ["状态"],
  factory: ["当前排队量"],
  procurement: [
    "采购类型", "关联SKU", "数量", "发起日期", "预计到货", "状态", "触发来源",
  ],
  ai_analysis: ["分析日期", "分析类型", "AI分析内容", "关键预警", "建议行动"],
};

// ─── 飞书 API ────────────────────────────────────────────────────────
const BASE = "https://open.feishu.cn/open-apis";
let _token = "";

async function getToken() {
  if (_token) return _token;
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const j = await r.json();
  _token = j.tenant_access_token;
  return _token;
}

async function fetchTableFields(tableId) {
  const token = await getToken();
  const r = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields?page_size=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`飞书 API 错误: ${j.msg}`);
  return new Set((j.data?.items || []).map(f => f.field_name));
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────
let errors = 0;
let warnings = 0;

console.log("🔍 Bitable 字段守卫 — 对比代码 vs 飞书表结构\n");

for (const [name, expected] of Object.entries(EXPECTED_FIELDS)) {
  const tableId = TABLES[name];
  if (!tableId) {
    console.log(`⚠️  ${name}: TABLES.${name} 未定义，跳过`);
    warnings++;
    continue;
  }

  let actual;
  try {
    actual = await fetchTableFields(tableId);
  } catch (e) {
    if (/TableIdNotFound/.test(e.message)) {
      console.log(`⏭️  ${name}: 表不存在（可能未创建或 ID 变更），跳过`);
      warnings++;
    } else {
      console.log(`💥 ${name}: 读取失败 — ${e.message}`);
      errors++;
    }
    continue;
  }

  const missing = expected.filter(f => !actual.has(f));
  const extra = [...actual].filter(f => !expected.includes(f));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✅ ${name}: ${expected.length} 字段全部匹配`);
  } else {
    if (missing.length > 0) {
      console.log(`❌ ${name}: 缺少字段（代码写入但 Bitable 不存在）:`);
      for (const f of missing) console.log(`     - ${f}`);
      errors++;
    }
    if (extra.length > 0) {
      console.log(`ℹ️  ${name}: 多余字段（Bitable 有但代码不写入，正常）: ${extra.join(", ")}`);
    }
  }
}

console.log(`\n${"─".repeat(50)}`);
if (errors > 0) {
  console.log(`❌ 发现 ${errors} 个问题，${warnings} 个警告`);
  process.exit(1);
} else {
  console.log(`✅ 全部通过${warnings > 0 ? `，${warnings} 个警告` : ""}`);
  process.exit(0);
}
