
import React from 'react';
import { PatientData } from '../types';

interface DataEntryProps {
  data: PatientData;
  onChange: (data: Partial<PatientData>) => void;
}

const DataEntry: React.FC<DataEntryProps> = ({ data, onChange }) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'number' ? parseFloat(value) : value;
    onChange({ [name]: val });
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [e.target.name]: e.target.checked });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
      {/* Basic Info */}
      <section className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-400 mb-6 uppercase tracking-widest flex items-center">
          <span className="w-1 h-4 bg-blue-600 mr-2 rounded"></span>
          患者基本信息与遗传背景
        </h3>
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">姓名</label>
            <input name="name" value={data.name} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2">年龄 (岁)</label>
              <input type="number" name="age" value={data.age} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2">性别</label>
              <select name="gender" value={data.gender} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none">
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">父母近视情况</label>
            <select name="parentalMyopia" value={data.parentalMyopia} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none">
              <option value="none">无近视</option>
              <option value="one">单方近视</option>
              <option value="both">双方近视</option>
            </select>
          </div>
          <label className="flex items-center space-x-3 cursor-pointer p-2 bg-slate-50 rounded border border-slate-100">
            <input type="checkbox" name="parentalHighMyopia" checked={data.parentalHighMyopia} onChange={handleCheckboxChange} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
            <span className="text-sm text-slate-700">父母存在高度近视 (≥ -6.00D)</span>
          </label>
        </div>
      </section>

      {/* Behavioral & Environment */}
      <section className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-400 mb-6 uppercase tracking-widest flex items-center">
          <span className="w-1 h-4 bg-orange-600 mr-2 rounded"></span>
          行为与环境负荷
        </h3>
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">每日有效户外时长 (小时)</label>
            <input type="number" name="outdoorTime" value={data.outdoorTime} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">每日近距离用眼时长 (小时)</label>
            <input type="number" name="nearWorkTime" value={data.nearWorkTime} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">阅读/写字距离 (cm)</label>
            <input type="number" name="readingDistance" value={data.readingDistance} onChange={handleInputChange} className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
        </div>
      </section>

      {/* Physiological metrics */}
      <section className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm md:col-span-2">
        <h3 className="text-sm font-bold text-slate-400 mb-6 uppercase tracking-widest flex items-center">
          <span className="w-1 h-4 bg-emerald-600 mr-2 rounded"></span>
          生理与解剖指标 (Biometrics)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">等效球镜 (D)</label>
            <input type="number" step="0.25" name="sphericalEquivalent" value={data.sphericalEquivalent} onChange={handleInputChange} placeholder="-2.50" className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">眼轴长度 AL (mm)</label>
            <input type="number" step="0.01" name="axialLength" value={data.axialLength} onChange={handleInputChange} placeholder="24.50" className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">平均角膜曲率 (D)</label>
            <input type="number" step="0.1" name="cornealCurvature" value={data.cornealCurvature} onChange={handleInputChange} placeholder="43.0" className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">年度眼轴增长 (mm/yr)</label>
            <input type="number" step="0.01" name="alGrowthLastYear" value={data.alGrowthLastYear} onChange={handleInputChange} placeholder="0.35" className="w-full bg-slate-50 border-slate-200 rounded-md py-2 px-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
          </div>
        </div>
      </section>
    </div>
  );
};

export default DataEntry;
