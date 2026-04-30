
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { PatientData, AnalysisResult, RiskLevel } from '../types';
import { RWS_EVIDENCE, COLORS, CLINICAL_PATHWAY } from '../constants';

interface ClinicalAnalysisProps {
  data: PatientData;
  result: AnalysisResult;
}

const ClinicalAnalysis: React.FC<ClinicalAnalysisProps> = ({ data, result }) => {
  const radarData = [
    { subject: '遗传风险', A: result.geneticRisk === RiskLevel.HIGH ? 100 : result.geneticRisk === RiskLevel.MEDIUM ? 60 : 30 },
    { subject: '环境负荷', A: result.environmentalRisk === RiskLevel.HIGH ? 100 : result.environmentalRisk === RiskLevel.MEDIUM ? 60 : 30 },
    { subject: '眼轴增长', A: data.alGrowthLastYear > 0.35 ? 100 : data.alGrowthLastYear > 0.2 ? 60 : 20 },
    { subject: '度数基数', A: Math.abs(data.sphericalEquivalent) > 4 ? 100 : Math.abs(data.sphericalEquivalent) > 2 ? 60 : 30 },
    { subject: '户外时间', A: data.outdoorTime < 1 ? 100 : data.outdoorTime < 2 ? 60 : 20 },
  ];

  const getTrafficLight = (level: RiskLevel) => {
    const config = {
      [RiskLevel.HIGH]: { color: COLORS.riskHigh, label: '高进展风险', bg: 'bg-red-50' },
      [RiskLevel.MEDIUM]: { color: COLORS.riskMedium, label: '中等进展风险', bg: 'bg-amber-50' },
      [RiskLevel.LOW]: { color: COLORS.riskLow, label: '低进展风险', bg: 'bg-emerald-50' },
    };
    const { color, label, bg } = config[level];
    return (
      <div className={`flex items-center space-x-3 p-3 rounded-lg border border-slate-100 ${bg}`}>
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }}></span>
          <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: color }}></span>
        </div>
        <span className="text-xs font-bold" style={{ color: color }}>{label}</span>
      </div>
    );
  };

  // Icon Components
  const GeneticIcon = () => (
    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  );

  const EnvironmentalIcon = () => (
    <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  );

  const PhysiologicalIcon = () => (
    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );

  return (
    <div className="space-y-8">
      {/* Risk Metrics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Radar Map */}
        <div className="lg:col-span-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-xs font-bold text-slate-500 mb-6 uppercase tracking-widest">综合评估模型</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: '#64748b' }} />
                <Radar dataKey="A" stroke={COLORS.brandBlue} fill={COLORS.brandBlue} fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 text-center">
            <p className="text-[10px] text-slate-400 uppercase font-bold">综合风险评分</p>
            <p className="text-3xl font-black text-slate-800 tracking-tighter">{result.progressionScore}<span className="text-sm font-normal text-slate-400">/100</span></p>
          </div>
        </div>

        {/* Traffic Lights Details with Icons */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase">遗传基线评估</p>
              <GeneticIcon />
            </div>
            {getTrafficLight(result.geneticRisk)}
            <div className="flex items-start space-x-2">
              <svg className="w-3 h-3 text-blue-300 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
              <p className="text-[10px] text-slate-500 leading-relaxed italic">{RWS_EVIDENCE.genetic[0].content}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase">行为习惯评估</p>
              <EnvironmentalIcon />
            </div>
            {getTrafficLight(result.environmentalRisk)}
            <div className="flex items-start space-x-2">
              <svg className="w-3 h-3 text-orange-300 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <p className="text-[10px] text-slate-500 leading-relaxed italic">{RWS_EVIDENCE.environmental[0].content}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase">生理指标监测</p>
              <PhysiologicalIcon />
            </div>
            {getTrafficLight(result.physiologicalRisk)}
            <div className="flex items-start space-x-2">
              <svg className="w-3 h-3 text-emerald-300 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>
              <p className="text-[10px] text-slate-500 leading-relaxed italic">{RWS_EVIDENCE.physiological[0].content}</p>
            </div>
          </div>
        </div>
      </div>

      {/* RWS Evidence Insights Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-xs font-bold text-slate-500 mb-6 uppercase tracking-widest flex items-center">
          <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
          真实世界研究 (RWS) 循证依据
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 flex items-start space-x-3">
              <div className="bg-blue-100 p-2 rounded flex-shrink-0"><GeneticIcon /></div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400">GENETIC BASELINE</p>
                <p className="text-[11px] text-slate-600 leading-tight">基于《白皮书》，父母近视是首要遗传预警指标。</p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 flex items-start space-x-3">
              <div className="bg-orange-100 p-2 rounded flex-shrink-0"><EnvironmentalIcon /></div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400">ENVIRONMENTAL LOAD</p>
                <p className="text-[11px] text-slate-600 leading-tight">BHVI数据显示户外2h/天是视网膜光生长的关键动力。</p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 flex items-start space-x-3">
              <div className="bg-emerald-100 p-2 rounded flex-shrink-0"><PhysiologicalIcon /></div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-400">PHYSIOLOGICAL TREND</p>
                <p className="text-[11px] text-slate-600 leading-tight">Tideman研究确认眼轴增长速率是评估防控效果的金标准。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostic Pathway according to White Paper */}
      <div className="bg-slate-900 rounded-xl p-8 shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <h3 className="text-white font-bold mb-8 flex items-center serif-title tracking-widest uppercase">
            依据《近视防控白皮书》的诊疗路径分析
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
            <div className="hidden md:block absolute top-12 left-0 w-full h-0.5 bg-slate-800 -z-10"></div>
            
            {Object.entries(CLINICAL_PATHWAY).map(([key, val], idx) => {
              const isRecommended = (result.progressionScore > 70 && key === 'medical') ||
                                  (result.progressionScore > 40 && result.progressionScore <= 70 && key === 'control') ||
                                  (result.progressionScore > 20 && result.progressionScore <= 40 && key === 'prevention') ||
                                  (result.progressionScore <= 20 && key === 'observation');
              
              return (
                <div key={key} className={`p-5 rounded-lg border transition-all ${
                  isRecommended ? 'bg-blue-600 border-blue-400 scale-105 shadow-xl shadow-blue-900/40' : 'bg-slate-800 border-slate-700 opacity-40'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded text-white uppercase">Phase {idx+1}</span>
                    {isRecommended && <span className="bg-white text-blue-600 text-[8px] px-1.5 py-0.5 rounded font-black">当前推荐</span>}
                  </div>
                  <h4 className="text-sm font-bold text-white mb-2">{val.title}</h4>
                  <p className="text-[10px] text-blue-100/70 mb-3">{val.criteria}</p>
                  <p className="text-[11px] text-white leading-relaxed">{val.action}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="absolute bottom-0 right-0 p-4 opacity-5 pointer-events-none">
          <svg className="w-48 h-48 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20Z"/></svg>
        </div>
      </div>
    </div>
  );
};

export default ClinicalAnalysis;
