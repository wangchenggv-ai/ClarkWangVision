
import React from 'react';

const ProductManual: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-16 py-10 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* Cover Section */}
      <section className="bg-slate-900 text-white rounded-[4rem] p-16 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-blue-600/20 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="inline-block px-4 py-1.5 bg-blue-600 rounded-full text-[10px] font-black tracking-[0.3em] uppercase mb-8">
            Internal Technical Manual
          </div>
          <h1 className="text-6xl font-black serif-title italic tracking-tighter mb-6">
            高视星 (Gaoshi Xing) <br />
            <span className="text-blue-400">临床决策支持系统 V1.0</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl font-medium leading-relaxed italic">
            深度集成真实世界研究 (RWS) 数据库，为全球视光师提供精准的数字化近视管理闭环。
          </p>
          <div className="mt-12 flex items-center space-x-12 border-t border-white/10 pt-12">
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Release Version</p>
              <p className="text-lg font-black italic">Alpha 1.0.4</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Clinic Certified</p>
              <p className="text-lg font-black italic text-emerald-400">Level IV Ready</p>
            </div>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="space-y-6 p-10 bg-white rounded-[3rem] border border-slate-100">
          <h3 className="text-2xl font-black serif-title italic text-slate-900 uppercase">三维风险模型 (3D Model)</h3>
          <p className="text-sm text-slate-500 leading-relaxed italic">
            高视星不只看度数，更关注“遗传基因、用眼环境、生理轨迹”的动态博弈。我们的算法基于《近视防控白皮书》，通过 24 个临床维度构建高精度的进展预测曲线。
          </p>
          <ul className="space-y-4 pt-4">
            {[
              { t: '遗传基线', d: '对父母近视史进行多项加权评估' },
              { t: '用眼负荷', d: '实时监测户外光照与近距离用眼比例' },
              { t: '生物测量', d: '眼轴(AL)增长速率与角膜曲率的深度对数分析' }
            ].map((item, i) => (
              <li key={i} className="flex items-start space-x-4">
                <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-black italic text-[10px] shrink-0 border border-blue-100">
                  {i+1}
                </div>
                <div>
                  <h5 className="text-xs font-black text-slate-800 uppercase">{item.t}</h5>
                  <p className="text-[11px] text-slate-400 italic font-medium">{item.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="bg-slate-50 rounded-[3rem] p-10 flex flex-col justify-center border border-slate-100">
          <div className="mb-8">
            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">SOP Standard</span>
            <h3 className="text-2xl font-black serif-title italic text-slate-900 mt-2">标准化“3-6-9-12”随访</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed italic mb-8">
            干预方案的有效性取决于“过程管理”。高视星强制集成的 SOP 复诊路径，确保每 90 天对干预方案进行一次有效性校准。
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 mb-1">临床有效率提升</p>
              <p className="text-2xl font-black italic text-blue-600">+22.4%</p>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 mb-1">年度眼轴节省量</p>
              <p className="text-2xl font-black italic text-emerald-600">0.24mm</p>
            </div>
          </div>
        </div>
      </div>

      {/* Product Showcase */}
      <section className="space-y-10">
        <h3 className="text-3xl font-black serif-title italic text-slate-900 text-center uppercase tracking-tighter">
          高视星家族产品矩阵 (Product Portfolio)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              id: 'Ultra',
              desc: '高权重离焦技术，针对轴性快速增长与高风险遗传人群。',
              eff: '67.4%',
              color: 'bg-slate-900',
              accent: 'text-blue-400'
            },
            {
              id: '时空之眼',
              desc: '平衡离焦方案，适用于中低度近视、进展相对平稳的患儿。',
              eff: '58.2%',
              color: 'bg-blue-600',
              accent: 'text-white'
            },
            {
              id: '小旋风',
              desc: '轻量化预防技术，针对近视前期、远视储备不足的保护方案。',
              eff: '32.5%',
              color: 'bg-emerald-600',
              accent: 'text-white'
            }
          ].map((p, i) => (
            <div key={i} className={`${p.color} p-10 rounded-[3.5rem] text-white shadow-xl relative overflow-hidden`}>
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/5 rounded-full blur-3xl" />
              <h4 className="text-3xl font-black serif-title mb-4 italic">{p.id}</h4>
              <p className="text-xs text-white/70 leading-relaxed font-medium mb-10 h-16">{p.desc}</p>
              <div className="pt-6 border-t border-white/10 flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-bold uppercase opacity-60">有效率</p>
                  <p className={`text-3xl font-black italic ${p.accent}`}>{p.eff}</p>
                </div>
                <div className="bg-white/10 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest">Clinical Grade</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer / Copyright */}
      <footer className="pt-20 border-t border-slate-200 text-center pb-10">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mb-4">Gaoshi Xing Optical Engineering</p>
        <p className="text-xs text-slate-500 font-medium italic italic">
          AI是副驾，人才是主驾。本手册仅供临床医生参考使用。
        </p>
        <p className="text-[9px] text-slate-300 mt-2 font-mono">© 2025 Gaoshi Xing CDSS Enterprise Edition v1.0.0</p>
      </footer>
    </div>
  );
};

export default ProductManual;
