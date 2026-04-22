import { HEX_SIZE } from '../engine/board.js';
import { Phase } from '../engine/state.js';

const TERRAIN_COLORS = {
  forest:    { fill: '#2d5a2d', stroke: '#1e3d1e' },
  pasture:   { fill: '#8bc24a', stroke: '#5a8c2a' },
  field:     { fill: '#e8c353', stroke: '#a88830' },
  hills:     { fill: '#c2723d', stroke: '#8c4a1f' },
  mountains: { fill: '#8a8a8a', stroke: '#555' },
  desert:    { fill: '#d9c48a', stroke: '#9a8550' }
};

const RESOURCE_ICON = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️'
};

const PORT_ICON = {
  '3:1': '3:1', wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️'
};

export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.highlight = { vertices: [], edges: [], hexes: [] };
    this.hoverVertex = null;
    this.hoverEdge = null;
    this.hoverHex = null;
  }

  setState(state) { this.state = state; }
  setHighlights(h) { this.highlight = h; }
  setHover(kind, id) {
    this.hoverVertex = null; this.hoverEdge = null; this.hoverHex = null;
    if (kind === 'vertex') this.hoverVertex = id;
    else if (kind === 'edge') this.hoverEdge = id;
    else if (kind === 'hex') this.hoverHex = id;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#1a3050';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._drawPorts();
    this._drawHexes();
    this._drawHighlightEdges();
    this._drawRoads();
    this._drawRobber();
    this._drawHighlightVertices();
    this._drawBuildings();
    this._drawDice();
  }

  _drawHexes() {
    const ctx = this.ctx;
    for (const id in this.state.board.hexes) {
      const hex = this.state.board.hexes[id];
      const colors = TERRAIN_COLORS[hex.terrain];

      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const c = hex.corners[i];
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      }
      ctx.closePath();
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.stroke;
      ctx.stroke();

      if (this.highlight.hexes.includes(id) || this.hoverHex === id) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffd96a';
        ctx.stroke();
      }

      if (hex.number) {
        const isRed = hex.number === 6 || hex.number === 8;
        ctx.beginPath();
        ctx.arc(hex.center.x, hex.center.y, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#f0e6d0';
        ctx.fill();
        ctx.strokeStyle = '#5a4a30';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = isRed ? '#c0392b' : '#2c3e50';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hex.number, hex.center.x, hex.center.y - 3);

        const dots = dotsFor(hex.number);
        ctx.fillStyle = isRed ? '#c0392b' : '#2c3e50';
        const dotY = hex.center.y + 9;
        const dotSpacing = 3.5;
        const startX = hex.center.x - (dots - 1) * dotSpacing / 2;
        for (let i = 0; i < dots; i++) {
          ctx.beginPath();
          ctx.arc(startX + i * dotSpacing, dotY, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (hex.terrain === 'desert') {
        ctx.fillStyle = '#8a7550';
        ctx.font = 'italic 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('沙漠', hex.center.x, hex.center.y + 24);
      }
    }
  }

  _drawPorts() {
    const ctx = this.ctx;
    for (const port of this.state.board.ports) {
      const hex = this.state.board.hexes[port.hexId];
      const mid = port.midpoint;
      const dx = mid.x - hex.center.x;
      const dy = mid.y - hex.center.y;
      const len = Math.hypot(dx, dy);
      const ox = mid.x + dx / len * 30;
      const oy = mid.y + dy / len * 30;

      const v1 = this.state.board.vertices[port.vertexIds[0]].pos;
      const v2 = this.state.board.vertices[port.vertexIds[1]].pos;
      ctx.strokeStyle = '#8d6e4a';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y); ctx.lineTo(ox, oy);
      ctx.moveTo(v2.x, v2.y); ctx.lineTo(ox, oy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(ox, oy, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#d9b282';
      ctx.fill();
      ctx.strokeStyle = '#8d6e4a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#3a2a1a';
      ctx.font = port.type === '3:1' ? 'bold 10px sans-serif' : '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PORT_ICON[port.type], ox, oy);
    }
  }

  _drawHighlightEdges() {
    const ctx = this.ctx;
    for (const eid of this.highlight.edges) {
      const edge = this.state.board.edges[eid];
      if (!edge) continue;
      const v1 = this.state.board.vertices[edge.vertexIds[0]].pos;
      const v2 = this.state.board.vertices[edge.vertexIds[1]].pos;
      ctx.strokeStyle = 'rgba(255, 217, 106, 0.5)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y);
      ctx.stroke();
    }
    if (this.hoverEdge && this.highlight.edges.includes(this.hoverEdge)) {
      const edge = this.state.board.edges[this.hoverEdge];
      const v1 = this.state.board.vertices[edge.vertexIds[0]].pos;
      const v2 = this.state.board.vertices[edge.vertexIds[1]].pos;
      ctx.strokeStyle = '#ffd96a';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y);
      ctx.stroke();
    }
  }

  _drawRoads() {
    const ctx = this.ctx;
    for (const eid in this.state.roads) {
      const owner = this.state.roads[eid];
      const edge = this.state.board.edges[eid];
      const v1 = this.state.board.vertices[edge.vertexIds[0]].pos;
      const v2 = this.state.board.vertices[edge.vertexIds[1]].pos;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y);
      ctx.stroke();

      ctx.strokeStyle = this.state.players[owner].color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y);
      ctx.stroke();
    }
  }

  _drawHighlightVertices() {
    const ctx = this.ctx;
    for (const vid of this.highlight.vertices) {
      const v = this.state.board.vertices[vid];
      if (!v) continue;
      ctx.beginPath();
      ctx.arc(v.pos.x, v.pos.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 217, 106, 0.5)';
      ctx.fill();
    }
    if (this.hoverVertex && this.highlight.vertices.includes(this.hoverVertex)) {
      const v = this.state.board.vertices[this.hoverVertex];
      ctx.beginPath();
      ctx.arc(v.pos.x, v.pos.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd96a';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _drawBuildings() {
    const ctx = this.ctx;
    for (const vid in this.state.buildings) {
      const b = this.state.buildings[vid];
      const v = this.state.board.vertices[vid];
      const color = this.state.players[b.owner].color;
      if (b.type === 'settlement') {
        this._drawSettlement(v.pos.x, v.pos.y, color);
      } else {
        this._drawCity(v.pos.x, v.pos.y, color);
      }
    }
  }

  _drawSettlement(x, y, color) {
    const ctx = this.ctx;
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(x - s, y + s);
    ctx.lineTo(x - s, y - s * 0.3);
    ctx.lineTo(x, y - s);
    ctx.lineTo(x + s, y - s * 0.3);
    ctx.lineTo(x + s, y + s);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawCity(x, y, color) {
    const ctx = this.ctx;
    const s = 13;
    ctx.beginPath();
    ctx.moveTo(x - s, y + s);
    ctx.lineTo(x - s, y - s * 0.2);
    ctx.lineTo(x - s * 0.3, y - s * 0.2);
    ctx.lineTo(x - s * 0.3, y - s * 0.7);
    ctx.lineTo(x + s * 0.3, y - s);
    ctx.lineTo(x + s, y - s * 0.5);
    ctx.lineTo(x + s, y + s);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawRobber() {
    const ctx = this.ctx;
    const hex = this.state.board.hexes[this.state.robberHex];
    if (!hex) return;
    const x = hex.center.x + 18;
    const y = hex.center.y - 18;
    ctx.beginPath();
    ctx.arc(x, y - 4, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 10);
    ctx.lineTo(x + 7, y + 10);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawDice() {
    if (!this.state.lastRoll) return;
    const ctx = this.ctx;
    const [d1, d2] = this.state.dice;
    const x = 20, y = 20;
    this._drawDie(x, y, d1);
    this._drawDie(x + 46, y, d2);
  }

  _drawDie(x, y, value) {
    const ctx = this.ctx;
    const size = 38;
    ctx.fillStyle = '#f0e6d0';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 6);
    ctx.fill();
    ctx.stroke();

    const positions = {
      1: [[0.5, 0.5]],
      2: [[0.25, 0.25], [0.75, 0.75]],
      3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
      5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
      6: [[0.25, 0.2], [0.75, 0.2], [0.25, 0.5], [0.75, 0.5], [0.25, 0.8], [0.75, 0.8]]
    };
    ctx.fillStyle = '#333';
    for (const [px, py] of positions[value] || []) {
      ctx.beginPath();
      ctx.arc(x + px * size, y + py * size, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function dotsFor(n) {
  return { 2:1, 3:2, 4:3, 5:4, 6:5, 8:5, 9:4, 10:3, 11:2, 12:1 }[n] || 0;
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
  };
}
