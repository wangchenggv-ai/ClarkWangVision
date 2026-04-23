# -*- coding: utf-8 -*-
"""
离焦RGP 6个月临床数据 - PPT图表生成器
医疗行业专业风格
"""

import matplotlib.pyplot as plt
import matplotlib
import numpy as np
from matplotlib.patches import FancyBboxPatch
import os

# ==================== 全局样式配置 ====================
# 医疗行业专业配色
COLORS = {
    'primary': '#0077B6',      # 深蓝 - 主色
    'secondary': '#00B4D8',    # 浅蓝 - 副色
    'accent': '#90E0EF',       # 天蓝 - 强调
    'success': '#2D9B5A',      # 绿色 - 正面
    'warning': '#F4A261',      # 橙色 - 中性
    'danger': '#E63946',       # 红色 - 警示
    'neutral': '#6C757D',      # 灰色
    'bg': '#F8FAFC',           # 背景色
    'text': '#1B2A4A',         # 文字色
}

# 渐变配色方案
GRADIENT_BLUES = ['#0077B6', '#0096C7', '#00B4D8', '#48CAE4', '#90E0EF']
GRADIENT_WARM = ['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#264653']

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.dpi'] = 300
plt.rcParams['figure.facecolor'] = '#FFFFFF'

# 输出目录
OUTPUT_DIR = r'C:\Users\wangc\Downloads\ClarkWangVision\charts'
os.makedirs(OUTPUT_DIR, exist_ok=True)


def add_watermark(ax, text='离焦RGP · 临床数据'):
    """添加水印"""
    ax.text(0.98, 0.02, text, transform=ax.transAxes, fontsize=7,
            color='#CCCCCC', ha='right', va='bottom', alpha=0.5)


# ==================== 图表1: 眼轴增长趋势 ====================
def chart_al_trend():
    """眼轴变化趋势图 - 带误差棒的折线图"""
    fig, ax = plt.subplots(figsize=(10, 6), facecolor='white')
    
    time_points = ['基线', '3个月', '6个月']
    al_change = [0, 0.016, 0.090]
    std_dev = [0, 0.087, 0.112]
    
    # 绘制误差棒区域
    ax.fill_between([0, 1, 2], 
                    [a - s for a, s in zip(al_change, std_dev)],
                    [a + s for a, s in zip(al_change, std_dev)],
                    alpha=0.15, color=COLORS['primary'], label='±1 SD')
    
    # 主折线
    line = ax.plot([0, 1, 2], al_change, 
                   color=COLORS['primary'], linewidth=3, 
                   marker='o', markersize=12, markerfacecolor='white',
                   markeredgewidth=3, markeredgecolor=COLORS['primary'],
                   zorder=5)
    
    # 数据标注
    for i, (x, y, s) in enumerate(zip([0, 1, 2], al_change, std_dev)):
        if i > 0:
            ax.annotate(f'+{y:.3f}mm\n(±{s:.3f})', 
                       xy=(x, y), xytext=(0, 20),
                       textcoords='offset points',
                       ha='center', fontsize=11, fontweight='bold',
                       color=COLORS['text'],
                       bbox=dict(boxstyle='round,pad=0.3', 
                                facecolor=COLORS['accent'], 
                                edgecolor=COLORS['primary'],
                                alpha=0.8))
    
    # 年化推算虚线
    ax.axhline(y=0.181, color=COLORS['secondary'], linestyle='--', 
               linewidth=2, alpha=0.7)
    ax.text(2.3, 0.181, '年化 +0.181mm', fontsize=10, 
            color=COLORS['secondary'], fontweight='bold', va='center')
    
    # 文献基准区间
    ax.axhspan(0.30, 0.40, alpha=0.1, color=COLORS['danger'], label='文献基准 (0.30~0.40mm/年)')
    ax.axhline(y=0.35, color=COLORS['danger'], linestyle=':', linewidth=1.5, alpha=0.6)
    ax.text(2.3, 0.35, '未干预基准', fontsize=9, color=COLORS['danger'], va='center')
    
    # 样式美化
    ax.set_xlim(-0.3, 2.8)
    ax.set_ylim(-0.05, 0.45)
    ax.set_xticks([0, 1, 2])
    ax.set_xticklabels(time_points, fontsize=13, fontweight='bold')
    ax.set_ylabel('眼轴变化量 (mm)', fontsize=13, fontweight='bold')
    ax.set_title('离焦RGP眼轴增长控制趋势\n6个月随访数据', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#E0E0E0')
    ax.spines['bottom'].set_color('#E0E0E0')
    ax.tick_params(colors=COLORS['text'])
    ax.legend(loc='upper left', frameon=True, fancybox=True, shadow=True)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '01_眼轴增长趋势.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表1: 眼轴增长趋势图 已生成")


# ==================== 图表2: SER变化分类 ====================
def chart_ser_distribution():
    """屈光度变化分类 - 环形图"""
    fig, ax = plt.subplots(figsize=(8, 8), facecolor='white')
    
    labels = ['稳定\n(|ΔD|≤0.125D)', '进展\n(加深>0.125D)', '改善\n(减少>0.125D)']
    sizes = [45, 32, 23]
    colors = [COLORS['success'], COLORS['warning'], COLORS['primary']]
    explode = (0.05, 0, 0)
    
    # 外圈饼图
    wedges, texts, autotexts = ax.pie(sizes, 
                                       explode=explode,
                                       labels=labels, 
                                       colors=colors,
                                       autopct='%1.0f%%',
                                       pctdistance=0.75,
                                       startangle=90,
                                       wedgeprops=dict(width=0.4, edgecolor='white', linewidth=3))
    
    # 美化文字
    for text in texts:
        text.set_fontsize(12)
        text.set_fontweight('bold')
        text.set_color(COLORS['text'])
    
    for autotext in autotexts:
        autotext.set_fontsize(16)
        autotext.set_fontweight('bold')
        autotext.set_color('white')
    
    # 中心文字
    ax.text(0, 0, '6个月\nSER变化', ha='center', va='center',
            fontsize=14, fontweight='bold', color=COLORS['text'])
    
    # 图例详细数据
    detail_text = (
        f"稳定: 10眼 (45%)\n"
        f"进展: 7眼 (32%)\n"
        f"改善: 5眼 (23%)\n"
        f"平均变化: -0.10 ± 0.34 D"
    )
    ax.text(1.3, -0.1, detail_text, fontsize=11, 
            bbox=dict(boxstyle='round,pad=0.5', facecolor=COLORS['bg'], 
                     edgecolor=COLORS['primary'], alpha=0.9),
            verticalalignment='center')
    
    ax.set_title('屈光度(SER)变化分类分布\nn=22眼', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '02_SER变化分类.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表2: SER变化分类图 已生成")


# ==================== 图表3: 亚组分析 - 年龄分层 ====================
def chart_age_subgroup():
    """年龄分层亚组分析 - 对比柱状图"""
    fig, ax = plt.subplots(figsize=(9, 6), facecolor='white')
    
    groups = ['≤8岁\n(n=6眼)', '≥10岁\n(n=16眼)']
    al_change = [0.052, 0.105]
    colors = [COLORS['primary'], COLORS['secondary']]
    
    bars = ax.bar(groups, al_change, color=colors, width=0.5,
                  edgecolor='white', linewidth=2, zorder=3)
    
    # 数值标注
    for bar, val in zip(bars, al_change):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.005,
                f'+{val:.3f}mm', ha='center', va='bottom',
                fontsize=14, fontweight='bold', color=COLORS['text'])
    
    # 添加控制效果优势标注
    ax.annotate('控制效果更优\n(↓50.5%)', xy=(0, 0.052), xytext=(0.5, 0.02),
                fontsize=10, color=COLORS['success'], fontweight='bold',
                ha='center',
                arrowprops=dict(arrowstyle='->', color=COLORS['success'], lw=2))
    
    ax.set_ylabel('6个月眼轴变化 (mm)', fontsize=13, fontweight='bold')
    ax.set_title('年龄分层亚组分析\n眼轴增长控制效果对比', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#E0E0E0')
    ax.spines['bottom'].set_color('#E0E0E0')
    ax.set_ylim(0, 0.15)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '03_年龄分层分析.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表3: 年龄分层亚组分析图 已生成")


# ==================== 图表4: 亚组分析 - 屈光度分层 ====================
def chart_ser_subgroup():
    """基线屈光度分层亚组分析 - 对比柱状图"""
    fig, ax = plt.subplots(figsize=(9, 6), facecolor='white')
    
    groups = ['低中度\n(SER > -3.0D)\n(n=12眼)', '中高度\n(SER ≤ -3.0D)\n(n=10眼)']
    al_change = [0.070, 0.115]
    colors = [COLORS['accent'], COLORS['primary']]
    
    bars = ax.bar(groups, al_change, color=colors, width=0.5,
                  edgecolor='white', linewidth=2, zorder=3)
    
    # 数值标注
    for bar, val in zip(bars, al_change):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.005,
                f'+{val:.3f}mm', ha='center', va='bottom',
                fontsize=14, fontweight='bold', color=COLORS['text'])
    
    # 添加中高度近视警告
    ax.text(1, 0.13, '中高度近视\n眼轴增长更快\n(符合临床预期)', 
            ha='center', fontsize=10, color=COLORS['warning'], fontweight='bold')
    
    ax.set_ylabel('6个月眼轴变化 (mm)', fontsize=13, fontweight='bold')
    ax.set_title('基线屈光度分层亚组分析\n不同近视程度控制效果对比', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#E0E0E0')
    ax.spines['bottom'].set_color('#E0E0E0')
    ax.set_ylim(0, 0.16)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '04_屈光度分层分析.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表4: 屈光度分层亚组分析图 已生成")


# ==================== 图表5: 疗效控制率 ====================
def chart_control_rate():
    """个体疗效分布 - 水平堆叠条形图"""
    fig, ax = plt.subplots(figsize=(10, 5), facecolor='white')
    
    categories = ['良好控制\n(AL ≤ 0.10mm)', '中等控制\n(0.10 < AL ≤ 0.20mm)', '控制欠佳\n(AL > 0.20mm)']
    values = [64, 18, 18]  # 良好64%, 中等18%, 欠佳18%
    colors = [COLORS['success'], COLORS['warning'], COLORS['danger']]
    counts = [14, 4, 4]
    
    # 绘制堆叠条形图
    left = 0
    bars = []
    for i, (val, color, cat, count) in enumerate(zip(values, colors, categories, counts)):
        bar = ax.barh(0, val, left=left, color=color, height=0.5,
                     edgecolor='white', linewidth=2, zorder=3)
        bars.append(bar)
        
        # 在条形内添加文字
        if val >= 15:
            ax.text(left + val/2, 0, f'{cat}\n{count}眼\n({val}%)',
                   ha='center', va='center', fontsize=11, 
                   fontweight='bold', color='white')
        left += val
    
    ax.set_xlim(0, 100)
    ax.set_yticks([])
    ax.set_xlabel('百分比 (%)', fontsize=13, fontweight='bold')
    ax.set_title('个体疗效分布\nn=22眼', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.spines['bottom'].set_color('#E0E0E0')
    
    # 添加图例
    from matplotlib.patches import Patch
    legend_elements = [Patch(facecolor=COLORS['success'], label='良好控制 (14眼)'),
                       Patch(facecolor=COLORS['warning'], label='中等控制 (4眼)'),
                       Patch(facecolor=COLORS['danger'], label='控制欠佳 (4眼)')]
    ax.legend(handles=legend_elements, loc='upper right', frameon=True, fontsize=10)
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '05_疗效控制率.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表5: 疗效控制率图 已生成")


# ==================== 图表6: 满意度趋势 ====================
def chart_satisfaction():
    """满意度趋势图 - 折线+面积图"""
    fig, ax = plt.subplots(figsize=(10, 6), facecolor='white')
    
    time_points = ['取镜时', '3个月', '6个月']
    satisfaction = [9.14, 9.38, 9.26]
    
    # 填充区域
    ax.fill_between(time_points, satisfaction, 8.5, 
                    alpha=0.2, color=COLORS['primary'])
    
    # 主折线
    ax.plot(time_points, satisfaction, 
            color=COLORS['primary'], linewidth=3,
            marker='s', markersize=12, markerfacecolor=COLORS['primary'],
            markeredgecolor='white', markeredgewidth=2,
            zorder=5)
    
    # 数据标注
    for x, y in zip(time_points, satisfaction):
        ax.annotate(f'{y:.2f}', xy=(x, y), xytext=(0, 15),
                   textcoords='offset points',
                   ha='center', fontsize=14, fontweight='bold',
                   color=COLORS['primary'],
                   bbox=dict(boxstyle='round,pad=0.3', 
                            facecolor='white', 
                            edgecolor=COLORS['primary'],
                            alpha=0.9))
    
    # 满分参考线
    ax.axhline(y=10, color=COLORS['neutral'], linestyle=':', 
               linewidth=1, alpha=0.5)
    ax.text(2.1, 10, '满分 10分', fontsize=9, color=COLORS['neutral'])
    
    # 高满意度区间
    ax.axhspan(9.0, 9.5, alpha=0.1, color=COLORS['success'])
    ax.text(-0.1, 9.45, '高满意度区间', fontsize=9, color=COLORS['success'], 
            fontweight='bold', ha='left')
    
    ax.set_ylim(8.8, 10.2)
    ax.set_ylabel('满意度评分 (满分10分)', fontsize=13, fontweight='bold')
    ax.set_title('患者满意度随访趋势\n戴镜舒适度、视力质量综合评价', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#E0E0E0')
    ax.spines['bottom'].set_color('#E0E0E0')
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '06_满意度趋势.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表6: 满意度趋势图 已生成")


# ==================== 图表7: 文献基准对比 ====================
def chart_literature_comparison():
    """与文献基准对比 - 柱状对比图"""
    fig, ax = plt.subplots(figsize=(10, 7), facecolor='white')
    
    categories = ['本研究\n离焦RGP', '文献基准\n未干预', '离焦软镜\n(DIMS/DISC)']
    values = [0.181, 0.35, 0.15]
    errors = [0, 0.05, 0.05]  # 基准和软镜的范围
    colors = [COLORS['primary'], COLORS['danger'], COLORS['secondary']]
    
    bars = ax.bar(categories, values, color=colors, width=0.5,
                  edgecolor='white', linewidth=2, zorder=3,
                  yerr=errors, capsize=8, error_kw={'linewidth': 2, 'color': '#333333'})
    
    # 数值标注
    for bar, val, cat in zip(bars, values, categories):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.03,
                f'{val:.3f}mm/年', ha='center', va='bottom',
                fontsize=13, fontweight='bold', color=COLORS['text'])
    
    # 控制效力标注
    ax.annotate('眼轴控制效力\n≈50~55%', xy=(0, 0.181), xytext=(0.7, 0.22),
                fontsize=11, color=COLORS['success'], fontweight='bold',
                ha='center',
                arrowprops=dict(arrowstyle='->', color=COLORS['success'], lw=2))
    
    # 效力区间标注
    ax.fill_between([0.5, 1.5], 0.10, 0.20, alpha=0.1, color=COLORS['success'])
    ax.text(1, 0.08, '与离焦软镜处于\n同一效力量级', ha='center',
            fontsize=10, color=COLORS['success'], fontweight='bold')
    
    ax.set_ylabel('年化眼轴增长 (mm)', fontsize=13, fontweight='bold')
    ax.set_title('离焦RGP眼轴控制效力\n与文献基准及离焦软镜对比', 
                 fontsize=16, fontweight='bold', color=COLORS['text'], pad=20)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#E0E0E0')
    ax.spines['bottom'].set_color('#E0E0E0')
    ax.set_ylim(0, 0.45)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '07_文献基准对比.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表7: 文献基准对比图 已生成")


# ==================== 图表8: 研究概况信息图 ====================
def chart_study_overview():
    """研究概况 - 信息卡片图"""
    fig, ax = plt.subplots(figsize=(12, 6), facecolor='white')
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 6)
    ax.axis('off')
    
    cards = [
        {'pos': (1.5, 4.5), 'value': '11人', 'label': '有效样本', 'sub': '22眼', 'color': COLORS['primary']},
        {'pos': (4.5, 4.5), 'value': '男5/女6', 'label': '性别比', 'sub': '', 'color': COLORS['secondary']},
        {'pos': (7.5, 4.5), 'value': '10.5岁', 'label': '平均年龄', 'sub': '±1.7岁 (8~12)', 'color': COLORS['primary']},
        {'pos': (10.5, 4.5), 'value': '-3.03D', 'label': '基线SER', 'sub': '±1.33D', 'color': COLORS['secondary']},
        {'pos': (1.5, 2), 'value': '24.47mm', 'label': '基线眼轴', 'sub': '±0.93mm', 'color': COLORS['primary']},
        {'pos': (4.5, 2), 'value': '77%', 'label': '视力≥5.0', 'sub': '17/22眼', 'color': COLORS['success']},
        {'pos': (7.5, 2), 'value': '9.26分', 'label': '6月满意度', 'sub': '满分10分', 'color': COLORS['success']},
        {'pos': (10.5, 2), 'value': '64%', 'label': '良好控制', 'sub': 'AL≤0.10mm', 'color': COLORS['success']},
    ]
    
    for card in cards:
        x, y = card['pos']
        color = card['color']
        
        # 卡片背景
        rect = FancyBboxPatch((x-1.3, y-0.8), 2.6, 1.6,
                              boxstyle="round,pad=0.1",
                              facecolor=color, alpha=0.1,
                              edgecolor=color, linewidth=2)
        ax.add_patch(rect)
        
        # 数值
        ax.text(x, y+0.2, card['value'], ha='center', va='center',
                fontsize=20, fontweight='bold', color=color)
        
        # 标签
        ax.text(x, y-0.2, card['label'], ha='center', va='center',
                fontsize=11, fontweight='bold', color=COLORS['text'])
        
        # 子信息
        if card['sub']:
            ax.text(x, y-0.5, card['sub'], ha='center', va='center',
                    fontsize=9, color=COLORS['neutral'])
    
    ax.set_title('研究概况概览', fontsize=18, fontweight='bold', 
                 color=COLORS['text'], pad=20, y=1.02)
    
    add_watermark(ax)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '08_研究概况.png'), 
                bbox_inches='tight', facecolor='white')
    plt.close()
    print("[OK] 图表8: 研究概况信息图 已生成")


# ==================== 主程序 ====================
if __name__ == '__main__':
    print("=" * 50)
    print("离焦RGP 6个月临床数据 - PPT图表生成")
    print("=" * 50)
    
    chart_study_overview()      # 图表8: 研究概况
    chart_al_trend()            # 图表1: 眼轴增长趋势
    chart_ser_distribution()    # 图表2: SER变化分类
    chart_age_subgroup()        # 图表3: 年龄分层
    chart_ser_subgroup()        # 图表4: 屈光度分层
    chart_control_rate()        # 图表5: 疗效控制率
    chart_satisfaction()        # 图表6: 满意度趋势
    chart_literature_comparison() # 图表7: 文献基准对比
    
    print("=" * 50)
    print(f"所有图表已保存至: {OUTPUT_DIR}")
    print("=" * 50)
