import { Phase, totalCards } from './state.js';
import { RESOURCES, dice2pDistribution } from './board.js';
import {
  COSTS, hasResources,
  canPlaceSettlement, canPlaceRoad, canPlaceRoadFreeOnly,
  canUpgradeToCity, canBuyDevCard,
  getAvailableSettlementVertices, getAvailableRoadEdges, getAvailableCityVertices, getAvailableFreeRoadEdges,
  getBankTradeRate
} from './rules.js';
import { computeVictoryPoints } from './scoring.js';

export function aiStep(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const p = state.players[pid];
  if (!p.isAI) return false;

  switch (state.phase) {
    case Phase.SETUP_1_SETTLEMENT:
    case Phase.SETUP_2_SETTLEMENT:
      return aiPlaceSetupSettlement(engine);
    case Phase.SETUP_1_ROAD:
    case Phase.SETUP_2_ROAD:
      return aiPlaceSetupRoad(engine);
    case Phase.ROLL:
      return engine.rollDice();
    case Phase.DISCARD:
      return aiDiscard(engine);
    case Phase.MOVE_ROBBER:
      return aiMoveRobber(engine);
    case Phase.STEAL:
      return aiSteal(engine);
    case Phase.MAIN:
      return aiMainTurn(engine);
    case Phase.ROAD_BUILDING_1:
    case Phase.ROAD_BUILDING_2:
      return aiPlaceFreeRoad(engine);
  }
  return false;
}

function vertexScore(state, vertexId) {
  const vertex = state.board.vertices[vertexId];
  let score = 0;
  const resources = new Set();
  let portBonus = 0;
  for (const hexId of vertex.hexIds) {
    const hex = state.board.hexes[hexId];
    if (hex.number) {
      score += dice2pDistribution(hex.number);
      if (hex.resource) resources.add(hex.resource);
    }
  }
  score += resources.size * 2;
  const portTypes = state.board.portByVertex[vertexId];
  if (portTypes) portBonus = portTypes.includes('3:1') ? 1 : 2;
  return score + portBonus;
}

function aiPlaceSetupSettlement(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const avail = getAvailableSettlementVertices(state, pid, true);
  if (avail.length === 0) return false;
  avail.sort((a, b) => vertexScore(state, b) - vertexScore(state, a));
  return engine.placeSetupSettlement(avail[0]);
}

function aiPlaceSetupRoad(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const avail = getAvailableRoadEdges(state, pid, true, state.lastSetupVertex);
  if (avail.length === 0) return false;
  const bestEdge = avail.map(eid => {
    const edge = state.board.edges[eid];
    const otherV = edge.vertexIds[0] === state.lastSetupVertex ? edge.vertexIds[1] : edge.vertexIds[0];
    return { eid, score: vertexScore(state, otherV) };
  }).sort((a, b) => b.score - a.score)[0];
  return engine.placeSetupRoad(bestEdge.eid);
}

function aiDiscard(engine) {
  const state = engine.state;
  for (const pid in state.pendingDiscards) {
    if (!state.players[pid].isAI) continue;
    const need = state.pendingDiscards[pid];
    const p = state.players[pid];
    const discards = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const pool = [];
    for (const r of RESOURCES) for (let i = 0; i < p.resources[r]; i++) pool.push(r);
    pool.sort(() => Math.random() - 0.5);
    for (let i = 0; i < need; i++) discards[pool[i]]++;
    engine.discardCards(parseInt(pid), discards);
  }
  return true;
}

function aiMoveRobber(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  let bestHex = null;
  let bestScore = -Infinity;
  for (const hid in state.board.hexes) {
    if (hid === state.robberHex) continue;
    const hex = state.board.hexes[hid];
    let score = 0;
    let hasEnemy = false;
    let hasSelf = false;
    for (const vid of hex.vertexIds) {
      const b = state.buildings[vid];
      if (!b) continue;
      if (b.owner === pid) hasSelf = true;
      else {
        hasEnemy = true;
        const vp = computeVictoryPoints(state, b.owner);
        const cards = totalCards(state.players[b.owner].resources);
        const mult = b.type === 'city' ? 2 : 1;
        score += (vp * 3 + cards) * mult * (hex.number ? dice2pDistribution(hex.number) : 0);
      }
    }
    if (hasSelf) score -= 100;
    if (!hasEnemy) score -= 50;
    if (score > bestScore) { bestScore = score; bestHex = hid; }
  }
  if (!bestHex) {
    for (const hid in state.board.hexes) if (hid !== state.robberHex) { bestHex = hid; break; }
  }
  return engine.moveRobber(bestHex);
}

function aiSteal(engine) {
  const state = engine.state;
  const victims = state.pendingStealVictims || [];
  if (victims.length === 0) return false;
  let best = victims[0];
  let bestCards = -1;
  for (const vid of victims) {
    const c = totalCards(state.players[vid].resources);
    if (c > bestCards) { bestCards = c; best = vid; }
  }
  return engine.chooseStealVictim(best);
}

function aiMainTurn(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const p = state.players[pid];

  if ((p.devCards.knight || 0) > 0 && !p.playedDevCardThisTurn) {
    const robberHex = state.board.hexes[state.robberHex];
    let blocked = false;
    for (const vid of robberHex.vertexIds) {
      if (state.buildings[vid] && state.buildings[vid].owner === pid) { blocked = true; break; }
    }
    if (blocked) {
      engine.playDevCard('knight');
      return true;
    }
  }

  const cityTargets = getAvailableCityVertices(state, pid);
  if (cityTargets.length > 0 && hasResources(p, COSTS.city)) {
    const ranked = cityTargets.map(v => ({ v, s: vertexScore(state, v) })).sort((a,b)=>b.s-a.s);
    engine.upgradeToCity(ranked[0].v);
    return true;
  }

  if (hasResources(p, COSTS.settlement)) {
    const avail = getAvailableSettlementVertices(state, pid, false);
    if (avail.length > 0) {
      avail.sort((a,b)=>vertexScore(state,b)-vertexScore(state,a));
      engine.buildSettlement(avail[0]);
      return true;
    }
  }

  if (hasResources(p, COSTS.road) && p.roadsLeft > 0) {
    const myCityCount = Object.values(state.buildings).filter(b => b.owner === pid).length;
    if (myCityCount < 5) {
      const target = findBestRoadExtension(state, pid);
      if (target) {
        engine.buildRoad(target);
        return true;
      }
    }
  }

  if ((p.devCards.monopoly || 0) > 0 && !p.playedDevCardThisTurn) {
    const best = pickMonopolyResource(state, pid);
    if (best) { engine.playDevCard('monopoly', { resource: best }); return true; }
  }

  if ((p.devCards.yearOfPlenty || 0) > 0 && !p.playedDevCardThisTurn) {
    const needed = whatINeed(state, pid);
    engine.playDevCard('yearOfPlenty', { r1: needed[0] || 'wheat', r2: needed[1] || needed[0] || 'ore' });
    return true;
  }

  if (canBuyDevCard(state, pid) && state.devDeck.length > 0) {
    if (Math.random() < 0.6) {
      engine.buyDevCard();
      return true;
    }
  }

  if (tryBankTrade(engine)) return true;

  return engine.endTurn();
}

function aiPlaceFreeRoad(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const avail = getAvailableFreeRoadEdges(state, pid);
  if (avail.length === 0) {
    state.phase = Phase.MAIN;
    state.roadBuildingPlaced = 0;
    return true;
  }
  const best = avail.map(eid => {
    const edge = state.board.edges[eid];
    const s = Math.max(vertexScore(state, edge.vertexIds[0]), vertexScore(state, edge.vertexIds[1]));
    return { eid, s };
  }).sort((a,b)=>b.s-a.s)[0];
  return engine.placeFreeRoad(best.eid);
}

function findBestRoadExtension(state, pid) {
  const avail = getAvailableRoadEdges(state, pid, false, null);
  if (avail.length === 0) return null;
  const ranked = avail.map(eid => {
    const edge = state.board.edges[eid];
    let s = 0;
    for (const vid of edge.vertexIds) {
      if (canPlaceSettlement(state, pid, vid, true) || (!state.buildings[vid] && !hasAdjacentBuilding(state, vid))) {
        s += vertexScore(state, vid);
      }
    }
    return { eid, s };
  }).sort((a,b)=>b.s-a.s);
  return ranked[0].eid;
}

function hasAdjacentBuilding(state, vid) {
  const v = state.board.vertices[vid];
  for (const n of v.neighborIds) if (state.buildings[n]) return true;
  return false;
}

function whatINeed(state, pid) {
  const p = state.players[pid];
  const priority = ['wheat', 'ore', 'wood', 'brick', 'sheep'];
  return priority.filter(r => p.resources[r] < 2);
}

function pickMonopolyResource(state, pid) {
  let best = null;
  let bestCount = 0;
  for (const r of RESOURCES) {
    let c = 0;
    for (const other of state.players) if (other.id !== pid) c += other.resources[r];
    if (c > bestCount) { bestCount = c; best = r; }
  }
  return bestCount >= 3 ? best : null;
}

function tryBankTrade(engine) {
  const state = engine.state;
  const pid = state.currentPlayer;
  const p = state.players[pid];

  const missingForSettlement = [];
  for (const r in COSTS.settlement) {
    const need = COSTS.settlement[r] - p.resources[r];
    if (need > 0) missingForSettlement.push({ r, need });
  }
  const missingForCity = [];
  for (const r in COSTS.city) {
    const need = COSTS.city[r] - p.resources[r];
    if (need > 0) missingForCity.push({ r, need });
  }

  let target = null;
  if (missingForCity.length === 1 && missingForCity[0].need === 1) target = missingForCity[0].r;
  else if (missingForSettlement.length === 1 && missingForSettlement[0].need === 1) target = missingForSettlement[0].r;
  if (!target) return false;

  for (const r of RESOURCES) {
    if (r === target) continue;
    const rate = getBankTradeRate(p, r);
    if (p.resources[r] >= rate + (COSTS.settlement[r] || COSTS.city[r] || 0)) {
      return engine.tradeWithBank(r, target);
    }
  }
  return false;
}
