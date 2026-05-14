import { feishuApi, batchCreateRecords, batchUpdateRecords, listRecords } from "./feishu.js";
import { TABLES } from "../shared/tables.js";

/**
 * 导出记录管理
 * 
 * 导出类型：factory(工厂生产) / label(标签打印) / slip(随货通行单) / statement(对账单)
 */

// 延迟获取 TABLES，避免初始化问题
function getTableId() {
  return TABLES.export_log;
}

const EXPORT_TYPES = ["factory", "label", "slip", "statement"];

const EXPORT_TYPE_LABELS = {
  factory: "工厂生产",
  label: "标签打印",
  slip: "随货通行单",
  statement: "对账单",
};

/**
 * 生成导出批次号
 */
export function genExportBatchNo(type) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EXP-${type}-${d}-${r}`;
}

/**
 * 检查订单是否已导出
 * @param {string[]} orderNos - 订单号列表
 * @param {string} exportType - 导出类型
 * @returns {Promise<{exported: string[], unexported: string[]}>}
 */
export async function checkExportStatus(orderNos, exportType) {
  if (!EXPORT_TYPES.includes(exportType)) {
    throw new Error(`无效的导出类型: ${exportType}`);
  }

  const tableId = getTableId();
  const records = await listRecords(tableId);
  const exportedSet = new Set();

  for (const rec of records || []) {
    const type = rec.fields["导出类型"];
    const orderStr = rec.fields["包含订单号"] || "";
    if (type === exportType) {
      const nos = orderStr.split(",").map(s => s.trim());
      for (const no of nos) {
        if (orderNos.includes(no)) exportedSet.add(no);
      }
    }
  }

  return {
    exported: orderNos.filter(no => exportedSet.has(no)),
    unexported: orderNos.filter(no => !exportedSet.has(no)),
  };
}

/**
 * 记录导出
 * @param {string} exportType - 导出类型
 * @param {string[]} orderNos - 订单号列表
 * @param {object} options - 可选参数
 * @returns {Promise<string>} 批次号
 */
export async function logExport(exportType, orderNos, options = {}) {
  if (!EXPORT_TYPES.includes(exportType)) {
    throw new Error(`无效的导出类型: ${exportType}`);
  }

  const batchNo = genExportBatchNo(exportType);
  const { lensCodes = [], filename = "", operator = "助理", remark = "" } = options;

  const fields = {
    "导出类型": exportType,
    "导出批次号": batchNo,
    "包含订单号": orderNos.join(","),
    "包含镜片码": lensCodes.join(","),
    "导出时间": Date.now(),
    "操作人": operator,
    "导出文件名": filename,
    "备注": remark,
  };

  const tableId = getTableId();
  await batchCreateRecords(tableId, [{ fields }]);
  invalidateExportCache();

  return batchNo;
}

/**
 * 查询导出记录
 * @param {object} filters - 筛选条件
 * @returns {Promise<object[]>}
 */
export async function listExportLogs(filters = {}) {
  const tableId = getTableId();
  const records = await listRecords(tableId);
  let results = (records || []).map(r => ({
    id: r.record_id,
    type: r.fields["导出类型"] || "",
    batchNo: r.fields["导出批次号"] || "",
    orderNos: (r.fields["包含订单号"] || "").split(",").filter(Boolean),
    lensCodes: (r.fields["包含镜片码"] || "").split(",").filter(Boolean),
    time: r.fields["导出时间"],
    operator: r.fields["操作人"] || "",
    filename: r.fields["导出文件名"] || "",
    remark: r.fields["备注"] || "",
  }));

  if (filters.type) {
    results = results.filter(r => r.type === filters.type);
  }
  if (filters.orderNo) {
    results = results.filter(r => r.orderNos.includes(filters.orderNo));
  }
  if (filters.startTime) {
    results = results.filter(r => r.time >= filters.startTime);
  }
  if (filters.endTime) {
    results = results.filter(r => r.time <= filters.endTime);
  }

  return results;
}

/**
 * 获取订单的导出状态（用于前端展示）
 * @param {string[]} orderNos - 订单号列表
 * @returns {Promise<object>} { orderNo: { factory: batchNo, label: batchNo, ... } }
 */
let _exportCache = { data: null, ts: 0 };
const EXPORT_CACHE_TTL = 60000;
export function invalidateExportCache() { _exportCache = { data: null, ts: 0 }; }

export async function getOrderExportStatus(orderNos) {
  const tableId = getTableId();

  let records;
  if (_exportCache.data && Date.now() - _exportCache.ts < EXPORT_CACHE_TTL) {
    records = _exportCache.data;
  } else {
    records = await listRecords(tableId);
    _exportCache = { data: records, ts: Date.now() };
  }

  const statusMap = {};

  for (const no of orderNos) {
    statusMap[no] = { factory: "", label: "", slip: "", statement: "" };
  }

  for (const rec of records || []) {
    const type = rec.fields["导出类型"];
    const batchNo = rec.fields["导出批次号"] || "";
    const orderStr = rec.fields["包含订单号"] || "";
    const nos = orderStr.split(",").map(s => s.trim());

    for (const no of nos) {
      if (statusMap[no] && type && !statusMap[no][type]) {
        statusMap[no][type] = batchNo;
      }
    }
  }

  return statusMap;
}
