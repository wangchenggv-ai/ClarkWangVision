/**
 * 飞书API连接诊断工具
 * 用于检查为什么API返回非JSON响应
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 手动加载.env
function loadEnv() {
  const envPath = join(__dirname, '../shared/.env');
  if (!fs.existsSync(envPath)) {
    console.log('✗ 未找到.env文件');
    return false;
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  
  lines.forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      process.env[key.trim()] = value;
    }
  });
  
  return true;
}

loadEnv();

console.log('🔍 飞书API连接诊断\n');

// 检查环境变量
console.log('【环境变量检查】');
console.log(`FEISHU_APP_ID: ${process.env.FEISHU_APP_ID ? '✓ 已设置' : '✗ 未设置'}`);
console.log(`FEISHU_APP_SECRET: ${process.env.FEISHU_APP_SECRET ? '✓ 已设置 (前8位: ' + process.env.FEISHU_APP_SECRET.substring(0, 8) + '...)' : '✗ 未设置'}`);
console.log('');

// 测试获取tenant_access_token
async function testGetToken() {
  console.log('【测试1：获取tenant_access_token】');
  
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  
  if (!appId || !appSecret) {
    console.log('✗ 环境变量缺失，无法测试');
    return null;
  }
  
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      })
    });
    
    console.log(`HTTP状态: ${res.status}`);
    
    const json = await res.json();
    console.log('响应:', JSON.stringify(json, null, 2));
    
    if (json.code === 0 && json.tenant_access_token) {
      console.log(`✓ Token获取成功: ${json.tenant_access_token.substring(0, 20)}...`);
      return json.tenant_access_token;
    } else {
      console.log(`✗ Token获取失败: ${json.msg}`);
      return null;
    }
  } catch (error) {
    console.log(`✗ 请求失败: ${error.message}`);
    return null;
  }
}

// 测试读取Bitable
async function testReadBitable(token) {
  console.log('\n【测试2：读取订单表】');
  
  if (!token) {
    console.log('✗ 跳过（没有有效token）');
    return;
  }
  
  const appToken = 'B3xQbbqicaome1sKdZbcwdk8nWg';
  const tableId = 'tblk9Ch4gk2uQ1zG';  // 订单表
  
  try {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=5`;
    console.log(`请求URL: ${url}`);
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log(`HTTP状态: ${res.status}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);
    
    const text = await res.text();
    console.log(`响应长度: ${text.length} 字节`);
    console.log(`响应内容(前500字符):\n${text.substring(0, 500)}`);
    
    try {
      const json = JSON.parse(text);
      console.log(`\n解析后的JSON:\n${JSON.stringify(json, null, 2)}`);
      
      if (json.code === 0) {
        console.log(`✓ 读取成功，返回 ${json.data?.items?.length || 0} 条记录`);
      } else {
        console.log(`✗ API错误: ${json.msg}`);
      }
    } catch (e) {
      console.log(`✗ 响应不是JSON格式: ${e.message}`);
    }
    
  } catch (error) {
    console.log(`✗ 请求失败: ${error.message}`);
  }
}

// 执行诊断
(async () => {
  const token = await testGetToken();
  await testReadBitable(token);
  
  console.log('\n✅ 诊断完成');
})();
