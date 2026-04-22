export function getClickedVertex(x, y, state, tolerance = 18) {
  let best = null;
  let bestDist = tolerance;
  for (const vid in state.board.vertices) {
    const v = state.board.vertices[vid];
    const d = Math.hypot(v.pos.x - x, v.pos.y - y);
    if (d < bestDist) { bestDist = d; best = vid; }
  }
  return best;
}

export function getClickedEdge(x, y, state, tolerance = 10) {
  let best = null;
  let bestDist = tolerance;
  for (const eid in state.board.edges) {
    const edge = state.board.edges[eid];
    const v1 = state.board.vertices[edge.vertexIds[0]].pos;
    const v2 = state.board.vertices[edge.vertexIds[1]].pos;
    const d = pointToSegmentDist(x, y, v1.x, v1.y, v2.x, v2.y);
    if (d < bestDist) { bestDist = d; best = eid; }
  }
  return best;
}

export function getClickedHex(x, y, state) {
  for (const hid in state.board.hexes) {
    const hex = state.board.hexes[hid];
    const dx = x - hex.center.x;
    const dy = y - hex.center.y;
    if (Math.hypot(dx, dy) > 60) continue;
    if (pointInHex(x, y, hex.corners)) return hid;
  }
  return null;
}

function pointInHex(x, y, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].x, yi = corners[i].y;
    const xj = corners[j].x, yj = corners[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function getCanvasCoords(evt, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}
