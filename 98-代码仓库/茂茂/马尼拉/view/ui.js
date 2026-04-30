import {
  SHIPS, SHIP_LABELS, SHIP_COLORS, DICE, PAYOFF_PER_SHARE,
  STOCKS_PER_SHIP,
} from '../engine/rules.js';
import {
  setShipPosition, setShipAlive, setPlayerStock, setPlayerCash,
  advancePhase,
} from '../engine/state.js';
import { currentStockPrice, rankPlayers } from '../engine/payoffs.js';
import {
  shipFinalPMFs, shipReachProbability, shipSinkProbability,
  expectedPayoutPerShare,
} from '../engine/probability.js';

// ── 玩家颜色系（彩虹五色，区分明显）
const P_COLORS = ['#5aa8e0', '#e8a050', '#78d478', '#e05898', '#a870d4'];

// 骰子面点阵（在 60×60 画布内）
const DOT_POSITIONS = {
  1: [[30, 30]],
  2: [[17, 17], [43, 43]],
  3: [[17, 17], [30, 30], [43, 43]],
};

export class UI {
  constructor(state, onStateChange) {
    this.state = state;
    this.onStateChange = onStateChange;
    this.cachedPMFs = null;

    // UI-only state（引擎无关）
    this.placements    = [];              // [{playerId, ship, pos}]
    this.activeTurnIdx = 0;              // 全局点击计数，% playerCount = 当前玩家
    this.diceValues    = [null, null, null];
    this.diceLocked    = [false, false, false];
  }

  // 触发概率重算 + 重绘
  notify() {
    this.cachedPMFs = shipFinalPMFs(this.state, { samples: 2500 });
    this.onStateChange();
  }

  render() {
    this._renderMapPanel();
    this._renderProfitPanel();
    this._renderPlayersPanel();
    this._renderDicePanel();
  }

  // ═══════════════════════════════════════════════════
  //  左上：地图面板
  // ═══════════════════════════════════════════════════
  _renderMapPanel() {
    const hdr  = document.getElementById('map-hdr');
    const body = document.getElementById('map-body');

    const s   = this.state;
    const pid = this.activeTurnIdx % s.players.length;
    const ap  = s.players[pid];
    const pc  = P_COLORS[ap.id % P_COLORS.length];

    // ─ 顶部控制条
    hdr.innerHTML = `
      <span class="ptitle">⚓ 航海地图</span>
      <span class="hdr-sep">|</span>
      <span>第 <b>${s.round}</b> 轮 · 第 <b>${s.phase}</b> 阶段</span>
      <span class="turn-tag" style="color:${pc}">⟳ ${ap.name}</span>
      ${this._shipPosControls()}
      <button class="hdr-btn" id="reset-bets-btn">重置投注</button>
    `;

    // 船位输入事件
    hdr.querySelectorAll('.ship-pos-in').forEach(inp => {
      inp.addEventListener('change', e => {
        const ship = e.target.dataset.ship;
        const v = Math.max(0, Math.min(13, parseInt(e.target.value, 10) || 0));
        setShipPosition(this.state, ship, v);
        this.notify();
      });
    });
    hdr.querySelectorAll('.alive-chk').forEach(chk => {
      chk.addEventListener('change', e => {
        setShipAlive(this.state, e.target.dataset.ship, e.target.checked);
        this.notify();
      });
    });

    hdr.querySelector('#reset-bets-btn').onclick = () => {
      this.placements    = [];
      this.activeTurnIdx = 0;
      this.render();
    };

    // ─ 地图 SVG
    body.innerHTML = this._buildMapSVG();

    body.querySelectorAll('.pos-cell').forEach(el => {
      el.addEventListener('click', e => {
        this._handleMapClick(
          e.currentTarget.dataset.ship,
          parseInt(e.currentTarget.dataset.pos, 10),
        );
      });
    });
  }

  _shipPosControls() {
    let html = '';
    for (const ship of SHIPS) {
      const d = this.state.ships[ship];
      const c = SHIP_COLORS[ship];
      html += `
        <span class="ship-pos-ctl">
          <span style="color:${c}">${SHIP_LABELS[ship][0]}</span>
          <input class="ship-pos-in" type="number" min="0" max="13"
            value="${d.pos}" data-ship="${ship}"/>
          <input class="alive-chk" type="checkbox" ${d.alive ? 'checked' : ''}
            data-ship="${ship}" title="存活"/>
        </span>`;
    }
    return html;
  }

  _handleMapClick(ship, pos) {
    const pid = this.activeTurnIdx % this.state.players.length;
    // 同一玩家在同一格不重复标记
    const dup = this.placements.some(p => p.playerId === pid && p.ship === ship && p.pos === pos);
    if (dup) return;
    this.placements.push({ playerId: pid, ship, pos });
    this.activeTurnIdx++;
    this.render();
  }

  // ─ 核心：绘制游戏地图 SVG
  _buildMapSVG() {
    const W = 1000, H = 510;
    // 14 个格位的 x 坐标（0..13），留左右各 55px 边距
    const px = i => 55 + i * (885 / 13);
    // 三条航道的 y 中心
    const TRACK_Y = { red: 105, yellow: 255, black: 405 };
    // 区域分隔 x
    const xSep1 = (px(6) + px(7)) / 2;   // 大海 / 近港
    const xSep2 = (px(10) + px(11)) / 2;  // 近港 / 港口

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

    // ── 渐变 & 滤镜定义
    s += `<defs>
      <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="#050d1a"/>
        <stop offset="68%"  stop-color="#091828"/>
        <stop offset="100%" stop-color="#0a2014"/>
      </linearGradient>
      <linearGradient id="harborGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#081a0e"/>
        <stop offset="100%" stop-color="#0e2818"/>
      </linearGradient>
    </defs>`;

    // ── 背景
    s += `<rect width="${W}" height="${H}" fill="url(#seaGrad)"/>`;
    // 港口区底色
    s += `<rect x="${xSep2}" y="0" width="${W - xSep2}" height="${H}" fill="url(#harborGrad)" opacity="0.7"/>`;

    // ── 海浪纹理（装饰）
    for (let wy = 55; wy < H - 40; wy += 45) {
      const wave = `M 10,${wy} Q 120,${wy - 9} 240,${wy} Q 360,${wy + 9} 480,${wy}`;
      s += `<path d="${wave}" fill="none" stroke="#0d2438" stroke-width="1.2" opacity="0.5"/>`;
    }

    // ── 区域分隔线
    s += `<line x1="${xSep1}" y1="26" x2="${xSep1}" y2="${H - 20}" stroke="#223a52" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    s += `<line x1="${xSep2}" y1="26" x2="${xSep2}" y2="${H - 20}" stroke="#223a52" stroke-width="1.5" stroke-dasharray="6,4"/>`;

    // ── 区域标签
    s += `<text x="${px(3)}" y="20" text-anchor="middle" fill="#2e5878" font-size="12" font-family="sans-serif" font-weight="600">⚓ 大 海</text>`;
    s += `<text x="${(xSep1 + xSep2) / 2}" y="20" text-anchor="middle" fill="#6a7830" font-size="12" font-family="sans-serif" font-weight="600">近 港</text>`;
    s += `<text x="${(xSep2 + W) / 2}" y="20" text-anchor="middle" fill="#3a8850" font-size="12" font-family="sans-serif" font-weight="600">🏛 马尼拉港</text>`;

    // ── 岛屿（装饰，位于航道间隙）
    // 北岛（红/黄航道之间）
    s += `<ellipse cx="295" cy="182" rx="65" ry="38" fill="#122a0e" stroke="#1e4018" stroke-width="1.5"/>`;
    s += `<ellipse cx="295" cy="182" rx="52" ry="28" fill="#1c3c18"/>`;
    s += `<text x="295" y="187" text-anchor="middle" fill="#3a6430" font-size="12">🌴 北岛</text>`;
    // 南岛（黄/黑航道之间）
    s += `<ellipse cx="268" cy="330" rx="58" ry="34" fill="#122a0e" stroke="#1e4018" stroke-width="1.5"/>`;
    s += `<ellipse cx="268" cy="330" rx="46" ry="25" fill="#1c3c18"/>`;
    s += `<text x="268" y="335" text-anchor="middle" fill="#3a6430" font-size="12">🌴 南岛</text>`;

    // ── 海盗水域标记（位置 2-5）
    const pirX0 = px(2) - 20, pirX1 = px(5) + 20;
    s += `<rect x="${pirX0}" y="${H - 38}" width="${pirX1 - pirX0}" height="24" rx="4" fill="#2a0808" opacity="0.5"/>`;
    s += `<text x="${(pirX0 + pirX1) / 2}" y="${H - 21}" text-anchor="middle" fill="#6a2020" font-size="11">☠ 海盗水域</text>`;

    // ── 港口城市剪影
    const hcx = xSep2 + 28;
    const buildH = [36, 50, 42, 58, 38, 46];
    buildH.forEach((bh, i) => {
      const bx = hcx + i * 22;
      const by = H / 2 - bh / 2;
      s += `<rect x="${bx}" y="${by}" width="16" height="${bh}" fill="#0e2c18" opacity="0.6"/>`;
      s += `<rect x="${bx + 5}" y="${by + 5}" width="6" height="6" fill="#ffd96a" opacity="0.25"/>`;
    });
    s += `<text x="${W - 26}" y="${H / 2 + 4}" text-anchor="middle" fill="#2e5a38" font-size="11"
      transform="rotate(-90,${W - 26},${H / 2})">马尼拉 MANILA</text>`;

    // ── 三条航道 + 格位
    for (const ship of SHIPS) {
      const y     = TRACK_Y[ship];
      const color = SHIP_COLORS[ship];
      const sd    = this.state.ships[ship];
      const pmf   = this.cachedPMFs?.[ship];

      // 航道基线
      s += `<line x1="${px(0)}" y1="${y}" x2="${px(13)}" y2="${y}"
        stroke="${color}" stroke-width="1.8" stroke-opacity="0.3"/>`;

      // 船名标签
      s += `<text x="30" y="${y + 5}" text-anchor="middle" fill="${color}"
        font-size="13" font-weight="700">${SHIP_LABELS[ship][0]}</text>`;

      // 格位（0-13）
      for (let p = 0; p <= 13; p++) {
        const x        = px(p);
        const isHere   = sd.alive && sd.pos === p;
        const isHarbor = p >= 11;
        const isNear   = p >= 7 && p < 11;
        const prob     = pmf ? (pmf[p] || 0) : 0;

        // 热度光晕
        if (prob > 0.015) {
          const glow = Math.min(0.85, prob * 2.8);
          s += `<circle cx="${x}" cy="${y}" r="24" fill="${color}" opacity="${glow * 0.28}"/>`;
        }

        // 格位背景色
        const bgFill   = isHarbor ? 'rgba(20,65,25,0.65)' : isNear ? 'rgba(60,55,10,0.65)' : 'rgba(8,22,48,0.65)';
        const bdColor  = isHarbor ? '#3a7040' : isNear ? '#706820' : '#1a3e68';
        // 点击高亮（被选中时加亮边框）
        const hasPlacement = this.placements.some(pl => pl.ship === ship && pl.pos === p);
        const bdWidth  = hasPlacement ? '2.5' : '1.5';

        s += `<circle cx="${x}" cy="${y}" r="19" fill="${bgFill}"
          stroke="${bdColor}" stroke-width="${bdWidth}"
          class="pos-cell" data-ship="${ship}" data-pos="${p}"
          style="cursor:pointer" role="button" tabindex="0"/>`;

        // 格位编号
        s += `<text x="${x}" y="${y + 4}" text-anchor="middle"
          fill="#8098b0" font-size="10" pointer-events="none">${p}</text>`;

        // 港口/近港格显示分红数值
        if (PAYOFF_PER_SHARE[p]) {
          s += `<text x="${x}" y="${y - 23}" text-anchor="middle"
            fill="#f0d060" font-size="9" opacity="0.8" pointer-events="none">
            ¥${PAYOFF_PER_SHARE[p]}</text>`;
        }

        // 船只令牌
        if (isHere) {
          s += `<circle cx="${x}" cy="${y}" r="14" fill="${color}" opacity="0.92" pointer-events="none"/>`;
          s += `<text x="${x}" y="${y + 5}" text-anchor="middle"
            fill="white" font-size="13" pointer-events="none">⛵</text>`;
        }
        // 沉船标记
        if (!sd.alive && p === 0 && ship === ship) {
          // 只在对应的 pos=0 格显示沉船
          if (p === 0) {
            s += `<text x="${x}" y="${y - 24}" text-anchor="middle"
              fill="#884444" font-size="10" pointer-events="none">沉</text>`;
          }
        }

        // 海盗区小图标
        if (p >= 2 && p <= 5) {
          s += `<text x="${x}" y="${y + 30}" text-anchor="middle"
            fill="#5a1818" font-size="9" pointer-events="none">☠</text>`;
        }

        // 玩家投注令牌
        const placed = this.placements.filter(pl => pl.ship === ship && pl.pos === p);
        const total  = placed.length;
        placed.forEach((pl, idx) => {
          const angle = total === 1
            ? -Math.PI / 2
            : (idx / total) * 2 * Math.PI - Math.PI / 2;
          const tr  = 27;
          const tx  = x + tr * Math.cos(angle);
          const ty2 = y + tr * Math.sin(angle);
          const pc  = P_COLORS[pl.playerId % P_COLORS.length];
          s += `<circle cx="${tx}" cy="${ty2}" r="9" fill="${pc}"
            stroke="white" stroke-width="1.2" pointer-events="none"/>`;
          s += `<text x="${tx}" y="${ty2 + 4}" text-anchor="middle"
            fill="white" font-size="8" font-weight="bold" pointer-events="none">
            ${pl.playerId + 1}</text>`;
        });
      }
    }

    s += `</svg>`;
    return s;
  }

  // ═══════════════════════════════════════════════════
  //  右上：收益分析面板
  // ═══════════════════════════════════════════════════
  _renderProfitPanel() {
    const el  = document.getElementById('profit-body');
    const pmf = this.cachedPMFs;

    const pid         = this.activeTurnIdx % this.state.players.length;
    const ap          = this.state.players[pid];
    const myPlacements = this.placements.filter(p => p.playerId === ap.id);

    // 计算所有可支付格位的 EV
    const rows = [];
    for (const ship of SHIPS) {
      for (let p = 7; p <= 13; p++) {
        const prob   = pmf ? (pmf[ship]?.[p] || 0) : 0;
        const pay    = PAYOFF_PER_SHARE[p] || 0;
        const ev     = prob * pay;
        const placed = myPlacements.some(pl => pl.ship === ship && pl.pos === p);
        rows.push({ ship, pos: p, prob, pay, ev, placed });
      }
    }
    rows.sort((a, b) => b.ev - a.ev);

    let html = `
      <div class="profit-current">
        <span style="color:${P_COLORS[ap.id % P_COLORS.length]}">◉ ${ap.name}</span>
        <span class="profit-sub">已投 ${myPlacements.length} 格</span>
      </div>`;

    for (const r of rows) {
      const pct = (r.prob * 100).toFixed(1);
      const ev  = r.ev.toFixed(1);
      const sc  = SHIP_COLORS[r.ship];
      html += `<div class="profit-row${r.placed ? ' placed' : ''}">
        <span class="prf-ship" style="color:${sc}">${SHIP_LABELS[r.ship]}</span>
        <span class="prf-pos">${r.pos}</span>
        <span class="prf-pay">+${r.pay}</span>
        <span class="prf-pct">${pct}%</span>
        <span class="prf-ev">${ev}</span>
      </div>`;
    }

    // 大海格（0-6）无分红，显示示意
    html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #1c2c42;color:#405060;font-size:10px">
      大海格 (0-6) 无分红 · 点击地图投注</div>`;

    el.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════
  //  左下：玩家资产面板
  // ═══════════════════════════════════════════════════
  _renderPlayersPanel() {
    const el     = document.getElementById('players-body');
    const ranked = this.cachedPMFs ? rankPlayers(this.state, this.cachedPMFs) : [];
    const pid    = this.activeTurnIdx % this.state.players.length;

    // 排名摘要放 header
    const rankBar = document.getElementById('rank-bar');
    if (rankBar && ranked.length) {
      rankBar.textContent = ranked.map((r, i) => `${i + 1}.${r.name}`).join(' > ');
    }

    let html = `<table class="ptable"><thead><tr>
      <th>玩家</th><th>现金</th>`;
    for (const ship of SHIPS) {
      html += `<th style="color:${SHIP_COLORS[ship]}">${SHIP_LABELS[ship]}</th>`;
    }
    html += `<th>预期值</th><th>排名</th></tr></thead><tbody>`;

    for (const p of this.state.players) {
      const isActive = p.id === pid;
      const r        = ranked.find(x => x.playerId === p.id);
      const rank     = ranked.findIndex(x => x.playerId === p.id) + 1;
      const rowCls   = `${isActive ? 'active-tr ' : ''}${p.isMe ? 'me-tr' : ''}`;

      html += `<tr class="${rowCls}">
        <td class="pname-cell">
          ${isActive ? `<span class="act-dot">◉</span>` : ''}
          ${p.name}${p.isMe ? ' ★' : ''}
        </td>
        <td><input class="ci" type="number" value="${p.cash}" data-pid="${p.id}"/></td>`;
      for (const ship of SHIPS) {
        html += `<td><input class="si" type="number" min="0" max="5"
          value="${p.stocks[ship]}" data-pid="${p.id}" data-ship="${ship}"/></td>`;
      }
      const ev = r ? r.totalEV.toFixed(0) : '—';
      html += `<td class="ev-td">${ev}</td>`;
      html += `<td class="rnk-td">${rank || '—'}</td></tr>`;
    }

    html += `</tbody></table>`;
    el.innerHTML = html;

    el.querySelectorAll('.ci').forEach(inp => inp.addEventListener('change', e => {
      setPlayerCash(this.state, +e.target.dataset.pid, +e.target.value || 0);
      this.notify();
    }));
    el.querySelectorAll('.si').forEach(inp => inp.addEventListener('change', e => {
      setPlayerStock(this.state, +e.target.dataset.pid, e.target.dataset.ship, +e.target.value || 0);
      this.notify();
    }));
  }

  // ═══════════════════════════════════════════════════
  //  右下：骰子面板
  // ═══════════════════════════════════════════════════
  _renderDicePanel() {
    const el    = document.getElementById('dice-body');
    const phase = document.getElementById('dice-phase-info');
    if (phase) {
      phase.textContent = `第 ${this.state.round} 轮 / 第 ${this.state.phase} 阶段`;
    }

    const sum = this.diceValues.reduce((a, v) => a + (v || 0), 0);

    let html = `<div class="dice-row" id="dice-row">`;
    for (let i = 0; i < 3; i++) {
      html += this._dieSVG(this.diceValues[i], this.diceLocked[i], i);
    }
    html += `</div>
    <div class="dice-btns">
      <button class="cbtn" id="roll-btn">🎲 掷骰</button>
      <button class="cbtn secondary" id="phase-end-btn">▶ 阶段结束</button>
    </div>
    <div class="dice-sum">点数合计：<b>${sum || '—'}</b></div>`;

    el.innerHTML = html;

    el.querySelector('#roll-btn').onclick = () => this._rollDice();

    el.querySelector('#phase-end-btn').onclick = () => {
      // 同步骰子到引擎状态
      this.diceValues.forEach((v, i) => { this.state.currentDice[i] = v; });
      advancePhase(this.state);
      // 重置回合
      this.placements    = [];
      this.activeTurnIdx = 0;
      this.diceLocked    = [false, false, false];
      this.notify();
    };

    // 点击骰子切换锁定
    el.querySelectorAll('.die-svg').forEach(svg => {
      svg.addEventListener('click', e => {
        const idx = +e.currentTarget.dataset.idx;
        this.diceLocked[idx] = !this.diceLocked[idx];
        this._renderDicePanel();
      });
    });
  }

  _dieSVG(value, locked, idx) {
    const dots    = value ? (DOT_POSITIONS[value] || []) : [];
    const bg      = locked ? '#1e1000' : '#0e1626';
    const border  = locked ? '#c07818' : '#283c58';
    const dotCol  = locked ? '#ffb040' : '#dce8f8';
    const shadow  = locked ? 'filter:drop-shadow(0 0 3px #c07818)' : '';

    let s = `<svg class="die-svg" data-idx="${idx}" width="68" height="68" viewBox="0 0 60 60"
      style="cursor:pointer;${shadow}" title="${locked ? '点击解锁' : '点击锁定'}">
      <rect width="60" height="60" rx="10" fill="${bg}" stroke="${border}" stroke-width="2.5"/>`;

    if (value) {
      dots.forEach(([dx, dy]) => {
        s += `<circle cx="${dx}" cy="${dy}" r="7" fill="${dotCol}"/>`;
      });
      if (locked) {
        s += `<text x="30" y="56" text-anchor="middle" fill="#c07818" font-size="8">锁定</text>`;
      }
    } else {
      s += `<text x="30" y="37" text-anchor="middle" fill="#2c4260" font-size="22">?</text>`;
    }
    s += `</svg>`;
    return s;
  }

  _rollDice() {
    const faces = DICE.faces;
    for (let i = 0; i < 3; i++) {
      if (!this.diceLocked[i]) {
        this.diceValues[i] = faces[Math.floor(Math.random() * faces.length)];
      }
    }
    this._renderDicePanel();
  }
}
