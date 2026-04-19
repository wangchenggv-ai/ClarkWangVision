import { createServer } from 'http';

const PORT = 3220;

const MOCK_ORDERS = {};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 模拟溯源系统扫码回调
  if (url.pathname === '/api/scan-callback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log(`[Mock] 收到扫码回调: ${JSON.stringify(data)}`);
        MOCK_ORDERS[data.lensCode] = { ...data, scannedAt: new Date().toISOString() };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 0, message: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: -1, message: 'invalid json' }));
      }
    });
    return;
  }

  // 模拟溯源查询
  if (url.pathname === '/api/query' && req.method === 'GET') {
    const lensCode = url.searchParams.get('lensCode');
    const record = MOCK_ORDERS[lensCode];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (record) {
      res.end(JSON.stringify({ code: 0, data: record }));
    } else {
      res.end(JSON.stringify({ code: -1, message: 'not found' }));
    }
    return;
  }

  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mock-shuang', orders: Object.keys(MOCK_ORDERS).length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: -1, message: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`[Mock] 溯源 Mock 服务启动: http://0.0.0.0:${PORT}`);
});
