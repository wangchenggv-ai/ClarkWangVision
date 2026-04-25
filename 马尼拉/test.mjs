// 概率引擎自检 —— node test.mjs
import { createInitialState, setShipPosition, setShipAlive, setDie, setRoleHolder } from './engine/state.js';
import { shipFinalPMFs, shipReachProbability, shipSinkProbability,
  expectedPayoutPerShare, variancePayoutPerShare } from './engine/probability.js';
import { TOTAL_ROUNDS, PHASES_PER_ROUND, payoutForPosition } from './engine/rules.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function approxEq(a, b, tol = 0.05) {
  return Math.abs(a - b) <= tol;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 测试 1：船已在 13（港口），不会再移动
test('已到港船终局必为 13', () => {
  const s = createInitialState({ playerCount: 4 });
  for (const ship of ['red', 'yellow', 'black']) setShipPosition(s, ship, 13);
  s.round = 3; s.phase = 3;
  s.currentDice = [1, 2, 3];
  const pmfs = shipFinalPMFs(s, { samples: 1000 });
  assert(approxEq(pmfs.red[13], 1.0, 0.01), `red[13]=${pmfs.red[13]} 应≈1`);
  assert(approxEq(expectedPayoutPerShare(pmfs.red), 30, 0.5), `red EV=${expectedPayoutPerShare(pmfs.red)} 应≈30`);
});

// 测试 2：已沉船终局 = -1，payoff = 0
test('已沉船 EV = 0', () => {
  const s = createInitialState({ playerCount: 4 });
  setShipAlive(s, 'red', false);
  setShipPosition(s, 'yellow', 13);
  setShipPosition(s, 'black', 13);
  s.round = 3; s.phase = 3;
  s.currentDice = [1, 2, 3];
  const pmfs = shipFinalPMFs(s, { samples: 1000 });
  assert(approxEq(pmfs.red[-1], 1.0, 0.01), `red sink prob=${pmfs.red[-1]} 应≈1`);
  assert(approxEq(expectedPayoutPerShare(pmfs.red), 0, 0.5), `red EV=${expectedPayoutPerShare(pmfs.red)} 应≈0`);
});

// 测试 3：船在 8 + 最后一个阶段 + 已知骰子，无海盗 → 平均移动 (1+2+3)/3 = 2，终局位置 8+1=9, 8+2=10, 8+3=11 各 1/3
test('终局阶段已知骰子的位置分布', () => {
  const s = createInitialState({ playerCount: 4 });
  setShipPosition(s, 'red', 8);
  setShipPosition(s, 'yellow', 13);   // 黄黑都在港口，不会成为海盗目标
  setShipPosition(s, 'black', 13);
  s.round = 3; s.phase = 3;
  s.currentDice = [1, 2, 3];
  // 没有海盗
  const pmfs = shipFinalPMFs(s, { samples: 5000 });
  // red 收到的骰子应该在 1/2/3 各 1/3 概率（均匀随机分配）
  assert(approxEq(pmfs.red[9], 1/3, 0.04), `red[9]=${pmfs.red[9].toFixed(3)} 应≈0.333`);
  assert(approxEq(pmfs.red[10], 1/3, 0.04), `red[10]=${pmfs.red[10].toFixed(3)} 应≈0.333`);
  assert(approxEq(pmfs.red[11], 1/3, 0.04), `red[11]=${pmfs.red[11].toFixed(3)} 应≈0.333`);
  // EV = (10+15+20)/3 = 15
  assert(approxEq(expectedPayoutPerShare(pmfs.red), 15, 0.6), `red EV=${expectedPayoutPerShare(pmfs.red).toFixed(2)} 应≈15`);
});

// 测试 4：本阶段海盗在场 + 红船最低 → 红船沉
test('海盗沉最低船', () => {
  const s = createInitialState({ playerCount: 4 });
  setShipPosition(s, 'red', 1);
  setShipPosition(s, 'yellow', 5);
  setShipPosition(s, 'black', 6);
  s.round = 3; s.phase = 3;
  s.currentDice = [1, 1, 1];   // 都+1：red→2, yellow→6, black→7
  setRoleHolder(s, 'pirate', 1);  // 玩家 1 持有海盗
  const pmfs = shipFinalPMFs(s, { samples: 1000 });
  // red 移动后位置 2，仍是最低的非到港船 → 必沉
  assert(approxEq(pmfs.red[-1], 1.0, 0.05), `red sink prob=${pmfs.red[-1].toFixed(3)} 应≈1`);
});

// 测试 5：到港概率单调性 —— 起点更靠后，到港概率应更高
test('到港概率单调性', () => {
  const probAt = (pos) => {
    const s = createInitialState({ playerCount: 4 });
    setShipPosition(s, 'red', pos);
    setShipPosition(s, 'yellow', 13);  // 让黄黑不被海盗选
    setShipPosition(s, 'black', 13);
    s.round = 3; s.phase = 1;
    return shipReachProbability(shipFinalPMFs(s, { samples: 2000 }).red);
  };
  const p3 = probAt(3);
  const p6 = probAt(6);
  const p9 = probAt(9);
  assert(p3 < p6 && p6 < p9, `到港概率应单调：p3=${p3.toFixed(2)}, p6=${p6.toFixed(2)}, p9=${p9.toFixed(2)}`);
});

// 测试 6：payoff 表正确
test('payoutForPosition', () => {
  assert(payoutForPosition(13) === 30, '13应=30');
  assert(payoutForPosition(11) === 20, '11应=20');
  assert(payoutForPosition(7) === 3, '7应=3');
  assert(payoutForPosition(6) === 0, '6应=0（开海无支付）');
  assert(payoutForPosition(0) === 0, '0应=0');
});

// 跑测
let passed = 0, failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`✓ ${t.name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${t.name}\n  ${e.message}`);
    failed++;
  }
}
console.log(`\n${passed}/${tests.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
