// lib/starmap-aggregator.js — 星图数据聚合模块

import { TABLES, APP_TOKEN } from "../shared/tables.js";

// ECP100 独立 Bitable
const ECP_APP_TOKEN = "RlfTb6gykaEb3gsR1lwcGnShnAA";
const ECP_PERF_TABLE = "tblnC2oBxVyIX11j";     // 业绩明细
const ECP_OPT_TABLE = "tblFyEMF7P76o7Ur";       // 视光师档案

// 年终返利档位（离焦大镜片）
const REBATE_TIERS = [
  { min: 10000, rate: 0.10 },
  { min: 6000,  rate: 0.08 },
  { min: 4000,  rate: 0.05 },
  { min: 0,     rate: 0 },
];

// 供货价阶梯（按年承诺采购量）
const PRICE_TIERS = [
  { min: 3000, sky: 231, ultra: 308, storm: 154 },
  { min: 2000, sky: 266, ultra: 354, storm: 177 },
  { min: 1000, sky: 300, ultra: 400, storm: 200 },
  { min: 0,    sky: 350, ultra: 450, storm: 260 },
];

/**
 * 获取代理商当年已发货订单总副数
 * 只算状态为"已发货"的订单
 */
export async function getAgentAnnualVolume(agentId, feishuMod) {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1).getTime();
  const endOfYear = new Date(year + 1, 0, 1).getTime();

  // 用 filterRecords 筛选该代理商已发货订单
  const filter = `AND(CurrentValue.[代理商ID]="${agentId}",CurrentValue.[订单状态]="已发货")`;
  const records = await feishuMod.filterRecords(TABLES.order, filter, [
    "订单编号", "发货时间", "数量", "订单状态"
  ]);

  let totalVolume = 0;
  for (const rec of records) {
    const fields = rec.fields || {};
    const shipTime = fields["发货时间"];
    // 发货时间可能是时间戳(ms)或日期字符串
    let shipTs = shipTime;
    if (typeof shipTime === "string") shipTs = new Date(shipTime).getTime();

    if (shipTs && shipTs >= startOfYear && shipTs < endOfYear) {
      totalVolume += Number(fields["数量"] || 1);
    }
  }
  return totalVolume;
}

/**
 * 计算星轨数据（纯计算函数，可独立测试）
 */
export function calculateStarTrail(agent, currentVolume, currentDate) {
  const yearlyTarget = Number(agent.yearly_target || 0);
  const now = currentDate || new Date();

  if (!yearlyTarget || yearlyTarget === 0) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      yearlyTarget: 0,
      currentVolume,
      progressPercent: 0,
      remainingVolume: 0,
      remainingMonths: 0,
      monthlyPaceNeeded: 0,
      status: "no_target",
      lastUpdateTime: now.toISOString(),
    };
  }

  const progressPercent = Math.min(100, currentVolume / yearlyTarget * 100);
  const remainingVolume = Math.max(0, yearlyTarget - currentVolume);

  // 剩余月份（含当月）
  let remainingMonths = 12 - now.getMonth(); // getMonth() 0-indexed, 5月→4, 12-4=8
  if (remainingMonths <= 0) remainingMonths = 1;

  const monthlyPaceNeeded = Math.ceil(remainingVolume / remainingMonths);

  // 状态判断
  const expectedProgressPercent = (12 - remainingMonths + 1) / 12 * 100;
  let status;
  if (currentVolume >= yearlyTarget) {
    status = "exceeded";
  } else if (progressPercent < expectedProgressPercent - 10) {
    status = "behind";
  } else if (progressPercent > expectedProgressPercent + 10) {
    status = "ahead";
  } else {
    status = "normal";
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    yearlyTarget,
    currentVolume,
    progressPercent: Math.round(progressPercent * 10) / 10,
    remainingVolume,
    remainingMonths,
    monthlyPaceNeeded,
    status,
    lastUpdateTime: now.toISOString(),
  };
}

/**
 * 计算星级数据（返利档位）
 */
export function calculateStarTier(agent, currentVolume) {
  const yearlyTarget = Number(agent.yearly_target || 0);

  // 当前返利档位
  let currentTier = REBATE_TIERS[REBATE_TIERS.length - 1]; // 默认0%
  for (const tier of REBATE_TIERS) {
    if (currentVolume >= tier.min) {
      currentTier = tier;
      break;
    }
  }

  // 下一档
  let nextTier = null;
  for (let i = REBATE_TIERS.length - 1; i >= 0; i--) {
    if (REBATE_TIERS[i].min > currentVolume) {
      nextTier = REBATE_TIERS[i];
    }
  }

  // 当前供货价档位
  let priceTier = PRICE_TIERS[PRICE_TIERS.length - 1];
  for (const tier of PRICE_TIERS) {
    if (yearlyTarget >= tier.min) {
      priceTier = tier;
      break;
    }
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    currentVolume,
    yearlyTarget,
    // 返利信息
    rebateRate: currentTier.rate,
    rebatePercent: `${(currentTier.rate * 100).toFixed(0)}%`,
    rebateTierMin: currentTier.min,
    nextRebateTier: nextTier ? { min: nextTier.min, rate: nextTier.rate } : null,
    volumeToNextRebate: nextTier ? Math.max(0, nextTier.min - currentVolume) : 0,
    // 供货价信息
    currentPriceTier: priceTier,
  };
}

/**
 * 获取ECP榜单数据（跨Bitable访问）
 * 返回代理商关联的ECP排名和进度
 */
export async function getECPLeaderboard(agentName, feishuMod) {
  // 读取视光师档案
  const optRecords = await feishuMod.feishuApi("GET",
    `/bitable/v1/apps/${ECP_APP_TOKEN}/tables/${ECP_OPT_TABLE}/records?page_size=100`
  );
  const opts = optRecords?.items || [];

  // 读取业绩明细
  const perfRecords = await feishuMod.feishuApi("GET",
    `/bitable/v1/apps/${ECP_APP_TOKEN}/tables/${ECP_PERF_TABLE}/records?page_size=500`
  );
  const perfs = perfRecords?.items || [];

  // 按视光师聚合业绩
  const ecpMap = new Map(); // name -> { name, store, boundCount, tier, status }
  for (const rec of opts) {
    const f = rec.fields || {};
    const name = f["视光师姓名"] || "";
    ecpMap.set(name, {
      name,
      store: f["所属门店"] || "",
      boundCount: Number(f["累计副数"] || 0),
      tier: f["当前档位"] || "未达标",
      status: f["状态"] || "进行中",
      distanceToNext: Number(f["距下一档"] || 0),
    });
  }

  // 用业绩明细补充/校正绑定数
  const perfCounts = new Map();
  for (const rec of perfs) {
    const f = rec.fields || {};
    const name = f["视光师"] || "";
    if (!name) continue;
    perfCounts.set(name, (perfCounts.get(name) || 0) + 1);
  }

  // 合并数据
  for (const [name, ecp] of ecpMap) {
    if (perfCounts.has(name)) {
      ecp.boundCount = perfCounts.get(name);
    }
  }

  // 排序（按绑定数降序）
  const ranked = [...ecpMap.values()].sort((a, b) => b.boundCount - a.boundCount);

  // 计算游学名额（100副+封顶50人）
  const studyTripCount = ranked.filter(e => e.boundCount >= 100).length;
  const studyTripRemaining = Math.max(0, 50 - studyTripCount);

  return {
    totalECP: ranked.length,
    studyTripRemaining,
    leaderboard: ranked.map((ecp, i) => ({
      rank: i + 1,
      name: ecp.name,
      store: ecp.store,
      boundCount: ecp.boundCount,
      tier: ecp.tier,
      status: ecp.status,
      distanceToNext: ecp.distanceToNext,
      progress: Math.min(100, Math.round(ecp.boundCount / 100 * 100)),
    })),
  };
}
