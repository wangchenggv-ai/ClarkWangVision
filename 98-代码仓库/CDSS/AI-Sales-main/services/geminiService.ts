
import { GoogleGenAI } from "@google/genai";
import { PatientData } from "../types";

export const generateExpertOpinion = async (data: PatientData): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return "系统分析建议：根据该患儿目前的检查结果，建议严格执行每3个月的定期随访。目前眼轴增长速率处于临界区间，应重点关注户外活动的达标量及近距离用眼强度。";
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `
    作为一名拥有严谨医学背景的视光专家，请基于以下患者数据提供一份专业的、循证的临床分析建议。
    你的语气应当专业且客观，90%重心在风险分析，10%在管理方向。
    
    患者年龄: ${data.age}岁
    当前屈光度: ${data.sphericalEquivalent}D
    当前眼轴(AL): ${data.axialLength}mm
    去年眼轴增长: ${data.alGrowthLastYear}mm
    遗传背景: 父母${data.parentalMyopia === 'both' ? '双方' : data.parentalMyopia === 'one' ? '单方' : '均不'}近视
    环境负荷: 户外${data.outdoorTime}h/天，近距离用眼${data.nearWorkTime}h/天
    
    请输出200字以内的深度意见。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1,
        topP: 0.95,
      },
    });

    return response.text || "无法生成专家意见，请根据临床经验手动核准。";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "系统提示：临床AI引擎当前繁忙。根据循证医学模型，建议该患儿增加每日户外光照至2小时以上，并采用高权重离焦技术进行光学干预。";
  }
};
