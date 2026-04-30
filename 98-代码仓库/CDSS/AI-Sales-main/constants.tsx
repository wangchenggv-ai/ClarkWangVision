
export const COLORS = {
  navy: '#002147',
  brandBlue: '#0a4da2',
  riskHigh: '#ef4444', // Red
  riskMedium: '#f59e0b', // Amber
  riskLow: '#10b981', // Green
  slate: '#64748b'
};

export const CLINICAL_PATHWAY = {
  observation: {
    title: "动态观察期",
    criteria: "远视储备充足或近视度数稳定 (<0.25D/年)",
    action: "建立视力发育档案，每6个月复查。"
  },
  prevention: {
    title: "早期干预方案",
    criteria: "远视储备不足或处于近视前期",
    action: "生活方式处方 + 增加户外活动 + 减少用眼负荷。"
  },
  control: {
    title: "强化控制方案",
    criteria: "近视增长速度 ≥ 0.50D/年 或眼轴增长速度 ≥ 0.2mm/年",
    action: "多焦光学矫正 + 可能的药物辅助（如低浓度阿托品）。"
  },
  medical: {
    title: "深度医疗干预",
    criteria: "高度近视倾向或轴性快速增长 (AL增长 > 0.35mm/年)",
    action: "高权重离焦技术 + 组合防控方案 + 视网膜安全性监测。"
  }
};

export const RWS_EVIDENCE = {
  genetic: [
    {
      source: "《中国近视临床白皮书》",
      content: "父母双方近视的儿童患病风险是无近视父母的 6.4 倍，遗传背景决定了近视防控的基线压力。"
    }
  ],
  environmental: [
    {
      source: "BHVI Real World Data",
      content: "每日户外活动 2 小时可产生多巴胺介导的光保护作用，降低约 30% 的近视发生风险。"
    }
  ],
  physiological: [
    {
      source: "Tideman et al. (2016)",
      content: "眼轴长度(AL)每增长 1mm，视网膜变薄风险增加 60%。"
    }
  ]
};

export const APP_DISCLAIMER = "AI是副驾，人才是主驾。本分析由高视星临床模型提供，具体诊断需经视光师核准。";
