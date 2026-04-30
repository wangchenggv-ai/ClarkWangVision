import { createInitialState } from './engine/state.js';
import { UI } from './view/ui.js';

// 启动配置
const PLAYER_COUNT_DEFAULT = 4;
const MY_SEAT_DEFAULT = 0;

// 初始化时弹一次配置（只在首次进入显示）
function initialSetup() {
  const setupEl = document.getElementById('setup');
  return new Promise(resolve => {
    setupEl.style.display = 'block';
    setupEl.innerHTML = `
      <div class="setup-box">
        <h2>马尼拉 实战辅助器 — 局面初始化</h2>
        <div class="setup-row">
          玩家人数：
          <select id="setup-count">
            ${[3, 4, 5].map(n => `<option value="${n}" ${n === PLAYER_COUNT_DEFAULT ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="setup-row">
          我的座位号（从 0 起）：
          <input type="number" id="setup-seat" value="${MY_SEAT_DEFAULT}" min="0"/>
        </div>
        <div class="setup-row">
          各玩家名字（用逗号分隔，留空自动生成）：
          <input type="text" id="setup-names" placeholder="例：我, 张三, 李四, 王五"/>
        </div>
        <button id="setup-btn">开始</button>
      </div>`;
    document.getElementById('setup-btn').addEventListener('click', () => {
      const playerCount = parseInt(document.getElementById('setup-count').value, 10);
      const mySeat = parseInt(document.getElementById('setup-seat').value, 10) || 0;
      const namesRaw = document.getElementById('setup-names').value.trim();
      const names = namesRaw ? namesRaw.split(/[,，]/).map(n => n.trim()) : null;
      setupEl.style.display = 'none';
      resolve({ playerCount, mySeat: Math.min(mySeat, playerCount - 1), names });
    });
  });
}

async function main() {
  const config = await initialSetup();
  const state = createInitialState(config);
  const ui = new UI(state, () => ui.render());
  ui.render();
  ui.notify();   // 触发首次 PMF 计算
  // 暴露到 window 方便调试
  window.__manila = { state, ui };
}

main();
