
import React, { useState } from 'react';
import { Report, RiskLevel } from '../types';
import { APP_DISCLAIMER } from '../constants';
import { generateExpertOpinion } from '../services/geminiService';

interface ReportPreviewProps {
  report: Report;
}

const ReportPreview: React.FC<ReportPreviewProps> = ({ report }) => {
  const [aiOpinion, setAiOpinion] = useState<string>(report.expertOpinion);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchAiInsight = async () => {
    setIsGenerating(true);
    const opinion = await generateExpertOpinion(report.patient);
    setAiOpinion(opinion);
    setIsGenerating(false);
  };

  return (
    <div className="bg-slate-200 p-10 min-h-screen flex justify-center no-print-bg">
      {/* Paper Style */}
      <div className="w-[840px] bg-white shadow-2xl p-14 flex flex-col relative overflow-hidden">
        {/* Hospital Branding Decor */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rotate-45 translate-x-16 -translate-y-16 pointer-events-none" />

        {/* Header */}
        <div className="border-b-2 border-slate-900 pb-8 mb-10 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black serif-title tracking-tighter text-slate-900 mb-1 italic">高视星近视临床分析报告</h1>
            <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">GAOSHI XING CLINICAL DECISION SUPPORT SYSTEM · V2.5 EXPERT EDITION</p>
          </div>
          <div className="text-right">
            <div className="bg-slate-900 text-white px-3 py-1 text-[10px] font-bold mb-1">MEDICAL CONFIDENTIAL</div>
            <p className="text-xs font-black">ID: {report.serialNumber}</p>
            <p className="text-[10px] text-slate-400 uppercase">生成时间: {report.timestamp}</p>
          </div>
        </div>

        {/* Patient Section */}
        <section className="mb-12">
          <div className="flex items-center space-x-2 mb-6">
            <h3 className="text-xs font-black bg-slate-100 border border-slate-200 text-slate-800 px-3 py-1 uppercase tracking-widest">Part I. 患者临床基线 (Clinical Baseline)</h3>
          </div>
          <div className="grid grid-cols-4 gap-y-6 gap-x-4 text-xs">
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">姓名:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.name}</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">年龄:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.age} 岁</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">性别:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.gender === 'male' ? '男' : '女'}</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">眼轴(AL):</span> <span className="font-bold text-slate-900 ml-2">{report.patient.axialLength} mm</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">等效球镜:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.sphericalEquivalent} D</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">户外时长:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.outdoorTime} h/d</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">用眼负荷:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.nearWorkTime} h/d</span></div>
            <div className="border-b border-slate-100 pb-2"><span className="text-slate-400 font-bold uppercase tracking-tighter">遗传等级:</span> <span className="font-bold text-slate-900 ml-2">{report.patient.parentalMyopia === 'both' ? '双方' : report.patient.parentalMyopia === 'one' ? '单方' : '无'}</span></div>
          </div>
        </section>

        {/* Analytics Section */}
        <section className="mb-12">
          <div className="flex items-center space-x-2 mb-6">
            <h3 className="text-xs font-black bg-slate-100 border border-slate-200 text-slate-800 px-3 py-1 uppercase tracking-widest">Part II. 临床风险评估总结 (Clinical Analytics)</h3>
          </div>
          <div className="grid grid-cols-2 gap-8 items-start">
            <div className="border border-slate-200 rounded p-6 bg-slate-50/30">
               <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black text-slate-400 uppercase">综合进展评分</span>
                  <span className="text-2xl font-black text-slate-900 tracking-tighter">{report.analysis.progressionScore}<span className="text-xs font-normal">/100</span></span>
               </div>
               <div className="space-y-3">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">遗传基线</span>
                    <span className={`font-bold ${report.analysis.geneticRisk === RiskLevel.HIGH ? 'text-red-600' : 'text-slate-800'}`}>{report.analysis.geneticRisk}</span>
                  </div>
                  <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                    <div className="bg-slate-900 h-full" style={{ width: `${report.analysis.progressionScore}%` }} />
                  </div>
               </div>
            </div>
            <div className="text-xs space-y-3">
               <p className="leading-relaxed text-slate-700 italic border-l-2 border-slate-300 pl-4 py-1">
                  该患者在不进行医疗干预的情况下，18岁预计等效球镜将达到 <span className="font-bold text-slate-900 underline">{report.analysis.prediction18yo.toFixed(2)}D</span>。
                  当前生理指标偏差呈现<span className="font-bold text-red-600 ml-1">{report.analysis.physiologicalRisk === 'HIGH' ? '显著扩张' : '持续增长'}</span>趋势。
               </p>
            </div>
          </div>
        </section>

        {/* Expert Recommendation */}
        <section className="mb-12 flex-1">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-black bg-slate-100 border border-slate-200 text-slate-800 px-3 py-1 uppercase tracking-widest">Part III. 临床干预建议 (Clinical Decision)</h3>
            {!aiOpinion && !isGenerating && (
              <button 
                onClick={fetchAiInsight}
                className="text-[10px] bg-blue-600 text-white font-black py-1.5 px-5 rounded-lg shadow-xl hover:bg-blue-700 transition-all no-print flex items-center space-x-2 active:scale-95"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                <span>基于本中心的大数据防控结果分析</span>
              </button>
            )}
          </div>
          <div className="bg-slate-50/50 p-8 rounded-lg border border-slate-200 min-h-[180px] relative">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] text-slate-400 font-bold uppercase animate-pulse">正在调取云端临床模型...</p>
              </div>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-slate-800 serif-title whitespace-pre-line">
                  {aiOpinion || "请点击上方按钮生成基于本中心大数据的深度临床决策分析报告。"}
                </p>
                <div className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-end">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold mb-1 uppercase tracking-[0.2em]">建议干预等级</p>
                    <p className="text-xl font-black text-slate-900 tracking-tighter">
                      {report.analysis.interventionRecommendation === 'Ultra' ? '深度医疗干预 (Level IV)' : 
                       report.analysis.interventionRecommendation === '时空之眼' ? '强化控制方案 (Level III)' : '早期/预防干预 (Level I/II)'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="h-14 w-40 border border-dashed border-slate-300 rounded flex items-center justify-center text-[8px] text-slate-300 font-mono italic">
                      VALIDATION SIGNATURE AREA
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Footer */}
        <div className="mt-auto pt-8 border-t border-slate-100 text-[10px] text-slate-400 flex justify-between items-center italic">
          <p>{APP_DISCLAIMER}</p>
          <div className="flex items-center space-x-1">
             <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
             <p className="font-bold uppercase tracking-widest">Validated by Gaoshi Xing Engine</p>
          </div>
        </div>
      </div>
      
      {/* Floating Buttons */}
      <div className="fixed bottom-10 right-10 flex flex-col space-y-4 no-print">
        <button 
          onClick={() => window.print()}
          className="bg-slate-900 text-white px-8 py-4 rounded-full shadow-2xl hover:bg-slate-800 transition-all flex items-center space-x-3 font-bold active:scale-95"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
          <span className="uppercase tracking-widest text-xs">Print Final Report</span>
        </button>
      </div>
    </div>
  );
};

export default ReportPreview;
