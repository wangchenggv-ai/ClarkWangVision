import { SHIPS, STOCKS_PER_SHIP, START_POSITION, ROLES } from './rules.js';

// State 是工具的唯一真相源。所有 advisor / renderer / ui 都基于它派生。
// 字段都用最简单的 plain object/array，便于 JSON 序列化（导出局面记录）。

export function createInitialState({ playerCount = 4, mySeat = 0, names = null } = {}) {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: i,
      name: names?.[i] || `玩家${i + 1}`,
      isMe: i === mySeat,
      cash: 0,                                       // 现金，用户每轮可改
      stocks: { red: 0, yellow: 0, black: 0 },       // 各船持股数
      role: null,                                    // 本阶段持有的角色
    });
  }

  const ships = {};
  for (const s of SHIPS) ships[s] = { pos: START_POSITION, alive: true };

  const stockMarket = {};
  for (const s of SHIPS) stockMarket[s] = STOCKS_PER_SHIP;  // 5 张全在市场

  return {
    round: 1,
    phase: 1,
    ships,
    players,
    bigBoss: 0,                                      // 当前 Big Boss 玩家 id
    stockMarket,
    // 本阶段输入：用户填的 3 颗骰子点数（null 表示尚未掷）
    currentDice: [null, null, null],
    // 本阶段角色拍卖结果：{ roleName: playerId } —— 拍到的玩家
    currentRoles: {},
    // 决策权重（UI 滑块控制）
    weights: {
      lambdaRisk:    0.5,    // 风险厌恶系数
      alphaLead:     0.3,    // 领先/落后调整
      betaSuppress:  0.4,    // 对手抑制
    },
    // 历史记录（每阶段结束后追加快照）
    history: [],
  };
}

export function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// ---- 派生量 ----------------------------------------------------------

export function aliveShips(state) {
  return SHIPS.filter(s => state.ships[s].alive);
}

export function myPlayer(state) {
  return state.players.find(p => p.isMe);
}

export function getPlayer(state, id) {
  return state.players[id];
}

// ---- 修改器 ----------------------------------------------------------

export function setShipPosition(state, ship, pos) {
  state.ships[ship].pos = pos;
}

export function setShipAlive(state, ship, alive) {
  state.ships[ship].alive = alive;
  if (!alive) state.ships[ship].pos = 0;
}

export function setPlayerStock(state, playerId, ship, count) {
  state.players[playerId].stocks[ship] = Math.max(0, count);
}

export function setPlayerCash(state, playerId, cash) {
  state.players[playerId].cash = cash;
}

export function setPlayerRole(state, playerId, role) {
  state.players[playerId].role = role;
}

export function setRoleHolder(state, role, playerId) {
  state.currentRoles[role] = playerId;
  if (playerId != null) state.players[playerId].role = role;
}

export function clearRoles(state) {
  state.currentRoles = {};
  for (const p of state.players) p.role = null;
}

export function setDie(state, idx, value) {
  state.currentDice[idx] = value;
}

export function setWeights(state, partial) {
  Object.assign(state.weights, partial);
}

// 推进到下一阶段（或下一轮）。不做规则强制，只是计数器。
export function advancePhase(state) {
  state.history.push({
    round: state.round,
    phase: state.phase,
    ships: JSON.parse(JSON.stringify(state.ships)),
    dice: [...state.currentDice],
    roles: { ...state.currentRoles },
  });
  state.currentDice = [null, null, null];
  clearRoles(state);
  state.phase += 1;
  if (state.phase > 3) {
    state.phase = 1;
    state.round += 1;
  }
}
