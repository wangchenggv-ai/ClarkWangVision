// parse-report.js — 从飞书文档 blocks 提取 CRM 记录

// block_type 常量
const T_TEXT      = 2;
const T_H1        = 3;
const T_H2        = 4;
const T_H3        = 5;
const T_H4        = 6;
const T_H5        = 7;
const T_H6        = 8;
const T_TABLE     = 31;
const T_TABLE_ROW = 32;
const T_TABLE_CELL= 33;

/**
 * 主入口：blocks (来自 getDocBlocks) → CRM 记录数组
 */
export function parseWeeklyReport(blocks) {
  const byId   = Object.fromEntries(blocks.map(b => [b.block_id, b]));
  const children = {};   // parent_id → [child_block_id]
  for (const b of blocks) {
    if (!b.parent_id) continue;
    (children[b.parent_id] ||= []).push(b.block_id);
  }

  // 文档根节点的直接子 blocks（按顺序）
  const rootId   = blocks[0]?.block_id;            // 第一个 block 是文档本身
  const rootKids = children[rootId] || [];

  const salesperson = extractSalesperson(rootKids, byId, children);
  const reportDate  = extractReportDate(rootKids, byId, children);

  // 找所有 table blocks，并记录它们在 rootKids 里前面最近的标题文字
  const records = [];
  for (let i = 0; i < rootKids.length; i++) {
    const bid = rootKids[i];
    const b   = byId[bid];
    if (b?.block_type !== T_TABLE) continue;

    // 往前找最近的标题
    const heading = findHeadingBefore(rootKids, i, byId, children);
    const rows    = tableToRows(bid, byId, children);
    if (rows.length < 2) continue;            // 只有表头，跳过

    const newRecs = sectionRules(heading, rows, salesperson, reportDate);
    records.push(...newRecs);
  }

  // 去重（同医院同类型取第一条）
  const seen = new Set();
  return records.filter(r => {
    const key = `${r['终端医院']}|${r['上报类型']}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── blocks 工具 ────────────────────────────────────────────

function blockText(block, children, byId) {
  if (!block) return '';
  const type = block.block_type;
  // 文本/标题 block：从 elements 提取
  if ([T_TEXT, T_H1, T_H2, T_H3, T_H4, T_H5, T_H6].includes(type)) {
    const key = type === T_TEXT ? 'text' : `heading${type - 2}`;
    const el  = block[key];
    if (!el?.elements) return '';
    return el.elements.map(e => e.text_run?.content ?? '').join('').trim();
  }
  // 其他 block：递归子节点
  const kids = children[block.block_id] || [];
  return kids.map(id => blockText(byId[id], children, byId)).join(' ').trim();
}

function findHeadingBefore(kids, idx, byId, children) {
  for (let j = idx - 1; j >= 0; j--) {
    const b = byId[kids[j]];
    if (!b) continue;
    if ([T_H1, T_H2, T_H3, T_H4, T_H5, T_H6].includes(b.block_type)) {
      return blockText(b, children, byId);
    }
  }
  return '';
}

function tableToRows(tableBlockId, byId, children) {
  // table → rows → cells → 取第一个文本子 block
  const rowIds = children[tableBlockId] || [];
  return rowIds.map(rowId => {
    const cellIds = children[rowId] || [];
    return cellIds.map(cellId => {
      const textIds = children[cellId] || [];
      const texts   = textIds.map(tid => blockText(byId[tid], children, byId)).filter(Boolean);
      return texts.join(' ').trim();
    });
  });
}

// ── 提取销售人员 & 日期 ────────────────────────────────────

function extractSalesperson(kids, byId, children) {
  for (const id of kids) {
    const t = blockText(byId[id], children, byId);
    // "销售周报模板 V1.0高珊（2026年）" 或 "高珊（2026年）"
    const m = t.match(/([^\s\d（(]{2,4})[（(]\d{4}/);
    if (m && !['销售', '周报', '模板'].includes(m[1])) return m[1];
  }
  return '未知';
}

function extractReportDate(kids, byId, children) {
  for (const id of kids) {
    const t = blockText(byId[id], children, byId);
    const m = t.match(/(\d{4})年.*?(\d{1,2})月.*?第\s*(\d{1,2})\s*周/);
    if (!m) continue;
    const [, year, month, week] = m.map(Number);
    const firstDay    = new Date(year, month - 1, 1);
    const dayOfWeek   = firstDay.getDay() || 7;                  // 1=Mon…7=Sun
    const firstMonday = new Date(year, month - 1, 1 + (dayOfWeek === 1 ? 0 : 8 - dayOfWeek));
    const target      = new Date(firstMonday);
    target.setDate(firstMonday.getDate() + (week - 1) * 7);
    return target.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

// ── 按标题判断表格类型 → 生成记录 ────────────────────────

function sectionRules(heading, rows, sp, date) {
  const h = heading;
  const header = rows[0];
  const data   = rows.slice(1).filter(r => r.some(Boolean));

  // 1.2 重点大客户验配进展：客户名称 | 周数据 | 月累计 | 年度累计 | 进展
  if (/重点大客户|验配进展/.test(h) && header.some(c => /周数据/.test(c))) {
    return data.filter(r => r[0]).map(r =>
      rec(sp, date, r[0], '', '客户拜访',
        `本周${r[1] || '无'}，进展：${r[4] || '—'}`, ''));
  }

  // 3.1 老客户维护：客户名称 | 本周工作 | 进展 | 卡点/需求 | 下周计划
  if (/老客户维护/.test(h)) {
    return data.filter(r => r[0]).map(r =>
      rec(sp, date, r[0], '', '客户拜访',
        [r[1], r[2] && `进展：${r[2]}`, r[3] && `卡点：${r[3]}`].filter(Boolean).join('。'), ''));
  }

  // 3.2 新客户开发：客户名称 | 开发阶段 | 关键决策人 | 核心需求 | 突破计划
  if (/新客户开发/.test(h)) {
    return data.filter(r => r[0]).map(r =>
      rec(sp, date, r[0], '', '新增',
        [r[1], r[3] && `需求：${r[3]}`, r[4] && `计划：${r[4]}`].filter(Boolean).join('。'), r[2] || ''));
  }

  // 四、大客户项目：项目名称 | 客户 | 当前阶段 | 本周进展 | 下周计划 | 预计签单时间
  if (/大客户项目/.test(h) && header.some(c => /预计签单/.test(c))) {
    return data.filter(r => r[1]).map(r =>
      rec(sp, date, r[1], '', '客户拜访',
        [`项目：${r[0]}`, `阶段：${r[2]}`, r[3] && `本周：${r[3]}`, r[5] && `预计签约：${r[5]}`].filter(Boolean).join('。'), ''));
  }

  // 5.2 培训/市场活动：活动名称 | 客户 | 效果反馈 | 改进建议
  if (/市场活动|培训/.test(h)) {
    return data.filter(r => r[1]).map(r =>
      rec(sp, date, r[1], '', '培训跟进',
        [r[0] && `活动：${r[0]}`, r[2] && `反馈：${r[2]}`, r[3] && `建议：${r[3]}`].filter(Boolean).join('。'), ''));
  }

  return [];
}

function rec(sp, date, hospital, agent, type, notes, doctors) {
  const r = { '销售人员': sp, '上报日期': date, '上报类型': type };
  if (hospital) r['终端医院'] = hospital;
  if (agent)    r['代理商名称'] = agent;
  if (notes)    r['备注'] = notes;
  if (doctors)  r['医生列表'] = doctors;
  return r;
}
