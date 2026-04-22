import { Phase, totalCards, DEV_CARD_TYPES } from './state.js';
import { RESOURCES } from './board.js';
import {
  COSTS, hasResources, payResources,
  canPlaceSettlement, canPlaceRoad, canPlaceRoadFreeOnly,
  canUpgradeToCity, canBuyDevCard, getBankTradeRate
} from './rules.js';
import { updateLongestRoad, updateLargestArmy, checkWinner, computeVictoryPoints } from './scoring.js';

export class CatanEngine {
  constructor(state, onChange) {
    this.state = state;
    this.onChange = onChange || (() => {});
  }

  log(msg, type = 'normal') {
    this.state.log.push({ msg, type, turn: this.state.turnNumber });
    if (this.state.log.length > 300) this.state.log.shift();
  }

  emit() { this.onChange(); }

  currentPlayer() { return this.state.players[this.state.currentPlayer]; }

  placeSetupSettlement(vertexId) {
    const state = this.state;
    if (state.phase !== Phase.SETUP_1_SETTLEMENT && state.phase !== Phase.SETUP_2_SETTLEMENT) return false;
    const pid = state.currentPlayer;
    if (!canPlaceSettlement(state, pid, vertexId, true)) return false;

    state.buildings[vertexId] = { type: 'settlement', owner: pid };
    state.players[pid].settlementsLeft--;
    state.lastSetupVertex = vertexId;

    const portTypes = state.board.portByVertex[vertexId];
    if (portTypes) for (const t of portTypes) state.players[pid].portAccess.add(t);

    this.log(`${state.players[pid].name} 建立了村庄`, 'normal');

    if (state.phase === Phase.SETUP_2_SETTLEMENT) {
      const vertex = state.board.vertices[vertexId];
      for (const hexId of vertex.hexIds) {
        const hex = state.board.hexes[hexId];
        if (hex.resource) {
          state.players[pid].resources[hex.resource]++;
        }
      }
      this.log(`${state.players[pid].name} 获得初始资源`, 'system');
    }

    state.phase = (state.phase === Phase.SETUP_1_SETTLEMENT) ? Phase.SETUP_1_ROAD : Phase.SETUP_2_ROAD;
    this.emit();
    return true;
  }

  placeSetupRoad(edgeId) {
    const state = this.state;
    if (state.phase !== Phase.SETUP_1_ROAD && state.phase !== Phase.SETUP_2_ROAD) return false;
    const pid = state.currentPlayer;
    if (!canPlaceRoad(state, pid, edgeId, true, state.lastSetupVertex)) return false;

    state.roads[edgeId] = pid;
    state.players[pid].roadsLeft--;
    this.log(`${state.players[pid].name} 建造了道路`, 'normal');

    if (state.phase === Phase.SETUP_1_ROAD) {
      if (state.currentPlayer < state.players.length - 1) {
        state.currentPlayer++;
        state.phase = Phase.SETUP_1_SETTLEMENT;
      } else {
        state.phase = Phase.SETUP_2_SETTLEMENT;
      }
    } else {
      if (state.currentPlayer > 0) {
        state.currentPlayer--;
        state.phase = Phase.SETUP_2_SETTLEMENT;
      } else {
        state.phase = Phase.ROLL;
        state.turnNumber = 1;
        this.log('=== 初始摆放完成,游戏开始 ===', 'highlight');
      }
    }
    state.lastSetupVertex = null;
    this.emit();
    return true;
  }

  rollDice() {
    const state = this.state;
    if (state.phase !== Phase.ROLL) return false;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    state.dice = [d1, d2];
    const total = d1 + d2;
    state.lastRoll = total;
    this.log(`${this.currentPlayer().name} 掷出 ${d1}+${d2}=${total}`, 'highlight');

    if (total === 7) {
      this._handleSeven();
    } else {
      this._distributeResources(total);
      state.phase = Phase.MAIN;
    }
    this.emit();
    return true;
  }

  _distributeResources(roll) {
    const state = this.state;
    const gains = {};
    for (const p of state.players) gains[p.id] = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

    for (const hid in state.board.hexes) {
      const hex = state.board.hexes[hid];
      if (hex.number !== roll) continue;
      if (state.robberHex === hid) continue;
      if (!hex.resource) continue;
      for (const vid of hex.vertexIds) {
        const b = state.buildings[vid];
        if (!b) continue;
        const amount = b.type === 'city' ? 2 : 1;
        gains[b.owner][hex.resource] += amount;
      }
    }
    for (const p of state.players) {
      const g = gains[p.id];
      const parts = [];
      for (const r of RESOURCES) {
        if (g[r] > 0) {
          p.resources[r] += g[r];
          parts.push(`${g[r]}${resIcon(r)}`);
        }
      }
      if (parts.length > 0) this.log(`${p.name} 获得 ${parts.join(' ')}`, 'system');
    }
  }

  _handleSeven() {
    const state = this.state;
    this.log('⚠️ 掷出 7 点!盗贼出动', 'highlight');
    const discards = {};
    let anyDiscard = false;
    for (const p of state.players) {
      const total = totalCards(p.resources);
      if (total > 7) {
        discards[p.id] = Math.floor(total / 2);
        anyDiscard = true;
      }
    }
    state.pendingDiscards = discards;
    if (anyDiscard) {
      state.phase = Phase.DISCARD;
    } else {
      state.phase = Phase.MOVE_ROBBER;
    }
  }

  discardCards(playerId, resources) {
    const state = this.state;
    if (state.phase !== Phase.DISCARD) return false;
    const need = state.pendingDiscards[playerId];
    if (!need) return false;
    let total = 0;
    for (const r of RESOURCES) {
      const v = resources[r] || 0;
      if (v < 0 || v > (state.players[playerId].resources[r] || 0)) return false;
      total += v;
    }
    if (total !== need) return false;
    for (const r of RESOURCES) state.players[playerId].resources[r] -= resources[r] || 0;
    delete state.pendingDiscards[playerId];
    this.log(`${state.players[playerId].name} 弃了 ${total} 张牌`, 'system');
    if (Object.keys(state.pendingDiscards).length === 0) {
      state.phase = Phase.MOVE_ROBBER;
    }
    this.emit();
    return true;
  }

  moveRobber(hexId, victimId) {
    const state = this.state;
    if (state.phase !== Phase.MOVE_ROBBER) return false;
    if (hexId === state.robberHex) return false;
    if (!state.board.hexes[hexId]) return false;

    state.robberHex = hexId;
    this.log(`${this.currentPlayer().name} 移动盗贼`, 'normal');

    const hex = state.board.hexes[hexId];
    const victims = new Set();
    for (const vid of hex.vertexIds) {
      const b = state.buildings[vid];
      if (b && b.owner !== state.currentPlayer && totalCards(state.players[b.owner].resources) > 0) {
        victims.add(b.owner);
      }
    }

    const resume = state._postRobberPhase || Phase.MAIN;
    if (victims.size === 0) {
      state.phase = resume;
      state._postRobberPhase = null;
    } else if (victims.size === 1) {
      const vId = [...victims][0];
      this._stealFrom(state.currentPlayer, vId);
      state.phase = resume;
      state._postRobberPhase = null;
    } else {
      if (victimId !== undefined && victims.has(victimId)) {
        this._stealFrom(state.currentPlayer, victimId);
        state.phase = resume;
        state._postRobberPhase = null;
      } else {
        state.pendingStealVictims = [...victims];
        state.phase = Phase.STEAL;
      }
    }
    this.emit();
    return true;
  }

  chooseStealVictim(victimId) {
    const state = this.state;
    if (state.phase !== Phase.STEAL) return false;
    if (!state.pendingStealVictims || !state.pendingStealVictims.includes(victimId)) return false;
    this._stealFrom(state.currentPlayer, victimId);
    state.pendingStealVictims = null;
    state.phase = state._postRobberPhase || Phase.MAIN;
    state._postRobberPhase = null;
    this.emit();
    return true;
  }

  _stealFrom(thiefId, victimId) {
    const state = this.state;
    const victim = state.players[victimId];
    const pool = [];
    for (const r of RESOURCES) {
      for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
    }
    if (pool.length === 0) return;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    victim.resources[picked]--;
    state.players[thiefId].resources[picked]++;
    this.log(`${state.players[thiefId].name} 从 ${victim.name} 偷了 1 张`, 'highlight');
  }

  buildRoad(edgeId) {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;
    const pid = state.currentPlayer;
    if (!canPlaceRoad(state, pid, edgeId, false, null)) return false;

    payResources(state.players[pid], COSTS.road);
    state.roads[edgeId] = pid;
    state.players[pid].roadsLeft--;
    this.log(`${state.players[pid].name} 建造了道路`, 'normal');
    updateLongestRoad(state);
    this._checkWin();
    this.emit();
    return true;
  }

  buildSettlement(vertexId) {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;
    const pid = state.currentPlayer;
    if (!canPlaceSettlement(state, pid, vertexId, false)) return false;

    payResources(state.players[pid], COSTS.settlement);
    state.buildings[vertexId] = { type: 'settlement', owner: pid };
    state.players[pid].settlementsLeft--;

    const portTypes = state.board.portByVertex[vertexId];
    if (portTypes) for (const t of portTypes) state.players[pid].portAccess.add(t);

    this.log(`${state.players[pid].name} 建造了村庄`, 'normal');
    updateLongestRoad(state);
    this._checkWin();
    this.emit();
    return true;
  }

  upgradeToCity(vertexId) {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;
    const pid = state.currentPlayer;
    if (!canUpgradeToCity(state, pid, vertexId)) return false;

    payResources(state.players[pid], COSTS.city);
    state.buildings[vertexId].type = 'city';
    state.players[pid].citiesLeft--;
    state.players[pid].settlementsLeft++;
    this.log(`${state.players[pid].name} 升级为城市`, 'highlight');
    this._checkWin();
    this.emit();
    return true;
  }

  buyDevCard() {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;
    const pid = state.currentPlayer;
    if (!canBuyDevCard(state, pid)) return false;

    payResources(state.players[pid], COSTS.devCard);
    const card = state.devDeck.pop();
    state.players[pid].newDevCards[card]++;
    this.log(`${state.players[pid].name} 购买了 1 张发展卡`, 'normal');
    this._checkWin();
    this.emit();
    return true;
  }

  playDevCard(type, payload = {}) {
    const state = this.state;
    const pid = state.currentPlayer;
    const p = state.players[pid];
    if (p.playedDevCardThisTurn && type !== 'victoryPoint') return false;
    if ((p.devCards[type] || 0) <= 0) return false;

    if (type === 'knight') {
      if (state.phase !== Phase.MAIN && state.phase !== Phase.ROLL) return false;
      const preRoll = state.phase === Phase.ROLL;
      p.devCards.knight--;
      p.playedKnights++;
      p.playedDevCardThisTurn = true;
      this.log(`${p.name} 打出骑士卡`, 'highlight');
      updateLargestArmy(state);
      state.phase = Phase.MOVE_ROBBER;
      state._postRobberPhase = preRoll ? Phase.ROLL : Phase.MAIN;
      this._checkWin();
      this.emit();
      return true;
    }

    if (state.phase !== Phase.MAIN) return false;

    if (type === 'roadBuilding') {
      p.devCards.roadBuilding--;
      p.playedDevCardThisTurn = true;
      this.log(`${p.name} 打出修路卡 (建 2 条免费路)`, 'highlight');
      state.phase = Phase.ROAD_BUILDING_1;
      state.roadBuildingPlaced = 0;
      this.emit();
      return true;
    }

    if (type === 'yearOfPlenty') {
      const { r1, r2 } = payload;
      if (!RESOURCES.includes(r1) || !RESOURCES.includes(r2)) return false;
      p.devCards.yearOfPlenty--;
      p.playedDevCardThisTurn = true;
      p.resources[r1]++;
      p.resources[r2]++;
      this.log(`${p.name} 打出丰收卡,获得 ${resIcon(r1)}${resIcon(r2)}`, 'highlight');
      this.emit();
      return true;
    }

    if (type === 'monopoly') {
      const { resource } = payload;
      if (!RESOURCES.includes(resource)) return false;
      p.devCards.monopoly--;
      p.playedDevCardThisTurn = true;
      let total = 0;
      for (const other of state.players) {
        if (other.id === pid) continue;
        total += other.resources[resource];
        other.resources[resource] = 0;
      }
      p.resources[resource] += total;
      this.log(`${p.name} 打出垄断卡,收集 ${total} 张 ${resIcon(resource)}`, 'highlight');
      this.emit();
      return true;
    }

    return false;
  }

  placeFreeRoad(edgeId) {
    const state = this.state;
    if (state.phase !== Phase.ROAD_BUILDING_1 && state.phase !== Phase.ROAD_BUILDING_2) return false;
    const pid = state.currentPlayer;
    if (!canPlaceRoadFreeOnly(state, pid, edgeId)) return false;

    state.roads[edgeId] = pid;
    state.players[pid].roadsLeft--;
    state.roadBuildingPlaced++;
    this.log(`${state.players[pid].name} (免费) 建造了道路`, 'normal');
    updateLongestRoad(state);

    if (state.roadBuildingPlaced >= 2 || state.players[pid].roadsLeft === 0) {
      state.phase = Phase.MAIN;
      state.roadBuildingPlaced = 0;
    } else {
      state.phase = Phase.ROAD_BUILDING_2;
    }
    this._checkWin();
    this.emit();
    return true;
  }

  tradeWithBank(giveResource, getResource) {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;
    const pid = state.currentPlayer;
    const p = state.players[pid];
    if (!RESOURCES.includes(giveResource) || !RESOURCES.includes(getResource)) return false;
    if (giveResource === getResource) return false;
    const rate = getBankTradeRate(p, giveResource);
    if (p.resources[giveResource] < rate) return false;
    p.resources[giveResource] -= rate;
    p.resources[getResource]++;
    this.log(`${p.name} 银行交易: ${rate}${resIcon(giveResource)} → 1${resIcon(getResource)}`, 'normal');
    this.emit();
    return true;
  }

  endTurn() {
    const state = this.state;
    if (state.phase !== Phase.MAIN) return false;

    const p = this.currentPlayer();
    for (const type of DEV_CARD_TYPES) {
      p.devCards[type] += p.newDevCards[type];
      p.newDevCards[type] = 0;
    }
    p.playedDevCardThisTurn = false;

    if (checkWinner(state) !== null) {
      state.phase = Phase.GAME_OVER;
      state.winner = checkWinner(state);
      this.log(`🏆 ${state.players[state.winner].name} 获胜! (${computeVictoryPoints(state, state.winner)} 分)`, 'highlight');
      this.emit();
      return true;
    }

    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    state.turnNumber++;
    state.phase = Phase.ROLL;
    this.log(`—— ${this.currentPlayer().name} 的回合 ——`, 'system');
    this.emit();
    return true;
  }

  _checkWin() {
    const winner = checkWinner(this.state);
    if (winner !== null) {
      this.state.phase = Phase.GAME_OVER;
      this.state.winner = winner;
      this.log(`🏆 ${this.state.players[winner].name} 获胜! (${computeVictoryPoints(this.state, winner)} 分)`, 'highlight');
    }
  }
}

export function resIcon(r) {
  return { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' }[r] || r;
}
