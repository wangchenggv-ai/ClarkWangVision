// test_serial_slip.mjs — 序列号映射 + 同行单货位列测试
// 运行: node test_serial_slip.mjs

import { lookupBySerial, lookupBySphCyl, getAllEntries, getSupportedSkus } from "./lib/sku-serial.js";
const SKU = "Ultra双效";

let pass = 0, fail = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    fail++;
  }
}

// ── 1. 总量检查 ────────────────────────────────────────────────────────────────
console.log("\n[1] 总量检查");
const all = getAllEntries(SKU);
assert("共 219 条记录", all.length === 219, `实际 ${all.length}`);
assert("Ultra双效在支持列表", getSupportedSkus().includes(SKU));
assert("序列号001存在", !!lookupBySerial(SKU, "001"));
assert("序列号219存在", !!lookupBySerial(SKU, "219"));
assert("序列号000不存在", lookupBySerial(SKU, "000") === null);
assert("序列号220不存在", lookupBySerial(SKU, "220") === null);
assert("未知型号返回空", lookupBySerial("D8", "001") === null);

// ── 2. Top20 SPH/CYL + 货位验证 ───────────────────────────────────────────────
console.log("\n[2] Top20 SPH/CYL + 货位验证");
// 数据源：仓库SKU地址映射表.xlsx（权威）
const TOP20 = [
  ["001",  0.00,  0.00, "A-01-3-01", "A"],
  ["002", -1.25,  0.00, "A-01-3-02", "A"],
  ["003", -1.00,  0.00, "A-01-3-03", "A"],
  ["004", -0.75,  0.00, "A-01-3-04", "A"],
  ["005", -1.50,  0.00, "A-01-3-05", "A"],
  ["006", -1.50, -0.50, "A-01-3-06", "A"],
  ["007", -1.75,  0.00, "A-01-2-01", "A"],
  ["008", -1.25, -0.50, "A-01-2-02", "A"],
  ["009", -1.00, -0.50, "A-01-2-03", "A"],
  ["010", -2.25,  0.00, "A-01-2-04", "A"],
  ["011", -2.00, -0.50, "A-01-2-05", "A"],
  ["012", -2.00,  0.00, "A-01-2-06", "A"],
  ["013", -0.75, -0.50, "A-01-4-01", "A"],
  ["014", -0.50,  0.00, "A-01-4-02", "A"],
  ["015", -2.25, -0.50, "A-01-4-03", "A"],
  ["016", -1.75, -0.50, "A-01-4-04", "A"],
  ["017", -2.50, -0.50, "A-01-4-05", "A"],
  ["018", -2.75, -0.50, "A-01-4-06", "A"],
  ["019", -2.50,  0.00, "A-01-1-01", "A"],
  ["020", -2.75,  0.00, "A-01-1-02", "A"],
];

for (const [serial, sph, cyl, expectedBin, expectedAbc] of TOP20) {
  const bySerial = lookupBySerial(SKU, serial);
  assert(`${serial}: lookupBySerial → sph=${sph} cyl=${cyl}`,
    bySerial && bySerial.sph === sph && bySerial.cyl === cyl,
    `got sph=${bySerial?.sph} cyl=${bySerial?.cyl}`);
  assert(`${serial}: lookupBySerial → bin=${expectedBin}`,
    bySerial?.bin === expectedBin, `got ${bySerial?.bin}`);
  assert(`${serial}: lookupBySerial → abc=${expectedAbc}`,
    bySerial?.abc === expectedAbc, `got ${bySerial?.abc}`);

  const bySphCyl = lookupBySphCyl(SKU, sph, cyl);
  assert(`lookupBySphCyl(${sph},${cyl}) → serial=${serial}`,
    bySphCyl?.s === serial, `got ${bySphCyl?.s}`);
}

// ── 3. 反向查找精度（浮点容忍）────────────────────────────────────────────────
console.log("\n[3] 浮点输入容忍性");
assert("lookupBySphCyl('-1.00', '0') 字符串输入", lookupBySphCyl(SKU, "-1.00", "0")?.s === "003");
assert("lookupBySphCyl('-1', '-0.5') 简写输入", lookupBySphCyl(SKU, "-1", "-0.5")?.s === "009");
assert("lookupBySphCyl(0, 0) 零散光", lookupBySphCyl(SKU, 0, 0)?.s === "001");
assert("不存在的度数返回 null", lookupBySphCyl(SKU, -9.00, -5.00) === null);
assert("NaN 输入返回 null", lookupBySphCyl(SKU, NaN, 0) === null);
assert("未知型号返回 null", lookupBySphCyl("D8", -1.00, 0) === null);

// ── 4. B/C 类 bin 地址（已知部分）────────────────────────────────────────────
console.log("\n[4] B类货位地址（xlsx权威）");
assert("062 → B-04-3-01", lookupBySerial(SKU, "062")?.bin === "B-04-3-01");
assert("067 → B-04-3-06", lookupBySerial(SKU, "067")?.bin === "B-04-3-06");
assert("104 → B-05-4-01", lookupBySerial(SKU, "104")?.bin === "B-05-4-01");

console.log("\n[5] 全量数据覆盖");
assert("025 有完整数据（xlsx已分配）", lookupBySerial(SKU, "025")?.sph === -1.75 && lookupBySerial(SKU, "025")?.bin === "A-01-5-01");
assert("068 有完整数据（xlsx已分配）", lookupBySerial(SKU, "068")?.sph === -4.50 && lookupBySerial(SKU, "068")?.bin === "B-04-2-01");
assert("219 有完整数据", lookupBySerial(SKU, "219")?.sph === -5.75 && lookupBySerial(SKU, "219")?.cyl === -2.00 && lookupBySerial(SKU, "219")?.bin === "C-09-5-01");

// ── 5. templates.js slipHTML 列检查 ───────────────────────────────────────────
console.log("\n[6] slipHTML 列检查（简化版：眼别/SKU/SPH/CYL/AXIS）");
import { init, slipHTML, buildLabelHtmlFromFields } from "./lib/templates.js";
init({ getServerBaseUrl: () => "https://lab.gaushclear.com" });

const testOrder = {
  orderNo: "ORD-TEST-001",
  customerName: "测试顾客",
  agentName: "测试代理商",
  agentId: "AG-001",
  shipDate: "2026-05-16",
  promiseDate: "2026-05-18",
  courierName: "顺丰",
  trackingNo: "SF123456789",
  address: "北京市朝阳区测试路1号",
  rows: [
    { eye: "右眼", sku: "Ultra双效", sph: -1.00, cyl: 0, axis: 0, lensCode: "AABBCCDD11223344", pairIndex: 1 },
    { eye: "左眼", sku: "Ultra双效", sph: -1.25, cyl: -0.50, axis: 180, lensCode: "AABBCCDD11223355", pairIndex: 1 },
  ],
};

const html = slipHTML(testOrder);
// 通行单只包含5列，无序列号/货位/镜片码/QR
assert("slipHTML 包含「眼别」列头", html.includes("眼别"));
assert("slipHTML 包含「SPH 球镜」列头", html.includes("SPH 球镜"));
assert("slipHTML 包含「CYL 柱镜」列头", html.includes("CYL 柱镜"));
assert("slipHTML 包含「AXIS 轴位」列头", html.includes("AXIS 轴位"));
assert("slipHTML 不包含序列号列", !html.includes("<th>序列号</th>"));
assert("slipHTML 不包含货位列", !html.includes("<th>货位</th>"));
assert("slipHTML 不包含镜片码列", !html.includes("<th>镜片码</th>"));
assert("slipHTML 包含签收栏", html.includes("签收"));
assert("slipHTML 包含 SPH=-1.00", html.includes("-1.00"));
assert("slipHTML 包含 CYL=-1.25", html.includes("-1.25"));

// 标签含序列号+货位（序列号/货位在标签上给仓库拣货用）
console.log("\n[7] 标签含序列号+货位（仓库拣货）");
const labelR = await buildLabelHtmlFromFields({
  "顾客姓名": "测试顾客",
  "眼别": "右眼",
  "产品型号": "Ultra双效",
  "球镜SPH": -1.00,
  "柱镜CYL": 0,
  "轴位AXIS": 0,
  "镜片码（唯一）": "AABBCCDD11223344",
}, "ORD-TEST-001");
assert("buildLabelHtmlFromFields 右眼有返回", !!labelR);
assert("标签含序列号003", labelR?.html.includes("003"));
assert("标签含货位 A-01-3-03", labelR?.html.includes("A-01-3-03"));
assert("标签含 lbl-bin div", labelR?.html.includes('<div class="lbl-bin">'));

const labelL = await buildLabelHtmlFromFields({
  "顾客姓名": "测试顾客",
  "眼别": "左眼",
  "产品型号": "Ultra双效",
  "球镜SPH": -1.25,
  "柱镜CYL": -0.50,
  "轴位AXIS": 180,
  "镜片码（唯一）": "AABBCCDD11223355",
}, "ORD-TEST-001");
assert("标签含序列号008（左眼）", labelL?.html.includes("008"));
assert("标签含货位 A-01-2-02（左眼，xlsx权威）", labelL?.html.includes("A-01-2-02"));

// ── 汇总 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
if (fail > 0) process.exit(1);
