export const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 }
};

export function hasResources(player, cost) {
  for (const k in cost) if ((player.resources[k] || 0) < cost[k]) return false;
  return true;
}

export function payResources(player, cost) {
  for (const k in cost) player.resources[k] -= cost[k];
}

export function refundResources(player, cost) {
  for (const k in cost) player.resources[k] += cost[k];
}

export function canPlaceSettlement(state, playerId, vertexId, isSetup) {
  const p = state.players[playerId];
  if (!isSetup && p.settlementsLeft <= 0) return false;
  if (!isSetup && !hasResources(p, COSTS.settlement)) return false;
  if (state.buildings[vertexId]) return false;

  const vertex = state.board.vertices[vertexId];
  if (!vertex) return false;

  for (const nId of vertex.neighborIds) {
    if (state.buildings[nId]) return false;
  }

  if (!isSetup) {
    let connected = false;
    for (const eId of vertex.edgeIds) {
      if (state.roads[eId] === playerId) { connected = true; break; }
    }
    if (!connected) return false;
  }
  return true;
}

export function canPlaceRoad(state, playerId, edgeId, isSetup, lastVertex) {
  const p = state.players[playerId];
  if (p.roadsLeft <= 0) return false;
  if (!isSetup && !hasResources(p, COSTS.road)) return false;
  if (state.roads[edgeId] !== undefined) return false;

  const edge = state.board.edges[edgeId];
  if (!edge) return false;

  if (isSetup) {
    if (!lastVertex) return false;
    return edge.vertexIds.includes(lastVertex);
  }

  for (const vId of edge.vertexIds) {
    const building = state.buildings[vId];
    if (building && building.owner === playerId) return true;
    if (building && building.owner !== playerId) continue;
    const vertex = state.board.vertices[vId];
    for (const otherEdgeId of vertex.edgeIds) {
      if (otherEdgeId === edgeId) continue;
      if (state.roads[otherEdgeId] === playerId) return true;
    }
  }
  return false;
}

export function canPlaceRoadFreeOnly(state, playerId, edgeId) {
  const p = state.players[playerId];
  if (p.roadsLeft <= 0) return false;
  if (state.roads[edgeId] !== undefined) return false;

  const edge = state.board.edges[edgeId];
  if (!edge) return false;

  for (const vId of edge.vertexIds) {
    const building = state.buildings[vId];
    if (building && building.owner === playerId) return true;
    if (building && building.owner !== playerId) continue;
    const vertex = state.board.vertices[vId];
    for (const otherEdgeId of vertex.edgeIds) {
      if (otherEdgeId === edgeId) continue;
      if (state.roads[otherEdgeId] === playerId) return true;
    }
  }
  return false;
}

export function canUpgradeToCity(state, playerId, vertexId) {
  const p = state.players[playerId];
  if (p.citiesLeft <= 0) return false;
  if (!hasResources(p, COSTS.city)) return false;
  const b = state.buildings[vertexId];
  if (!b) return false;
  if (b.owner !== playerId) return false;
  if (b.type !== 'settlement') return false;
  return true;
}

export function canBuyDevCard(state, playerId) {
  const p = state.players[playerId];
  if (state.devDeck.length === 0) return false;
  if (!hasResources(p, COSTS.devCard)) return false;
  return true;
}

export function getAvailableSettlementVertices(state, playerId, isSetup) {
  const result = [];
  for (const vid in state.board.vertices) {
    if (canPlaceSettlement(state, playerId, vid, isSetup)) result.push(vid);
  }
  return result;
}

export function getAvailableRoadEdges(state, playerId, isSetup, lastVertex) {
  const result = [];
  for (const eid in state.board.edges) {
    if (canPlaceRoad(state, playerId, eid, isSetup, lastVertex)) result.push(eid);
  }
  return result;
}

export function getAvailableFreeRoadEdges(state, playerId) {
  const result = [];
  for (const eid in state.board.edges) {
    if (canPlaceRoadFreeOnly(state, playerId, eid)) result.push(eid);
  }
  return result;
}

export function getAvailableCityVertices(state, playerId) {
  const result = [];
  for (const vid in state.buildings) {
    const b = state.buildings[vid];
    if (b.owner === playerId && b.type === 'settlement') result.push(vid);
  }
  return result;
}

export function getBankTradeRate(player, resource) {
  if (player.portAccess.has(resource)) return 2;
  if (player.portAccess.has('3:1')) return 3;
  return 4;
}
