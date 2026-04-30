import { createInitialState, Phase } from './engine/state.js';
import { CatanEngine } from './engine/engine.js';
import { aiStep } from './engine/ai.js';
import {
  getAvailableSettlementVertices, getAvailableRoadEdges, getAvailableCityVertices, getAvailableFreeRoadEdges
} from './engine/rules.js';
import { Renderer } from './view/renderer.js';
import { UI } from './view/ui.js';
import { getCanvasCoords, getClickedVertex, getClickedEdge, getClickedHex } from './view/input.js';

const HUMAN_ID = 0;

const state = createInitialState(4, [false, true, true, true]);
const engine = new CatanEngine(state, onStateChange);
const canvas = document.getElementById('board');
const renderer = new Renderer(canvas, state);
const ui = new UI(engine, HUMAN_ID);

let buildMode = null;

ui.onModeChange = (mode) => {
  buildMode = mode;
  refresh();
};

function computeHighlights() {
  const s = engine.state;
  const out = { vertices: [], edges: [], hexes: [] };
  if (s.currentPlayer !== HUMAN_ID) return out;

  switch (s.phase) {
    case Phase.SETUP_1_SETTLEMENT:
    case Phase.SETUP_2_SETTLEMENT:
      out.vertices = getAvailableSettlementVertices(s, HUMAN_ID, true);
      break;
    case Phase.SETUP_1_ROAD:
    case Phase.SETUP_2_ROAD:
      out.edges = getAvailableRoadEdges(s, HUMAN_ID, true, s.lastSetupVertex);
      break;
    case Phase.MAIN:
      if (buildMode === 'settlement') {
        out.vertices = getAvailableSettlementVertices(s, HUMAN_ID, false);
      } else if (buildMode === 'road') {
        out.edges = getAvailableRoadEdges(s, HUMAN_ID, false, null);
      } else if (buildMode === 'city') {
        out.vertices = getAvailableCityVertices(s, HUMAN_ID);
      }
      break;
    case Phase.MOVE_ROBBER:
      for (const hid in s.board.hexes) if (hid !== s.robberHex) out.hexes.push(hid);
      break;
    case Phase.ROAD_BUILDING_1:
    case Phase.ROAD_BUILDING_2:
      out.edges = getAvailableFreeRoadEdges(s, HUMAN_ID);
      break;
  }
  return out;
}

function refresh() {
  renderer.setHighlights(computeHighlights());
  renderer.draw();
  ui.render();
}

function onStateChange() {
  buildMode = null;
  refresh();
  scheduleAI();
}

let aiTimer = null;
function scheduleAI() {
  if (aiTimer) clearTimeout(aiTimer);
  const s = engine.state;
  if (s.phase === Phase.GAME_OVER) return;

  const needsAI =
    s.players[s.currentPlayer].isAI ||
    (s.phase === Phase.DISCARD && Object.keys(s.pendingDiscards).some(pid => s.players[pid].isAI));

  if (!needsAI) return;

  const delay = s.phase.startsWith('SETUP') ? 450 : 650;
  aiTimer = setTimeout(() => {
    try {
      aiStep(engine);
    } catch (e) {
      console.error('AI error', e);
    }
  }, delay);
}

canvas.addEventListener('click', (e) => {
  const s = engine.state;
  if (s.currentPlayer !== HUMAN_ID && s.phase !== Phase.DISCARD) return;
  const { x, y } = getCanvasCoords(e, canvas);

  switch (s.phase) {
    case Phase.SETUP_1_SETTLEMENT:
    case Phase.SETUP_2_SETTLEMENT: {
      const vid = getClickedVertex(x, y, s);
      if (vid) engine.placeSetupSettlement(vid);
      break;
    }
    case Phase.SETUP_1_ROAD:
    case Phase.SETUP_2_ROAD: {
      const eid = getClickedEdge(x, y, s);
      if (eid) engine.placeSetupRoad(eid);
      break;
    }
    case Phase.MAIN: {
      if (buildMode === 'settlement') {
        const vid = getClickedVertex(x, y, s);
        if (vid && engine.buildSettlement(vid)) buildMode = null;
      } else if (buildMode === 'road') {
        const eid = getClickedEdge(x, y, s);
        if (eid && engine.buildRoad(eid)) buildMode = null;
      } else if (buildMode === 'city') {
        const vid = getClickedVertex(x, y, s);
        if (vid && engine.upgradeToCity(vid)) buildMode = null;
      }
      refresh();
      break;
    }
    case Phase.MOVE_ROBBER: {
      const hid = getClickedHex(x, y, s);
      if (hid && hid !== s.robberHex) engine.moveRobber(hid);
      break;
    }
    case Phase.ROAD_BUILDING_1:
    case Phase.ROAD_BUILDING_2: {
      const eid = getClickedEdge(x, y, s);
      if (eid) engine.placeFreeRoad(eid);
      break;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const s = engine.state;
  const { x, y } = getCanvasCoords(e, canvas);
  let kind = null, id = null;

  switch (s.phase) {
    case Phase.SETUP_1_SETTLEMENT:
    case Phase.SETUP_2_SETTLEMENT:
      kind = 'vertex'; id = getClickedVertex(x, y, s); break;
    case Phase.SETUP_1_ROAD:
    case Phase.SETUP_2_ROAD:
      kind = 'edge'; id = getClickedEdge(x, y, s); break;
    case Phase.MAIN:
      if (buildMode === 'settlement' || buildMode === 'city') { kind = 'vertex'; id = getClickedVertex(x, y, s); }
      else if (buildMode === 'road') { kind = 'edge'; id = getClickedEdge(x, y, s); }
      break;
    case Phase.MOVE_ROBBER:
      kind = 'hex'; id = getClickedHex(x, y, s); break;
    case Phase.ROAD_BUILDING_1:
    case Phase.ROAD_BUILDING_2:
      kind = 'edge'; id = getClickedEdge(x, y, s); break;
  }
  renderer.setHover(kind, id);
  renderer.draw();
});

canvas.addEventListener('mouseleave', () => {
  renderer.setHover(null, null);
  renderer.draw();
});

engine.log('=== 欢迎来到卡坦岛 ===', 'highlight');
engine.log(`你是 ${state.players[HUMAN_ID].name},对手是 3 个 AI`, 'system');
engine.log('初始摆放:每人依次放 1 村 + 1 路,然后逆序再放 1 村 + 1 路', 'system');

refresh();
scheduleAI();

window.__catan = { engine, state, renderer, ui };
