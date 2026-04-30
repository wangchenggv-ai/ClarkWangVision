// Advisor 端到端冒烟测试
import { createInitialState, setShipPosition, setPlayerStock, setPlayerCash, setDie } from './engine/state.js';
import { recommendCaptainAssignment, recommendStockPurchase, recommendBidLimits, recommendAll } from './engine/advisor.js';

function setupScenario() {
  const s = createInitialState({ playerCount: 4, mySeat: 0, names: ['我', '张三', '李四', '王五'] });
  // 第 2 轮第 2 阶段
  s.round = 2; s.phase = 2;
  // 船的位置
  setShipPosition(s, 'red', 7);
  setShipPosition(s, 'yellow', 5);
  setShipPosition(s, 'black', 6);
  // 我重仓红船
  setPlayerStock(s, 0, 'red', 3);
  setPlayerStock(s, 0, 'yellow', 0);
  setPlayerStock(s, 0, 'black', 1);
  setPlayerCash(s, 0, 30);
  // 张三重仓黄
  setPlayerStock(s, 1, 'red', 0);
  setPlayerStock(s, 1, 'yellow', 3);
  setPlayerStock(s, 1, 'black', 1);
  setPlayerCash(s, 1, 20);
  // 李四重仓黑
  setPlayerStock(s, 2, 'black', 3);
  setPlayerCash(s, 2, 25);
  // 王五均衡
  setPlayerStock(s, 3, 'red', 1);
  setPlayerStock(s, 3, 'yellow', 1);
  setPlayerStock(s, 3, 'black', 1);
  setPlayerCash(s, 3, 18);
  // 股票市场剩余
  s.stockMarket = { red: 1, yellow: 1, black: 0 };
  // 本阶段骰子已知
  setDie(s, 0, 3);
  setDie(s, 1, 2);
  setDie(s, 2, 1);
  return s;
}

console.log('--- 场景：第 2 轮第 2 阶段，骰子 [3,2,1] ---');
console.log('我重仓红船 3 股，黑船 1 股；张三重仓黄船；李四重仓黑船');
console.log();

const state = setupScenario();
const t0 = Date.now();
const all = recommendAll(state);
const elapsed = Date.now() - t0;
console.log(`计算耗时：${elapsed}ms`);
console.log();

console.log('▼ 船长骰子分配 Top-3');
all.captain.options.slice(0, 3).forEach((o, i) => {
  console.log(`  ${i+1}. ${o.label}  U=${o.U.toFixed(2)}  ΔE=${o.breakdown.dWealth} ΔVar=${o.breakdown.dVar} Δ领先=${o.breakdown.dLead} Δ对手=${o.breakdown.dRival}`);
});

console.log();
console.log('▼ 股票购买 Top-3');
all.stock.options.slice(0, 3).forEach((o, i) => {
  console.log(`  ${i+1}. ${o.label}  U=${o.U.toFixed(2)}  ΔE=${o.breakdown.dWealth} ΔVar=${o.breakdown.dVar}`);
});

console.log();
console.log('▼ 角色拍卖估值');
all.bidLimits.options.forEach(o => {
  const v = o.bidLimit == null ? '—' : o.bidLimit.toFixed(2);
  console.log(`  ${o.label}: ${v}  (${o.notes})`);
});

console.log();
// 直觉验证：船长最优分配应该把大点数给我重仓的红船？
// 但红船在 7（near harbor），黑船 6 我也持股。给红 3 → 红到 10（payoff 15）。
// 给红 1 → 红到 8（payoff 6）。差异 9 金/股 × 3 股 = 27 金。这应该是大头。
// 期望 top-1 选 red=3 或类似把大点数给红的方案。
const top = all.captain.options[0];
const needsCheck = top.assignment.red >= 2;  // 给红船 ≥ 2 点
console.log(needsCheck
  ? `✓ 直觉验证通过：top-1 给红船 ${top.assignment.red}（≥2）`
  : `✗ 直觉验证失败：top-1 红船=${top.assignment.red}，预期 ≥2`);

process.exit(needsCheck ? 0 : 1);
