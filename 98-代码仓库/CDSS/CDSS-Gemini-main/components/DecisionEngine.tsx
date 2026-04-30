
import React, { useState, useEffect } from 'react';
import { CheckCircle, Info, Star, ChevronDown, ListCheck, BookOpen } from 'lucide-react';
import { Patient, Visit, ProductSKU } from '../types';

interface DecisionEngineProps {
  patient: Patient;
  visit: Visit;
  onNext: (visit: Visit) => void;
  onBack: () => void;
}

const DecisionEngine: React.FC<DecisionEngineProps> = ({ patient, visit, onNext, onBack }) => {
  const [selectedSKU, setSelectedSKU] = useState<ProductSKU>(ProductSKU.ULTRA);
  const [showEvidence, setShowEvidence] = useState(false);

  // Simple funnel logic
  useEffect(() => {
    const { axialLengthOD, bcc } = visit.clinicalData;
    if (bcc > 0.75 || axialLengthOD > 25) {
      setSelectedSKU(ProductSKU.ULTRA);
    } else if (axialLengthOD > 24) {
      setSelectedSKU(ProductSKU.SHIKONGZHIYAN);
    } else {
      setSelectedSKU(ProductSKU.XIAOXUANFENG);
    }
  }, [visit]);

  const handleNext = () => {
    onNext({ ...visit, recommendedProduct: selectedSKU });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-10">
      {/* Strategy Layer */}
      <section className="bg-white p-8 rounded-3xl shadow-sm border-2 border-blue-100 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 bg-blue-600 text-white rounded-bl-3xl font-bold text-xs uppercase tracking-wider">
          AI 智能算法推荐
        </div>
        
        <div className="flex items-start gap-6">
          <div className="bg-blue-50 p-4 rounded-2xl text-blue-600 shrink-0">
            <Star size={32} fill="currentColor" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">首选策略: 光学离焦干预 (强效型)</h3>
            <p className="text-gray-600 leading-relaxed mb-6">
              结合患者高度近视遗传史及 <span className="font-bold text-blue-600">BCC 调节滞后 (+{visit.clinicalData.bcc}D)</span>，
              常规离焦镜片可能控制力不足。建议采用 <span className="font-bold underline decoration-blue-500">点扩散强效离焦技术</span>。
            </p>
            
            <div className="flex gap-4">
              <span className="px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-lg border border-green-100">循证级 A</span>
              <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100">强推荐</span>
            </div>
          </div>
        </div>
      </section>

      {/* Product Selection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Object.values(ProductSKU).map(sku => (
          <button 
            key={sku}
            onClick={() => setSelectedSKU(sku)}
            className={`p-6 rounded-2xl border-2 text-left transition-all relative ${selectedSKU === sku ? 'bg-white border-blue-600 ring-4 ring-blue-50' : 'bg-gray-50 border-transparent grayscale opacity-70 hover:grayscale-0 hover:opacity-100'}`}
          >
            {selectedSKU === sku && <CheckCircle size={20} className="text-blue-600 absolute top-4 right-4" />}
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-widest">Gaoshixing SKU</p>
            <h4 className="text-lg font-black text-slate-800 mb-2">{sku}</h4>
            <div className="h-1 w-10 bg-blue-600 rounded-full mb-4"></div>
            <p className="text-xs text-gray-500 leading-snug">
              {sku === ProductSKU.ULTRA ? '针对调节滞后优化，点扩散强效设计' : sku === ProductSKU.SHIKONGZHIYAN ? '标准微透镜设计，适合常规防控' : '入门级方案，远视储备下降期首选'}
            </p>
          </button>
        ))}
      </div>

      {/* Evidence Sidebar/Bottom Section */}
      <div className="bg-slate-50 border rounded-3xl p-6">
        <button 
          onClick={() => setShowEvidence(!showEvidence)}
          className="w-full flex items-center justify-between text-slate-800 font-bold"
        >
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-blue-600" /> 循证证据与专利支撑
          </div>
          <ChevronDown className={`transition ${showEvidence ? 'rotate-180' : ''}`} />
        </button>
        
        {showEvidence && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top duration-300">
            <div className="bg-white p-4 rounded-xl border border-dashed text-xs space-y-2">
              <p className="font-bold text-gray-700">【临床数据】</p>
              <p className="text-gray-500">《IOVS》2023 期刊研究显示：点扩散设计相较于传统周边离焦可进一步延缓眼轴增长平均 0.12mm/年。</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-dashed text-xs space-y-2">
              <p className="font-bold text-gray-700">【核心专利】</p>
              <p className="text-gray-500">发明专利 ZL2022XXXXXXXX.X：一种具有非对称点阵设计的眼用透镜及其制作方法。</p>
            </div>
          </div>
        )}
      </div>

      {/* Final Action */}
      <div className="flex gap-4">
        <button 
          onClick={onBack}
          className="px-8 py-4 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-gray-100 transition"
        >
          返回分析
        </button>
        <button 
          onClick={handleNext}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-xl shadow-blue-100 transition active:scale-95"
        >
          <ListCheck size={20} /> 核准并生成 AI 评估报告
        </button>
      </div>
    </div>
  );
};

export default DecisionEngine;
