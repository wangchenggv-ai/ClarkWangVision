export const HEX_SIZE = 58;
export const BOARD_CX = 420;
export const BOARD_CY = 360;

export const TERRAIN_TYPES = ['forest', 'pasture', 'field', 'hills', 'mountains', 'desert'];
export const RESOURCE_OF_TERRAIN = {
  forest: 'wood', pasture: 'sheep', field: 'wheat', hills: 'brick', mountains: 'ore', desert: null
};
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const HEX_COORDS = [
  [0,-2],[1,-2],[2,-2],
  [-1,-1],[0,-1],[1,-1],[2,-1],
  [-2,0],[-1,0],[0,0],[1,0],[2,0],
  [-2,1],[-1,1],[0,1],[1,1],
  [-2,2],[-1,2],[0,2]
];

const TERRAIN_POOL = [
  'forest','forest','forest','forest',
  'pasture','pasture','pasture','pasture',
  'field','field','field','field',
  'hills','hills','hills',
  'mountains','mountains','mountains',
  'desert'
];

const NUMBER_POOL = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];

// Ports: [hex_q, hex_r, edge_direction (0..5), type]
// Edge i is between corner i and corner (i+1)%6. Corner 0 is top.
// Edge 0 = NE, 1 = E, 2 = SE, 3 = SW, 4 = W, 5 = NW
export const PORTS = [
  { hex: [0, -2], edge: 5, type: '3:1' },
  { hex: [2, -2], edge: 0, type: 'sheep' },
  { hex: [2, -1], edge: 1, type: '3:1' },
  { hex: [2, 0],  edge: 1, type: 'ore' },
  { hex: [1, 1],  edge: 2, type: '3:1' },
  { hex: [-1, 2], edge: 3, type: 'wheat' },
  { hex: [-2, 2], edge: 3, type: '3:1' },
  { hex: [-2, 1], edge: 4, type: 'wood' },
  { hex: [-2, 0], edge: 4, type: 'brick' }
];

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hexToPixel(q, r) {
  const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
  const y = HEX_SIZE * 1.5 * r;
  return { x: x + BOARD_CX, y: y + BOARD_CY };
}

export function hexCorner(center, i) {
  const angle = (60 * i - 90) * Math.PI / 180;
  return {
    x: center.x + HEX_SIZE * Math.cos(angle),
    y: center.y + HEX_SIZE * Math.sin(angle)
  };
}

const vkey = (p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
const ekey = (a, b) => [a, b].sort().join('|');

export function hexId(q, r) { return `${q},${r}`; }

export function generateBoard(seed = Date.now()) {
  const rand = mulberry32(seed);
  const terrains = shuffle(TERRAIN_POOL, rand);
  const numbers = shuffle(NUMBER_POOL, rand);

  const hexes = {};
  let numIdx = 0;
  for (let i = 0; i < HEX_COORDS.length; i++) {
    const [q, r] = HEX_COORDS[i];
    const id = hexId(q, r);
    const terrain = terrains[i];
    const center = hexToPixel(q, r);
    hexes[id] = {
      id, q, r, terrain,
      resource: RESOURCE_OF_TERRAIN[terrain],
      number: terrain === 'desert' ? null : numbers[numIdx++],
      center,
      corners: [],
      edgeIds: [],
      vertexIds: []
    };
  }

  const vertices = {};
  const edges = {};

  for (const id in hexes) {
    const hex = hexes[id];
    const corners = [];
    for (let i = 0; i < 6; i++) corners.push(hexCorner(hex.center, i));
    hex.corners = corners;

    const vIds = [];
    for (const c of corners) {
      const k = vkey(c);
      if (!vertices[k]) {
        vertices[k] = { id: k, pos: c, hexIds: [], edgeIds: [], neighborIds: [] };
      }
      vertices[k].hexIds.push(id);
      vIds.push(k);
    }
    hex.vertexIds = vIds;

    const eIds = [];
    for (let i = 0; i < 6; i++) {
      const v1 = vIds[i];
      const v2 = vIds[(i + 1) % 6];
      const k = ekey(v1, v2);
      if (!edges[k]) {
        edges[k] = { id: k, vertexIds: [v1, v2], hexIds: [], midpoint: midpoint(vertices[v1].pos, vertices[v2].pos) };
      }
      edges[k].hexIds.push(id);
      eIds.push(k);
      if (!vertices[v1].edgeIds.includes(k)) vertices[v1].edgeIds.push(k);
      if (!vertices[v2].edgeIds.includes(k)) vertices[v2].edgeIds.push(k);
      if (!vertices[v1].neighborIds.includes(v2)) vertices[v1].neighborIds.push(v2);
      if (!vertices[v2].neighborIds.includes(v1)) vertices[v2].neighborIds.push(v1);
    }
    hex.edgeIds = eIds;
  }

  const ports = PORTS.map(p => {
    const hex = hexes[hexId(p.hex[0], p.hex[1])];
    const v1 = hex.vertexIds[p.edge];
    const v2 = hex.vertexIds[(p.edge + 1) % 6];
    return {
      type: p.type,
      vertexIds: [v1, v2],
      hexId: hex.id,
      edgeIndex: p.edge,
      midpoint: midpoint(vertices[v1].pos, vertices[v2].pos),
      hexCenter: hex.center
    };
  });

  const portByVertex = {};
  for (const p of ports) {
    for (const vid of p.vertexIds) {
      if (!portByVertex[vid]) portByVertex[vid] = [];
      portByVertex[vid].push(p.type);
    }
  }

  const robberHex = Object.values(hexes).find(h => h.terrain === 'desert').id;

  return { hexes, vertices, edges, ports, portByVertex, robberHex };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function dice2pDistribution(n) {
  const dots = { 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:5, 9:4, 10:3, 11:2, 12:1 };
  return dots[n] || 0;
}
