import { SHIPS, ROLES, ROLE_LABELS, STOCK_PRICE_TIERS } from './rules.js';
import { clone, myPlayer } from './state.js';
import { shipFinalPMFs } from './probability.js';
import {
  portfolioValue, rankPlayers, myLeadGap, topRival, currentStockPrice,
} from './payoffs.js';

// Advisor 的核心：给定 state + 决策类型，枚举行动并打分。
//
// 效用函数：
//   U = ΔE[我方财富]
//     - λ' · ΔVar[我方财富]
//     + α  · Δ(领先差距)
//     - β  · ΔE[最强对手财富]
//
// λ' 动态调整：领先时 ×1.5（更厌恶风险），落后时 ×0.5（更乐意博方差）。

const MC_SAMPLES = 2500;   // 每次评估的 Monte Carlo 样本数

function adjustLambda(baseLambda, leadGap) {
  if (leadGap > 0) return baseLambda * 1.5;       // 领先 → 更稳
  if (leadGap < 0) return baseLambda * 0.5;       // 落后 → 更敢博
  return baseLambda;
}

// 计算 (stateA, pmfsA) → (stateB, pmfsB) 这个变化对我方的效用增量
function computeUtility(stateBefore, pmfsBefore, stateAfter, pmfsAfter) {
  const me = myPlayer(stateBefore);
  if (!me) return { U: 0, breakdown: {} };

  const w = stateBefore.weights;
  const meBefore = portfolioValue(me, pmfsBefore);
  const meAfter  = portfolioValue(stateAfter.players[me.id], pmfsAfter);
  const dWealth  = meAfter.totalEV - meBefore.totalEV;
  const dVar     = meAfter.totalVar - meBefore.totalVar;

  const leadBefore = myLeadGap(stateBefore, pmfsBefore);
  const leadAfter  = myLeadGap(stateAfter, pmfsAfter);
  const dLead      = leadAfter - leadBefore;

  const rival = topRival(stateBefore, pmfsBefore);
  let dRival = 0;
  if (rival) {
    const rivalBeforeP = portfolioValue(stateBefore.players[rival.playerId], pmfsBefore);
    const rivalAfterP  = portfolioValue(stateAfter.players[rival.playerId], pmfsAfter);
    dRival = rivalAfterP.totalEV - rivalBeforeP.totalEV;
  }

  const lambda = adjustLambda(w.lambdaRisk, leadBefore);
  const U =
      dWealth
    - lambda * dVar
    + w.alphaLead * dLead
    - w.betaSuppress * dRival;

  return {
    U,
    breakdown: {
      dWealth: round2(dWealth),
      dVar: round2(dVar),
      dLead: round2(dLead),
      dRival: round2(dRival),
      lambdaUsed: round2(lambda),
    },
  };
}

function round2(x) { return Math.round(x * 100) / 100; }

// ---- 决策 1：船长骰子分配 ------------------------------------------------
// 给定本阶段已知的 3 颗骰子，枚举 6 种 (red,yellow,black) 的排列
// 返回每种分配的 U 评分 + 分解
export function recommendCaptainAssignment(state) {
  const dice = state.currentDice;
  if (dice.some(d => d == null)) {
    return { error: '请先输入本阶段 3 颗骰子点数' };
  }

  const pmfsBefore = shipFinalPMFs(state, { samples: MC_SAMPLES });
  const options = [];

  // 6 种排列：每种 = 把 dice[0],dice[1],dice[2] 分给 (red,yellow,black) 的某种映射
  const perms = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  for (const perm of perms) {
    const assignment = {
      red:    dice[perm[0]],
      yellow: dice[perm[1]],
      black:  dice[perm[2]],
    };

    // 假设这种分配后的 state（船的位置已推进）
    const stateAfter = clone(state);
    for (const s of SHIPS) {
      if (!stateAfter.ships[s].alive) continue;
      const newPos = Math.min(13, stateAfter.ships[s].pos + assignment[s]);
      stateAfter.ships[s].pos = newPos;
    }
    // 注意：海盗、其他角色会在未来阶段中被 MC 自然处理
    // 把当前阶段标记为"已消费"——推进到下一阶段
    stateAfter.currentDice = [null, null, null];
    stateAfter.currentRoles = {};
    stateAfter.phase += 1;
    if (stateAfter.phase > 3) { stateAfter.phase = 1; stateAfter.round += 1; }

    const pmfsAfter = shipFinalPMFs(stateAfter, { samples: MC_SAMPLES });
    const { U, breakdown } = computeUtility(state, pmfsBefore, stateAfter, pmfsAfter);

    options.push({
      label: `红=${assignment.red} 黄=${assignment.yellow} 黑=${assignment.black}`,
      assignment,
      U: round2(U),
      breakdown,
    });
  }

  options.sort((a, b) => b.U - a.U);
  return { options, pmfsBefore };
}

// ---- 决策 2：买股票 ------------------------------------------------
// 枚举每艘船的当前可买价位（市场剩余的最低价），评估对我方效用的影响
export function recommendStockPurchase(state) {
  const me = myPlayer(state);
  if (!me) return { error: '未找到自己玩家' };

  const pmfsBefore = shipFinalPMFs(state, { samples: MC_SAMPLES });
  const options = [];

  for (const ship of SHIPS) {
    if (state.stockMarket[ship] <= 0) continue;
    const price = currentStockPrice(state, ship);
    if (price == null || price > me.cash) continue;

    const stateAfter = clone(state);
    stateAfter.players[me.id].cash -= price;
    stateAfter.players[me.id].stocks[ship] += 1;
    stateAfter.stockMarket[ship] -= 1;

    // 买股票不影响船的位置，所以 PMF 不变。但因为持仓变了，组合估值变了。
    const { U, breakdown } = computeUtility(state, pmfsBefore, stateAfter, pmfsBefore);
    options.push({
      label: `买 ${ship}（${price}金）`,
      ship, price,
      U: round2(U),
      breakdown,
    });
  }

  // 加一个"不买"基线
  options.push({
    label: '不买（保留现金）',
    ship: null, price: 0,
    U: 0,
    breakdown: { dWealth: 0, dVar: 0, dLead: 0, dRival: 0, lambdaUsed: 0 },
  });

  options.sort((a, b) => b.U - a.U);
  return { options, pmfsBefore };
}

// ---- 决策 3：角色拍卖出价上限 ----------------------------------------
// 给每个角色估值：它能给我带来多少效用？这就是我可以承受的最高价。
//
// 简化模型：
//   - 船长价值 = 最优分配 vs 平均分配的 U 差值
//   - 海盗价值 = 沉掉对手最重仓船 vs 不沉的 U 差值
//   - 其他角色暂未建模 → 标 "?"
export function recommendBidLimits(state) {
  const dice = state.currentDice;
  const out = [];

  // 船长估值：需要骰子已知
  if (!dice.some(d => d == null)) {
    const cap = recommendCaptainAssignment(state);
    if (!cap.error && cap.options.length) {
      const best = cap.options[0].U;
      const avg = cap.options.reduce((s, o) => s + o.U, 0) / cap.options.length;
      out.push({
        role: 'captain', label: '船长',
        bidLimit: round2(best - avg),
        notes: `最优 U=${best.toFixed(1)}，平均=${avg.toFixed(1)}`,
      });
    } else {
      out.push({ role: 'captain', label: '船长', bidLimit: null, notes: cap.error || '不可估' });
    }
  } else {
    out.push({ role: 'captain', label: '船长', bidLimit: null, notes: '需先输入骰子' });
  }

  // 海盗估值：模拟"沉掉对手最重仓的非到港船"vs"不沉"
  const pmfsBefore = shipFinalPMFs(state, { samples: MC_SAMPLES });
  const rival = topRival(state, pmfsBefore);
  if (rival) {
    const rivalP = state.players[rival.playerId];
    let bestShipToSink = null;
    let bestN = 0;
    for (const s of SHIPS) {
      if (!state.ships[s].alive) continue;
      if (state.ships[s].pos >= 11) continue;
      if (rivalP.stocks[s] > bestN) { bestN = rivalP.stocks[s]; bestShipToSink = s; }
    }
    if (bestShipToSink) {
      const stateAfter = clone(state);
      stateAfter.ships[bestShipToSink].alive = false;
      stateAfter.ships[bestShipToSink].pos = 0;
      const pmfsAfter = shipFinalPMFs(stateAfter, { samples: MC_SAMPLES });
      const { U } = computeUtility(state, pmfsBefore, stateAfter, pmfsAfter);
      out.push({
        role: 'pirate', label: '海盗',
        bidLimit: round2(Math.max(0, U)),
        notes: `若沉掉 ${bestShipToSink}（${rival.name} 持 ${bestN} 股）`,
      });
    } else {
      out.push({ role: 'pirate', label: '海盗', bidLimit: 0, notes: '对手在该船无重仓' });
    }
  }

  // 其他角色：暂未建模
  for (const role of ROLES) {
    if (role === 'captain' || role === 'pirate') continue;
    out.push({ role, label: ROLE_LABELS[role], bidLimit: null, notes: '未建模（依赖更细规则）' });
  }
  return { options: out, pmfsBefore };
}

// ---- 一站式综合建议 ----------------------------------------------------
// 给出当前所有决策的推荐摘要
export function recommendAll(state) {
  const result = {
    summary: {
      round: state.round,
      phase: state.phase,
      myCash: myPlayer(state)?.cash ?? 0,
    },
  };
  result.captain = recommendCaptainAssignment(state);
  result.stock = recommendStockPurchase(state);
  result.bidLimits = recommendBidLimits(state);
  return result;
}
