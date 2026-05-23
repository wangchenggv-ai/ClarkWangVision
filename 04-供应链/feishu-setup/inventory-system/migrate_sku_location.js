/**
 * migrate_sku_location.js
 *
 * 从仓库设计/仓库SKU地址映射表.xlsx「序列号速查」Sheet 导入219条记录到 sku_location 表。
 *
 * 用法：
 *   node migrate_sku_location.js [--product-sku=Ultra双效]
 *   node migrate_sku_location.js --dry-run
 *
 * 注意：运行前会清空表已有数据（防重复），谨慎执行。
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { config } from 'dotenv';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../shared/.env') });

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 配置 ──────────────────────────────────────────────────
const XLSX_PATH = join(__dirname, '../仓库设计/仓库SKU地址映射表.xlsx');
const SHEET_NAME = '序列号速查';
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BASE_TOKEN = process.env.FEISHU_APP_TOKEN;
const TABLE_ID = 'tblTbLuC3VI0ISKH';
const BATCH_SIZE = 50;

// 命令行参数
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PRODUCT_SKU = (args.find(a => a.startsWith('--product-sku=')) || '').replace('--product-sku=', '') || 'Ultra双效';

// ── 飞书 token ──────────────────────────────────────────────
async function getToken() {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const { tenant_access_token } = await res.json();
  return tenant_access_token;
}

async function feishuGet(token, path) {
  const res = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function feishuPost(token, path, body) {
  const res = await fetch(`https://open.feishu.cn/open-apis${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── 读取 xlsx ────────────────────────────────────────────────
function readXlsx() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`xlsx 不存在: ${XLSX_PATH}`);
  const xlsx = require(join(__dirname, '../node_modules/xlsx'));
  const wb = xlsx.readFile(XLSX_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet「${SHEET_NAME}」不存在，可用：${wb.SheetNames.join(', ')}`);
  const [, ...data] = xlsx.utils.sheet_to_json(ws, { header: 1 });
  return data.filter(r => r.length >= 6).map(r => ({
    序列号: String(r[0]).padStart(3, '0'),
    SPH: Number(r[1]),
    CYL: Number(r[2]),
    ABC分类: String(r[3]),
    总片数: Number(r[4]),
    货位编号: String(r[5]),
    料盒类型: String(r[6] || ''),
  }));
}

// ── 清空表 ───────────────────────────────────────────────────
async function clearTable(token) {
  let allIds = [], pageToken = '';
  do {
    const url = `/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records?page_size=200${pageToken ? '&page_token=' + pageToken : ''}`;
    const j = await feishuGet(token, url);
    allIds.push(...j.data.items.map(x => x.record_id));
    pageToken = j.data.has_more ? j.data.page_token : '';
  } while (pageToken);

  if (!allIds.length) return;
  console.log(`清空 ${allIds.length} 条旧记录...`);
  for (let i = 0; i < allIds.length; i += 200) {
    const j = await feishuPost(token, `/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_delete`, {
      records: allIds.slice(i, i + 200),
    });
    if (j.code !== 0) throw new Error(`删除失败: ${JSON.stringify(j)}`);
  }
}

// ── 主逻辑 ──────────────────────────────────────────────────
async function main() {
  console.log(`ProductSKU: ${PRODUCT_SKU}${DRY_RUN ? '  [DRY RUN]' : ''}`);
  const rows = readXlsx();
  console.log(`读取 ${rows.length} 行数据`);

  if (DRY_RUN) {
    console.log('前3行预览:');
    rows.slice(0, 3).forEach(r => console.log(JSON.stringify(r)));
    return;
  }

  const token = await getToken();
  await clearTable(token);

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const records = batch.map(r => ({
      fields: {
        序列号: r.序列号,
        ProductSKU: PRODUCT_SKU,
        SPH: r.SPH,
        CYL: r.CYL,
        ABC分类: { text: r.ABC分类 },
        总片数: r.总片数,
        货位编号: r.货位编号,
        料盒类型: r.料盒类型,
      },
    }));
    const j = await feishuPost(token, `/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_create`, { records });
    if (j.code !== 0) throw new Error(`写入失败: ${JSON.stringify(j)}`);
    total += batch.length;
    process.stdout.write(`\r已写入 ${total}/${rows.length}`);
  }
  console.log(`\n完成，已写入 ${total} 条`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
