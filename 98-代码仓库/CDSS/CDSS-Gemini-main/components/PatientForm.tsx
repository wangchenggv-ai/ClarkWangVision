
import React, { useState } from 'react';
import { ArrowLeft, Save, Info, Zap } from 'lucide-react';
// Added ProductSKU to the imports
import { Patient, Visit, Gender, ParentTag, ClinicalData, ProductSKU } from '../types';

interface PatientFormProps {
  initialPatient?: Patient;
  onComplete: (patient: Patient, visit: Visit) => void;
  onBack: () => void;
  isFollowUp?: boolean;
}

const PatientForm: React.FC<PatientFormProps> = ({ initialPatient, onComplete, onBack, isFollowUp }) => {
  const [patient, setPatient] = useState<Patient>(initialPatient || {
    id: Math.random().toString(36).substr(2, 9),
    name: '',
    gender: Gender.MALE,
    birthdate: '',
    phone: '',
    parentTags: [],
    fatherDiopter: 0,
    motherDiopter: 0,
    outdoorHours: 1,
    screenHours: 2,
    history: []
  });

  const [clinical, setClinical] = useState<ClinicalData>({
    nakedVisionOD: '1.0',
    nakedVisionOS: '1.0',
    sphOD: -1.0,
    sphOS: -1.0,
    cylOD: 0,
    cylOS: 0,
    axisOD: 0,
    axisOS: 0,
    axialLengthOD: 23.5,
    axialLengthOS: 23.5,
    k1OD: 43.0,
    k2OD: 43.0,
    bcc: 0.5,
    aca: 4.0,
    pra: -2.5,
    af: 8,
    phoria: 0,
    monoPD_OD: 30,
    ph: 15,
    vd: 12
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newVisit: Visit = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: patient.id,
      date: new Date().toISOString(),
      type: isFollowUp ? 'Follow-up' : 'Initial',
      clinicalData: clinical,
      algorithmScore: 0,
      // Fixed the invalid dynamic import and cast to ProductSKU
      recommendedProduct: Object.values(ProductSKU)[0] as ProductSKU,
      isApproved: false
    };
    onComplete(patient, newVisit);
  };

  const handleTagToggle = (tag: ParentTag) => {
    setPatient(prev => ({
      ...prev,
      parentTags: prev.parentTags.includes(tag)
        ? prev.parentTags.filter(t => t !== tag)
        : [...prev.parentTags, tag]
    }));
  };

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 hover:bg-white rounded-full transition">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-2xl font-bold">{isFollowUp ? '复诊数据录入' : '新建初诊档案'}</h2>
          <p className="text-gray-500 text-sm">请录入今日检查的核心视光生物指标</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-600 rounded-full"></span> 基础档案与画像
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">姓名</label>
              <input 
                type="text" 
                required
                className="w-full px-4 py-2 border rounded-lg outline-none focus:border-blue-500 transition" 
                value={patient.name}
                onChange={e => setPatient({...patient, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">性别</label>
              <select 
                className="w-full px-4 py-2 border rounded-lg outline-none focus:border-blue-500 transition"
                value={patient.gender}
                onChange={e => setPatient({...patient, gender: e.target.value as Gender})}
              >
                <option value={Gender.MALE}>男</option>
                <option value={Gender.FEMALE}>女</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">联系电话</label>
              <input 
                type="tel" 
                className="w-full px-4 py-2 border rounded-lg outline-none focus:border-blue-500 transition" 
                value={patient.phone}
                onChange={e => setPatient({...patient, phone: e.target.value})}
              />
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-xs font-bold text-gray-500 mb-3">家长画像标签 (可多选，影响AI话术)</label>
            <div className="flex flex-wrap gap-2">
              {Object.values(ParentTag).map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleTagToggle(tag)}
                  className={`px-4 py-1.5 rounded-full border text-sm font-medium transition ${patient.parentTags.includes(tag) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-gray-600 hover:border-gray-400'}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Clinical Data */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-600 rounded-full"></span> 临床生物测量
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">眼轴 OD (mm)</label>
              <input 
                type="number" step="0.01" required
                className="w-full px-4 py-2 border rounded-lg bg-blue-50/30 font-mono" 
                value={clinical.axialLengthOD}
                onChange={e => setClinical({...clinical, axialLengthOD: parseFloat(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">眼轴 OS (mm)</label>
              <input 
                type="number" step="0.01" required
                className="w-full px-4 py-2 border rounded-lg bg-blue-50/30 font-mono" 
                value={clinical.axialLengthOS}
                onChange={e => setClinical({...clinical, axialLengthOS: parseFloat(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">球镜 OD (D)</label>
              <input 
                type="number" step="0.25"
                className="w-full px-4 py-2 border rounded-lg" 
                value={clinical.sphOD}
                onChange={e => setClinical({...clinical, sphOD: parseFloat(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">球镜 OS (D)</label>
              <input 
                type="number" step="0.25"
                className="w-full px-4 py-2 border rounded-lg" 
                value={clinical.sphOS}
                onChange={e => setClinical({...clinical, sphOS: parseFloat(e.target.value)})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
             <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">调节滞后 BCC (D)</label>
              <input 
                type="number" step="0.25"
                className="w-full px-4 py-2 border rounded-lg border-blue-200" 
                value={clinical.bcc}
                onChange={e => setClinical({...clinical, bcc: parseFloat(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">AC/A 值 (△/D)</label>
              <input 
                type="number" step="0.1"
                className="w-full px-4 py-2 border rounded-lg border-blue-200" 
                value={clinical.aca}
                onChange={e => setClinical({...clinical, aca: parseFloat(e.target.value)})}
              />
            </div>
             <div className="col-span-2 flex items-center gap-3 bg-gray-50 p-4 rounded-xl border border-dashed">
              <Info className="text-gray-400 shrink-0" />
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="font-bold text-gray-700">双眼视功能提示:</span><br/>
                BCC > +0.75D 表示调节不足，强烈推荐 Ultra 点扩散镜片。
              </p>
            </div>
          </div>
        </section>

        {/* Environmental Factors */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-600 rounded-full"></span> 遗传与环境风险
          </h3>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">每日户外时长: {patient.outdoorHours} 小时</label>
                <input 
                  type="range" min="0" max="8" step="0.5"
                  className="w-full accent-blue-600"
                  value={patient.outdoorHours}
                  onChange={e => setPatient({...patient, outdoorHours: parseFloat(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">每日屏幕时长: {patient.screenHours} 小时</label>
                <input 
                  type="range" min="0" max="8" step="0.5"
                  className="w-full accent-red-600"
                  value={patient.screenHours}
                  onChange={e => setPatient({...patient, screenHours: parseFloat(e.target.value)})}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">父亲近视度数</label>
                <input 
                  type="number" step="50"
                  className="w-full px-4 py-2 border rounded-lg" 
                  value={patient.fatherDiopter}
                  onChange={e => setPatient({...patient, fatherDiopter: parseFloat(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">母亲近视度数</label>
                <input 
                  type="number" step="50"
                  className="w-full px-4 py-2 border rounded-lg" 
                  value={patient.motherDiopter}
                  onChange={e => setPatient({...patient, motherDiopter: parseFloat(e.target.value)})}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex gap-4">
          <button 
            type="submit" 
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-200 transition active:scale-[0.98]"
          >
            <Zap size={20} /> 立即生成智能风险报告
          </button>
        </div>
      </form>
    </div>
  );
};

export default PatientForm;
