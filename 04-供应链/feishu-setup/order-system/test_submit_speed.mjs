/**
 * 测试代理商下单速度：5条新订单
 */
const BASE = "https://lab.gaushclear.com";
const AGENT_TOKEN = "AG-002-zxkmgoryb6nprmv6";
const SKU = "Ultra双效";
const NAMES = ["速度测试王", "速度测试李", "速度测试陈", "速度测试赵", "速度测试周"];

async function main() {
  const times = [];

  for (let i = 0; i < 5; i++) {
    const body = {
      address: `测试地址${i+1}号`,
      patients: [{
        customerName: NAMES[i],
        sku: SKU,
        quantity: 1,
        eyes: [
          { side: "右眼", sph: -(3 + i * 0.25), cyl: -0.75, axis: 90 + i },
          { side: "左眼", sph: -(3.5 + i * 0.25), cyl: -1.0, axis: 85 + i },
        ],
      }],
      terminalCustomer: { name: `速度测试诊所${i+1}`, contact: "测试", phone: "13800000000" },
      clientRequestId: `speed-test-${Date.now()}-${i}`,
    };

    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/submit?t=${AGENT_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const elapsed = performance.now() - t0;
    times.push({ i: i+1, name: NAMES[i], orderNo: json.orderNo, ok: json.success, ms: elapsed.toFixed(0) });
    console.log(`#${i+1} ${NAMES[i]}: ${json.success ? "✓" : "✗"} ${elapsed.toFixed(0)}ms ${json.orderNo || json.error}`);
  }

  const avg = times.reduce((s, t) => s + Number(t.ms), 0) / times.length;
  const max = Math.max(...times.map(t => Number(t.ms)));
  console.log(`\n平均: ${avg.toFixed(0)}ms | 最慢: ${max}ms`);

  console.log("\n测试订单（可在管理后台删除）:");
  for (const t of times) console.log(`  ${t.orderNo}`);
}

main().catch(e => console.error(e));
