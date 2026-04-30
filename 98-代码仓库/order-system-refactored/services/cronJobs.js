import cron from 'node-cron';
import { runWeeklyAIAnalysis } from './aiAnalysisService.js';
import { logger } from '../utils/logger.js';

export function startCronJobs() {
  // 每周一上午 9:00 自动运行 AI 周报
  cron.schedule('0 9 * * 1', async () => {
    logger.info('Starting weekly AI analysis...');
    try {
      await runWeeklyAIAnalysis();
      logger.info('Weekly AI analysis completed successfully');
    } catch (error) {
      logger.error('Weekly AI analysis failed', { error });
    }
  });

  logger.info('Cron jobs initialized (AI analysis every Monday 9:00)');
}