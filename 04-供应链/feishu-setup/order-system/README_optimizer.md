# 供应链参数自动优化器使用指南

## 一、这是什么

基于autoresearch思路设计的供应链参数自动优化工具，**完全在本地CPU运行，零GPU依赖**。

核心原理：
1. 定义参数空间（安全库存天数、补货阈值、排产批次等）
2. 用历史90天订单数据模拟每组参数的表现
3. 计算综合得分（缺货成本 + 库存持有成本）
4. 自动找出最优参数组合

## 二、运行要求

- ✅ Node.js（你已经有）
- ✅ 能访问飞书Bitable API
- ✅ 纯CPU计算，笔记本就能跑
- ⏱️ 运行时间：10-30秒

## 三、使用步骤

### 1. 放到order-system目录

```powershell
# 复制到你的项目目录
Copy-Item "C:\Users\wangc\Downloads\supply_chain_optimizer.js" `
  -Destination "C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system\"
```

### 2. 执行优化

```powershell
cd "C:\Users\wangc\Downloads\ClarkWangVision\04-供应链\feishu-setup\order-system"
node supply_chain_optimizer.js
```

### 3. 查看结果

脚本会生成 `optimization_results.json`，包含：
- 最优参数组合
- Top 10 配置排名
- 详细性能指标

## 四、可调整的参数

在 `supply_chain_optimizer.js` 的 `PARAMETER_SPACE` 部分：

```javascript
const PARAMETER_SPACE = {
  // 安全库存天数
  safetyStockDays: [3, 5, 7, 10],
  
  // 补货阈值（库存低于此比例触发补货）
  reorderThreshold: [0.15, 0.20, 0.25, 0.30],
  
  // 排产批次大小
  productionBatchSize: [50, 100, 150, 200],
  
  // 库存预警阈值
  stockAlertThreshold: [10, 20, 30]
};
```

**组合数量** = 4 × 4 × 4 × 3 = 192 种

想测试更多组合？直接加值：
```javascript
safetyStockDays: [3, 5, 7, 10, 14, 21],  // 现在有6个值
```

## 五、输出示例

```
🚀 启动供应链参数优化...

📊 读取历史数据...
   ✓ 已加载 287 条订单
   ✓ 已加载 1575 条库存记录

🔬 开始测试 192 种参数组合...
   进度: 192/192

💾 结果已保存到 optimization_results.json

╔═══════════════════════════════════════════════════════════════╗
║                    🎯 优化结果摘要                              ║
╚═══════════════════════════════════════════════════════════════╝

【最优配置】
  安全库存天数:    5 天
  补货阈值:        20%
  排产批次:        150 件
  预警阈值:        20 件

【性能指标】
  缺货次数:        3 次
  平均库存天数:    42.15 天
  补货次数:        12 次
  排产次数:        8 次
  综合得分:        72.15

【Top 5 参数组合】
  1. 得分 72.15 - 安全库存5天 | 补货20% | 批次150
  2. 得分 74.82 - 安全库存7天 | 补货20% | 批次150
  3. 得分 76.34 - 安全库存5天 | 补货25% | 批次150
  4. 得分 78.91 - 安全库存5天 | 补货20% | 批次100
  5. 得分 81.22 - 安全库存7天 | 补货25% | 批次150

✅ 优化完成！
```

## 六、应用到实际业务

### 方案1：手动应用

看结果后，手动到 `/control?admin=TOKEN` 页面修改规则参数。

### 方案2：自动应用（需额外开发）

在脚本末尾加代码，自动回写到 `rules_config.json`：

```javascript
// 保存最优参数到规则配置
const rulesConfig = JSON.parse(
  fs.readFileSync('rules_config.json', 'utf8')
);

rulesConfig.rule14.safetyStockDays = bestConfig.params.safetyStockDays;
rulesConfig.rule13.batchSize = bestConfig.params.productionBatchSize;

fs.writeFileSync('rules_config.json', JSON.stringify(rulesConfig, null, 2));
```

## 七、扩展方向

### 7.1 增加更多优化目标

当前只优化：缺货次数 + 库存天数

可以加入：
- 交期达成率
- 排产频率惩罚（排产太频繁也有成本）
- SKU差异化策略（Ultra和小旋风用不同参数）

### 7.2 加入季节性因素

```javascript
function getSeasonalMultiplier(date) {
  const month = date.getMonth();
  // 9-11月（开学季）销量高，库存系数×1.5
  if (month >= 8 && month <= 10) return 1.5;
  return 1.0;
}
```

### 7.3 多目标优化（Pareto前沿）

不是找单一"最优"，而是找一组"不被支配"的解：
- 方案A：缺货3次，库存40天
- 方案B：缺货2次，库存55天
- 方案C：缺货5次，库存30天

让你根据业务阶段选择。

## 八、与autoresearch的对比

| 维度 | autoresearch | 供应链优化器 |
|------|-------------|-------------|
| 优化对象 | 神经网络参数 | 业务规则参数 |
| 计算需求 | GPU（H100） | CPU就够 |
| 单次评估 | 5分钟（训练模型） | <1秒（数据模拟） |
| 总时间 | 8小时跑100次 | 30秒跑200次 |
| 参数空间 | 连续（学习率0.001-0.1） | 离散（天数3/5/7/10） |
| 目标函数 | Loss下降 | 成本下降 |

## 九、注意事项

1. **历史数据质量**：90天数据要有代表性，如果刚好遇到春节/促销等特殊时期，结果会偏
2. **模拟精度**：当前模拟逻辑是简化版，真实业务更复杂（比如度数级库存、多SKU耦合）
3. **线上验证**：最优参数不要直接全量上线，先小范围A/B测试

## 十、常见问题

**Q: 能不能用AI自动改代码？**  
A: 可以！把这个脚本的 `simulateWithParameters` 函数也交给AI优化，让它自己改模拟逻辑。这就是完整的autoresearch思路了。

**Q: 192种组合够吗？**  
A: 对于4个参数的初步优化够了。想要更精细，可以：
   - 第一轮：粗粒度（192种，找大方向）
   - 第二轮：在最优附近细化（比如5天附近测试4.5/5/5.5天）

**Q: 能自动定期运行吗？**  
A: 可以！写个Windows计划任务，每周日晚上自动跑一次，第二天早上看结果。

---

**核心价值：把"拍脑袋定参数"变成"数据驱动找最优"。**
