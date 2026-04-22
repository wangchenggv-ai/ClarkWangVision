import { Phase, totalCards, totalDevCards, DEV_CARD_TYPES } from '../engine/state.js';
import { RESOURCES } from '../engine/board.js';
import { COSTS, hasResources, canBuyDevCard, getBankTradeRate, canPlaceSettlement, canUpgradeToCity } from '../engine/rules.js';
import { computeVictoryPoints, computeVisibleVP } from '../engine/scoring.js';

const RES_ICON = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️' };
const RES_NAME = { wood: '木', brick: '砖', sheep: '羊', wheat: '麦', ore: '矿' };

const DEV_NAME = {
  knight: '骑士',
  roadBuilding: '修路',
  yearOfPlenty: '丰收',
  monopoly: '垄断',
  victoryPoint: '胜利点'
};

const PHASE_LABELS = {
  SETUP_1_SETTLEMENT: '初始摆放 1 · 选村位',
  SETUP_1_ROAD: '初始摆放 1 · 选路',
  SETUP_2_SETTLEMENT: '初始摆放 2 · 选村位',
  SETUP_2_ROAD: '初始摆放 2 · 选路',
  ROLL: '等待掷骰',
  DISCARD: '弃牌阶段',
  MOVE_ROBBER: '移动盗贼',
  STEAL: '选择偷牌目标',
  MAIN: '主回合 · 建造/交易',
  ROAD_BUILDING_1: '免费建路 (1/2)',
  ROAD_BUILDING_2: '免费建路 (2/2)',
  GAME_OVER: '游戏结束'
};

export class UI {
  constructor(engine, humanId = 0) {
    this.engine = engine;
    this.humanId = humanId;
    this.dialogRoot = document.getElementById('dialog-root');
    this.bindButtons();
  }

  bindButtons() {
    const state = this.engine.state;
    document.getElementById('btn-roll').onclick = () => {
      if (state.phase === Phase.ROLL && state.currentPlayer === this.humanId) {
        this.engine.rollDice();
      }
    };
    document.getElementById('btn-road').onclick = () => this.setMode('road');
    document.getElementById('btn-settlement').onclick = () => this.setMode('settlement');
    document.getElementById('btn-city').onclick = () => this.setMode('city');
    document.getElementById('btn-devcard').onclick = () => this.engine.buyDevCard();
    document.getElementById('btn-play-dev').onclick = () => this.showPlayDevDialog();
    document.getElementById('btn-trade-bank').onclick = () => this.showBankTradeDialog();
    document.getElementById('btn-trade-player').onclick = () => this.showPlayerTradeDialog();
    document.getElementById('btn-end-turn').onclick = () => {
      if (state.phase === Phase.MAIN && state.currentPlayer === this.humanId) {
        this.engine.endTurn();
      }
    };
  }

  setMode(mode) {
    if (this.onModeChange) this.onModeChange(mode);
  }

  render() {
    const state = this.engine.state;

    const banner = document.getElementById('phase-banner');
    const label = PHASE_LABELS[state.phase] || state.phase;
    const currentName = state.players[state.currentPlayer].name;
    banner.textContent = `${label} · ${currentName}`;

    this.renderPlayerList();
    this.renderMyResources();
    this.renderButtons();
    this.renderLog();
    this.renderHint();

    if (state.phase === Phase.DISCARD && state.pendingDiscards[this.humanId]) {
      this.showDiscardDialog();
    }

    if (state.phase === Phase.STEAL && state.currentPlayer === this.humanId) {
      this.showStealDialog();
    }

    if (state.phase === Phase.GAME_OVER) {
      this.showGameOverDialog();
    }
  }

  renderPlayerList() {
    const state = this.engine.state;
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    for (const p of state.players) {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.id === state.currentPlayer ? ' active' : '');
      const vp = p.id === this.humanId ? computeVictoryPoints(state, p.id) : computeVisibleVP(state, p.id);
      const totalRes = totalCards(p.resources);
      const totalDev = totalDevCards(p.devCards) + totalDevCards(p.newDevCards);
      row.innerHTML = `
        <div class="dot" style="background:${p.color}"></div>
        <div class="name">${p.name}${p.isAI ? ' 🤖' : ''}</div>
        <div class="vp">${vp}分</div>
        <div class="meta">卡${totalRes} · 发展${totalDev} · 骑${p.playedKnights}${state.longestRoadOwner===p.id?' 🛣️最长路':''}${state.largestArmyOwner===p.id?' ⚔️最大军':''}</div>
      `;
      list.appendChild(row);
    }
  }

  renderMyResources() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    const el = document.getElementById('my-resources');
    el.innerHTML = '';
    for (const r of RESOURCES) {
      const chip = document.createElement('div');
      chip.className = 'res-chip';
      chip.innerHTML = `<div class="icon">${RES_ICON[r]}</div><div class="count">${me.resources[r]}</div>`;
      el.appendChild(chip);
    }

    const devEl = document.getElementById('my-dev-cards');
    const parts = [];
    for (const type of DEV_CARD_TYPES) {
      const have = me.devCards[type] || 0;
      const newCount = me.newDevCards[type] || 0;
      if (have + newCount > 0) {
        parts.push(`${DEV_NAME[type]}${have}${newCount > 0 ? `(+${newCount})` : ''}`);
      }
    }
    devEl.textContent = parts.length > 0 ? parts.join(' · ') : '无';
  }

  renderButtons() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    const isMyTurn = state.currentPlayer === this.humanId;
    const inMain = isMyTurn && state.phase === Phase.MAIN;

    document.getElementById('btn-roll').disabled = !(isMyTurn && state.phase === Phase.ROLL);
    document.getElementById('btn-road').disabled = !inMain || !hasResources(me, COSTS.road) || me.roadsLeft === 0;
    document.getElementById('btn-settlement').disabled = !inMain || !hasResources(me, COSTS.settlement) || me.settlementsLeft === 0;
    document.getElementById('btn-city').disabled = !inMain || !hasResources(me, COSTS.city) || me.citiesLeft === 0;
    document.getElementById('btn-devcard').disabled = !inMain || !canBuyDevCard(state, this.humanId);

    const hasPlayable = DEV_CARD_TYPES.some(t => t !== 'victoryPoint' && (me.devCards[t] || 0) > 0);
    const canPlayDev = isMyTurn && !me.playedDevCardThisTurn && hasPlayable &&
      (state.phase === Phase.MAIN || (state.phase === Phase.ROLL && (me.devCards.knight || 0) > 0));
    document.getElementById('btn-play-dev').disabled = !canPlayDev;

    document.getElementById('btn-trade-bank').disabled = !inMain;
    document.getElementById('btn-trade-player').disabled = !inMain;
    document.getElementById('btn-end-turn').disabled = !inMain;
  }

  renderLog() {
    const state = this.engine.state;
    const logEl = document.getElementById('log');
    const entries = state.log.slice(-60);
    logEl.innerHTML = entries.map(e => `<div class="entry ${e.type}">${e.msg}</div>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  renderHint() {
    const state = this.engine.state;
    const hint = document.getElementById('hint');
    const isMyTurn = state.currentPlayer === this.humanId;

    if (!isMyTurn) {
      hint.textContent = `等待 ${state.players[state.currentPlayer].name} 行动...`;
      return;
    }
    switch (state.phase) {
      case Phase.SETUP_1_SETTLEMENT:
      case Phase.SETUP_2_SETTLEMENT:
        hint.textContent = '点击金色高亮顶点建立村庄'; break;
      case Phase.SETUP_1_ROAD:
      case Phase.SETUP_2_ROAD:
        hint.textContent = '点击村庄相邻的金色高亮边建造道路'; break;
      case Phase.ROLL:
        hint.textContent = '点击 🎲 掷骰,或先打骑士卡'; break;
      case Phase.DISCARD:
        hint.textContent = '需要弃牌'; break;
      case Phase.MOVE_ROBBER:
        hint.textContent = '点击任意六角地块放置盗贼'; break;
      case Phase.STEAL:
        hint.textContent = '选择偷牌对象'; break;
      case Phase.MAIN:
        hint.textContent = '点击"建路/建村/升城"然后点击地图目标,或交易/结束回合'; break;
      case Phase.ROAD_BUILDING_1:
      case Phase.ROAD_BUILDING_2:
        hint.textContent = '点击金色高亮边免费建路'; break;
    }
  }

  closeDialog() {
    this.dialogRoot.innerHTML = '';
  }

  showDialog(html) {
    this.dialogRoot.innerHTML = `<div class="dialog-backdrop"><div class="dialog">${html}</div></div>`;
  }

  showDiscardDialog() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    const need = state.pendingDiscards[this.humanId];
    if (!need) return;
    if (this.dialogRoot.querySelector('#discard-form')) return;

    const html = `
      <h2>弃牌:需弃 ${need} 张</h2>
      <p>你有 ${totalCards(me.resources)} 张牌,请选择要弃掉的资源:</p>
      <div id="discard-form">
        ${RESOURCES.map(r => `
          <div class="row">
            <label>${RES_ICON[r]} ${RES_NAME[r]} (${me.resources[r]})</label>
            <input type="number" min="0" max="${me.resources[r]}" value="0" data-res="${r}">
          </div>
        `).join('')}
        <div class="hint" id="discard-total">已选: 0 / ${need}</div>
        <div class="btn-row">
          <button id="discard-confirm" disabled>确认弃牌</button>
        </div>
      </div>
    `;
    this.showDialog(html);

    const inputs = this.dialogRoot.querySelectorAll('input[data-res]');
    const totalEl = this.dialogRoot.querySelector('#discard-total');
    const btn = this.dialogRoot.querySelector('#discard-confirm');
    const update = () => {
      let sum = 0;
      inputs.forEach(i => sum += parseInt(i.value) || 0);
      totalEl.textContent = `已选: ${sum} / ${need}`;
      btn.disabled = sum !== need;
    };
    inputs.forEach(i => i.oninput = update);
    btn.onclick = () => {
      const discards = {};
      inputs.forEach(i => discards[i.dataset.res] = parseInt(i.value) || 0);
      if (this.engine.discardCards(this.humanId, discards)) {
        this.closeDialog();
      }
    };
  }

  showStealDialog() {
    const state = this.engine.state;
    const victims = state.pendingStealVictims || [];
    const html = `
      <h2>选择偷牌目标</h2>
      <div class="res-row">
        ${victims.map(vid => `<button class="res-btn" data-vid="${vid}" style="background:${state.players[vid].color}22;border-color:${state.players[vid].color}">${state.players[vid].name} (${totalCards(state.players[vid].resources)} 张)</button>`).join('')}
      </div>
    `;
    this.showDialog(html);
    this.dialogRoot.querySelectorAll('[data-vid]').forEach(b => {
      b.onclick = () => {
        const vid = parseInt(b.dataset.vid);
        this.engine.chooseStealVictim(vid);
        this.closeDialog();
      };
    });
  }

  showBankTradeDialog() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    let give = null, get = null;
    const html = `
      <h2>银行交易</h2>
      <p>根据港口,不同资源有不同汇率 (4:1 / 3:1 / 2:1)</p>
      <div class="row"><label>给出:</label><div class="res-row" id="give-row">
        ${RESOURCES.map(r => `<button class="res-btn" data-give="${r}">${RES_ICON[r]} ${RES_NAME[r]} (${me.resources[r]}) [${getBankTradeRate(me, r)}:1]</button>`).join('')}
      </div></div>
      <div class="row"><label>获得:</label><div class="res-row" id="get-row">
        ${RESOURCES.map(r => `<button class="res-btn" data-get="${r}">${RES_ICON[r]} ${RES_NAME[r]}</button>`).join('')}
      </div></div>
      <div class="btn-row">
        <button class="cancel" id="cancel">取消</button>
        <button id="confirm" disabled>确认</button>
      </div>
    `;
    this.showDialog(html);
    const giveBtns = this.dialogRoot.querySelectorAll('[data-give]');
    const getBtns = this.dialogRoot.querySelectorAll('[data-get]');
    const confirm = this.dialogRoot.querySelector('#confirm');
    const update = () => {
      if (!give || !get || give === get) { confirm.disabled = true; return; }
      const rate = getBankTradeRate(me, give);
      confirm.disabled = me.resources[give] < rate;
    };
    giveBtns.forEach(b => b.onclick = () => {
      give = b.dataset.give;
      giveBtns.forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      update();
    });
    getBtns.forEach(b => b.onclick = () => {
      get = b.dataset.get;
      getBtns.forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      update();
    });
    this.dialogRoot.querySelector('#cancel').onclick = () => this.closeDialog();
    confirm.onclick = () => {
      if (this.engine.tradeWithBank(give, get)) this.closeDialog();
    };
  }

  showPlayerTradeDialog() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    const give = {}; const get = {};
    for (const r of RESOURCES) { give[r] = 0; get[r] = 0; }

    const html = `
      <h2>玩家交易 (AI 会按需求评估接受)</h2>
      <div class="row"><label>你给:</label><div class="res-row" id="give-ctrls">
        ${RESOURCES.map(r => `
          <div style="display:flex;align-items:center;gap:4px">
            <button data-dec-give="${r}">-</button>
            <span>${RES_ICON[r]}<span id="give-${r}">0</span>/${me.resources[r]}</span>
            <button data-inc-give="${r}">+</button>
          </div>
        `).join('')}
      </div></div>
      <div class="row"><label>你要:</label><div class="res-row" id="get-ctrls">
        ${RESOURCES.map(r => `
          <div style="display:flex;align-items:center;gap:4px">
            <button data-dec-get="${r}">-</button>
            <span>${RES_ICON[r]}<span id="get-${r}">0</span></span>
            <button data-inc-get="${r}">+</button>
          </div>
        `).join('')}
      </div></div>
      <div class="row"><label>对象:</label>
        ${state.players.filter(p => p.id !== this.humanId).map(p =>
          `<button class="res-btn" data-target="${p.id}">${p.name}</button>`
        ).join('')}
      </div>
      <div id="trade-hint" class="hint"></div>
      <div class="btn-row">
        <button class="cancel" id="cancel">关闭</button>
      </div>
    `;
    this.showDialog(html);

    this.dialogRoot.querySelectorAll('[data-inc-give]').forEach(b => b.onclick = () => {
      const r = b.dataset.incGive;
      if (give[r] < me.resources[r]) { give[r]++; this.dialogRoot.querySelector(`#give-${r}`).textContent = give[r]; }
    });
    this.dialogRoot.querySelectorAll('[data-dec-give]').forEach(b => b.onclick = () => {
      const r = b.dataset.decGive;
      if (give[r] > 0) { give[r]--; this.dialogRoot.querySelector(`#give-${r}`).textContent = give[r]; }
    });
    this.dialogRoot.querySelectorAll('[data-inc-get]').forEach(b => b.onclick = () => {
      const r = b.dataset.incGet;
      get[r]++; this.dialogRoot.querySelector(`#get-${r}`).textContent = get[r];
    });
    this.dialogRoot.querySelectorAll('[data-dec-get]').forEach(b => b.onclick = () => {
      const r = b.dataset.decGet;
      if (get[r] > 0) { get[r]--; this.dialogRoot.querySelector(`#get-${r}`).textContent = get[r]; }
    });

    const hintEl = this.dialogRoot.querySelector('#trade-hint');
    this.dialogRoot.querySelectorAll('[data-target]').forEach(b => b.onclick = () => {
      const targetId = parseInt(b.dataset.target);
      const target = state.players[targetId];
      for (const r of RESOURCES) if (target.resources[r] < get[r]) {
        hintEl.textContent = `${target.name} 没有足够的 ${RES_NAME[r]}`;
        return;
      }
      const totalGive = RESOURCES.reduce((s,r)=>s+give[r],0);
      const totalGet = RESOURCES.reduce((s,r)=>s+get[r],0);
      if (totalGive === 0 || totalGet === 0) { hintEl.textContent = '请至少选一项给/要'; return; }
      let accept = false;
      if (target.isAI) {
        accept = aiEvaluateTrade(state, target.id, give, get);
      } else {
        accept = confirm(`${target.name},是否接受此交易?\n给你: ${formatRes(give)}\n要你: ${formatRes(get)}`);
      }
      if (!accept) { hintEl.textContent = `${target.name} 拒绝了交易`; return; }
      for (const r of RESOURCES) { me.resources[r] -= give[r]; target.resources[r] += give[r]; }
      for (const r of RESOURCES) { me.resources[r] += get[r]; target.resources[r] -= get[r]; }
      this.engine.log(`${me.name} 与 ${target.name} 交易成功`, 'normal');
      this.engine.emit();
      this.closeDialog();
    });

    this.dialogRoot.querySelector('#cancel').onclick = () => this.closeDialog();
  }

  showPlayDevDialog() {
    const state = this.engine.state;
    const me = state.players[this.humanId];
    const playable = DEV_CARD_TYPES.filter(t => t !== 'victoryPoint' && (me.devCards[t] || 0) > 0);
    if (playable.length === 0) return;

    const html = `
      <h2>打出发展卡</h2>
      <div class="res-row">
        ${playable.map(t => `<button class="res-btn" data-type="${t}">${DEV_NAME[t]} (${me.devCards[t]})</button>`).join('')}
      </div>
      <div class="btn-row"><button class="cancel" id="cancel">取消</button></div>
    `;
    this.showDialog(html);
    this.dialogRoot.querySelector('#cancel').onclick = () => this.closeDialog();
    this.dialogRoot.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
      const type = b.dataset.type;
      if (type === 'knight') {
        this.engine.playDevCard('knight');
        this.closeDialog();
      } else if (type === 'roadBuilding') {
        this.engine.playDevCard('roadBuilding');
        this.closeDialog();
      } else if (type === 'yearOfPlenty') {
        this.showYearOfPlentyDialog();
      } else if (type === 'monopoly') {
        this.showMonopolyDialog();
      }
    });
  }

  showYearOfPlentyDialog() {
    let r1 = null, r2 = null;
    const html = `
      <h2>丰收:任选 2 张资源</h2>
      <div class="row"><label>资源 1:</label><div class="res-row" id="r1-row">
        ${RESOURCES.map(r => `<button class="res-btn" data-r1="${r}">${RES_ICON[r]} ${RES_NAME[r]}</button>`).join('')}
      </div></div>
      <div class="row"><label>资源 2:</label><div class="res-row" id="r2-row">
        ${RESOURCES.map(r => `<button class="res-btn" data-r2="${r}">${RES_ICON[r]} ${RES_NAME[r]}</button>`).join('')}
      </div></div>
      <div class="btn-row"><button class="cancel" id="cancel">取消</button><button id="confirm" disabled>确认</button></div>
    `;
    this.showDialog(html);
    const confirm = this.dialogRoot.querySelector('#confirm');
    this.dialogRoot.querySelectorAll('[data-r1]').forEach(b => b.onclick = () => {
      r1 = b.dataset.r1;
      this.dialogRoot.querySelectorAll('[data-r1]').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      confirm.disabled = !(r1 && r2);
    });
    this.dialogRoot.querySelectorAll('[data-r2]').forEach(b => b.onclick = () => {
      r2 = b.dataset.r2;
      this.dialogRoot.querySelectorAll('[data-r2]').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      confirm.disabled = !(r1 && r2);
    });
    this.dialogRoot.querySelector('#cancel').onclick = () => this.closeDialog();
    confirm.onclick = () => {
      this.engine.playDevCard('yearOfPlenty', { r1, r2 });
      this.closeDialog();
    };
  }

  showMonopolyDialog() {
    const html = `
      <h2>垄断:选一种资源,收走所有人的</h2>
      <div class="res-row">
        ${RESOURCES.map(r => `<button class="res-btn" data-r="${r}">${RES_ICON[r]} ${RES_NAME[r]}</button>`).join('')}
      </div>
      <div class="btn-row"><button class="cancel" id="cancel">取消</button></div>
    `;
    this.showDialog(html);
    this.dialogRoot.querySelector('#cancel').onclick = () => this.closeDialog();
    this.dialogRoot.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      this.engine.playDevCard('monopoly', { resource: b.dataset.r });
      this.closeDialog();
    });
  }

  showGameOverDialog() {
    if (this.dialogRoot.querySelector('#game-over')) return;
    const state = this.engine.state;
    const winner = state.players[state.winner];
    const standings = state.players
      .map(p => ({ p, vp: computeVictoryPoints(state, p.id) }))
      .sort((a, b) => b.vp - a.vp);
    const html = `
      <div id="game-over">
        <h2>🏆 游戏结束</h2>
        <p><strong>${winner.name}</strong> 以 ${computeVictoryPoints(state, winner.id)} 分获胜!</p>
        <div style="margin:12px 0">
          ${standings.map((s, i) => `<div style="padding:4px 0;color:${s.p.color}">${i+1}. ${s.p.name} — ${s.vp} 分</div>`).join('')}
        </div>
        <div class="btn-row">
          <button id="restart">新一局</button>
        </div>
      </div>
    `;
    this.showDialog(html);
    this.dialogRoot.querySelector('#restart').onclick = () => {
      window.location.reload();
    };
  }
}

function formatRes(r) {
  return RESOURCES.filter(x => r[x] > 0).map(x => `${r[x]}${RES_ICON[x]}`).join(' ') || '无';
}

function aiEvaluateTrade(state, aiId, give, get) {
  const ai = state.players[aiId];
  for (const r of RESOURCES) if (ai.resources[r] < get[r]) return false;
  const needed = ['wheat', 'ore', 'brick', 'wood', 'sheep'];
  const giveValue = RESOURCES.reduce((s, r) => s + give[r] * (5 - needed.indexOf(r)), 0);
  const getValue = RESOURCES.reduce((s, r) => s + get[r] * (5 - needed.indexOf(r)), 0);
  return giveValue >= getValue + 1;
}
