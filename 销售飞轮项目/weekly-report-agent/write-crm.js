// write-crm.js — 周报数据写入 CRM，关联客户/培训记录（bot token 直接调 API）
import { api, batchCreateRecords } from './feishu.js';

const APP_TOKEN      = process.env.BITABLE_APP_TOKEN;
const TABLE_REPORT   = process.env.SALES_REPORT_TABLE_ID;
const TABLE_CUSTOMER = 'tblouJycsub1g7Nb';
const TABLE_TRAINING = 'tblbY5Nzf3xu7iqO';

// ── 加载全表记录（分页） ────────────────────────────────────

async function loadAllRecords(tableId) {
  const all = [];
  let pageToken = '';
  while (true) {
    const qs = `page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`;
    const data = await api('GET', `/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records?${qs}`);
    // bot identity 返回带 fields 对象的标准格式
    for (const r of data.items || []) {
      all.push({ record_id: r.record_id, fields: r.fields });
    }
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return all;
}

// ── 索引构建 ───────────────────────────────────────────────

function buildCustomerIndex(records) {
  const index = {};
  for (const r of records) {
    const name = r.fields['客户名称'];
    if (name) index[String(name).trim()] = r.record_id;
  }
  return index;
}

function buildTrainingIndex(records) {
  const index = {};
  for (const r of records) {
    const hospital = r.fields['目标医院'];
    if (!hospital) continue;
    const key = String(hospital).trim();
    (index[key] ||= []).push(r.record_id);
  }
  return index;
}

// ── 模糊匹配 ───────────────────────────────────────────────

function normalize(s) {
  return String(s).replace(/[（()）\s]/g, '').toLowerCase();
}

function findCustomerId(index, name) {
  const norm = normalize(name);
  // 精确 → 归一化精确 → 包含
  for (const [key, id] of Object.entries(index)) {
    if (normalize(key) === norm) return id;
  }
  for (const [key, id] of Object.entries(index)) {
    if (normalize(key).includes(norm) || norm.includes(normalize(key))) return id;
  }
  return null;
}

function findTrainingIds(index, name) {
  const norm = normalize(name);
  const ids = [];
  for (const [key, rids] of Object.entries(index)) {
    if (normalize(key) === norm || normalize(key).includes(norm) || norm.includes(normalize(key))) {
      ids.push(...rids);
    }
  }
  return [...new Set(ids)];
}

// ── 主函数 ─────────────────────────────────────────────────

/**
 * @param {Object} payload  LLM 输出 { 销售人员, 上报日期, records: [...] }
 * @returns {Array} 写入摘要
 */
export async function writeToCRM(payload) {
  const { 销售人员: salesperson, 上报日期: reportDate, records } = payload;
  if (!records?.length) throw new Error('records 为空');

  console.log('[write-crm] 加载客户/培训索引...');
  const [customerRecords, trainingRecords] = await Promise.all([
    loadAllRecords(TABLE_CUSTOMER),
    loadAllRecords(TABLE_TRAINING),
  ]);
  const customerIdx = buildCustomerIndex(customerRecords);
  const trainingIdx = buildTrainingIndex(trainingRecords);
  console.log(`[write-crm] 客户 ${Object.keys(customerIdx).length} 条，培训 ${Object.keys(trainingIdx).length} 条`);

  const toWrite = [];
  const summary = [];

  for (const r of records) {
    const hospital = r['终端医院']?.trim();
    if (!hospital) continue;

    const fields = {
      '销售人员':  salesperson,
      '上报日期':  new Date(reportDate).getTime(),
      '终端医院':  hospital,
      '上报类型':  r['上报类型'] || '客户拜访',
    };
    if (r['代理商名称']) fields['代理商名称'] = r['代理商名称'];
    if (r['备注'])       fields['备注']       = r['备注'];
    if (r['医生列表'])   fields['医生列表']   = r['医生列表'];

    const custId = findCustomerId(customerIdx, hospital);
    if (custId) fields['关联终端客户'] = [custId];

    if (r['上报类型'] === '培训跟进') {
      const trainIds = findTrainingIds(trainingIdx, hospital);
      if (trainIds.length) fields['关联培训记录'] = trainIds;
    }

    toWrite.push(fields);
    summary.push({
      医院: hospital,
      类型: fields['上报类型'],
      关联客户: custId ? '✓' : '✗',
      关联培训: fields['关联培训记录']?.length ? `✓(${fields['关联培训记录'].length}条)` : '-',
    });
  }

  await batchCreateRecords(APP_TOKEN, TABLE_REPORT, toWrite);
  return summary;
}
