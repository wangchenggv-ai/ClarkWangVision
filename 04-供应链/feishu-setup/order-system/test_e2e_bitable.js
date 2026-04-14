/**
 * test_e2e_bitable.js — E2E测试：1个代理商下5单，走完整流程
 *
 * 流程：下单→查询→确认→发货→签收
 * 代理商：AG-001 北京澳美雅博医疗器械有限公司
 *
 * Usage: node test_e2e_bitable.js
 */

const TOKEN = "AG-001-e662c4a12861fbf8";
const BASE = "http://localhost:3210";
const ADMIN = process.env.ADMIN_TOKEN || "";

const customers = ["北京同仁医院", "北医三院眼科", "北京爱尔眼科", "铂林眼科诊所", "北京嘉悦眼科"];
const skus = [
  "Ultra双效 -0.75/-0.50",
  "D8",
  "Ultra双效 -2.25/-0.50",
  "Ultra -1.25/-0.50",
  "Ultra",
];
const prescriptions = [
  { sph: -3.25, cyl: -0.75, axis: 180 },
  { sph: -2.50, cyl: -1.00, axis: 170 },
  { sph: -4.00, cyl: -0.50, axis: 5  },
  { sph: -1.75, cyl: -1.25, axis: 175 },
  { sph: -5.00, cyl: -0.75, axis: 10 },
];

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, json };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const orderNos = [];

  console.log("═══════════════════════════════════════════════════");
  console.log("  E2E测试: AG-001 下5单完整流程");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: 验证代理商
  console.log("[Step 1] 验证代理商...");
  const agentRes = await api("GET", `/api/agent?t=${TOKEN}`);
  if (agentRes.status !== 200) {
    console.error("❌ 代理商验证失败:", agentRes.json);
    process.exit(1);
  }
  console.log(`✅ 代理商: ${agentRes.json.name} (${agentRes.json.id})\n`);

  // Step 2: 下5单
  console.log("[Step 2] 下5个订单...");
  for (let i = 0; i < 5; i++) {
    const payload = {
      address: `北京市海淀区中关村大街${100 + i}号`,
      patients: [{
        customerName: customers[i],
        sku: skus[i],
        quantity: 1,
        eyes: [{
          side: "左眼",
          sph: prescriptions[i].sph,
          cyl: prescriptions[i].cyl,
          axis: prescriptions[i].axis,
          pd: 32.0,
          ph: 18.0,
          frame: `测试镜框-${i + 1}`,
        }],
        remark: `E2E测试订单 #${i + 1}`,
      }],
    };

    const res = await api("POST", `/api/submit?t=${TOKEN}`, payload);
    if (res.status === 200 && res.json.success) {
      orderNos.push(res.json.orderNo);
      console.log(`  ✅ 订单${i + 1}: ${res.json.orderNo} → ${customers[i]} ${skus[i]}`);
    } else {
      console.error(`  ❌ 订单${i + 1}失败:`, JSON.stringify(res.json));
    }
    await delay(300); // 避免订单号碰撞
  }
  console.log(`\n共提交 ${orderNos.length} 个订单\n`);

  // Step 3: 查询订单列表
  console.log("[Step 3] 查询订单列表...");
  const listRes = await api("GET", `/api/orders?t=${TOKEN}&pageSize=10`);
  if (listRes.status === 200) {
    console.log(`✅ 订单列表: 共${listRes.json.total}单`);
    console.log(`   待处理: ${listRes.json.stats.pending}, 生产中: ${listRes.json.stats.inProduction || 0}, 已发货: ${listRes.json.stats.shipped || 0}`);
  } else {
    console.error("❌ 查询失败:", listRes.json);
  }

  // Step 4: 查询每个订单详情
  console.log("\n[Step 4] 查询订单详情...");
  for (const orderNo of orderNos) {
    const detailRes = await api("GET", `/api/order/${orderNo}?t=${TOKEN}`);
    if (detailRes.status === 200) {
      const d = detailRes.json;
      const item0 = d.items && d.items[0];
      console.log(`  ✅ ${orderNo}: ${item0?.customerName || '-'} ${item0?.sku || '-'} 状态=${d.status}`);
    } else {
      console.error(`  ❌ ${orderNo}:`, detailRes.json);
    }
  }

  // Step 5: 确认订单（生成镜片码+QR）
  console.log("\n[Step 5] 确认订单（生成镜片码+QR）...");
  for (const orderNo of orderNos) {
    const confirmRes = await api("POST", `/api/order/${orderNo}/confirm?t=${TOKEN}`);
    if (confirmRes.status === 200) {
      console.log(`  ✅ ${orderNo}: 已确认，镜片码=${JSON.stringify(confirmRes.json.lensCodes || confirmRes.json)}`);
    } else {
      console.error(`  ❌ ${orderNo} 确认失败:`, confirmRes.json);
    }
    await delay(200);
  }

  // Step 6: 发货（需要admin权限，这里通过直接修改Bitable状态模拟）
  console.log("\n[Step 6] 模拟发货...");
  // 通过admin API查看所有订单，然后用更新接口改状态
  if (ADMIN) {
    const adminRes = await api("GET", `/api/admin/orders?admin=${ADMIN}`);
    if (adminRes.status === 200) {
      console.log(`  admin订单总数: ${adminRes.json.total || 'N/A'}`);
    }
  }
  // 直接说明这一步需要在Bitable上手动操作或用admin API
  console.log("  ℹ️  发货/签收需要在Bitable手动改状态或用物流模块(logistics.js)");
  console.log("  命令: node logistics.js ship --order " + orderNos[0]);
  console.log("  命令: node logistics.js deliver --order " + orderNos[0]);

  // Step 7: 验证双写 - 检查镜片明细表
  console.log("\n[Step 7] 验证双写（订单主表 + 镜片明细表）...");
  for (const orderNo of orderNos) {
    const detailRes = await api("GET", `/api/order/${orderNo}?t=${TOKEN}`);
    if (detailRes.status === 200) {
      const d = detailRes.json;
      const hasLensDetails = d.lenses && d.lenses.length > 0;
      console.log(`  ${orderNo}: 镜片明细=${hasLensDetails ? d.lenses.length + '条 ✅' : '无 ❌'}`);
      if (hasLensDetails) {
        for (const lens of d.lenses) {
          console.log(`    - ${lens.eye} SPH=${lens.sph} CYL=${lens.cyl} AXIS=${lens.axis}`);
        }
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  E2E测试完成");
  console.log("═══════════════════════════════════════════════════");
  console.log(`\n生成的订单号:`);
  for (const o of orderNos) console.log(`  ${o}`);
}

main().catch(err => { console.error("💥", err.message); process.exit(1); });
