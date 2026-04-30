// Manila (Zoch Verlag, 2005, Franz-Benno Delonge) rule constants.
// ⚠️ ADJUST THESE TO MATCH YOUR PRINTED RULEBOOK — values below are
// based on common BGG references. If a constant disagrees with your
// physical copy, change it here; the rest of the engine reads from this file.

export const SHIPS = ['red', 'yellow', 'black'];
export const SHIP_LABELS = { red: '红船', yellow: '黄船', black: '黑船' };
export const SHIP_COLORS = { red: '#d94545', yellow: '#e6c84a', black: '#2a2a2a' };

export const TRACK_LENGTH = 14;                 // positions 0..13
export const SEA_POSITIONS = [0, 1, 2, 3, 4, 5, 6];
export const NEAR_HARBOR  = [7, 8, 9, 10];      // partial payout zone
export const HARBOR_POSITIONS = [11, 12, 13];   // full payout zone
export const START_POSITION = 0;

// 终局每股回报：船在哪个位置，对应每股股票分红多少金币
// (sea positions implicitly pay 0 — sunk / failed to arrive)
export const PAYOFF_PER_SHARE = {
  13: 30,
  12: 25,
  11: 20,
  10: 15,
   9: 10,
   8:  6,
   7:  3,
};

// 每艘船的股票市场：5 张股票，按购买顺序由低到高的价格梯队
export const STOCK_PRICE_TIERS = [4, 8, 12, 16, 20];
export const STOCKS_PER_SHIP = STOCK_PRICE_TIERS.length;

// 角色清单（Zoch 2005 原版）
export const ROLES = [
  'captain',       // 船长：掷 3 颗骰子 + 分配
  'pirate',        // 海盗：本阶段末击沉最落后的船
  'pilot',         // 领航员：可重掷 1 颗骰子
  'harborMaster',  // 船坞主：到港船给额外移动
  'speculator',    // 投机商：本轮末额外购股
  'loader',        // 装卸工：到港船给装卸奖金
  'banker',        // 银行家：放贷
  'insurance',     // 保险商：船沉时获补偿
];

export const ROLE_LABELS = {
  captain: '船长',
  pirate: '海盗',
  pilot: '领航员',
  harborMaster: '船坞主',
  speculator: '投机商',
  loader: '装卸工',
  banker: '银行家',
  insurance: '保险商',
};

// 骰子：马尼拉用 1-3 点（Zoch 原版印刷的特殊骰子）
export const DICE = {
  count: 3,
  faces: [1, 2, 3],
};

// 全部骰子组合（27 种），用于精确枚举
export const DICE_OUTCOMES = (() => {
  const out = [];
  for (const a of DICE.faces)
    for (const b of DICE.faces)
      for (const c of DICE.faces)
        out.push([a, b, c]);
  return out;
})();

// 一颗骰子掷出某点数的概率（均匀分布）
export const DIE_PROB = 1 / DICE.faces.length;

// 一组 3 颗骰子组合的概率（独立均匀）
export const DICE_OUTCOME_PROB = Math.pow(DIE_PROB, DICE.count);

// 游戏总轮数 + 每轮内骰子阶段数
export const TOTAL_ROUNDS = 3;
export const PHASES_PER_ROUND = 3;

// 海盗行动：阶段末沉掉位置最落后的船（位置最小者；并列时由海盗玩家选）
// 沉船后位置归 0，且该轮剩余阶段不再移动
export const PIRATE_SINKS_LOWEST = true;

// 工具函数 ---------------------------------------------------------

export function isInHarbor(pos) {
  return HARBOR_POSITIONS.includes(pos);
}

export function isNearHarbor(pos) {
  return NEAR_HARBOR.includes(pos);
}

export function isAtSea(pos) {
  return SEA_POSITIONS.includes(pos);
}

export function payoutForPosition(pos) {
  return PAYOFF_PER_SHARE[pos] || 0;
}

// 剩余的骰子阶段总数（含本阶段尚未掷的）
export function remainingPhases(round, phase) {
  const remainingInThisRound = PHASES_PER_ROUND - phase + 1;
  const futureRounds = TOTAL_ROUNDS - round;
  return remainingInThisRound + futureRounds * PHASES_PER_ROUND;
}
