
# 暑期备货模型计算

heatmap = {
    0.00:  [152, 9, 36, 24, 22, 3, 2, 1, 4],
   -0.25:  [43, 10, 20, 14, 13, 3, 3, 3, 4],
   -0.50:  [70, 6, 46, 21, 11, 3, 2, 4, 3],
   -0.75:  [92, 6, 55, 28, 15, 3, 2, 4, 4],
   -1.00:  [110, 13, 74, 44, 18, 1, 1, 3, 4],
   -1.25:  [116, 15, 78, 22, 19, 2, 2, 2, 4],
   -1.50:  [91, 6, 82, 38, 25, 0, 1, 4, 3],
   -1.75:  [85, 5, 55, 39, 26, 3, 3, 3, 2],
   -2.00:  [65, 9, 60, 40, 26, 2, 3, 4, 3],
   -2.25:  [19, 2, 16, 4, 3, 3, 4, 3, 2],
   -2.50:  [9, 2, 11, 11, 4, 4, 4, 4, 4],
   -2.75:  [17, 3, 17, 7, 5, 3, 3, 4, 2],
   -3.00:  [14, 4, 7, 3, 4, 1, 3, 2, 2],
   -3.25:  [5, 1, 9, 3, 6, 2, 2, 2, 4],
   -3.50:  [5, 2, 7, 1, 5, 3, 2, 3, 4],
   -3.75:  [4, 1, 3, 2, 6, 2, 4, 4, 2],
   -4.00:  [1, 2, 2, 5, 1, 4, 1, 3, 1],
   -4.25:  [2, 1, 3, 1, 4, 2, 3, 4, 4],
   -4.50:  [3, 2, 2, 4, 3, 3, 1, 4, 2],
   -4.75:  [4, 2, 3, 1, 4, 1, 2, 4, 3],
   -5.00:  [2, 2, 3, 2, 3, 4, 2, 4, 4],
   -5.25:  [3, 0, 0, 4, 2, 3, 4, 4, 3],
   -5.50:  [2, 2, 2, 3, 4, 3, 4, 5, 4],
   -5.75:  [3, 2, 2, 3, 2, 2, 4, 1, 3],
   -6.00:  [4, 1, 1, 4, 3, 3, 3, 2, 4],
}

cyl_vals = [0.00, -0.25, -0.50, -0.75, -1.00, -1.25, -1.50, -1.75, -2.00]
sph_vals = sorted(heatmap.keys(), reverse=True)  # 0 to -6

TARGET = 12000
total_hist = sum(v for row in heatmap.values() for v in row)
scale = TARGET / total_hist

print(f"历史总销量: {total_hist} 片")
print(f"暑假目标: {TARGET} 片")
print(f"放大系数: {scale:.3f}x")
print()

# 现片可用范围: SPH 0~-4, CYL 0~-1.00
def has_xianpian(sph, cyl):
    return sph >= -4.0 and cyl >= -1.0

# 决策逻辑: 预测需求 >= 20 且有现片 → 下现片
MOQ = 100
BREAK_EVEN = 50

import math

results = []
for sph in sph_vals:
    row = heatmap[sph]
    for i, cyl in enumerate(cyl_vals):
        hist = row[i]
        forecast = hist * scale
        xianpian = has_xianpian(sph, cyl)
        use_xianpian = xianpian and forecast >= BREAK_EVEN
        if use_xianpian:
            order_qty = math.ceil(forecast / MOQ) * MOQ
            order_qty = max(order_qty, MOQ)
        else:
            order_qty = 0
        results.append({
            'sph': sph, 'cyl': cyl, 'hist': hist,
            'forecast': round(forecast, 1),
            'xianpian': xianpian,
            'use_xianpian': use_xianpian,
            'order_qty': order_qty,
        })

# === 汇总 ===
xianpian_skus = [r for r in results if r['use_xianpian']]
chefang_skus = [r for r in results if not r['use_xianpian'] and r['hist'] > 0]
total_xianpian_order = sum(r['order_qty'] for r in xianpian_skus)
total_forecast_xianpian = sum(r['forecast'] for r in xianpian_skus)
total_forecast_chefang = sum(r['forecast'] for r in results if not r['use_xianpian'])

print(f"=== 整体分布 ===")
print(f"现片SKU数: {len(xianpian_skus)} 个（下单{total_xianpian_order}片，预测需{total_forecast_xianpian:.0f}片，超备{total_xianpian_order - total_forecast_xianpian:.0f}片）")
print(f"车房片覆盖SKU数: {len([r for r in results if not r['use_xianpian']])} 个，预测需求{total_forecast_chefang:.0f}片")
print()

# === ABC 分类 ===
print("=== 现片订单 TOP20（按预测需求降序）===")
print(f"{'SPH':>6} {'CYL':>6} {'历史':>6} {'预测':>7} {'订量':>6}")
print("-" * 40)
for r in sorted(xianpian_skus, key=lambda x: -x['forecast'])[:20]:
    print(f"{r['sph']:>6.2f} {r['cyl']:>6.2f} {r['hist']:>6} {r['forecast']:>7.0f} {r['order_qty']:>6}")

print()
print("=== 现片订单完整列表 ===")
print(f"{'SPH':>6} {'CYL':>6} {'历史':>6} {'预测':>7} {'订量':>6} {'超备':>6}")
print("-" * 50)
for r in sorted(xianpian_skus, key=lambda x: -x['forecast']):
    overage = r['order_qty'] - r['forecast']
    print(f"{r['sph']:>6.2f} {r['cyl']:>6.2f} {r['hist']:>6} {r['forecast']:>7.0f} {r['order_qty']:>6} {overage:>6.0f}")

print()
print("=== 车房片覆盖的有效SKU（历史>0，预测<20或无现片）===")
chefang_active = [r for r in results if not r['use_xianpian'] and r['hist'] > 0]
print(f"{'SPH':>6} {'CYL':>6} {'历史':>6} {'预测':>7} {'有现片':>6}")
print("-" * 40)
for r in sorted(chefang_active, key=lambda x: -x['forecast'])[:30]:
    xp = "Y" if r['xianpian'] else "N"
    print(f"{r['sph']:>6.2f} {r['cyl']:>6.2f} {r['hist']:>6} {r['forecast']:>7.0f} {xp:>6}")
