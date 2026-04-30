
import React from 'react';
import { APP_DISCLAIMER } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
  const tabs = [
    { id: 'data', label: '基础数据录入', icon: '📝' },
    { id: 'analysis', label: '临床风险评估', icon: '🔬' },
    { id: 'education', label: '患者教育模块', icon: '👁️' },
    { id: 'report', label: '临床报告预览', icon: '📄' },
    { id: 'solutions', label: '精准干预方案', icon: '🎯' },
    { id: 'manual', label: '系统产品手册', icon: '📘' },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-80 bg-slate-950 text-white flex flex-col shadow-2xl z-20">
        <div className="p-10 border-b border-white/5">
          <h1 className="text-3xl font-black serif-title tracking-tighter text-blue-400 italic">高视星</h1>
          <div className="flex items-center space-x-2 mt-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Expert CDSS</span>
            <span className="bg-blue-600 text-[8px] px-1.5 py-0.5 rounded font-black text-white">V1.0.0</span>
          </div>
        </div>
        
        <nav className="flex-1 mt-8 px-6 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`w-full text-left px-5 py-4 rounded-2xl transition-all mb-3 flex items-center group ${
                activeTab === tab.id 
                  ? 'bg-blue-600 text-white shadow-2xl shadow-blue-600/30' 
                  : 'text-slate-500 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="text-xl mr-4 opacity-70 group-hover:scale-110 transition-transform">{tab.icon}</span>
              <span className="font-bold text-sm tracking-tight">{tab.label}</span>
              {activeTab === tab.id && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-8 border-t border-white/5">
          <div className="bg-white/5 p-4 rounded-2xl text-[10px] text-slate-400 leading-relaxed italic font-medium">
            <span className="text-slate-300 font-bold block mb-1 uppercase tracking-widest">Clinical Disclaimer</span>
            {APP_DISCLAIMER}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative bg-[#fcfdfe]">
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-12 py-5 flex justify-between items-center no-print">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
               <span className="text-slate-400 font-black text-[10px] tracking-widest uppercase">System Online</span>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-tighter serif-title italic">
              {tabs.find(t => t.id === activeTab)?.label}
            </h2>
          </div>
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Authorized Specialist</p>
              <p className="text-sm font-black text-slate-900 tracking-tight italic">Zhang Shiying, M.D.</p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white text-xs font-black border border-white/10 shadow-lg">ZS</div>
          </div>
        </header>

        <div className="p-12 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
