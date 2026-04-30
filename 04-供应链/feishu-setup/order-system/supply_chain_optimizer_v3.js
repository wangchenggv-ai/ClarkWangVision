/**
 * 供应链参数自动优化器 v3
 * 修复版：使用正确的feishu.js函数名 listRecords
 */

import fs from 'fs';

let listRecords = null;
let TABLES = null;

try {
  const feishuModule = await import('./lib/feishu.js');
  const tablesModule = await import('./shared/tables.js');
  
  listRecords = feishuModule.listRecords;
  TABLES = tablesModule.TABLES;
  
  console.log('✓ 飞书API模块加载成功\n');
} catch (error) {
  console.log('⚠️  无法连接飞书API，使用模拟数据演示');
  console.log(`   错误: ${error.message}\n`);
}

// ============================================
// 配置参数空间
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
  displaySummary(bestConfig, results.slice(0, 5));
}

// ============================================
// 数据获取（使用真实API）
// ============================================

async function fetchHistoricalOrders(days) {
  if (!listRecords || !TABLES) {
    console.log('   ℹ️  使用模拟订单数据');
    return generateMockOrders(100);
  }
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTimestamp = cutoffDate.getTime();
    
    console.log(`   → 正在从飞书读取订单数据...`);
    const records = await listRecords(TABLES.order);
    console.log(`   → 收到 ${records.length} 条订单记录`);
    
    // 筛选最近90天
    const filtered = records.filter(order => {
      const createTime = order.fields['创建时间'];
      if (!createTime) return false;
      return new Date(createTime).getTime() >= cutoffTimestamp;
    });
    
    console.log(`   → 筛选后保留 ${filtered.length} 条（最近${days}天）`);
    return filtered;
    
  } catch (error) {
    console.log(`   ✗ API调用失败: ${error.message}`);
    console.log('   ℹ️  降级使用模拟数据');
    return generateMockOrders(100);
  }
}

async function fetchStockData() {
  if (!listRecords || !TABLES) {
    return generateMockStock(50);
  }
  
  try {
    console.log(`   → 正在从飞书读取库存数据...`);
    const records = await listRecords(TABLES.stock_detail);
    console.log(`   → 收到 ${records.length} 条库存记录`);
    return records;
  } catch (error) {
    console.log(`   ✗ 库存数据读取失败: ${error.message}`);
    return generateMockStock(50);
  }
}

// ============================================
// 核心模拟逻辑
// ============================================

function simulateWithParameters(orders, stockData, params) {
  let virtualStock = new Map();
  
  // 初始化虚拟库存
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
  
  // 按时间排序
  const sortedOrders = orders.sort((a, b) => {
    const aTime = a.fields?.['创建时间'] || new Date();
    const bTime = b.fields?.['创建时间'] || new Date();
    return new Date(aTime) - new Date(bTime);
  });
  
  sortedOrders.forEach(order => {
    const sku = order.fields?.['产品型号'] || 'Ultra双效';
    const quantity = parseInt(order.fields?.['数量'] || 1);
    
    // 简化：不考虑度数，只按SKU
    const stockKey = `${sku}_0_0`;
    const currentStock = virtualStock.get(stockKey) || 0;
    
    // 检查缺货
    if (currentStock < quantity) {
      stockouts++;
      
      // 触发紧急排产
      if (quantity >= params.productionBatchSize * 0.5) {
        virtualStock.set(stockKey, currentStock + params.productionBatchSize);
        productionEvents++;
      }
    } else {
      // 扣减库存
      virtualStock.set(stockKey, currentStock - quantity);
    }
    
    // 检查补货
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
  
  console.log('【Top 5 参数组合】');
  topResults.forEach((result, idx) => {
    console.log(`  ${idx + 1}. 得分 ${result.score.toFixed(2)} - ` +
      `安全库存${result.params.safetyStockDays}天 | ` +
      `补货${(result.params.reorderThreshold * 100).toFixed(0)}% | ` +
      `批次${result.params.productionBatchSize}`
    );
  });
  console.log('');
}

// ============================================
// Mock数据生成
// ============================================

function generateMockOrders(count) {
  const orders = [];
  const skus = ['Ultra双效', '时空之眼PRO', '小旋风'];
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - 90);
  
  for (let i = 0; i < count; i++) {
    const dayOffset = Math.floor(Math.random() * 90);
    const orderDate = new Date(baseDate);
    orderDate.setDate(orderDate.getDate() + dayOffset);
    
    orders.push({
      fields: {
        '订单编号': `ORD-MOCK-${String(i).padStart(6, '0')}`,
        '创建时间': orderDate.toISOString(),
        '产品型号': skus[Math.floor(Math.random() * skus.length)],
        '数量': Math.floor(Math.random() * 5) + 1,
        '状态': '已签收'
      }
    });
  }
  
  return orders;
}

function generateMockStock(count) {
  const stock = [];
  const skus = ['Ultra双效', '时空之眼PRO', '小旋风'];
  
  for (let i = 0; i < count; i++) {
    stock.push({
      fields: {
        'SKU': skus[i % skus.length],
        'SPH': ((i % 10) * -0.25).toFixed(2),
        'CYL': ((i % 5) * -0.25).toFixed(2),
        '库存数量': Math.floor(Math.random() * 100) + 20
      }
    });
  }
  
  return stock;
}

// ============================================
// 执行入口
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
