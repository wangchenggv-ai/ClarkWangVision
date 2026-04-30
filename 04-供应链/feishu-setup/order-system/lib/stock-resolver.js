// lib/stock-resolver.js — 库存判定（纯逻辑模块）
// 职责：给定镜片列表，返回每只眼的库存状态
// 不关心库存结果意味着什么状态 — 那是 state-router 的事

let _getStockMap;
let _STD_SPH_RANGE, _STD_CYL_RANGE;

function inRange(x, [lo, hi]) { return x >= lo && x <= hi; }

export function init({ getStockMap, stdSphRange, stdCylRange }) {
  _getStockMap = getStockMap;
  _STD_SPH_RANGE = stdSphRange;
  _STD_CYL_RANGE = stdCylRange;
}

/**
 * @param {Array<{sku: string, sph: number, cyl: number}>} lenses
 * @returns {Promise<Array<{sku, sph, cyl, key, stock, safetyStock, inStock, inRange}>>}
 */
export async function resolveStock(lenses) {
  const map = await _getStockMap();
  return lenses.map(l => {
    const sphN = Number(l.sph);
    const cylN = Number(l.cyl);
    if (!Number.isFinite(sphN) || !Number.isFinite(cylN)) {
      return { sku: l.sku, sph: sphN, cyl: cylN, key: "", stock: 0, safetyStock: 0, inStock: false, inRange: false };
    }
    const inRng = inRange(sphN, _STD_SPH_RANGE) && inRange(cylN, _STD_CYL_RANGE);
    if (!inRng) {
      return { sku: l.sku, sph: sphN, cyl: cylN, key: "", stock: 0, safetyStock: 0, inStock: false, inRange: false };
    }
    const key = `${l.sku}|${sphN.toFixed(2)}|${cylN.toFixed(2)}`;
    const info = map.get(key);
    const stock = info?.stock ?? 0;
    const available = info?.available ?? stock;
    return { sku: l.sku, sph: sphN, cyl: cylN, key, stock, reserved: info?.reserved ?? 0, available, safetyStock: info?.safetyStock ?? 0, inStock: available > 0, inRange: true };
  });
}
