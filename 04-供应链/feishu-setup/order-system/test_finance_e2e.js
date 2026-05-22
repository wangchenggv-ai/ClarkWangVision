/**
 * test_finance_e2e.js — 财务结算全流程 E2E 测试
 *
 * 测试流程:
 *   1. 定价表 CRUD
 *   2. 预存款流水 CRUD
 *   3. 退换货登记 CRUD
 *   4. 返利规则+记录 CRUD
 *   5. 换货赋码 API（需要先有一笔已确认订单）
 *   6. 自动签收 API
 *   7. 验真 void 码检查
 *
 * 用法:
 *   node test_finance_e2e.js           # 直接调 Bitable API 测试表结构
 *   node test_finance_e2e.js --server  # 通过测试服务器 API 测试（需要服务器运行中）
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const useServer = process.argv.includes("--server");

// ── 加载测试环境 ──
const envFile = resolve(__dirname, ".env.test");
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const BASE = "https://open.feishu.cn/open-apis";
const APP_TOKEN = env.FEISHU_APP_TOKEN;
let TOKEN = "";

// ── 从 tables.js 读取表 ID ──
const tablesContent = readFileSync(resolve(__dirname, "../shared/tables.js"), "utf8");
const tableIds = {};
for (const m of tablesContent.matchAll(/(\w+):\s*"tbl\w+"/g)) {
  const [key, val] = m[0].split(":").map(s => s.trim().replace(/"/g, ""));
  tableIds[key] = val;
}

// ── API 封装 ──
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getToken() {
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const json = await res.json();
  TOKEN = json.tenant_access_token;
}

async function createRecord(tableId, fields) {
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`, { fields });
  if (res.code !== 0) throw new Error(`createRecord failed: ${res.msg}`);
  return res.data.record;
}

async function searchRecords(tableId, filter) {
  const res = await api("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/search`, {
    page_size: 100,
    ...(filter ? { filter } : {}),
  });
  if (res.code !== 0) return [];
  return res.data?.items || [];
}

async function updateRecord(tableId, recordId, fields) {
  const res = await api("PUT", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`, { fields });
  if (res.code !== 0) throw new Error(`updateRecord failed: ${res.msg}`);
  return res.data;
}

async function deleteRecord(tableId, recordId) {
  const res = await api("DELETE", `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`);
  return res.code === 0;
}

// ── 测试结果收集 ──
const results = [];
function ok(name) { results.push({ name, pass: true }); console.log(`  ✅ ${name}`); }
function fail(name, err) { results.push({ name, pass: false, error: err }); console.log(`  ❌ ${name}: ${err}`); }

// ── 清理函数 ──
const cleanup = [];

// ── 测试用例 ──

async function testPricingTable() {
  console.log("\n📋 测试1: 代理商定价表 CRUD");
  const tableId = tableIds.agent_pricing;
  if (!tableId || tableId.includes("XXX")) { fail("定价表", "表ID未配置"); return; }

  try {
    const rec = await createRecord(tableId, {
      "代理商ID": "AG-TEST",
      "产品型号": "Ultra双效",
      "单价": 1280,
      "拼接key": "AG-TEST-Ultra双效",
    });
    cleanup.push(() => deleteRecord(tableId, rec.record_id));
    ok("定价表-创建");

    const found = await searchRecords(tableId, {
      conjunction: "and",
      conditions: [{ field_name: "代理商ID", operator: "is", value: ["AG-TEST"] }],
    });
    if (found.length > 0) ok("定价表-查询");
    else fail("定价表-查询", "未找到记录");

    await updateRecord(tableId, rec.record_id, { "单价": 1380 });
    ok("定价表-更新");
  } catch (e) { fail("定价表", e.message); }
}

async function testDepositTable() {
  console.log("\n📋 测试2: 预存款流水表 CRUD");
  const tableId = tableIds.agent_deposit_log;
  if (!tableId || tableId.includes("XXX")) { fail("预存款表", "表ID未配置"); return; }

  try {
    const rec = await createRecord(tableId, {
      "代理商ID": "AG-TEST",
      "类型": "recharge",
      "金额": 50000,
      "操作人": "测试脚本",
      "时间": Date.now(),
      "备注": "E2E测试充值",
    });
    cleanup.push(() => deleteRecord(tableId, rec.record_id));
    ok("预存款表-充值");

    const rec2 = await createRecord(tableId, {
      "代理商ID": "AG-TEST",
      "类型": "deduct",
      "金额": -1280,
      "关联订单号": "ORD-TEST-001",
      "操作人": "测试脚本",
      "时间": Date.now(),
    });
    cleanup.push(() => deleteRecord(tableId, rec2.record_id));
    ok("预存款表-扣款");
  } catch (e) { fail("预存款表", e.message); }
}

async function testReturnExchangeTable() {
  console.log("\n📋 测试3: 退换货登记表 CRUD");
  const tableId = tableIds.return_exchange;
  if (!tableId || tableId.includes("XXX")) { fail("退换货表", "表ID未配置"); return; }

  try {
    const rec = await createRecord(tableId, {
      "日期": Date.now(),
      "原订单号": "ORD-TEST-001",
      "代理商": "AG-TEST",
      "产品型号": "Ultra双效",
      "眼别": "左",
      "类型": "换货",
      "原因": "质量问题",
      "责任方": "公司",
      "旧镜片码": "AAAAAAAAAAAAAAAA",
      "新镜片码": "BBBBBBBBBBBBBBBB",
      "处理人": "测试脚本",
    });
    cleanup.push(() => deleteRecord(tableId, rec.record_id));
    ok("退换货表-创建");
  } catch (e) { fail("退换货表", e.message); }
}

async function testRebateTables() {
  console.log("\n📋 测试4: 返利规则+记录表 CRUD");
  const ruleId = tableIds.rebate_rule;
  const recId = tableIds.rebate_record;

  try {
    if (ruleId && !ruleId.includes("XXX")) {
      const r1 = await createRecord(ruleId, {
        "代理商ID": "AG-TEST",
        "季度发货量门槛": 100,
        "每件返利金额": 50,
      });
      cleanup.push(() => deleteRecord(ruleId, r1.record_id));
      ok("返利规则表-创建");
    } else { fail("返利规则表", "表ID未配置"); }

    if (recId && !recId.includes("XXX")) {
      const r2 = await createRecord(recId, {
        "代理商ID": "AG-TEST",
        "季度": "2026Q2",
        "合计签收量": 150,
        "应得返利金额": 7500,
        "状态": "待确认",
      });
      cleanup.push(() => deleteRecord(recId, r2.record_id));
      ok("返利记录表-创建");
    } else { fail("返利记录表", "表ID未配置"); }
  } catch (e) { fail("返利表", e.message); }
}

async function testLensDetailVoidFields() {
  console.log("\n📋 测试5: lens_detail 作废字段");
  const tableId = tableIds.lens_detail;
  if (!tableId) { fail("lens_detail", "表ID未配置"); return; }

  try {
    // 先查一条有镜片码的记录
    const records = await searchRecords(tableId, {
      conjunction: "and",
      conditions: [{ field_name: "镜片码（唯一）", operator: "isNotEmpty" }],
    });
    if (!records.length) {
      console.log("  ⚠️ lens_detail 无镜片码记录，跳过作废字段测试");
      return;
    }

    const rec = records[0];
    const lensCode = rec.fields["镜片码（唯一）"];

    // 测试写入 active 状态
    await updateRecord(tableId, rec.record_id, { "镜片码状态": "active" });
    ok("作废字段-写入active");

    // 测试写入 void 状态
    await updateRecord(tableId, rec.record_id, { "镜片码状态": "void", "替换码": "TESTNEWCODE1234" });
    ok("作废字段-写入void+替换码");

    // 验证写入结果
    const updated = await searchRecords(tableId, {
      conjunction: "and",
      conditions: [{ field_name: "镜片码（唯一）", operator: "is", value: [lensCode] }],
    });
    if (updated.length > 0 && updated[0].fields["镜片码状态"] === "void") {
      ok("作废字段-验证void状态");
    } else {
      fail("作废字段-验证", "void状态未写入");
    }

    // 恢复为 active
    await updateRecord(tableId, rec.record_id, { "镜片码状态": "active", "替换码": "" });
    ok("作废字段-恢复active");
  } catch (e) { fail("作废字段", e.message); }
}

async function testServerExchangeAPI() {
  console.log("\n📋 测试6: 换货赋码 API (服务器)");
  const serverUrl = `http://113.44.175.221:${env.PORT || 3211}`;
  const adminToken = env.ADMIN_TOKEN;

  try {
    // 先找一笔有镜片码的订单
    const orderTableId = tableIds.order;
    const lensTableId = tableIds.lens_detail;
    const orders = await searchRecords(orderTableId, {
      conjunction: "and",
      conditions: [{ field_name: "订单状态", operator: "is", value: ["打标签"] }],
    });
    if (!orders.length) {
      console.log("  ⚠️ 无'打标签'状态订单，跳过换货API测试");
      return;
    }

    const testOrderNo = orders[0].fields["订单编号"];
    console.log(`  测试订单: ${testOrderNo}`);

    // 调用换货 API
    const res = await fetch(`${serverUrl}/api/admin/exchange-order?admin=${adminToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo: testOrderNo, eye: "左", reason: "质量问题", responsibility: "公司" }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      ok("换货API-调用成功");
      console.log(`    旧码: ${data.results?.[0]?.oldCode || "N/A"}`);
      console.log(`    新码: ${data.results?.[0]?.newCode || "N/A"}`);

      // 验证退换货登记表有记录
      const exchangeRecords = await searchRecords(tableIds.return_exchange, {
        conjunction: "and",
        conditions: [{ field_name: "原订单号", operator: "is", value: [testOrderNo] }],
      });
      if (exchangeRecords.length > 0) ok("换货API-退换货登记已写入");
      else fail("换货API-退换货登记", "未找到记录");

      // 验证旧码状态为 void
      if (data.results?.[0]?.oldCode) {
        const oldLens = await searchRecords(lensTableId, {
          conjunction: "and",
          conditions: [{ field_name: "镜片码（唯一）", operator: "is", value: [data.results[0].oldCode] }],
        });
        if (oldLens.length > 0 && oldLens[0].fields["镜片码状态"] === "void") {
          ok("换货API-旧码已void");
        } else {
          fail("换货API-旧码状态", "未标记为void");
        }
      }
    } else {
      fail("换货API", data.error || `HTTP ${res.status}`);
    }
  } catch (e) { fail("换货API", e.message); }
}

async function testServerAutoReceipt() {
  console.log("\n📋 测试7: 自动签收 API (服务器)");
  const serverUrl = `http://113.44.175.221:${env.PORT || 3211}`;
  const adminToken = env.ADMIN_TOKEN;

  try {
    // 用 days=0 来测试（立即签收所有已发货）
    // 但实际测试用 days=365 看看有没有超过一年的（不会有，只测接口通不通）
    const res = await fetch(`${serverUrl}/api/admin/auto-receipt?admin=${adminToken}&days=365`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      ok("自动签收API-调用成功");
      console.log(`    ${data.message}`);
    } else {
      fail("自动签收API", data.error || `HTTP ${res.status}`);
    }
  } catch (e) { fail("自动签收API", e.message); }
}

// ── 主流程 ──

async function main() {
  console.log("🧪 财务结算 E2E 测试");
  console.log(`   Bitable: ${APP_TOKEN}`);
  console.log(`   模式: ${useServer ? "服务器API" : "直接Bitable API"}`);
  console.log("═".repeat(50));

  await getToken();
  console.log("🔑 Token 获取成功");

  // 表结构测试（直接调 Bitable）
  await testPricingTable();
  await testDepositTable();
  await testReturnExchangeTable();
  await testRebateTables();
  await testLensDetailVoidFields();

  // 服务器 API 测试
  if (useServer) {
    await testServerExchangeAPI();
    await testServerAutoReceipt();
  } else {
    console.log("\n⏭️  跳过服务器API测试（加 --server 参数启用）");
  }

  // 清理测试数据
  console.log("\n🧹 清理测试数据...");
  let cleaned = 0;
  for (const fn of cleanup) {
    try { await fn(); cleaned++; } catch {}
  }
  console.log(`   清理 ${cleaned}/${cleanup.length} 条`);

  // 汇总
  console.log("\n" + "═".repeat(50));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`📊 结果: ${passed} 通过, ${failed} 失败, 共 ${results.length} 项`);
  if (failed > 0) {
    console.log("\n失败项:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name}: ${r.error}`));
  }
  console.log("═".repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("💥 测试异常:", e.message); process.exit(1); });
