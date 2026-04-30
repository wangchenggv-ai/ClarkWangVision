# 高视星近视管理临床决策支持系统 (CDSS)

<p align="center">
  <img src="https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Vite-5.0-646CFF?style=flat-square&logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/TailwindCSS-3.3-06B6D4?style=flat-square&logo=tailwindcss" alt="TailwindCSS">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

> **Gaoshixing Myopia Management Clinical Decision Support System**
>
> 循证医学为根，AI算法为辅，商业转化为果。

## 📋 项目简介

高视星CDSS是一套闭环的"医疗级销售与诊疗系统"，旨在：

- 🎯 通过北大眼科学术背景赋能B端医生
- 🏥 解决新品牌信任难题
- 📈 实现从"卖镜片"到"卖全周期管理方案"的战略转型

## ✨ 核心功能

### 模块一：标准化数据采集
- 医学验配参数（单眼瞳距、瞳高、顶点距离）
- 双眼视功能指标（BCC、AC/A、PRA）
- 遗传与环境风险评估

### 模块二：算法驱动的干预决策
基于决策权重矩阵的智能推荐：

| 评估维度 | 触发条件 | 权重 |
|---------|---------|------|
| 进展速度 | AL增长 > 0.15mm/半年 | 40% |
| 调节能力 | BCC > +0.75D | 25% |
| 遗传背景 | 父母双方均 > 600D | 15% |
| 视功能 | 高AC/A伴内隐斜 | 10% |

### 模块三：复诊依从性审计
- 偏差预警（Gap Analysis）
- 疗效审计红绿灯
- 智能升级路径建议

### 模块四：可视化信任背书
- 3D眼轴拉长模拟器
- 离焦原理动态演示
- 循证证据库（专利、文献、本院数据）

### 模块五：AI智能报告
- 医师核准机制
- 医疗级PDF报告生成
- 微信扫码分享

## 🚀 快速开始

### 环境要求
- Node.js >= 18.0
- npm >= 9.0

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```

## 🛠 技术栈

- **前端框架**: React 18
- **构建工具**: Vite 5
- **样式方案**: TailwindCSS 3
- **图表库**: Recharts
- **图标库**: Lucide React

## 📁 项目结构

```
gaoshixing-cdss/
├── src/
│   ├── App.jsx          # 主应用组件
│   ├── main.jsx         # 入口文件
│   └── index.css        # 全局样式
├── index.html           # HTML模板
├── package.json         # 项目配置
├── vite.config.js       # Vite配置
├── tailwind.config.js   # Tailwind配置
└── postcss.config.js    # PostCSS配置
```

## 📖 产品SKU推荐逻辑

| 产品 | 设计特点 | 适用场景 | 算法触发条件 |
|-----|---------|---------|-------------|
| 小旋风 | 入门级离焦 | 远视储备下降、低风险预防 | 权重得分 < 30 |
| 时空之眼 | 标准离焦 | 初发近视、中等风险 | 权重得分 30-60 |
| Ultra系列 | 点扩散强效离焦 | 高风险、AL暴涨、BCC滞后 | 权重得分 > 60 或 BCC > +0.75D |

## ⚠️ 免责声明

> **AI是副驾，人才是主驾。**
>
> 本系统由高视星临床决策支持模型提供分析建议，具体诊断需经执业视光师核准。

## 📄 License

MIT License © 2026 高视星医疗

---

<p align="center">
  <strong>人是主驾，AI是副驾。</strong>
</p>
