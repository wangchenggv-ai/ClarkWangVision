// server.js — 飞书周报 agent webhook 服务器
import 'dotenv/config';
import http from 'http';
import { getWikiNode, getDocBlocks, replyMessage, batchCreateRecords } from './feishu.js';
import { parseWeeklyReport } from './parse-report.js';

const PORT = process.env.PORT || 3000;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const SALES_REPORT_TABLE_ID = process.env.SALES_REPORT_TABLE_ID;
// 防重放：记录已处理的 message_id（重启清空，生产环境可换 Redis）
const processed = new Set();

// ── 核心处理逻辑 ───────────────────────────────────────────

async function handleDocLink(wikiOrDocUrl, messageId) {
  // 1. 解析 URL 拿 token
  const wikiMatch = wikiOrDocUrl.match(/\/wiki\/([A-Za-z0-9]+)/);
  const docxMatch = wikiOrDocUrl.match(/\/docx\/([A-Za-z0-9]+)/);

  let docToken;
  if (wikiMatch) {
    const node = await getWikiNode(wikiMatch[1]);
    docToken = node.node.obj_token;
    if (node.node.obj_type !== 'docx') {
      await replyMessage(messageId, '⚠️ 暂只支持飞书文档（docx），请发送文档链接');
      return;
    }
  } else if (docxMatch) {
    docToken = docxMatch[1];
  } else {
    await replyMessage(messageId, '⚠️ 未识别到飞书文档链接，请直接粘贴文档 URL');
    return;
  }

  // 2. 获取文档内容
  await replyMessage(messageId, '⏳ 正在读取周报...');
  const blocks = await getDocBlocks(docToken);

  // 3. 解析提取记录
  const records = parseWeeklyReport(blocks);
  if (records.length === 0) {
    await replyMessage(messageId, '⚠️ 未从周报中提取到有效记录，请确认文档格式符合模板');
    return;
  }

  // 4. 写入 CRM
  await batchCreateRecords(BITABLE_APP_TOKEN, SALES_REPORT_TABLE_ID, records);

  // 5. 回复确认
  const lines = records.map((r, i) =>
    `${i + 1}. [${r['上报类型']}] ${r['终端医院']} — ${r['备注']?.slice(0, 30) ?? ''}`
  ).join('\n');
  await replyMessage(messageId,
    `✅ 已写入 CRM ${records.length} 条记录\n\n${lines}`
  );
}

// ── HTTP 服务器 ────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400); res.end('bad json'); return;
  }

  // 飞书 URL 验证握手
  if (payload.type === 'url_verification') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ challenge: payload.challenge }));
    return;
  }

  // 正常事件，先 200 再异步处理
  res.writeHead(200); res.end('ok');

  try {
    const event = payload.event;
    if (!event) return;

    const msgType = event.message?.message_type;
    const messageId = event.message?.message_id;

    // 防重放
    if (!messageId || processed.has(messageId)) return;
    processed.add(messageId);

    // 只处理文本消息
    if (msgType !== 'text') return;

    const content = JSON.parse(event.message.content || '{}');
    const text = content.text || '';

    // 从消息中提取飞书文档/知识库链接
    const urlMatch = text.match(/https:\/\/[a-z]+\.feishu\.cn\/(wiki|docx)\/[A-Za-z0-9]+/);
    if (!urlMatch) return; // 没有文档链接，忽略

    await handleDocLink(urlMatch[0], messageId);
  } catch (err) {
    console.error('处理消息出错:', err.message);
  }
});

server.listen(PORT, () => {
  console.log(`✅ 周报 agent 已启动，监听端口 ${PORT}`);
  console.log(`   CRM: ${BITABLE_APP_TOKEN} / ${SALES_REPORT_TABLE_ID}`);
});
