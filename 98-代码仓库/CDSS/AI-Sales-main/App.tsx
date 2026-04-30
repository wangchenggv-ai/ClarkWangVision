
import React, { useState, useEffect, useCallback } from 'react';
import Layout from './components/Layout';
import DataEntry from './components/DataEntry';
import ClinicalAnalysis from './components/ClinicalAnalysis';
import PatientEducation from './components/PatientEducation';
import ReportPreview from './components/ReportPreview';
import ManagementSolutions from './components/ManagementSolutions';
import ProductManual from './components/ProductManual';
import { PatientData, AnalysisResult, RiskLevel } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('data');
  const [patientData, setPatientData] = useState<PatientData>({
    name: '李小华',
    age: 9,
    gender: 'male',
    idNumber: '3101XXXXXXXXXXXXXX',
    parentalMyopia: 'one',
    parentalHighMyopia: false,
    outdoorTime: 1.2,
    nearWorkTime: 4.5,
    readingDistance: 28,
    sphericalEquivalent: -2.75,
    axialLength: 24.85,
    cornealCurvature: 42.8,
    alGrowthLastYear: 0.42,
  });

  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Clinical Logic refined with White Paper weights
  const runAnalysis = useCallback(() => {
    // 1. Genetic Risk
    let gRisk = RiskLevel.LOW;
    if (patientData.parentalMyopia === 'both' || patientData.parentalHighMyopia) gRisk = RiskLevel.HIGH;
    else if (patientData.parentalMyopia === 'one') gRisk = RiskLevel.MEDIUM;

    // 2. Environmental Risk
    let eRisk = RiskLevel.LOW;
    if (patientData.outdoorTime < 1 || patientData.nearWorkTime > 4) eRisk = RiskLevel.HIGH;
    else if (patientData.outdoorTime < 2 || patientData.nearWorkTime > 3) eRisk = RiskLevel.MEDIUM;

    // 3. Physiological Risk (AL Growth is key)
    let pRisk = RiskLevel.LOW;
    if (patientData.alGrowthLastYear >= 0.35 || Math.abs(patientData.sphericalEquivalent) > 4) pRisk = RiskLevel.HIGH;
    else if (patientData.alGrowthLastYear >= 0.2) pRisk = RiskLevel.MEDIUM;

    // Progression Score (0-100) - Weighted Calculation
    const weights = { genetic: 0.3, environmental: 0.3, physiological: 0.4 };
    const levelToValue = (l: RiskLevel) => l === RiskLevel.HIGH ? 100 : l === RiskLevel.MEDIUM ? 60 : 20;
    
    const score = Math.round(
      levelToValue(gRisk) * weights.genetic +
      levelToValue(eRisk) * weights.environmental +
      levelToValue(pRisk) * weights.physiological
    );

    // Intervention Hierarchy - Logic updated to match Solutions tab
    let rec: 'Ultra' | '时空之眼' | '小旋风' = '小旋风';
    if (score > 70) rec = 'Ultra';
    else if (score > 40) rec = '时空之眼';

    setAnalysisResult({
      geneticRisk: gRisk,
      environmentalRisk: eRisk,
      physiologicalRisk: pRisk,
      progressionScore: score,
      prediction18yo: patientData.sphericalEquivalent - (18 - patientData.age) * (score / 100 * 1.0),
      interventionRecommendation: rec,
      rwsEvidence: [],
    });
  }, [patientData]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  const handleDataChange = (newData: Partial<PatientData>) => {
    setPatientData(prev => ({ ...prev, ...newData }));
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  return (
    <Layout activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === 'data' && <DataEntry data={patientData} onChange={handleDataChange} />}
      {activeTab === 'analysis' && analysisResult && <ClinicalAnalysis data={patientData} result={analysisResult} />}
      {activeTab === 'education' && <PatientEducation data={patientData} />}
      {activeTab === 'report' && analysisResult && (
        <ReportPreview report={{
          serialNumber: 'GSX-REPORT-' + Date.now().toString().slice(-6),
          timestamp: new Date().toLocaleDateString(),
          patient: patientData,
          analysis: analysisResult,
          expertOpinion: '' 
        }} />
      )}
      {activeTab === 'solutions' && analysisResult && <ManagementSolutions result={analysisResult} />}
      {activeTab === 'manual' && <ProductManual />}
    </Layout>
  );
};

export default App;
