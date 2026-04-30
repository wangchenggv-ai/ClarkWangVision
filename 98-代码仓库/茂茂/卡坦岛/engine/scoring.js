export function computeLongestRoad(state) {
  let best = { ownerId: null, length: 0 };
  for (const p of state.players) {
    const len = longestRoadForPlayer(state, p.id);
    if (len > best.length) best = { ownerId: p.id, length: len };
  }
  return best;
}

function longestRoadForPlayer(state, playerId) {
  const myEdges = [];
  for (const eid in state.roads) {
    if (state.roads[eid] === playerId) myEdges.push(eid);
  }
  if (myEdges.length === 0) return 0;

  let maxLen = 0;
  for (const startEdge of myEdges) {
    const edge = state.board.edges[startEdge];
    for (const startV of edge.vertexIds) {
      const len = dfs(state, playerId, startEdge, startV, new Set([startEdge]));
      if (len > maxLen) maxLen = len;
    }
  }
  return maxLen;
}

function dfs(state, playerId, currentEdge, currentVertex, visited) {
  const edge = state.board.edges[currentEdge];
  const nextVertex = edge.vertexIds[0] === currentVertex ? edge.vertexIds[1] : edge.vertexIds[0];

  const buildingAtNext = state.buildings[nextVertex];
  if (buildingAtNext && buildingAtNext.owner !== playerId) {
    return 1;
  }

  let best = 1;
  const vertex = state.board.vertices[nextVertex];
  for (const nextEdge of vertex.edgeIds) {
    if (visited.has(nextEdge)) continue;
    if (state.roads[nextEdge] !== playerId) continue;
    visited.add(nextEdge);
    const sub = 1 + dfs(state, playerId, nextEdge, nextVertex, visited);
    if (sub > best) best = sub;
    visited.delete(nextEdge);
  }
  return best;
}

export function updateLongestRoad(state) {
  const result = computeLongestRoad(state);
  if (result.length < 5) {
    state.longestRoadOwner = null;
    state.longestRoadLength = 4;
    return;
  }
  if (!state.longestRoadOwner) {
    state.longestRoadOwner = result.ownerId;
    state.longestRoadLength = result.length;
    return;
  }
  const currentHolderLen = longestRoadForPlayer(state, state.longestRoadOwner);
  if (result.length > currentHolderLen) {
    state.longestRoadOwner = result.ownerId;
    state.longestRoadLength = result.length;
  } else {
    state.longestRoadLength = currentHolderLen;
    if (currentHolderLen < 5) state.longestRoadOwner = null;
  }
}

export function updateLargestArmy(state) {
  let best = { ownerId: null, size: 0 };
  for (const p of state.players) {
    if (p.playedKnights > best.size) best = { ownerId: p.id, size: p.playedKnights };
  }
  if (best.size < 3) {
    state.largestArmyOwner = null;
    state.largestArmySize = 2;
    return;
  }
  if (!state.largestArmyOwner) {
    state.largestArmyOwner = best.ownerId;
    state.largestArmySize = best.size;
    return;
  }
  const currentHolderSize = state.players[state.largestArmyOwner].playedKnights;
  if (best.size > currentHolderSize) {
    state.largestArmyOwner = best.ownerId;
    state.largestArmySize = best.size;
  } else {
    state.largestArmySize = currentHolderSize;
  }
}

export function computeVictoryPoints(state, playerId, includeHiddenVP = true) {
  let vp = 0;
  for (const vid in state.buildings) {
    const b = state.buildings[vid];
    if (b.owner === playerId) {
      vp += b.type === 'settlement' ? 1 : 2;
    }
  }
  if (state.longestRoadOwner === playerId) vp += 2;
  if (state.largestArmyOwner === playerId) vp += 2;
  if (includeHiddenVP) {
    const p = state.players[playerId];
    vp += p.devCards.victoryPoint || 0;
  }
  return vp;
}

export function computeVisibleVP(state, playerId) {
  return computeVictoryPoints(state, playerId, false);
}

export function checkWinner(state) {
  for (const p of state.players) {
    if (computeVictoryPoints(state, p.id, true) >= 10) return p.id;
  }
  return null;
}
