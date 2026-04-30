// 测试飞书API连接
import fs from 'fs';

console.log('🔍 检查飞书API配置...\n');

// 1. 检查.env文件
const envPaths = [
  './shared/.env',
  '../shared/.env',
  '.env'
];

let envFound = false;
for (const path of envPaths) {
  if (fs.existsSync(path)) {
    console.log(`✓ 找到环境变量文件: ${path}`);
    const content = fs.readFileSync(path, 'utf8');
    const hasAppId = content.includes('FEISHU_APP_ID');
    const hasSecret = content.includes('FEISHU_APP_SECRET');
    console.log(`  APP_ID配置: ${hasAppId ? '✓' : '✗'}`);
    console.log(`  APP_SECRET配置: ${hasSecret ? '✓' : '✗'}`);
    envFound = true;
    break;
  }
}

if (!envFound) {
  console.log('✗ 未找到.env文件');
  console.log('  期望位置: ./shared/.env 或 .env\n');
}

// 2. 检查lib/feishu.js
if (fs.existsSync('./lib/feishu.js')) {
  console.log('\n✓ 找到 lib/feishu.js');
  const content = fs.readFileSync('./lib/feishu.js', 'utf8');
  
  // 检查导出
  const exports = content.match(/export\s+(?:async\s+)?function\s+(\w+)/g) || [];
  console.log('  导出的函数:');
  exports.forEach(exp => {
    const name = exp.match(/function\s+(\w+)/)[1];
    console.log(`    - ${name}`);
  });
} else {
  console.log('\n✗ 未找到 lib/feishu.js');
}

// 3. 检查shared/tables.js
if (fs.existsSync('./shared/tables.js')) {
  console.log('\n✓ 找到 shared/tables.js');
} else {
  console.log('\n✗ 未找到 shared/tables.js');
}

console.log('\n请将此脚本放到order-system目录下运行');
