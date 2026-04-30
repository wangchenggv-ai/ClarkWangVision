
import React from 'react';
import { AnalysisResult } from '../types';

interface ManagementSolutionsProps {
  result: AnalysisResult;
}

const ProductLensDiagram: React.FC<{ type: string; isRec: boolean }> = ({ type, isRec }) => {
  const accentColor = isRec ? '#60a5fa' : '#3b82f6';
  
  if (type === 'Ultra') {
    return (
      <svg viewBox="0 0 100 100" className="w-24 h-24 mb-6">
        <circle cx="50" cy="50" r="45" fill="none" stroke={accentColor} strokeWidth="0.5" strokeDasharray="1 2" />
        <circle cx="50" cy="50" r="10" fill={accentColor} fillOpacity="0.2" stroke={accentColor} strokeWidth="1" />
        {Array.from({ length: 12 }).map((_, i) => (
          <g key={i} transform={`rotate(${i * 30}, 50, 50)`}>
            <circle cx="50" cy="25" r="1.5" fill={accentColor} />
            <circle cx="50" cy="35" r="1.5" fill={accentColor} />
            <circle cx="42" cy="30" r="1.5" fill={accentColor} />
            <circle cx="58" cy="30" r="1.5" fill={accentColor} />
          </g>
        ))}
      </svg>
    );
  }
  
  if (type === '时空之眼') {
    return (
      <svg viewBox="0 0 100 100" className="w-24 h-24 mb-6">
        <circle cx="50" cy="50" r="10" fill={accentColor} fillOpacity="0.2" stroke={accentColor} strokeWidth="1" />
        <circle cx="50" cy="50" r="22" fill="none" stroke={accentColor} strokeWidth="2" strokeDasharray="4 2" />
        <circle cx="50" cy="50" r="35" fill="none" stroke={accentColor} strokeWidth="1.5" />
        <circle cx="50" cy="50" r="45" fill="none" stroke={accentColor} strokeWidth="0.5" strokeDasharray="2 2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={i} x1="50" y1="15" x2="50" y2="22" stroke={accentColor} strokeWidth="1" transform={`rotate(${i * 45}, 50, 50)`} />
        ))}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className="w-24 h-24 mb-6">
      <circle cx="50" cy="50" r="12" fill={accentColor} fillOpacity="0.2" stroke={accentColor} strokeWidth="1" />
      <path 
        d="M 50 10 A 40 40 0 0 1 90 50 A 40 40 0 0 1 50 90 A 40 40 0 0 1 10 50 A 40 40 0 0 1 50 10" 
        fill="none" 
        stroke={accentColor} 
        strokeWidth="2" 
        strokeDasharray="20 10"
      />
      <circle cx="50" cy="50" r="45" fill="none" stroke={accentColor} strokeWidth="0.5" opacity="0.3" />
    </svg>
  );
};

const ManagementSolutions: React.FC<ManagementSolutionsProps> = ({ result }) => {
  const products = [
    {
      id: 'Ultra',
      name: 'Ultra 高阶离焦',
      techName: 'H.D.O.S 高权重微透镜技术',
      expectedOutcome: '有效率 67.4%',
      rwsStats: { sample: 1200, centers: 15 },
      rwsFinding: '显著降低轴性快速增长案例风险。',
      rwsData: [
        { label: '3月平均增长', value: '0.03mm' },
        { label: '12月累积增长', value: '0.12mm' },
      ],
      color: 'bg-slate-900',
    },
    {
      id: '时空之眼',
      name: '时空之眼',
      techName: 'B.V.Z 平衡视野区段技术',
      expectedOutcome: '有效率 58.2%',
      rwsStats: { sample: 850, centers: 8 },
      rwsFinding: '常规近视人群中表现出极佳的稳定性。',
      rwsData: [
        { label: '3月平均增长', value: '0.05mm' },
        { label: '12月累积增长', value: '0.20mm' },
      ],
      color: 'bg-slate-800',
    },
    {
      id: '小旋风',
      name: '小旋风',
      techName: 'L.D.P 轻量离焦预防技术',
      expectedOutcome: '有效率 +32.5%',
      rwsStats: { sample: 2100, centers: 12 },
      rwsFinding: '有效推迟近视前期儿童的近视触发点。',
      rwsData: [
        { label: '3月平均增长', value: '0.08mm' },
        { label: '12月累积增长', value: '0.32mm' },
      ],
      color: 'bg-slate-700',
    }
  ];

  const commonFollowUp = [
    { m: '3个月', t: '戴镜适应性评估', desc: '检查镜片中心定位、舒适度及初步视觉质量。' },
    { m: '6个月', t: '关键生物测量', desc: '复查眼轴 (AL) 及角膜曲率，评估半年期控制率。' },
    { m: '9个月', t: '视功能动态监测', desc: '评估调节灵敏度及周边离焦量稳定性。' },
    { m: '12个月', t: '年度防控审计', desc: '计算年度眼轴总增长，判定方案延续或升级建议。' }
  ];

  const recommendedId = result.interventionRecommendation;

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      <header className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h3 className="text-2xl font-black text-slate-900 serif-title italic uppercase">临床精准干预决策 (Decision Analysis)</h3>
          <p className="text-xs text-slate-500 mt-1 font-medium italic">集成 RWS 循证医学证据与全周期随访管理的闭环决策系统</p>
        </div>
        <div className="flex bg-blue-600 px-6 py-3 rounded-2xl text-white shadow-lg items-center space-x-4">
           <div className="text-right">
             <p className="text-[8px] font-black uppercase opacity-70">Clinical Priority</p>
             <p className="text-lg font-black italic">{recommendedId}</p>
           </div>
           <div className="w-px h-8 bg-white/20" />
           <div className="text-xl">🎯</div>
        </div>
      </header>

      {/* 产品方案网格 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {products.map((product) => {
          const isRec = product.id === recommendedId;
          return (
            <div 
              key={product.id}
              className={`relative flex flex-col p-10 rounded-[3rem] border transition-all duration-700 ${
                isRec 
                  ? `${product.color} text-white ring-[16px] ring-blue-500/5 scale-105 z-10 shadow-2xl` 
                  : 'bg-white border-slate-100 opacity-60 grayscale hover:opacity-100 hover:grayscale-0'
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h4 className={`text-3xl font-black serif-title mb-1 tracking-tighter ${isRec ? 'text-white' : 'text-slate-900'}`}>{product.id}</h4>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${isRec ? 'opacity-60 text-blue-200' : 'text-slate-400'}`}>{product.techName}</p>
                </div>
                {isRec && <div className="bg-blue-500 text-[8px] px-2 py-0.5 rounded font-black uppercase">First Choice</div>}
              </div>

              <div className="flex justify-center">
                <ProductLensDiagram type={product.id} isRec={isRec} />
              </div>

              <div className={`mb-4 p-5 rounded-[2rem] ${isRec ? 'bg-white/5 border border-white/10' : 'bg-slate-50 border border-slate-100'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className={`text-[8px] font-black uppercase tracking-widest ${isRec ? 'text-blue-300' : 'text-slate-400'}`}>RWS 核心研究发现</span>
                    <p className={`text-[10px] mt-1 font-bold leading-tight ${isRec ? 'text-white' : 'text-slate-800'}`}>{product.rwsFinding}</p>
                  </div>
                  <div className={`shrink-0 px-2 py-1 rounded text-[7px] font-black ${isRec ? 'bg-blue-500/20 text-blue-200' : 'bg-slate-200 text-slate-500'}`}>
                    N={product.rwsStats.sample} | {product.rwsStats.centers} Centers
                  </div>
                </div>

                <div className="flex justify-between items-center mb-4 pt-2 border-t border-current border-opacity-10">
                  <span className={`text-[8px] font-black uppercase tracking-widest ${isRec ? 'text-blue-300' : 'text-slate-400'}`}>预期有效率</span>
                  <span className={`text-lg font-black italic ${isRec ? 'text-blue-400' : 'text-blue-600'}`}>{product.expectedOutcome}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {product.rwsData.map((d, i) => (
                    <div key={i} className={`p-2 rounded-xl ${isRec ? 'bg-white/10' : 'bg-white shadow-sm'}`}>
                      <p className="text-[7px] font-black uppercase text-slate-500">{d.label}</p>
                      <p className={`text-sm font-black italic ${isRec ? 'text-white' : 'text-slate-900'}`}>{d.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`pt-6 border-t ${isRec ? 'border-white/10' : 'border-slate-100'}`}>
                <p className={`text-[8px] leading-relaxed italic font-medium ${isRec ? 'text-slate-400' : 'text-slate-500'}`}>
                   * 基于高视星 2025 RWS 数据库，有效率受戴镜依从性及环境因素综合影响。
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 统一的 12 个月随访方案 */}
      <section className="bg-white p-12 rounded-[3rem] border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-start mb-10">
          <div>
            <h4 className="text-xl font-black serif-title italic text-slate-900 uppercase tracking-tight">12个月标准化临床随访路径 (SOP)</h4>
            <p className="text-[10px] text-slate-500 mt-1 font-medium italic">每 3 个月一次全项复查，确保防控方案始终处于最优状态</p>
          </div>
          <div className="mt-4 md:mt-0 bg-slate-900 text-white px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl">
            Protocol Version 2025.Q1
          </div>
        </div>

        <div className="relative">
          <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-slate-100 -translate-y-1/2 hidden md:block" />
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {commonFollowUp.map((step, i) => (
              <div key={i} className="relative z-10 flex flex-col items-center text-center p-6 bg-slate-50 rounded-[2rem] border border-slate-100 group hover:border-blue-200 hover:shadow-lg transition-all">
                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center justify-center text-blue-600 font-black italic mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  {step.m}
                </div>
                <h5 className="text-xs font-black text-slate-900 mb-2">{step.t}</h5>
                <p className="text-[10px] text-slate-500 leading-relaxed italic">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-slate-950 p-12 rounded-[3rem] flex flex-col md:flex-row items-center justify-between text-white shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 to-emerald-900/10 pointer-events-none" />
        <div className="flex items-center space-x-10 relative z-10">
           <div className="w-16 h-16 rounded-3xl bg-white/10 flex items-center justify-center text-3xl">🛡️</div>
           <div className="max-w-xl">
              <h4 className="text-2xl font-black serif-title italic tracking-tight">全生命周期防控守护</h4>
              <p className="text-xs text-slate-400 leading-relaxed font-medium italic">
                高视星专家系统强调“随访即干预”。临床证据显示，严格执行每3个月随访的患儿，其防控成功率较非规律随访组显著提升约 22.4%。
              </p>
           </div>
        </div>
        <div className="mt-8 md:mt-0 text-right relative z-10">
           <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Clinic Engine Active</div>
           <div className="text-2xl font-black italic text-emerald-400 uppercase tracking-tighter">Verified Protocol</div>
        </div>
      </footer>
    </div>
  );
};

export default ManagementSolutions;
