import { SHIPS, STOCK_PRICE_TIERS, payoutForPosition, TRACK_LENGTH } from './rules.js';
import { expectedPayoutPerShare, variancePayoutPerShare } from './probability.js';

// 给定 PMFs，估算单股回报（净收益 = 终值 − 当前买入价）
export function stockNetEV(shipPMF, buyPrice) {
  return expectedPayoutPerShare(shipPMF) - buyPrice;
}

export function stockNetVariance(shipPMF) {
  return variancePayoutPerShare(shipPMF);  // 买入价是常数，方差不变
}

// 玩家总组合估值（按当前持股 + 现金）
//   注：持股已购买，对当前财富的贡献是"终值"，不是"净收益"
export function portfolioValue(player, pmfs) {
  let totalEV = player.cash;
  let totalVar = 0;
  for (const s of SHIPS) {
    const n = player.stocks[s];
    if (!n) continue;
    const ev = expectedPayoutPerShare(pmfs[s]);
    const v = variancePayoutPerShare(pmfs[s]);
    totalEV += n * ev;
    totalVar += n * n * v;       // n 张同船股票完全相关
  }
  return { totalEV, totalVar };
}

// 所有玩家排名（按 totalEV 降序），返回 [{playerId, totalEV, totalVar}]
export function rankPlayers(state, pmfs) {
  const ranked = state.players.map(p => {
    const { totalEV, totalVar } = portfolioValue(p, pmfs);
    return { playerId: p.id, name: p.name, isMe: p.isMe, totalEV, totalVar };
  });
  ranked.sort((a, b) => b.totalEV - a.totalEV);
  return ranked;
}

// 当前我方与第二名（或第一名，若我是第一）的 EV 差距
//   leadGap > 0 表示我领先，< 0 表示我落后
export function myLeadGap(state, pmfs) {
  const ranked = rankPlayers(state, pmfs);
  const meIdx = ranked.findIndex(r => r.isMe);
  if (meIdx === -1) return 0;
  const meEV = ranked[meIdx].totalEV;
  if (meIdx === 0) {
    // 我是第一，与第二的差距
    return meEV - ranked[1].totalEV;
  }
  // 我不是第一，与第一的差距（负数）
  return meEV - ranked[0].totalEV;
}

// 找到"目前最大威胁的对手"——除我外 EV 最高的玩家
export function topRival(state, pmfs) {
  const ranked = rankPlayers(state, pmfs);
  return ranked.find(r => !r.isMe) || null;
}

// 当前股票市场最低可购入价（即下一张可买的）
export function currentStockPrice(state, ship) {
  const remaining = state.stockMarket[ship];
  if (remaining <= 0) return null;
  // 价格从低到高：剩 5 张卖第 1 档（最便宜），剩 1 张卖第 5 档
  const tierIdx = STOCK_PRICE_TIERS.length - remaining;
  return STOCK_PRICE_TIERS[tierIdx];
}
