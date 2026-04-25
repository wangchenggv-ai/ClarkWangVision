import {
  SHIPS, SHIP_LABELS, SHIP_COLORS, ROLES, ROLE_LABELS, DICE,
  STOCK_PRICE_TIERS, STOCKS_PER_SHIP,
} from '../engine/rules.js';
import {
  setShipPosition, setShipAlive, setPlayerStock, setPlayerCash,
  setRoleHolder, setDie, setWeights, advancePhase, myPlayer,
} from '../engine/state.js';
import { recommendAll } from '../engine/advisor.js';
import { currentStockPrice, rankPlayers, myLeadGap } from '../engine/payoffs.js';
import { shipFinalPMFs, shipReachProbability, shipSinkProbability,
  expectedPayoutPerShare } from '../engine/probability.js';

export class UI {
  constructor(state, onStateChange) {
    this.state = state;
    this.onStateChange = onStateChange;
    this.cachedPMFs = null;
  }

  // 触发状态变更（重算 PMF + advisor + 重渲染）
  notify() {
    this.cachedPMFs = shipFinalPMFs(this.state, { samples: 2500 });
    this.onStateChange();
  }

  // 主渲染入口
  render() {
    this.renderShipsPanel();
    this.renderPlayersPanel();
    this.renderMarketPanel();
    this.renderInputPanel();
    this.renderWeightsPanel();
    this.renderRecommendations();
    this.renderHeader();
  }

  renderHeader() {
    const el = document.getElementById('header');
    const me = myPlayer(this.state);
    const ranked = this.cachedPMFs ? rankPlayers(this.state, this.cachedPMFs) : [];
    const myRank = ranked.findIndex(r => r.isMe);
    const lead = this.cachedPMFs ? myLeadGap(this.state, this.cachedPMFs) : 0;
    const leadStr = lead >= 0 ? `领先 +${lead.toFixed(1)}` : `落后 ${lead.toFixed(1)}`;
    el.innerHTML = `
      <div class="hdr-cell"><b>第 ${this.state.round} 轮 / 第 ${this.state.phase} 阶段</b></div>
      <div class="hdr-cell">现金 <b>${me?.cash ?? 0}</b></div>
      <div class="hdr-cell">排名 <b>${myRank + 1}/${this.state.players.length}</b></div>
      <div class="hdr-cell">${leadStr}</div>
    `;
  }

  // 船航道面板（位置 + 概率柱）
  renderShipsPanel() {
    const el = document.getElementById('ships-panel');
    let html = '<h3>船只 / 航道</h3>';
    for (const s of SHIPS) {
      const ship = this.state.ships[s];
      const pmf = this.cachedPMFs?.[s];
      const reachP = pmf ? shipReachProbability(pmf) : 0;
      const sinkP = pmf ? shipSinkProbability(pmf) : 0;
      const ev = pmf ? expectedPayoutPerShare(pmf) : 0;
      html += `
        <div class="ship-row">
          <div class="ship-head">
            <span class="ship-dot" style="background:${SHIP_COLORS[s]}"></span>
            <b>${SHIP_LABELS[s]}</b>
            位置
            <input type="number" min="0" max="13" value="${ship.pos}"
              data-ship="${s}" data-field="pos" class="ship-input" ${!ship.alive ? 'disabled' : ''}/>
            <label><input type="checkbox" data-ship="${s}" data-field="alive"
              ${ship.alive ? 'checked' : ''}/> 存活</label>
          </div>
          <div class="ship-stats">
            到港 <b>${(reachP * 100).toFixed(1)}%</b>
            · 沉船 <b>${(sinkP * 100).toFixed(1)}%</b>
            · 单股 EV <b>${ev.toFixed(1)}</b>
          </div>
          <div class="track">${this.renderTrackBar(ship, pmf)}</div>
        </div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('.ship-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const s = e.target.dataset.ship;
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v)) setShipPosition(this.state, s, Math.max(0, Math.min(13, v)));
        this.notify();
      });
    });
    el.querySelectorAll('input[type=checkbox][data-field=alive]').forEach(i => {
      i.addEventListener('change', (e) => {
        const s = e.target.dataset.ship;
        setShipAlive(this.state, s, e.target.checked);
        this.notify();
      });
    });
  }

  renderTrackBar(ship, pmf) {
    let html = '';
    for (let pos = 0; pos < 14; pos++) {
      const isHere = ship.pos === pos && ship.alive;
      const cls = pos >= 11 ? 'harbor' : (pos >= 7 ? 'near' : 'sea');
      const prob = pmf ? (pmf[pos] || 0) : 0;
      const opacity = 0.15 + prob * 1.7;
      html += `<div class="track-cell ${cls}" style="background:rgba(120,180,240,${Math.min(0.9, opacity)})">
        ${isHere ? '<span class="ship-here">●</span>' : ''}
        <span class="cell-num">${pos}</span>
        <span class="cell-prob">${(prob * 100).toFixed(0)}</span>
      </div>`;
    }
    return html;
  }

  // 玩家持仓面板
  renderPlayersPanel() {
    const el = document.getElementById('players-panel');
    let html = '<h3>玩家持仓</h3><table class="players"><thead><tr><th>玩家</th><th>现金</th>';
    for (const s of SHIPS) html += `<th style="color:${SHIP_COLORS[s]}">${SHIP_LABELS[s][0]}</th>`;
    html += '<th>预期</th></tr></thead><tbody>';
    const ranked = this.cachedPMFs ? rankPlayers(this.state, this.cachedPMFs) : [];
    for (const p of this.state.players) {
      const r = ranked.find(x => x.playerId === p.id);
      html += `<tr class="${p.isMe ? 'me' : ''}">
        <td>${p.name}${p.isMe ? ' (我)' : ''}${p.id === this.state.bigBoss ? ' 👑' : ''}</td>
        <td><input type="number" value="${p.cash}" data-pid="${p.id}" data-field="cash" class="cash-input"/></td>`;
      for (const s of SHIPS) {
        html += `<td><input type="number" min="0" max="5" value="${p.stocks[s]}"
          data-pid="${p.id}" data-ship="${s}" class="stock-input"/></td>`;
      }
      html += `<td>${r ? r.totalEV.toFixed(0) : '-'}</td></tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
    el.querySelectorAll('.cash-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const pid = parseInt(e.target.dataset.pid, 10);
        const v = parseInt(e.target.value, 10) || 0;
        setPlayerCash(this.state, pid, v);
        this.notify();
      });
    });
    el.querySelectorAll('.stock-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const pid = parseInt(e.target.dataset.pid, 10);
        const ship = e.target.dataset.ship;
        const v = parseInt(e.target.value, 10) || 0;
        setPlayerStock(this.state, pid, ship, v);
        this.notify();
      });
    });
  }

  // 股票市场面板
  renderMarketPanel() {
    const el = document.getElementById('market-panel');
    let html = '<h3>股票市场</h3><table class="market"><thead><tr><th>船</th><th>剩余</th><th>下一档价</th></tr></thead><tbody>';
    for (const s of SHIPS) {
      const remaining = this.state.stockMarket[s];
      const price = currentStockPrice(this.state, s);
      html += `<tr>
        <td><span class="ship-dot" style="background:${SHIP_COLORS[s]}"></span>${SHIP_LABELS[s]}</td>
        <td><input type="number" min="0" max="${STOCKS_PER_SHIP}" value="${remaining}"
          data-ship="${s}" class="market-input"/></td>
        <td>${price ?? '售罄'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
    el.querySelectorAll('.market-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const s = e.target.dataset.ship;
        const v = parseInt(e.target.value, 10) || 0;
        this.state.stockMarket[s] = Math.max(0, Math.min(STOCKS_PER_SHIP, v));
        this.notify();
      });
    });
  }

  // 当前阶段输入面板
  renderInputPanel() {
    const el = document.getElementById('input-panel');
    let html = `<h3>当前阶段</h3>
      <div class="dice-row">骰子：
        ${[0, 1, 2].map(i => `
          <select data-die="${i}" class="die-input">
            <option value="">?</option>
            ${DICE.faces.map(f => `<option value="${f}" ${this.state.currentDice[i] === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>`).join('')}
      </div>
      <div class="roles-grid">`;
    for (const role of ROLES) {
      const holder = this.state.currentRoles[role];
      html += `<div class="role-cell">
        <label>${ROLE_LABELS[role]}</label>
        <select data-role="${role}" class="role-input">
          <option value="">无</option>
          ${this.state.players.map(p => `<option value="${p.id}" ${holder === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>`;
    }
    html += `</div>
      <button id="advance-btn">阶段结束 → 下一阶段</button>`;
    el.innerHTML = html;
    el.querySelectorAll('.die-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.die, 10);
        const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
        setDie(this.state, idx, v);
        this.notify();
      });
    });
    el.querySelectorAll('.role-input').forEach(i => {
      i.addEventListener('change', (e) => {
        const role = e.target.dataset.role;
        const pid = e.target.value === '' ? null : parseInt(e.target.value, 10);
        setRoleHolder(this.state, role, pid);
        this.notify();
      });
    });
    el.querySelector('#advance-btn').addEventListener('click', () => {
      advancePhase(this.state);
      this.notify();
    });
  }

  // 权重滑块
  renderWeightsPanel() {
    const el = document.getElementById('weights-panel');
    const w = this.state.weights;
    el.innerHTML = `<h3>决策权重</h3>
      <div class="weight-row">
        λ 风险厌恶 <input type="range" min="0" max="2" step="0.1" value="${w.lambdaRisk}" id="w-lambda"/>
        <span id="w-lambda-val">${w.lambdaRisk.toFixed(1)}</span>
      </div>
      <div class="weight-row">
        α 领先调节 <input type="range" min="0" max="2" step="0.1" value="${w.alphaLead}" id="w-alpha"/>
        <span id="w-alpha-val">${w.alphaLead.toFixed(1)}</span>
      </div>
      <div class="weight-row">
        β 对手抑制 <input type="range" min="0" max="2" step="0.1" value="${w.betaSuppress}" id="w-beta"/>
        <span id="w-beta-val">${w.betaSuppress.toFixed(1)}</span>
      </div>
      <div class="hint">领先时 λ 自动 ×1.5，落后时 ×0.5</div>`;
    const bind = (id, key) => {
      const slider = document.getElementById(id);
      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        document.getElementById(`${id}-val`).textContent = v.toFixed(1);
        setWeights(this.state, { [key]: v });
        this.notify();
      });
    };
    bind('w-lambda', 'lambdaRisk');
    bind('w-alpha', 'alphaLead');
    bind('w-beta', 'betaSuppress');
  }

  // 推荐面板（核心输出）
  renderRecommendations() {
    const el = document.getElementById('reco-panel');
    const rec = recommendAll(this.state);
    let html = '<h3>📋 推荐建议</h3>';

    // 船长建议
    html += '<div class="reco-block"><h4>船长骰子分配</h4>';
    if (rec.captain.error) {
      html += `<div class="reco-error">${rec.captain.error}</div>`;
    } else {
      html += '<table class="reco"><thead><tr><th>方案</th><th>U</th><th>ΔE</th><th>ΔVar</th><th>Δ领先</th><th>Δ对手</th></tr></thead><tbody>';
      rec.captain.options.slice(0, 3).forEach((o, idx) => {
        const cls = idx === 0 ? 'best' : '';
        html += `<tr class="${cls}"><td>${o.label}</td><td><b>${o.U.toFixed(1)}</b></td>
          <td>${o.breakdown.dWealth}</td><td>${o.breakdown.dVar}</td>
          <td>${o.breakdown.dLead}</td><td>${o.breakdown.dRival}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // 买股建议
    html += '<div class="reco-block"><h4>股票购买</h4>';
    html += '<table class="reco"><thead><tr><th>方案</th><th>U</th><th>ΔE</th><th>ΔVar</th><th>Δ领先</th><th>Δ对手</th></tr></thead><tbody>';
    rec.stock.options.slice(0, 4).forEach((o, idx) => {
      const cls = idx === 0 ? 'best' : '';
      html += `<tr class="${cls}"><td>${o.label}</td><td><b>${o.U.toFixed(1)}</b></td>
        <td>${o.breakdown.dWealth}</td><td>${o.breakdown.dVar}</td>
        <td>${o.breakdown.dLead}</td><td>${o.breakdown.dRival}</td></tr>`;
    });
    html += '</tbody></table></div>';

    // 角色拍卖估值
    html += '<div class="reco-block"><h4>角色拍卖出价上限</h4>';
    html += '<table class="reco"><thead><tr><th>角色</th><th>上限</th><th>说明</th></tr></thead><tbody>';
    rec.bidLimits.options.forEach(o => {
      const v = o.bidLimit == null ? '—' : o.bidLimit.toFixed(1);
      html += `<tr><td>${o.label}</td><td><b>${v}</b></td><td class="muted">${o.notes}</td></tr>`;
    });
    html += '</tbody></table></div>';

    el.innerHTML = html;
  }
}
