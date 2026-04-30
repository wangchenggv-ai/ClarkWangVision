/**
 * 供应链参数自动优化器 - 独立版
 * 完全独立实现飞书API调用，不依赖feishu.js的复杂init逻辑
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// 环境变量加载
// ============================================

function loadEnv() {
  const envPath = join(__dirname, '../shared/.env');
  if (!fs.existsSync(envPath)) return false;
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
  return true;
}

loadEnv();
console.log('✓ 环境变量加载成功\n');

// ============================================
// 飞书API独立实现
// ============================================

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const BITABLE_APP_TOKEN = 'B3xQbbqicaome1sKdZbcwdk8nWg';

let cachedToken = null;
let tokenExpireTime = 0;

async function getFeishuToken() {
  if (Date.now() < tokenExpireTime && cachedToken) {
    return cachedToken;
  }
  
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });
  
  const json = await res.json();
  if (json.code === 0 && json.tenant_access_token) {
    cachedToken = json.tenant_access_token;
    tokenExpireTime = Date.now() + (json.expire - 60) * 1000; // 提前60秒刷新
    return cachedToken;
  }
  
  throw new Error(`获取Token失败: ${json.msg}`);
}

async function listBitableRecords(tableId) {
  const token = await getFeishuToken();
  const records = [];
  let pageToken = '';
  
  while (true) {
    const qs = pageToken ? `?page_size=100&page_token=${pageToken}` : '?page_size=100';
    const url = `${FEISHU_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records${qs}`;
    
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const json = await res.json();
    
    if (json.code !== 0) {
      console.log(`   ✗ API错误: ${json.msg}`);
      break;
    }
    
    if (json.data?.items) {
      records.push(...json.data.items);
    }
    
    if (!json.data?.has_more) break;
    pageToken = json.data.page_token;
  }
  
  return records;
}

// ============================================
// 表ID配置
// ============================================

const TABLES = {
  order: 'tblk9Ch4gk2uQ1zG',
  stock_detail: 'tbl7U79QGG4JtQev'
};

// ============================================
// 参数空间
// ============================================

const PARAMETER_SPACE = {
  safetyStockDays: [3, 5, 7, 10],
  reorderThreshold: [0.15, 0.20, 0.25, 0.30],
  productionBatchSize: [50, 100, 150, 200],
  stockAlertThreshold: [10, 20, 30]
};

const COSTS = {
  stockoutCost: 10,
  inventoryCostPerDay: 1
};

// ============================================
// 主优化流程
// ============================================

async function optimizeParameters() {
  console.log('🚀 启动供应链参数优化...\n');
  
  console.log('📊 读取历史数据...');
  const historicalOrders = await fetchHistoricalOrders(90);
  console.log(`   ✓ 已加载 ${historicalOrders.length} 条订单\n`);
  
  const stockData = await fetchStockData();
  console.log(`   ✓ 已加载 ${stockData.length} 条库存记录\n`);
  
  if (historicalOrders.length === 0) {
    console.log('⚠️  没有订单数据，无法优化。请检查飞书表格是否有数据。\n');
    process.exit(1);
  }
  
  const combinations = generateCombinations(PARAMETER_SPACE);
  console.log(`🔬 开始测试 ${combinations.length} 种参数组合...\n`);
  
  let bestConfig = null;
  let bestScore = Infinity;
  const results = [];
  
  for (let i = 0; i < combinations.length; i++) {
    const params = combinations[i];
    
    const simulation = simulateWithParameters(
      historicalOrders,
      stockData,
      params
    );
    
    const score = calculateScore(simulation, COSTS);
    
    results.push({
      params,
      simulation,
      score,
      rank: 0
    });
    
    if (score < bestScore) {
      bestScore = score;
      bestConfig = { params, simulation, score };
    }
    
    if ((i + 1) % 10 === 0 || i === combinations.length - 1) {
      process.stdout.write(`   进度: ${i + 1}/${combinations.length}\r`);
    }
  }
  
  console.log('\n');
  
  results.sort((a, b) => a.score - b.score);
  results.forEach((r, idx) => r.rank = idx + 1);
  
  saveResults(bestConfig, results);
  displaySummary(bestConfig, results.slice(0, 10));
}

// ============================================
// 数据获取
// ============================================

async function fetchHistoricalOrders(days) {
  try {
    console.log(`   → 正在从飞书读取订单数据...`);
    const records = await listBitableRecords(TABLES.order);
    console.log(`   → 收到 ${records.length} 条订单记录`);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTimestamp = cutoffDate.getTime();
    
    const filtered = records.filter(order => {
      const createTime = order.fields['创建时间'] || order.fields['下单日期'];
      if (!createTime) return false;
      return new Date(createTime).getTime() >= cutoffTimestamp;
    });
    
    console.log(`   → 筛选后保留 ${filtered.length} 条（最近${days}天）`);
    return filtered;
    
  } catch (error) {
    console.log(`   ✗ API调用失败: ${error.message}`);
    return [];
  }
}

async function fetchStockData() {
  try {
    console.log(`   → 正在从飞书读取库存数据...`);
    const records = await listBitableRecords(TABLES.stock_detail);
    console.log(`   → 收到 ${records.length} 条库存记录`);
    return records;
  } catch (error) {
    console.log(`   ✗ 库存数据读取失败: ${error.message}`);
    return [];
  }
}

// ============================================
// 核心模拟逻辑
// ============================================

function simulateWithParameters(orders, stockData, params) {
  let virtualStock = new Map();
  
  stockData.forEach(item => {
    const sku = item.fields?.['SKU'] || 'unknown';
    const sph = item.fields?.['SPH'] || '0';
    const cyl = item.fields?.['CYL'] || '0';
    const key = `${sku}_${sph}_${cyl}`;
    const qty = parseInt(item.fields?.['库存数量'] || 0);
    virtualStock.set(key, qty);
  });
  
  let stockouts = 0;
  let totalInventoryDays = 0;
  let reorderEvents = 0;
  let productionEvents = 0;
  
  const sortedOrders = orders.sort((a, b) => {
    const aTime = a.fields?.['创建时间'] || a.fields?.['下单日期'] || new Date();
    const bTime = b.fields?.['创建时间'] || b.fields?.['下单日期'] || new Date();
    return new Date(aTime) - new Date(bTime);
  });
  
  sortedOrders.forEach(order => {
    const sku = order.fields?.['产品型号'] || 'Ultra双效';
    const quantity = parseInt(order.fields?.['数量'] || 1);
    
    const stockKey = `${sku}_0_0`;
    const currentStock = virtualStock.get(stockKey) || 0;
    
    if (currentStock < quantity) {
      stockouts++;
      
      if (quantity >= params.productionBatchSize * 0.5) {
        virtualStock.set(stockKey, currentStock + params.productionBatchSize);
        productionEvents++;
      }
    } else {
      virtualStock.set(stockKey, currentStock - quantity);
    }
    
    const newStock = virtualStock.get(stockKey) || 0;
    if (newStock < params.stockAlertThreshold) {
      virtualStock.set(stockKey, newStock + params.productionBatchSize);
      reorderEvents++;
    }
    
    totalInventoryDays += newStock;
  });
  
  const avgInventoryDays = orders.length > 0 
    ? totalInventoryDays / orders.length 
    : 0;
  
  return {
    stockouts,
    avgInventoryDays,
    reorderEvents,
    productionEvents,
    totalOrders: orders.length
  };
}

function calculateScore(simulation, costs) {
  const stockoutCost = simulation.stockouts * costs.stockoutCost;
  const inventoryCost = simulation.avgInventoryDays * costs.inventoryCostPerDay;
  return stockoutCost + inventoryCost;
}

// ============================================
// 工具函数
// ============================================

function generateCombinations(space) {
  const keys = Object.keys(space);
  const combinations = [];
  
  function backtrack(index, current) {
    if (index === keys.length) {
      combinations.push({ ...current });
      return;
    }
    
    const key = keys[index];
    for (const value of space[key]) {
      current[key] = value;
      backtrack(index + 1, current);
    }
  }
  
  backtrack(0, {});
  return combinations;
}

function saveResults(bestConfig, allResults) {
  const output = {
    timestamp: new Date().toISOString(),
    bestConfiguration: bestConfig,
    top10Results: allResults.slice(0, 10),
    summary: {
      totalCombinations: allResults.length,
      bestScore: bestConfig.score,
      improvement: calculateImprovement(allResults)
    }
  };
  
  fs.writeFileSync(
    'optimization_results.json',
    JSON.stringify(output, null, 2)
  );
  
  console.log('💾 结果已保存到 optimization_results.json\n');
}

function calculateImprovement(results) {
  if (results.length < 2) return 0;
  const best = results[0].score;
  const worst = results[results.length - 1].score;
  return ((worst - best) / worst * 100).toFixed(2);
}

function displaySummary(bestConfig, topResults) {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    🎯 优化结果摘要                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  console.log('【最优配置】');
  console.log(`  安全库存天数:    ${bestConfig.params.safetyStockDays} 天`);
  console.log(`  补货阈值:        ${(bestConfig.params.reorderThreshold * 100).toFixed(0)}%`);
  console.log(`  排产批次:        ${bestConfig.params.productionBatchSize} 件`);
  console.log(`  预警阈值:        ${bestConfig.params.stockAlertThreshold} 件`);
  console.log('');
  
  console.log('【性能指标】');
  console.log(`  缺货次数:        ${bestConfig.simulation.stockouts} 次`);
  console.log(`  平均库存天数:    ${bestConfig.simulation.avgInventoryDays.toFixed(2)} 天`);
  console.log(`  补货次数:        ${bestConfig.simulation.reorderEvents} 次`);
  console.log(`  排产次数:        ${bestConfig.simulation.productionEvents} 次`);
  console.log(`  综合得分:        ${bestConfig.score.toFixed(2)}`);
  console.log('');
  
  console.log('【Top 10 参数组合】');
  topResults.forEach((result, idx) => {
    console.log(`  ${idx + 1}. 得分 ${result.score.toFixed(2)} - ` +
      `安全库存${result.params.safetyStockDays}天 | ` +
      `补货${(result.params.reorderThreshold * 100).toFixed(0)}% | ` +
      `批次${result.params.productionBatchSize} | ` +
      `缺货${result.simulation.stockouts}次`
    );
  });
  console.log('');
}

// ============================================
// 执行
// ============================================

optimizeParameters()
  .then(() => {
    console.log('✅ 优化完成！\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ 优化失败:', error);
    console.error(error.stack);
    process.exit(1);
  });
