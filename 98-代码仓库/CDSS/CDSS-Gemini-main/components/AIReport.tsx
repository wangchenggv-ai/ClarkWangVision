
import React, { useState, useEffect } from 'react';
import { ShieldCheck, FileText, Share2, Download, CheckCircle2, Loader2, UserCheck } from 'lucide-react';
import { Patient, Visit } from '../types';
import { generateClinicalAdvice } from '../services/geminiService';

interface AIReportProps {
  patient: Patient;
  visit: Visit;
  onDone: () => void;
}

const AIReport: React.FC<AIReportProps> = ({ patient, visit, onDone }) => {
  const [isGenerating, setIsGenerating] = useState(true);
  const [advice, setAdvice] = useState('');
  const [isApproved, setIsApproved] = useState(false);

  useEffect(() => {
    async function fetchAdvice() {
      const result = await generateClinicalAdvice(patient, visit);
      setAdvice(result);
      setIsGenerating(false);
    }
    fetchAdvice();
  }, [patient, visit]);

  const handleApprove = () => {
    setIsApproved(true);
    // In a real app, update DB here
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="bg-white rounded-3xl shadow-2xl border-t-8 border-blue-600 overflow-hidden">
        {/* Report Header */}
        <div className="p-10 border-b flex justify-between items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg text-white">
                <FileText size={24} />
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">近视管理临床分析报告</h1>
            </div>
            <div className="flex items-center gap-6 text-sm font-medium text-slate-500">
              <p>ID: #GAO-{visit.id.slice(0, 8).toUpperCase()}</p>
              <p>日期: {new Date(visit.date).toLocaleDateString()}</p>
              <p>主诊: Dr. Clark</p>
            </div>
          </div>
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-300 font-bold">
            Clinic Logo
          </div>
        </div>

        {/* AI Content */}
        <div className="p-10 space-y-10">
          <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100 relative">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
              AI 专家综述 (拟人化建议)
            </h3>
            
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-10 gap-4">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <p className="text-sm text-gray-500 font-medium">正在基于 20,000+ 临床案例生成个性化建议...</p>
              </div>
            ) : (
              <p className="text-gray-700 leading-loose text-lg whitespace-pre-line font-medium italic">
                {advice}
              </p>
            )}
            
            <div className="absolute -bottom-4 right-8 bg-slate-900 text-white px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-400" /> 经高视星医学大模型验证
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                <span className="w-1 h-4 bg-blue-600"></span> 关键临床指征
              </h4>
              <ul className="space-y-3">
                <li className="flex justify-between text-sm py-2 border-b">
                  <span className="text-gray-500">眼轴长度 (OD/OS)</span>
                  <span className="font-bold">{visit.clinicalData.axialLengthOD} / {visit.clinicalData.axialLengthOS} mm</span>
                </li>
                <li className="flex justify-between text-sm py-2 border-b">
                  <span className="text-gray-500">调节滞后 BCC</span>
                  <span className="font-bold text-red-600">+{visit.clinicalData.bcc} D</span>
                </li>
                <li className="flex justify-between text-sm py-2 border-b">
                  <span className="text-gray-500">遗传风险因素</span>
                  <span className="font-bold text-orange-600">双方高度近视</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-blue-50 p-6 rounded-2xl flex flex-col items-center justify-center text-center space-y-4 border-2 border-blue-100">
              <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">最终推荐方案</p>
              <h2 className="text-2xl font-black text-blue-900">{visit.recommendedProduct}</h2>
              <div className="w-full h-px bg-blue-200"></div>
              <p className="text-xs text-blue-800 font-medium italic">预计有效延缓眼轴增长率 55% - 68%</p>
            </div>
          </div>
        </div>

        {/* Doctor Approval Footer */}
        <div className="bg-slate-50 px-10 py-8 border-t flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-full transition-colors ${isApproved ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>
              <UserCheck size={28} />
            </div>
            <div>
              <p className="font-bold text-slate-800">医师责任核准</p>
              <p className="text-xs text-slate-500">点击核准代表已审阅数据并确认方案责任</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {!isApproved ? (
              <button 
                onClick={handleApprove}
                className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-4 rounded-xl font-bold transition-all flex items-center gap-2 shadow-xl active:scale-95"
              >
                <CheckCircle2 size={20} /> 核准当前决策
              </button>
            ) : (
              <>
                <button className="p-4 border border-slate-300 rounded-xl hover:bg-white transition">
                  <Download size={20} />
                </button>
                <button className="p-4 border border-slate-300 rounded-xl hover:bg-white transition">
                  <Share2 size={20} />
                </button>
                <button 
                  onClick={onDone}
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 transition"
                >
                  完成并返回列表
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIReport;
