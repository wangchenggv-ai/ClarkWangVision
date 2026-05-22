/**
 * seed_test_data.js — 在测试Bitable创建模拟数据 + 模拟换货全流程
 * 不依赖服务器，直接调 Bitable API
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, ".env.test"), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = env.FEISHU_APP_TOKEN;
let TOKEN = "";

// 测试Bitable的实际表ID（从lark-cli查询得到）
const T = {
  order: "tblmlRxaq0bNYgaf",
  lens_detail: "tblNPrsAB5uET9Hm",
  return_exchange: "tbldW8XLtXPf0lZC",
  agent_deposit_log: "tblObRYwlLa0Giua",
  agent_pricing: "tbl7eFXyw8s2fkYN",
  rebate_rule: "tblq2OW1BQ6JRNgu",
  rebate_record: "tblvtvJdtVLh6Ijy",
};

const results = [];
function ok(n) { results.push({ n, pass: true }); console.log(`  ✅ ${n}`); }
function fail(n, e) { results.push({ n, pass: false }); console.log(`  ❌ ${n}: ${e}`); }

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  TOKEN = (await r.json()).tenant_access_token;
}

function hex16() { return [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join(""); }

function extractText(val) {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(v => v.text || "").join("");
  if (val?.text) return val.text;
  return String(val || "");
}

async function main() {
  await getToken();
  console.log("🧪 模拟数据全流程测试\n" + "═".repeat(50));

  const orderNo = `ORD-TEST-${Date.now().toString(36).toUpperCase()}`;
  const customer = "测试门店A";
  const sku = "Ultra双效";
  const now = Date.now();

  // ── 1. 创建定价记录 ──
  console.log("\n📋 1. 代理商定价表");
  const pricingRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records`, {
    fields: { "代理商ID": "AG-TEST", "产品型号": sku, "单价": 1280, "拼接key": `AG-TEST-${sku}` },
  });
  if (pricingRes.code === 0) ok("定价记录创建");
  else fail("定价记录", pricingRes.msg);
  const pricingId = pricingRes.data?.record?.record_id;

  // ── 2. 创建预存款充值 ──
  console.log("\n📋 2. 预存款流水表");
  const depositRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_deposit_log}/records`, {
    fields: { "代理商ID": "AG-TEST", "类型": "recharge", "金额": 50000, "操作人": "测试", "时间": now, "备注": "E2E测试充值" },
  });
  if (depositRes.code === 0) ok("充值记录创建");
  else fail("充值记录", depositRes.msg);
  const depositId = depositRes.data?.record?.record_id;

  // ── 3. 创建订单 ──
  console.log(`\n📋 3. 创建测试订单: ${orderNo}`);
  const leftCode = hex16();
  const rightCode = hex16();

  const orderRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.order}/records`, {
    fields: {
      "订单编号": orderNo,
      "顾客姓名": customer,
      "产品型号": sku,
      "数量": 2,
      "订单状态": "打标签",
      "代理商名称": "测试代理商",
      "代理商ID": "AG-TEST",
      "下单日期": now,
      "镜片码": `${leftCode},${rightCode}`,
    },
  });
  if (orderRes.code === 0) ok(`订单创建`);
  else fail("订单创建", orderRes.msg);

  // ── 4. 创建镜片明细 ──
  console.log(`\n📋 4. 创建镜片明细: 左=${leftCode} 右=${rightCode}`);
  const lensRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records/batch_create`, {
    records: [
      { fields: { "订单编号": orderNo, "顾客姓名": customer, "产品型号": sku, "眼别": "左眼", "球镜SPH": -3.00, "柱镜CYL": -0.75, "轴位AXIS": 180, "序号": 1, "镜片码（唯一）": leftCode, "订单状态": "打标签", "镜片码状态": "active" } },
      { fields: { "订单编号": orderNo, "顾客姓名": customer, "产品型号": sku, "眼别": "右眼", "球镜SPH": -3.25, "柱镜CYL": -0.50, "轴位AXIS": 170, "序号": 1, "镜片码（唯一）": rightCode, "订单状态": "打标签", "镜片码状态": "active" } },
    ],
  });
  if (lensRes.code === 0) ok("镜片明细创建(2条)");
  else fail("镜片明细", lensRes.msg);

  // ── 5. 模拟换货：左眼旧码void + 新码 ──
  console.log(`\n🔄 5. 模拟换货: 左眼`);
  const newCode = hex16();

  // 5a. 查找旧码记录
  const oldLensRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records/search`, {
    page_size: 10,
    filter: { conjunction: "and", conditions: [{ field_name: "镜片码（唯一）", operator: "is", value: [leftCode] }] },
  });
  const oldLens = oldLensRes.data?.items?.[0];
  if (!oldLens) { fail("查找旧码", "未找到"); return; }

  // 5b. 旧码 → void
  const voidRes = await api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records/${oldLens.record_id}`, {
    fields: { "镜片码状态": "void", "替换码": newCode },
  });
  if (voidRes.code === 0) ok(`旧码 ${leftCode} → void`);
  else fail("旧码void", voidRes.msg);

  // 5c. 创建新码记录
  const newLensRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records`, {
    fields: {
      "订单编号": orderNo, "顾客姓名": customer, "产品型号": sku, "眼别": "左眼",
      "球镜SPH": -3.00, "柱镜CYL": -0.75, "轴位AXIS": 180, "序号": 1,
      "镜片码（唯一）": newCode, "订单状态": "打标签", "镜片码状态": "active", "替换码": leftCode,
    },
  });
  if (newLensRes.code === 0) ok(`新码 ${newCode} 创建`);
  else fail("新码创建", newLensRes.msg);

  // 5d. 写退换货登记
  const exRegRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.return_exchange}/records`, {
    fields: {
      "日期": now, "原订单号": orderNo, "代理商": "AG-TEST", "产品型号": sku,
      "眼别": "左", "类型": "换货", "原因": "质量问题", "责任方": "公司",
      "旧镜片码": leftCode, "新镜片码": newCode, "处理人": "测试脚本",
    },
  });
  if (exRegRes.code === 0) ok("退换货登记创建");
  else fail("退换货登记", exRegRes.msg);

  // ── 6. 验证：旧码状态=void ──
  console.log(`\n🔍 6. 验证作废状态`);
  const verifyOld = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records/search`, {
    page_size: 1,
    filter: { conjunction: "and", conditions: [{ field_name: "镜片码（唯一）", operator: "is", value: [leftCode] }] },
  });
  const oldFields = verifyOld.data?.items?.[0]?.fields || {};
  const oldStatus = typeof oldFields["镜片码状态"] === "object" ? oldFields["镜片码状态"]?.text || oldFields["镜片码状态"]?.value?.[0] : oldFields["镜片码状态"];
  const oldReplacement = extractText(oldFields["替换码"]);
  if (oldStatus === "void") ok(`旧码状态=void`);
  else fail("旧码状态", `实际=${oldStatus}`);
  if (oldReplacement === newCode) ok(`旧码替换码=${newCode}`);
  else fail("旧码替换码", `实际=${oldReplacement}`);

  // ── 7. 验证：新码状态=active ──
  const verifyNew = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.lens_detail}/records/search`, {
    page_size: 1,
    filter: { conjunction: "and", conditions: [{ field_name: "镜片码（唯一）", operator: "is", value: [newCode] }] },
  });
  const newFields = verifyNew.data?.items?.[0]?.fields || {};
  const newStatus = typeof newFields["镜片码状态"] === "object" ? newFields["镜片码状态"]?.text || newFields["镜片码状态"]?.value?.[0] : newFields["镜片码状态"];
  const newReplacement = extractText(newFields["替换码"]);
  if (newStatus === "active") ok(`新码状态=active`);
  else fail("新码状态", `实际=${newStatus}`);
  if (newReplacement === leftCode) ok(`新码替换码=${leftCode}`);
  else fail("新码替换码", `实际=${newReplacement}`);

  // ── 8. 验证：退换货登记有记录 ──
  console.log(`\n📋 8. 验证退换货登记`);
  const exVerify = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.return_exchange}/records/search`, {
    page_size: 10,
    filter: { conjunction: "and", conditions: [{ field_name: "原订单号", operator: "is", value: [orderNo] }] },
  });
  const exCount = exVerify.data?.items?.length || 0;
  if (exCount > 0) ok(`退换货登记 ${exCount} 条`);
  else fail("退换货登记", "无记录");

  // ── 9. 验证：预存款扣款 ──
  console.log(`\n📋 9. 验证预存款`);
  const deductRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_deposit_log}/records`, {
    fields: { "代理商ID": "AG-TEST", "类型": "deduct", "金额": -1280, "关联订单号": orderNo, "操作人": "测试", "时间": now },
  });
  if (deductRes.code === 0) ok("扣款记录创建");
  else fail("扣款记录", deductRes.msg);

  // ── 10. 验证：返利记录 ──
  console.log(`\n📋 10. 验证返利`);
  const rebateRes = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.rebate_record}/records`, {
    fields: { "代理商ID": "AG-TEST", "季度": "2026Q2", "合计签收量": 150, "应得返利金额": 7500, "状态": "待确认" },
  });
  if (rebateRes.code === 0) ok("返利记录创建");
  else fail("返利记录", rebateRes.msg);

  // ── 清理 ──
  console.log(`\n🧹 清理测试数据...`);
  const toClean = [pricingId, depositId, exRegRes.data?.record?.record_id, deductRes.data?.record?.record_id, rebateRes.data?.record?.record_id].filter(Boolean);
  let cleaned = 0;
  for (const id of toClean) {
    const r = await api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${T.agent_pricing}/records/${id}`);
    if (r.code === 0) cleaned++;
  }
  console.log(`   清理 ${cleaned} 条`);

  // ── 汇总 ──
  console.log("\n" + "═".repeat(50));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`📊 结果: ${passed} 通过, ${failed} 失败, 共 ${results.length} 项`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.n}`));
  }
  console.log(`\n测试订单: ${orderNo}`);
  console.log(`左眼旧码: ${leftCode} → void`);
  console.log(`左眼新码: ${newCode} → active`);
  console.log(`右眼镜片码: ${rightCode} → active (未换货)`);
  console.log("═".repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("💥", e.message); process.exit(1); });
