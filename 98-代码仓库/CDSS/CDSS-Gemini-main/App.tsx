
import React, { useState, useEffect } from 'react';
import { 
  Users, 
  PlusCircle, 
  History, 
  ShieldCheck, 
  Activity, 
  ChevronRight,
  Search,
  Bell,
  Menu,
  FileText
} from 'lucide-react';
import { Patient, Visit, Gender, ProductSKU } from './types';
import Dashboard from './components/Dashboard';
import PatientForm from './components/PatientForm';
import RiskAnalysis from './components/RiskAnalysis';
import DecisionEngine from './components/DecisionEngine';
import AIReport from './components/AIReport';

type ViewState = 'DASHBOARD' | 'NEW_PATIENT' | 'FOLLOW_UP' | 'RISK_ANALYSIS' | 'DECISION' | 'REPORT';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [currentVisit, setCurrentVisit] = useState<Visit | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);

  // Mock data initialization
  useEffect(() => {
    const mockPatient: Patient = {
      id: '1',
      name: '张小明',
      gender: Gender.MALE,
      birthdate: '2016-05-12',
      phone: '13812345678',
      parentTags: [],
      fatherDiopter: -4.5,
      motherDiopter: -6.2,
      outdoorHours: 1.5,
      screenHours: 3.5,
      history: []
    };
    setPatients([mockPatient]);
  }, []);

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setCurrentView('FOLLOW_UP');
  };

  const handleStartAnalysis = (patient: Patient, visit: Visit) => {
    setSelectedPatient(patient);
    setCurrentVisit(visit);
    setCurrentView('RISK_ANALYSIS');
  };

  const renderView = () => {
    switch (currentView) {
      case 'DASHBOARD':
        return <Dashboard 
          patients={patients} 
          onSelectPatient={handlePatientSelect} 
          onNewPatient={() => setCurrentView('NEW_PATIENT')} 
        />;
      case 'NEW_PATIENT':
        return <PatientForm 
          onComplete={handleStartAnalysis} 
          onBack={() => setCurrentView('DASHBOARD')} 
        />;
      case 'FOLLOW_UP':
        return <PatientForm 
          initialPatient={selectedPatient!} 
          onComplete={handleStartAnalysis} 
          onBack={() => setCurrentView('DASHBOARD')} 
          isFollowUp
        />;
      case 'RISK_ANALYSIS':
        return <RiskAnalysis 
          patient={selectedPatient!} 
          visit={currentVisit!} 
          onNext={() => setCurrentView('DECISION')} 
          onBack={() => setCurrentView('DASHBOARD')} 
        />;
      case 'DECISION':
        return <DecisionEngine 
          patient={selectedPatient!} 
          visit={currentVisit!} 
          onNext={(visit) => {
            setCurrentVisit(visit);
            setCurrentView('REPORT');
          }}
          onBack={() => setCurrentView('RISK_ANALYSIS')}
        />;
      case 'REPORT':
        return <AIReport 
          patient={selectedPatient!} 
          visit={currentVisit!} 
          onDone={() => setCurrentView('DASHBOARD')}
        />;
      default:
        return <Dashboard patients={patients} onSelectPatient={handlePatientSelect} onNewPatient={() => setCurrentView('NEW_PATIENT')} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
      {/* Sidebar - Desktop */}
      <aside className="w-20 lg:w-64 bg-slate-900 text-white flex flex-col transition-all">
        <div className="p-4 flex items-center justify-center lg:justify-start gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Activity size={24} />
          </div>
          <span className="hidden lg:block font-bold text-lg tracking-tight">高视星 CDSS</span>
        </div>
        
        <nav className="flex-1 mt-6 px-3 space-y-2">
          <button 
            onClick={() => setCurrentView('DASHBOARD')}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition ${currentView === 'DASHBOARD' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}
          >
            <Users size={20} />
            <span className="hidden lg:block font-medium">患者管理</span>
          </button>
          <button className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800 transition">
            <History size={20} />
            <span className="hidden lg:block font-medium">复诊提醒</span>
          </button>
          <button className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800 transition">
            <FileText size={20} />
            <span className="hidden lg:block font-medium">循证库</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
              <ShieldCheck size={20} className="text-blue-400" />
            </div>
            <div className="hidden lg:block">
              <p className="text-xs font-bold text-blue-400 uppercase">医师模式</p>
              <p className="text-sm font-medium">Dr. Clark</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-auto">
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-xl font-bold text-slate-800">
            {currentView === 'DASHBOARD' && '患者管理总览'}
            {currentView === 'NEW_PATIENT' && '新建档案'}
            {currentView === 'FOLLOW_UP' && '一键复诊'}
            {currentView === 'RISK_ANALYSIS' && '多维风险评估'}
            {currentView === 'DECISION' && '智能决策辅助'}
            {currentView === 'REPORT' && '报告生成与核准'}
          </h2>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
              <Search size={20} />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-full text-gray-500 relative">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        <section className="flex-1 p-6">
          {renderView()}
        </section>

        {/* Persistent Disclaimer Footer */}
        <footer className="bg-white border-t px-6 py-3 text-center text-xs text-gray-500 shrink-0">
          <span className="font-semibold text-blue-600 mr-2">免责声明:</span>
          AI是副驾，人才是主驾。本分析由高视星临床模型提供，具体诊断需经视光师核准。
        </footer>
      </main>
    </div>
  );
};

export default App;
