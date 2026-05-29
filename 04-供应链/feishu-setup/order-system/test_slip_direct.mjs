/**
 * test_slip_direct.mjs — 直接写测试记录到测试 Bitable，跑 slip-batch 验证地址聚合
 *
 * 跳过下单流程，直接插入5条"已发货"订单（3个地址），再调 slip-batch
 *
 * Usage: node test_slip_direct.mjs
 */

import { execSync } from "child_process";

const APP_ID     = "cli_a958c5e372b85cb0";
const APP_SECRET = "PWLWUZ3ZZZj3DnKb2nX0yhBWoQ5hzu0y";
const APP_TOKEN  = "CtXObqwAHaCXYssBBfkcXmrlnUe";
const ORDER_TBL  = "tblmlRxaq0bNYgaf";   // 测试 Bitable 的订单表
const LENS_TBL   = "tblNPrsAB5uET9Hm";   // 测试 Bitable 的镜片明细表

const TRACKING = "SF999000000001";  // 统一用一个快递单号，方便清理

// 3个地址、5条订单
const TEST_ORDERS = [
  { orderNo: "ORD-TEST-SLIP-001", customer: "张小明", addr: "上海市浦东新区张江高科技园区明眸眼科门诊一楼", contact: "王老师", phone: "13800000001" },
  { orderNo: "ORD-TEST-SLIP-002", customer: "李小红", addr: "上海市浦东新区张江高科技园区明眸眼科门诊一楼", contact: "王老师", phone: "13800000001" },
  { orderNo: "ORD-TEST-SLIP-003", customer: "王大力", addr: "北京市朝阳区建国路铂林眼科望京门诊3楼",       contact: "李经理", phone: "13900000002" },
  { orderNo: "ORD-TEST-SLIP-004", customer: "陈小花", addr: "北京市朝阳区建国路铂林眼科望京门诊3楼",       contact: "李经理", phone: "13900000002" },
  { orderNo: "ORD-TEST-SLIP-005", customer: "赵阳阳", addr: "四川省成都市高新区天府大道华厦眼科医院配镜中心", contact: "张护士", phone: "13700000003" },
];

let _token = null;
async function getToken() {
  if (_token) return _token;
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  _token = (await r.json()).tenant_access_token;
  return _token;
}

async function feishu(method, path, body) {
  const tok = await getToken();
  const r = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}

function ok(msg)   { console.log("  ✅", msg); }
function fail(msg) { console.error("  ❌", msg); process.exit(1); }
function step(n,t) { console.log(`\n━━━ Step ${n}: ${t}`); }

// ── Step 1: 清理上次测试残留 ────────────────────────────────────────────────
step(1, "清理上次测试残留");
const encoded = encodeURIComponent(`"ORD-TEST-SLIP"`);
const existing = await feishu("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records?page_size=20&filter=CurrentValue.[订单编号].contains("ORD-TEST-SLIP")`);
const oldIds = (existing.data?.items || []).map(r => r.record_id);
if (oldIds.length) {
  await feishu("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records/batch_delete`, { records: oldIds });
  console.log(`  清理 ${oldIds.length} 条旧订单`);
}
const existingLens = await feishu("GET", `/bitable/v1/apps/${APP_TOKEN}/tables/${LENS_TBL}/records?page_size=20&filter=CurrentValue.[订单编号].contains("ORD-TEST-SLIP")`);
const oldLensIds = (existingLens.data?.items || []).map(r => r.record_id);
if (oldLensIds.length) {
  await feishu("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${LENS_TBL}/records/batch_delete`, { records: oldLensIds });
  console.log(`  清理 ${oldLensIds.length} 条旧镜片明细`);
}
ok("清理完成");

// ── Step 2: 写入5条已发货订单 ───────────────────────────────────────────────
step(2, "写入5条已发货订单到测试 Bitable");
const shipTime = Date.now();
const orderRecords = TEST_ORDERS.map(o => ({
  fields: {
    "订单编号":   o.orderNo,
    "顾客姓名":   o.customer,
    "代理商ID":   "AG-002",
    "代理商名称": "测试代理商",
    "产品型号":   "Ultra双效",
    "收货地址":   o.addr,
    "联系人":     o.contact,   // 测试Bitable字段名
    "快递单号":   TRACKING,
    "物流公司":   "顺丰速运",
    "发货时间":   shipTime,
    "订单状态":   "已发货",    // 测试Bitable字段名
    "序号":       1,
  }
}));
const orderRes = await feishu("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TBL}/records/batch_create`, { records: orderRecords });
if (orderRes.code !== 0) fail(`写入订单失败: ${JSON.stringify(orderRes)}`);
ok(`写入 ${orderRes.data?.records?.length} 条订单`);

// ── Step 3: 写入镜片明细 ────────────────────────────────────────────────────
step(3, "写入镜片明细（每单双眼）");
const lensRecords = [];
let lensIdx = 1;
for (const o of TEST_ORDERS) {
  for (const eye of ["右眼", "左眼"]) {
    const code = `TESTSLIP${String(lensIdx++).padStart(8, "0")}`;
    lensRecords.push({ fields: {
      "订单编号":       o.orderNo,
      "顾客姓名":       o.customer,
      "眼别":           eye,
      "产品型号":       "Ultra双效",
      "球镜SPH":        -3.00,
      "柱镜CYL":        -0.75,
      "轴位AXIS":       180,
      "镜片码（唯一）": code,
      "序号":           1,
    }});
  }
}
const lensRes = await feishu("POST", `/bitable/v1/apps/${APP_TOKEN}/tables/${LENS_TBL}/records/batch_create`, { records: lensRecords });
if (lensRes.code !== 0) fail(`写入镜片明细失败: ${JSON.stringify(lensRes)}`);
ok(`写入 ${lensRes.data?.records?.length} 条镜片明细`);

// ── Step 4: 本地运行 slip-batch 针对测试 Bitable ─────────────────────────────
step(4, "本地运行 slip-batch（FEISHU_APP_TOKEN=测试Bitable）");
console.log("  命令:");
console.log(`  FEISHU_APP_TOKEN=${APP_TOKEN} ORDER_TBL=${ORDER_TBL} LENS_TBL=${LENS_TBL} node logistics.js slip-batch`);
console.log();

try {
  const cwd = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:\/)/i, "$1").replace(/\//g, "\\");
  const out = execSync(
    `node logistics.js slip-batch`,
    {
      cwd,
      env: {
        ...process.env,
        FEISHU_APP_TOKEN: APP_TOKEN,
        ORDER_TBL,
        LENS_TBL,
        FEISHU_APP_ID:     APP_ID,
        FEISHU_APP_SECRET: APP_SECRET,
        SERVER_BASE_URL:   "https://lab.gaushclear.com",
      },
      encoding: "utf-8",
      timeout: 60000,
    }
  );
  console.log(out);
} catch (e) {
  console.error("slip-batch 错误:", e.stdout || e.message);
}

// ── Step 5: 检查生成的 HTML 文件 ─────────────────────────────────────────────
step(5, "检查生成的 HTML 通行单");
import { readdirSync } from "fs";
const docs = readdirSync("./docs").filter(f => f.startsWith("slip-batch") && f.endsWith(".html"));
const testDocs = docs.filter(f => f.includes(TRACKING));
console.log(`  生成文件 (含 ${TRACKING}):`);
testDocs.forEach(f => console.log("   ", f));
console.log();
if (testDocs.length === 3) {
  ok(`✅ 正确：3张通行单（按3个地址各聚合一张）`);
} else if (testDocs.length === 5) {
  fail("❌ 5张通行单 — 地址聚合未生效，仍按订单分散");
} else {
  console.log(`  ⚠️ 生成 ${testDocs.length} 张，预期 3 张`);
}
