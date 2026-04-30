
import React, { useState } from 'react';
// Added Search to the lucide-react imports
import { PlusCircle, User, Calendar, AlertTriangle, ChevronRight, Filter, Search } from 'lucide-react';
import { Patient, EfficacyRating } from '../types';

interface DashboardProps {
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onNewPatient: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ patients, onSelectPatient, onNewPatient }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPatients = patients.filter(p => 
    p.name.includes(searchTerm) || p.phone.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <button 
          onClick={onNewPatient}
          className="bg-blue-600 hover:bg-blue-700 text-white p-6 rounded-2xl flex items-center justify-between transition group"
        >
          <div className="text-left">
            <h3 className="text-lg font-bold">新建初诊档案</h3>
            <p className="text-blue-100 text-sm opacity-90">采集全量视光生物数据</p>
          </div>
          <PlusCircle size={32} className="group-hover:scale-110 transition" />
        </button>

        <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm flex items-center justify-between">
          <div className="text-left">
            <h3 className="text-lg font-bold text-gray-800">今日待诊</h3>
            <p className="text-gray-500 text-sm">已有 12 位患者预约</p>
          </div>
          <Calendar size={32} className="text-gray-400" />
        </div>

        <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl shadow-sm flex items-center justify-between">
          <div className="text-left text-orange-800">
            <h3 className="text-lg font-bold">高危预警</h3>
            <p className="text-orange-600 text-sm">3 位患者眼轴增长超标</p>
          </div>
          <AlertTriangle size={32} className="text-orange-400" />
        </div>
      </div>

      {/* Patient List */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="搜索姓名、电话、首字母..." 
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border-transparent rounded-lg focus:bg-white focus:border-blue-500 transition outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            <Filter size={16} /> 筛选
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3">患者信息</th>
              <th className="px-6 py-3">当前方案</th>
              <th className="px-6 py-3">上周进展</th>
              <th className="px-6 py-3">风险状态</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {filteredPatients.map(p => (
              <tr 
                key={p.id} 
                onClick={() => onSelectPatient(p)}
                className="hover:bg-blue-50/50 cursor-pointer transition"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                      <User size={20} />
                    </div>
                    <div>
                      <p className="font-bold">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {p.history[0]?.recommendedProduct || '未评估'}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {p.history[0]?.clinicalData.axialLengthOD || '—'} mm
                </td>
                <td className="px-6 py-4">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div> 低风险
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <ChevronRight size={18} className="text-gray-300 ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Dashboard;
