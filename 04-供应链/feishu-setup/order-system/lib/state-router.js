// lib/state-router.js — 状态路由（纯函数，零 I/O）
// 职责：给定库存判定结果，返回订单目标状态
// 不关心库存怎么查出来的 — 那是 stock-resolver 的事

export const DELIVERY_IN_STOCK = "有货1-2天";
export const DELIVERY_PRODUCE = "排产5-7天";
export const DELIVERY_CUSTOM = "定制7-10天";

/**
 * @param {Array<{inStock: bool, inRange: bool}>} stockResults — resolveStock() 的返回值
 * @returns {{ targetStatus: string, wfStep: string, deliveryType: string }}
 */
export function routeConfirm(stockResults) {
  if (!stockResults.length) {
    return { targetStatus: "待处理", wfStep: "confirmed", deliveryType: DELIVERY_PRODUCE };
  }

  const anyOutOfRange = stockResults.some(r => !r.inRange);
  if (anyOutOfRange) {
    return { targetStatus: "待处理", wfStep: "confirmed", deliveryType: DELIVERY_CUSTOM };
  }

  const allInStock = stockResults.every(r => r.inStock);
  if (allInStock) {
    return { targetStatus: "打标签", wfStep: "labeled", deliveryType: DELIVERY_IN_STOCK };
  }

  return { targetStatus: "待处理", wfStep: "confirmed", deliveryType: DELIVERY_PRODUCE };
}

/**
 * @param {Array<{inStock: bool, inRange: bool}>} stockResults
 * @returns {{ suggestedStockStatus: string, note: string }}
 */
export function summarizeStock(stockResults) {
  if (!stockResults.length) return { suggestedStockStatus: "无库存", note: "无镜片明细" };

  const inStockCount = stockResults.filter(r => r.inStock).length;
  if (inStockCount === stockResults.length) {
    return { suggestedStockStatus: "有库存", note: `全部${stockResults.length}只眼有库存` };
  }
  if (inStockCount === 0) {
    return { suggestedStockStatus: "无库存", note: `全部${stockResults.length}只眼无库存` };
  }
  return { suggestedStockStatus: "无库存", note: `${inStockCount}/${stockResults.length}只眼有库存，其余无库存` };
}
