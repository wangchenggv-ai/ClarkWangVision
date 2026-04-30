
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export interface PatientData {
  name: string;
  age: number;
  gender: 'male' | 'female';
  idNumber: string;
  // Genetics
  parentalMyopia: 'none' | 'one' | 'both';
  parentalHighMyopia: boolean;
  // Behavior
  outdoorTime: number; // hours/day
  nearWorkTime: number; // hours/day
  readingDistance: number; // cm
  // Physical
  sphericalEquivalent: number; // D
  axialLength: number; // mm
  cornealCurvature: number; // D
  alGrowthLastYear: number; // mm/yr
}

export interface AnalysisResult {
  geneticRisk: RiskLevel;
  environmentalRisk: RiskLevel;
  physiologicalRisk: RiskLevel;
  progressionScore: number; // 0-100
  prediction18yo: number; // D
  interventionRecommendation: 'Ultra' | '时空之眼' | '小旋风';
  rwsEvidence: string[];
}

export interface Report {
  serialNumber: string;
  timestamp: string;
  patient: PatientData;
  analysis: AnalysisResult;
  expertOpinion: string;
}
