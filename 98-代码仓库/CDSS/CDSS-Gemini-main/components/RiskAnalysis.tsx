
import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ArrowRight, Info, TrendingUp, ShieldAlert } from 'lucide-react';
import { Patient, Visit } from '../types';

interface RiskAnalysisProps {
  patient: Patient;
  visit: Visit;
  onNext: () => void;
  onBack: () => void;
}

const RiskAnalysis: React.FC<RiskAnalysisProps> = ({ patient, visit, onNext, onBack }) => {
  const radarData = [
    { subject: '遗传风险', A: Math.abs(patient.fatherDiopter + patient.motherDiopter) / 12 * 100, fullMark: 100 },
    { subject: '环境负荷', A: (patient.screenHours / 8) * 100, fullMark: 100 },
    { subject: '生理现状', A: (visit.clinicalData.axialLengthOD / 28) * 100, fullMark: 100 },
    { subject: '视功能压力', A: (visit.clinicalData.bcc / 2.0) * 100, fullMark: 100 },
    { subject: '进展速度', A: 40, fullMark: 100 }, // Estimated
  ];

  const growthData = [
    { age: 6, normal: 22.5, patient: 22.8 },
    { age: 7, normal: 22.8, patient: 23.2 },
    { age: 8, normal: 23.1, patient: 23.6 },
    { age: 9, normal: 23.4, patient: 24.1 },
    { age: 10, normal: 23.7, patient: visit.clinicalData.axialLengthOD },
    { age: 11, normal: 24.0, patient: null },
    { age: 12, normal: 24.3, patient: null },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Radar Chart */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <TrendingUp size={20} className="text-blue-600" />
            4D 近视风险雷达图
          </h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Radar
                  name="Risk Profile"
                  dataKey="A"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.4}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 p-4 bg-blue-50 rounded-xl flex items-start gap-3">
            <Info size={18} className="text-blue-500 mt-1" />
            <p className="text-sm text-blue-800 leading-relaxed">
              <span className="font-bold">评估结论:</span> 遗传风险较高且视功能调节滞后(BCC: +{visit.clinicalData.bcc}D)，眼轴增长动力强，处于高危预警状态。
            </p>
          </div>
        </div>

        {/* Growth Curve */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <ShieldAlert size={20} className="text-red-500" />
            双重生长曲线对标
          </h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="age" label={{ value: '年龄 (岁)', position: 'insideBottom', offset: -5 }} />
                <YAxis domain={['auto', 'auto']} label={{ value: '眼轴 (mm)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Line 
                  name="全国同龄均值" 
                  type="monotone" 
                  dataKey="normal" 
                  stroke="#9ca3af" 
                  strokeDasharray="5 5" 
                  dot={false}
                />
                <Line 
                  name="患者实际轨迹" 
                  type="monotone" 
                  dataKey="patient" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  dot={{ r: 6, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-4 text-center text-sm font-bold text-gray-700">
            您的孩子眼轴发育超出同龄人 92%，预测 18 岁眼轴将达到 <span className="text-red-600">26.8mm</span>
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center bg-slate-900 p-6 rounded-2xl text-white">
        <div>
          <h4 className="text-lg font-bold">准备进入临床决策</h4>
          <p className="text-slate-400 text-sm">系统将根据多维权重为您推荐最优化管理方案</p>
        </div>
        <button 
          onClick={onNext}
          className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition active:scale-95"
        >
          查看智能推荐方案 <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
};

export default RiskAnalysis;
