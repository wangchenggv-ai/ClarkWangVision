// 导出状态筛选器测试
const BASE = "http://localhost:3212";
const TOKEN = "admin-gsx-2026";
const api = (path) => fetch(`${BASE}${path}`).then(r => r.json());

let passed = 0, failed = 0;

function ok(label, cond, detail = "") {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

// ─── T1: 无 exportFilter — 基准行为不变 ──────────────────────────────────────
console.log("\nT1: 无 exportFilter（基准）");
const base = await api(`/api/admin/orders-fast?admin=${TOKEN}&pageSize=20`);
ok("返回 orders 数组", Array.isArray(base.orders));
ok("返回 totalPages", typeof base.totalPages === "number" && base.totalPages >= 1);
ok("返回 totalFiltered", typeof base.totalFiltered === "number");
ok("每页最多20条", base.orders.length <= 20);
const baseTotal = base.totalFiltered;
console.log(`   基准总数: ${baseTotal}`);

// ─── T2: factory-pending + factory-done 互补 ────────────────────────────────
console.log("\nT2: factory-pending + factory-done 覆盖全部订单");
const pending = await api(`/api/admin/orders-fast?admin=${TOKEN}&pageSize=9999&exportFilter=factory-pending`);
const done    = await api(`/api/admin/orders-fast?admin=${TOKEN}&pageSize=9999&exportFilter=factory-done`);
ok("factory-pending 返回 orders", Array.isArray(pending.orders));
ok("factory-done 返回 orders", Array.isArray(done.orders));
const sumFactory = pending.totalFiltered + done.totalFiltered;
ok(`factory互补等于总数 (${pending.totalFiltered}+${done.totalFiltered}=${sumFactory} vs ${baseTotal})`,
   sumFactory === baseTotal, `pending=${pending.totalFiltered} done=${done.totalFiltered} total=${baseTotal}`);

// ─── T3: label-pending + label-done 互补 ────────────────────────────────────
console.log("\nT3: label-pending + label-done 覆盖全部订单");
const lPending = await api(`/api/admin/orders-fast?admin=${TOKEN}&pageSize=9999&exportFilter=label-pending`);
const lDone    = await api(`/api/admin/orders-fast?admin=${TOKEN}&pageSize=9999&exportFilter=label-done`);
ok("label-pending 返回 orders", Array.isArray(lPending.orders));
ok("label-done 返回 orders", Array.isArray(lDone.orders));
const sumLabel = lPending.totalFiltered + lDone.totalFiltered;
ok(`label互补等于总数 (${lPending.totalFiltered}+${lDone.totalFiltered}=${sumLabel} vs ${baseTotal})`,
   sumLabel === baseTotal, `pending=${lPending.totalFiltered} done=${lDone.totalFiltered} total=${baseTotal}`);

// ─── T4: exportFilter + status 组合 ─────────────────────────────────────────
console.log("\nT4: exportFilter + status 组合（待发工厂场景）");
const factoryWorkflow = await api(`/api/admin/orders-fast?admin=${TOKEN}&status=生产中&exportFilter=factory-pending&pageSize=9999`);
ok("status=生产中+factory-pending 返回", Array.isArray(factoryWorkflow.orders));
ok("结果均为生产中", factoryWorkflow.orders.every(o => o.status === "生产中"),
   `non-producing: ${factoryWorkflow.orders.filter(o=>o.status!=="生产中").length} 条`);
console.log(`   生产中未导出工厂: ${factoryWorkflow.totalFiltered} 条`);

// ─── T5: exportFilter + status 组合（待打标签场景）────────────────────────
console.log("\nT5: exportFilter + status 组合（待打标签场景）");
const labelWorkflow = await api(`/api/admin/orders-fast?admin=${TOKEN}&status=打标签&exportFilter=label-pending&pageSize=9999`);
ok("status=打标签+label-pending 返回", Array.isArray(labelWorkflow.orders));
ok("结果均为打标签", labelWorkflow.orders.every(o => o.status === "打标签"),
   `non-labeled: ${labelWorkflow.orders.filter(o=>o.status!=="打标签").length} 条`);
console.log(`   打标签未导出标签: ${labelWorkflow.totalFiltered} 条`);

// ─── T6: 分页正确性 ──────────────────────────────────────────────────────────
console.log("\nT6: exportFilter 下分页正确");
const page1 = await api(`/api/admin/orders-fast?admin=${TOKEN}&exportFilter=factory-pending&page=1&pageSize=5`);
const page2 = await api(`/api/admin/orders-fast?admin=${TOKEN}&exportFilter=factory-pending&page=2&pageSize=5`);
ok("第1页最多5条", page1.orders.length <= 5);
ok("totalPages 等于 ceil(totalFiltered/5)",
   page1.totalPages === Math.ceil(page1.totalFiltered / 5),
   `totalPages=${page1.totalPages}, ceil=${Math.ceil(page1.totalFiltered/5)}, totalFiltered=${page1.totalFiltered}`);
if (page1.totalFiltered > 5) {
  // 用复合键（同单多行：orderNo+customerName+pairIndex）
  const key = o => `${o.orderNo}|${o.customerName}|${o.pairIndex}`;
  const ids1 = new Set(page1.orders.map(key));
  const ids2 = page2.orders.map(key);
  const overlap = ids2.filter(k => ids1.has(k));
  ok("第1页和第2页无重叠行（复合键）", overlap.length === 0, `重叠: ${overlap.join(",")}`);
} else {
  ok("数据量不足两页，跳过重叠检查", true);
}

// ─── T7: 无 exportFilter 分页不受影响 ────────────────────────────────────────
console.log("\nT7: 无 exportFilter 回归（分页不影响）");
const baseP1 = await api(`/api/admin/orders-fast?admin=${TOKEN}&page=1&pageSize=5`);
const baseP2 = await api(`/api/admin/orders-fast?admin=${TOKEN}&page=2&pageSize=5`);
ok("无filter分页第1页≤5条", baseP1.orders.length <= 5);
ok("无filter两页订单不重叠", (() => {
  const s1 = new Set(baseP1.orders.map(o=>o.orderNo));
  return baseP2.orders.every(o => !s1.has(o.orderNo));
})());

// ─── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`结果: ${passed} 通过 / ${failed} 失败 / ${passed+failed} 总计`);
if (failed > 0) process.exit(1);
