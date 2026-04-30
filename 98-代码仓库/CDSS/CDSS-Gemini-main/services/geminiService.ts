
import { GoogleGenAI, Type } from "@google/genai";
import { Patient, Visit, ParentTag } from "../types";

export async function generateClinicalAdvice(patient: Patient, currentVisit: Visit): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const tagsText = patient.parentTags.join(", ");
  const clinical = currentVisit.clinicalData;
  
  const prompt = `
    Act as a professional Myopia Management Specialist. Generate a concise, persuasive clinical summary (approx 200 words) for a patient report.
    Patient Info:
    - Name: ${patient.name}
    - Age: ${new Date().getFullYear() - new Date(patient.birthdate).getFullYear()}
    - Parent Profile: ${tagsText}
    - Axial Length (OD/OS): ${clinical.axialLengthOD}/${clinical.axialLengthOS} mm
    - Recommended Solution: ${currentVisit.recommendedProduct}
    - BCC (Lag): ${clinical.bcc} D
    
    Constraint:
    - If "High-Focus", use cautionary tone about rapid progression.
    - If "Evidence-Driven", mention clinical efficacy data (e.g., 50-60% slowing).
    - Language: Chinese (Simplified).
    - Tone: Tech-Medical, Authoritative but empathetic.
    - Mention: "人是主驾，AI是副驾" (The doctor is the pilot, AI is the co-pilot).
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.7,
        topP: 0.9,
      }
    });
    return response.text || "无法生成建议，请视光师手动录入。";
  } catch (error) {
    console.error("AI Generation failed", error);
    return "系统繁忙，建议由主诊医师结合临床数据给出方案。";
  }
}
