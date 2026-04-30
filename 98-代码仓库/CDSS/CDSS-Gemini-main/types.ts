
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE'
}

export enum ParentTag {
  HIGH_FOCUS = 'High-Focus',
  EVIDENCE_DRIVEN = 'Evidence-Driven',
  PRICE_SENSITIVE = 'Price-Sensitive',
  LOW_COMPLIANCE = 'Low-Compliance'
}

export enum EfficacyRating {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED'
}

export enum ProductSKU {
  XIAOXUANFENG = '小旋风 (入门级)',
  SHIKONGZHIYAN = '时空之眼 (标准级)',
  ULTRA = 'Ultra 系列 (强效点扩散)'
}

export interface ClinicalData {
  nakedVisionOD: string;
  nakedVisionOS: string;
  sphOD: number;
  sphOS: number;
  cylOD: number;
  cylOS: number;
  axisOD: number;
  axisOS: number;
  axialLengthOD: number;
  axialLengthOS: number;
  k1OD: number;
  k2OD: number;
  bcc: number; // Lag of accommodation
  aca: number; // AC/A ratio
  pra: number; // Positive Relative Accommodation
  af: number;  // Accommodative Facility
  phoria: number; // Near phoria
  monoPD_OD: number;
  ph: number; // Pupil Height
  vd: number; // Vertex Distance
}

export interface Patient {
  id: string;
  name: string;
  gender: Gender;
  birthdate: string;
  phone: string;
  parentTags: ParentTag[];
  fatherDiopter: number;
  motherDiopter: number;
  outdoorHours: number;
  screenHours: number;
  history: Visit[];
}

export interface Visit {
  id: string;
  patientId: string;
  date: string;
  type: 'Initial' | 'Follow-up';
  clinicalData: ClinicalData;
  algorithmScore: number;
  recommendedProduct: ProductSKU;
  isApproved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  aiSummary?: string;
  efficacyRating?: EfficacyRating;
}
