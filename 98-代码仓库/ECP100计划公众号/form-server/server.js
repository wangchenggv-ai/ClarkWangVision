const http = require('http');
const { exec } = require('child_process');
const url = require('url');

const FEISHU_BASE_TOKEN = 'RlfTb6gykaEb3gsR1lwcGnShnAA';
const FEISHU_TABLE_ID = 'tblnC2oBxVyIX11j';
const PORT = 3001;

// 通过 lark-cli 写入飞书多维表格
function writeToFeishu(fields) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(fields).replace(/"/g, '\\"');
    const cmd = `lark-cli base +record-upsert --base-token ${FEISHU_BASE_TOKEN} --table-id ${FEISHU_TABLE_ID} --json "${json}" --as user`;
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error('lark-cli 执行失败: ' + (stderr || err.message)));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.ok) {
          resolve(result);
        } else {
          reject(new Error(result.error?.message || '写入失败'));
        }
      } catch (e) {
        reject(new Error('解析 lark-cli 响应失败'));
      }
    });
  });
}

// HTML 表单页面
function getFormHTML(optometrist, store) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>高视星正品验证与服务绑定</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 32px 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo h1 {
      font-size: 20px;
      color: #333;
      margin-bottom: 8px;
    }
    .logo p {
      font-size: 13px;
      color: #999;
    }
    .info-bar {
      background: #f0f7ff;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 13px;
      color: #1677ff;
    }
    .info-bar strong { color: #0958d9; }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #333;
      margin-bottom: 6px;
    }
    .form-group label .required {
      color: #ff4d4f;
      margin-left: 2px;
    }
    .form-group input, .form-group select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d9d9d9;
      border-radius: 8px;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 2px rgba(102,126,234,0.1);
    }
    .submit-btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.2s;
    }
    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .success {
      text-align: center;
      padding: 40px 20px;
    }
    .success .icon { font-size: 64px; margin-bottom: 16px; }
    .success h2 { font-size: 20px; color: #333; margin-bottom: 12px; }
    .success p { font-size: 14px; color: #666; line-height: 1.6; }
    .error-msg {
      color: #ff4d4f;
      font-size: 13px;
      margin-top: 8px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div id="formView">
      <div class="logo">
        <h1>高视星正品验证与服务绑定</h1>
        <p>完成以下信息，验证正品并开通复查提醒</p>
      </div>
      <div class="info-bar">
        配镜门店：<strong>${store}</strong> | 视光师：<strong>${optometrist}</strong>
      </div>
      <form id="mainForm">
        <div class="form-group">
          <label>您的姓名 <span class="required">*</span></label>
          <input type="text" name="name" required placeholder="请输入您的姓名">
        </div>
        <div class="form-group">
          <label>您的手机号 <span class="required">*</span></label>
          <input type="tel" name="phone" required placeholder="请输入手机号" pattern="1[3-9]\\d{9}">
        </div>
        <div class="form-group">
          <label>订单号 <span class="required">*</span></label>
          <input type="text" name="orderId" required placeholder="请输入镜片订单号">
        </div>
        <div class="form-group">
          <label>产品型号 <span class="required">*</span></label>
          <select name="product" required>
            <option value="">请选择产品型号</option>
            <option value="Ultra">Ultra</option>
            <option value="时空之眼">时空之眼</option>
          </select>
        </div>
        <div id="errorMsg" class="error-msg"></div>
        <button type="submit" class="submit-btn">提交验证</button>
      </form>
    </div>
    <div id="successView" style="display:none">
      <div class="success">
        <div class="icon">&#10004;&#65039;</div>
        <h2>验证成功！</h2>
        <p>您的产品已完成正品验证<br>复查提醒将在到期前通知您</p>
      </div>
    </div>
  </div>
  <script>
    document.getElementById('mainForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = this.querySelector('.submit-btn');
      const errorMsg = document.getElementById('errorMsg');
      btn.disabled = true;
      btn.textContent = '提交中...';
      errorMsg.style.display = 'none';

      const formData = {
        name: this.name.value.trim(),
        phone: this.phone.value.trim(),
        orderId: this.orderId.value.trim(),
        product: this.product.value
      };

      try {
        const resp = await fetch('/submit?optometrist=${encodeURIComponent(optometrist)}&store=${encodeURIComponent(store)}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        const result = await resp.json();
        if (result.ok) {
          document.getElementById('formView').style.display = 'none';
          document.getElementById('successView').style.display = 'block';
        } else {
          errorMsg.textContent = '提交失败：' + (result.error || '请重试');
          errorMsg.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '提交验证';
        }
      } catch (err) {
        errorMsg.textContent = '网络错误，请重试';
        errorMsg.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '提交验证';
      }
    });
  </script>
</body>
</html>`;
}

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // 首页 - 表单页面
  if (parsedUrl.pathname === '/' && req.method === 'GET') {
    const optometrist = parsedUrl.query.optometrist || '未指定';
    const store = parsedUrl.query.store || '未指定';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getFormHTML(optometrist, store));
    return;
  }

  // 提交接口
  if (parsedUrl.pathname === '/submit' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const optometrist = parsedUrl.query.optometrist || '未指定';
        const store = parsedUrl.query.store || '未指定';

        const fields = {
          '消费者姓名': data.name,
          '手机号': data.phone,
          '订单号': data.orderId,
          '产品型号': data.product,
          '配镜门店': store,
          '视光师': optometrist,
          '扫码时间': new Date().toISOString().replace('T', ' ').substring(0, 19)
        };

        const result = await writeToFeishu(fields);

        if (result.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error || '写入失败' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`ECP表单服务器已启动: http://localhost:${PORT}`);
  console.log(`李婷: http://localhost:${PORT}?optometrist=李婷&store=上海宝岛眼科南京路店`);
  console.log(`赵磊: http://localhost:${PORT}?optometrist=赵磊&store=北京同仁验光配镜中心`);
});
