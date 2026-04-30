import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';

const BASE = 'http://localhost:3210';
const ADMIN = 'admin-gsx-2026';
const TOKEN = 'AG-002-zxkmgoryb6nprmv6';

async function main() {
  // CSV check
  console.log('=== CSV导出 ===');
  const csvR = await fetch(BASE + '/api/orders/export?t=' + TOKEN + '&status=已发货&page_size=3');
  const csvBuf = Buffer.from(await csvR.arrayBuffer());
  console.log('BOM:', csvBuf.slice(0,3).toString('hex'));
  console.log('内容(前300字):');
  console.log(csvBuf.toString('utf8').slice(0,300));

  // Batch ZIP
  console.log('\n=== 批量ZIP导出 ===');
  const zipR = await fetch(BASE + '/api/admin/batch-zip?admin=' + ADMIN + '&orderNos=ORD-20260430-818797');
  const zipBuf = Buffer.from(await zipR.arrayBuffer());
  console.log('大小:', zipBuf.length, 'bytes');
  const tmp = 'C:\\temp\\test_export_batch.zip';
  writeFileSync(tmp, zipBuf);
  const entries = execSync(`powershell -Command "Add-Type -Assembly System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${tmp}'); $z.Entries | %% { $_.FullName + ' (' + ($_.Length/1KB).toString('F1') + ' KB)' }; $z.Dispose()"`, { timeout: 10000, encoding: 'utf8' });
  console.log('ZIP包含:');
  console.log(entries);
  unlinkSync(tmp);

  // Label Excel
  console.log('\n=== 标签Excel导出 ===');
  const shippingR = await fetch(BASE + '/api/admin/orders?admin=' + ADMIN + '&status=已发货&page_size=1');
  const shipped = await shippingR.json();
  if (shipped.orders?.[0]) {
    const xlsR = await fetch(BASE + '/api/admin/labels/export-excel?admin=' + ADMIN + '&orderNos=' + shipped.orders[0].orderNo);
    const xlsBuf = Buffer.from(await xlsR.arrayBuffer());
    console.log('大小:', xlsBuf.length, 'bytes');
    const tmp2 = 'C:\\temp\\test_labels.xlsx';
    writeFileSync(tmp2, xlsBuf);
    const entries2 = execSync(`powershell -Command "Add-Type -Assembly System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${tmp2}'); $z.Entries | %% { $_.FullName + ' (' + ($_.Length/1KB).toString('F1') + ' KB)' }; $z.Dispose()"`, { timeout: 10000, encoding: 'utf8' });
    console.log('XLSX包含:');
    console.log(entries2);
    unlinkSync(tmp2);
  }

  // Test the 待处理→生产中 status change on export
  console.log('\n=== 待处理→生产中状态变更 ===');
  const pendR = await fetch(BASE + '/api/admin/orders?admin=' + ADMIN + '&status=待处理&page_size=2');
  const pending = await pendR.json();
  const pendingNos = (pending.orders || []).map(o => o.orderNo);
  console.log('待处理订单:', pendingNos.length, '个');

  if (pendingNos.length > 0) {
    // Export these orders - should trigger status change
    console.log('导出这些订单...');
    const exportR = await fetch(BASE + '/api/admin/batch-zip?admin=' + ADMIN + '&orderNos=' + pendingNos.join(','));
    console.log('导出状态:', exportR.status, '大小:', (await exportR.arrayBuffer()).byteLength, 'bytes');

    // Check if status changed
    const checkR = await fetch(BASE + '/api/admin/orders?admin=' + ADMIN + '&q=' + pendingNos[0]);
    const check = await checkR.json();
    const newStatus = check.orders?.[0]?.status;
    console.log('导出后订单状态:', newStatus, '(期望: 生产中)');
  }
}

main().catch(e => console.error('错误:', e.message));
