// lib/stock.js — 度数级库存 + 代理商库存 + 交期判定

export const DELIVERY_IN_STOCK = "有货1-2天";
export const DELIVERY_PRODUCE = "排产5-7天";
export const DELIVERY_CUSTOM = "定制7-10天";

let feishuApi, listRecords, filterRecords, withLock, TABLES, APP_TOKEN, STD_SPH_RANGE, STD_CYL_RANGE;

function inRange(x, [lo, hi]) { return x >= lo && x <= hi; }

// ─── 度数级库存缓存 ─────────────────────────────────────────────────────

const STOCK_TTL = 2 * 60 * 1000;
let _stockCache = { map: null, time: 0 };

export function init({ feishuApi: api, listRecords: lr, filterRecords: fr, withLock: wl, tables, appToken, stdSphRange, stdCylRange }) {
  feishuApi = api;
  listRecords = lr;
  filterRecords = fr;
  withLock = wl;
  TABLES = tables;
  APP_TOKEN = appToken;
  STD_SPH_RANGE = stdSphRange;
  STD_CYL_RANGE = stdCylRange;
}

export async function getStockMap(fresh = false) {
  if (fresh) _stockCache = { map: null, time: 0 };
  if (_stockCache.map && Date.now() - _stockCache.time < STOCK_TTL) return _stockCache.map;
  const rows = await listRecords(TABLES.stock_detail);
  const map = new Map();
  for (const r of rows) {
    const f = r.fields || {};
    const sku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : (Array.isArray(f["SKU编号"]) ? f["SKU编号"][0]?.text : "");
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const stock = Number(f["当前库存"]) || 0;
    if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
    map.set(`${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`, { stock, recordId: r.record_id });
  }
  _stockCache = { map, time: Date.now() };
  return map;
}

export function clearStockCache() { _stockCache = { map: null, time: 0 }; }

// ─── 单条库存查询（不走全表扫描） ─────────────────────────────────────

export async function queryStockByRx(sku, sph, cyl) {
  const sphN = Number(sph);
  const cylN = Number(cyl);
  if (!Number.isFinite(sphN) || !Number.isFinite(cylN)) return null;
  const key = `${sku}|${sphN.toFixed(2)}|${cylN.toFixed(2)}`;

  const filter = {
    conjunction: "and",
    conditions: [
      { field_name: "SKU编号", operator: "is", value: [sku] },
      { field_name: "SPH", operator: "is", value: [String(sphN)] },
      { field_name: "CYL", operator: "is", value: [String(cylN)] },
    ],
  };
  const items = await filterRecords(TABLES.stock_detail, filter);
  if (!items.length) return null;
  const f = items[0].fields || {};
  return {
    stock: Number(f["当前库存"]) || 0,
    safetyStock: Number(f["安全库存"]) || 0,
    recordId: items[0].record_id,
    key,
  };
}

// ─── 度数级库存扣减（锁内 fresh read + write） ─────────────────────────

export async function deductStockDetail(sku, sph, cyl, qty) {
  const key = `${sku}|${Number(sph).toFixed(2)}|${Number(cyl).toFixed(2)}`;
  const map = await getStockMap();
  const info = map.get(key);
  if (!info) return { success: false, reason: "not_found" };

  return withLock(key, async () => {
    const freshData = await feishuApi("GET",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/${info.recordId}`
    );
    const currentStock = Number(freshData?.record?.fields?.["当前库存"]) || 0;

    const deductQty = Math.min(currentStock, qty);
    if (deductQty <= 0) {
      console.log(`  ⏭️ 无库存可扣: ${key}，走生产`);
      return { success: true, newStock: 0, deducted: 0 };
    }

    const newStock = currentStock - deductQty;
    const now = Date.now();

    const patchRes = await feishuApi("PUT",
      `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.stock_detail}/records/${info.recordId}`,
      { fields: { "当前库存": newStock, "最近出库": now } }
    );
    if (!patchRes) {
      console.error(`  ⚠️ 库存扣减写入失败: ${key}`);
      return { success: false, reason: "write_failed" };
    }

    clearStockCache();
    console.log(`  📉 度数扣减: ${key} -${deductQty} → ${newStock}`);
    return { success: true, newStock, deducted: deductQty };
  });
}

// ─── 代理商本地库存 ─────────────────────────────────────────────────────

const AGENT_STOCK_TTL = 2 * 60 * 1000;
let _agentStockCaches = {};

export async function getAgentStockMap(agentId) {
  if (!TABLES.agent_stock) return null;
  const cached = _agentStockCaches[agentId];
  if (cached?.map && Date.now() - cached.time < AGENT_STOCK_TTL) return cached.map;

  const encoded = encodeURIComponent(`"${agentId}"`);
  const data = await feishuApi("GET",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_stock}/records?page_size=500&filter=CurrentValue.[agent_id]=${encoded}`
  );
  const map = new Map();
  for (const r of data?.items || []) {
    const f = r.fields || {};
    const sku = typeof f["SKU编号"] === "string" ? f["SKU编号"] : (Array.isArray(f["SKU编号"]) ? f["SKU编号"][0]?.text : "");
    const sph = Number(f["SPH"]);
    const cyl = Number(f["CYL"]);
    const owned = Number(f["自有库存"]) || 0;
    const consigned = Number(f["寄售库存"]) || 0;
    if (!sku || !Number.isFinite(sph) || !Number.isFinite(cyl)) continue;
    const key = `${sku}|${sph.toFixed(2)}|${cyl.toFixed(2)}`;
    const consignDate = f["寄售入库日期"] || null;
    map.set(key, { owned, consigned, total: owned + consigned, consignDate, recordId: r.record_id });
  }
  _agentStockCaches[agentId] = { map, time: Date.now() };
  return map;
}

export function clearAgentStockCache(agentId) {
  delete _agentStockCaches[agentId];
}

// ─── 交期判定 ───────────────────────────────────────────────────────────

export async function estimateDeliveryByRx(sku, sph, cyl, qty, agentId) {
  const now = Date.now();
  const sphN = Number(sph);
  const cylN = Number(cyl);

  if (!Number.isFinite(sphN) || !Number.isFinite(cylN) ||
      !inRange(sphN, STD_SPH_RANGE) || !inRange(cylN, STD_CYL_RANGE)) {
    return { deliveryType: DELIVERY_CUSTOM, days: 10, promiseDate: now + 10 * 86400000, available: false, stock: 0 };
  }

  const key = `${sku}|${sphN.toFixed(2)}|${cylN.toFixed(2)}`;

  if (agentId) {
    const agentMap = await getAgentStockMap(agentId);
    if (agentMap) {
      const aStock = agentMap.get(key);
      if (aStock && aStock.total > 0) {
        const result = {
          deliveryType: aStock.total >= qty ? DELIVERY_IN_STOCK : DELIVERY_PRODUCE,
          days: aStock.total >= qty ? 2 : 7,
          promiseDate: now + (aStock.total >= qty ? 2 : 7) * 86400000,
          available: aStock.total >= qty,
          stock: aStock.total,
          agentStock: { owned: aStock.owned, consigned: aStock.consigned },
        };
        return result;
      }
    }
  }

  const map = await getStockMap();
  const stock = (map.get(key) || {}).stock ?? 0;

  if (stock >= qty) {
    return { deliveryType: DELIVERY_IN_STOCK, days: 2, promiseDate: now + 2 * 86400000, available: true, stock };
  }
  return { deliveryType: DELIVERY_PRODUCE, days: 7, promiseDate: now + 7 * 86400000, available: false, stock };
}

// ─── 代理商库存扣减（先自有后寄售） ────────────────────────────────────

export async function deductAgentStock(agentId, sku, sph, cyl, qty) {
  if (!TABLES.agent_stock || !TABLES.consignment_ledger) return { deducted: 0 };

  const key = `${sku}|${Number(sph).toFixed(2)}|${Number(cyl).toFixed(2)}`;
  const agentMap = await getAgentStockMap(agentId);
  if (!agentMap) return { deducted: 0 };

  const stockInfo = agentMap.get(key);
  if (!stockInfo || stockInfo.total <= 0) return { deducted: 0 };

  const deductQty = Math.min(qty, stockInfo.total);
  let ownedUsed = Math.min(deductQty, stockInfo.owned);
  let consignedUsed = deductQty - ownedUsed;

  if (!stockInfo.recordId) return { deducted: 0 };

  const newOwned = stockInfo.owned - ownedUsed;
  const newConsigned = stockInfo.consigned - consignedUsed;
  await feishuApi("PATCH",
    `/bitable/v1/apps/${APP_TOKEN}/tables/${TABLES.agent_stock}/records/${stockInfo.recordId}`,
    { fields: { "自有库存": newOwned, "寄售库存": newConsigned } }
  );

  clearAgentStockCache(agentId);

  const ledgerRecords = [];
  if (ownedUsed > 0) {
    ledgerRecords.push({
      fields: {
        "流水号": `OUT-${agentId}-${sku}-${key}-${Date.now()}-OWNED`,
        "agent_id": agentId,
        "类型": "消耗",
        "SKU编号": sku,
        "SPH": Number(sph),
        "CYL": Number(cyl),
        "数量": -ownedUsed,
        "备注": "自有库存消耗",
      },
    });
  }
  if (consignedUsed > 0) {
    ledgerRecords.push({
      fields: {
        "流水号": `OUT-${agentId}-${sku}-${key}-${Date.now()}-CONSIGN`,
        "agent_id": agentId,
        "类型": "消耗",
        "SKU编号": sku,
        "SPH": Number(sph),
        "CYL": Number(cyl),
        "数量": -consignedUsed,
        "备注": "寄售库存消耗",
      },
    });
  }

  return { deducted: deductQty, ownedUsed, consignedUsed, ledgerRecords };
}
