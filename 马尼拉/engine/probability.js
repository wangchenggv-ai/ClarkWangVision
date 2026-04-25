import {
  SHIPS, DICE, HARBOR_POSITIONS, TRACK_LENGTH,
  PHASES_PER_ROUND, TOTAL_ROUNDS, payoutForPosition,
} from './rules.js';

// Monte Carlo 模拟船只终局位置分布。
// 输入：当前 state（船位置/存活、本阶段已掷骰子、剩余阶段数）
// 输出：每艘船的终局位置 PMF + 沉船概率 + 期望/方差等聚合量
//
// 关键建模假设（在文件顶部集中说明，方便核对）：
// - 每阶段 3 颗骰子，每颗分配给一艘船（船长 6 种排列）。
//   未指定排列时，假设均匀随机（中性，不偏向任何策略）。
// - 海盗在每阶段末沉掉位置最低的"未到港"船（位置 0-10）。
//   只有当该阶段海盗角色由某玩家持有时才触发。
//   未来阶段海盗持有概率默认 1（保守假设：总有人想买海盗）。
// - 已沉船保持位置 0、不再移动、不再被海盗选中。
// - 角色加成（领航员、船坞主等）暂未建模 —— 现实中影响较小，
//   后续若需要可在 simulatePhase 中加 hook。

const DEFAULT_SAMPLES = 4000;

function rollDie() {
  return DICE.faces[Math.floor(Math.random() * DICE.faces.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 模拟单个阶段：原地修改 ships 对象。
// dice：本阶段 3 颗骰子点数（已知或新掷）
// assignment：可选 { red, yellow, black } —— 若提供则按此分配，否则均匀随机
// pirateActive：本阶段海盗是否存在（true/false）
function simulatePhase(ships, dice, assignment, pirateActive) {
  // 决定排列
  let perm;
  if (assignment) {
    perm = { red: assignment.red, yellow: assignment.yellow, black: assignment.black };
  } else {
    const shuffled = shuffle(SHIPS);
    perm = {};
    for (let i = 0; i < SHIPS.length; i++) perm[shuffled[i]] = dice[i];
  }
  // 移动（已沉/已到港的船不再动）
  for (const s of SHIPS) {
    if (!ships[s].alive) continue;
    if (ships[s].pos >= HARBOR_POSITIONS[0]) continue;
    ships[s].pos = Math.min(TRACK_LENGTH - 1, ships[s].pos + perm[s]);
  }
  // 海盗：沉掉位置最低的"未到港 + 存活"船
  if (pirateActive) {
    let target = null;
    let minPos = Infinity;
    for (const s of SHIPS) {
      if (!ships[s].alive) continue;
      if (ships[s].pos >= HARBOR_POSITIONS[0]) continue;  // 已到港，安全
      if (ships[s].pos < minPos) {
        minPos = ships[s].pos;
        target = s;
      }
    }
    if (target) {
      ships[target].alive = false;
      ships[target].pos = 0;
    }
  }
}

// 计算一次完整模拟，返回 { red, yellow, black } 的终局位置（沉船记为 -1）
function simulateOnce(state, currentAssignment) {
  const ships = JSON.parse(JSON.stringify(state.ships));
  const totalPhases = TOTAL_ROUNDS * PHASES_PER_ROUND;
  const consumedPhases = (state.round - 1) * PHASES_PER_ROUND + (state.phase - 1);
  const remaining = totalPhases - consumedPhases;
  if (remaining <= 0) {
    const result = {};
    for (const s of SHIPS) result[s] = ships[s].alive ? ships[s].pos : -1;
    return result;
  }

  // 第一阶段：使用 state.currentDice（缺失的位置随机补齐）
  const firstDice = [
    state.currentDice[0] ?? rollDie(),
    state.currentDice[1] ?? rollDie(),
    state.currentDice[2] ?? rollDie(),
  ];
  const firstPirate = state.currentRoles.pirate != null;
  simulatePhase(ships, firstDice, currentAssignment ?? null, firstPirate);

  // 后续阶段：全随机
  for (let p = 1; p < remaining; p++) {
    const dice = [rollDie(), rollDie(), rollDie()];
    simulatePhase(ships, dice, null, /*pirateActive=*/true);
  }

  const result = {};
  for (const s of SHIPS) result[s] = ships[s].alive ? ships[s].pos : -1;
  return result;
}

// 主函数：返回 { red: PMF, yellow: PMF, black: PMF }
// PMF：{ -1: sinkProb, 0: ..., 1: ..., ..., 13: ... }
//   -1 表示沉船
export function shipFinalPMFs(state, { samples = DEFAULT_SAMPLES, currentAssignment = null } = {}) {
  const counts = {};
  for (const s of SHIPS) {
    counts[s] = {};
    for (let p = -1; p < TRACK_LENGTH; p++) counts[s][p] = 0;
  }
  for (let i = 0; i < samples; i++) {
    const out = simulateOnce(state, currentAssignment);
    for (const s of SHIPS) counts[s][out[s]]++;
  }
  const pmfs = {};
  for (const s of SHIPS) {
    pmfs[s] = {};
    for (let p = -1; p < TRACK_LENGTH; p++) pmfs[s][p] = counts[s][p] / samples;
  }
  return pmfs;
}

// 单船派生量
export function shipReachProbability(pmf) {
  let p = 0;
  for (const pos of HARBOR_POSITIONS) p += (pmf[pos] || 0);
  return p;
}

export function shipSinkProbability(pmf) {
  return pmf[-1] || 0;
}

// 单股期望终值（金币）
export function expectedPayoutPerShare(pmf) {
  let ev = 0;
  for (let pos = 0; pos < TRACK_LENGTH; pos++) {
    ev += (pmf[pos] || 0) * payoutForPosition(pos);
  }
  // pos = -1（沉船）赔付 0，无需加
  return ev;
}

// 单股终值方差
export function variancePayoutPerShare(pmf) {
  const mean = expectedPayoutPerShare(pmf);
  let v = 0;
  for (let pos = -1; pos < TRACK_LENGTH; pos++) {
    const payoff = pos === -1 ? 0 : payoutForPosition(pos);
    v += (pmf[pos] || 0) * Math.pow(payoff - mean, 2);
  }
  return v;
}
