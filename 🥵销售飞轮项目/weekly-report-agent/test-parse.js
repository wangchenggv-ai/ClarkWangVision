// 快速测试解析逻辑（从已知周报提取记录）
import 'dotenv/config';
import { getWikiNode, getDocBlocks } from './feishu.js';
import { parseWeeklyReport } from './parse-report.js';

const WIKI_TOKEN = 'D4F9wPWiriSC7AkP9eTc2Rqkncc';

const node = await getWikiNode(WIKI_TOKEN);
const docToken = node.node.obj_token;
console.log('文档 token:', docToken);

const blocks = await getDocBlocks(docToken);
console.log('block 数量:', blocks.length, '\n');

const records = parseWeeklyReport(blocks);
console.log(`提取到 ${records.length} 条记录:\n`);
records.forEach((r, i) => {
  console.log(`${i + 1}. [${r['上报类型']}] ${r['终端医院']}`);
  console.log(`   销售：${r['销售人员']}  日期：${r['上报日期']}`);
  if (r['代理商名称']) console.log(`   代理商：${r['代理商名称']}`);
  if (r['医生列表']) console.log(`   医生：${r['医生列表']}`);
  console.log(`   备注：${r['备注']?.slice(0, 60) ?? ''}`);
  console.log();
});
