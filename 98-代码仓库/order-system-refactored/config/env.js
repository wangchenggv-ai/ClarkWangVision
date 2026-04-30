import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3210'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  FEISHU_APP_ID: z.string(),
  FEISHU_APP_SECRET: z.string(),
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SENTRY_DSN: z.string().optional(),
  COZE_PAT: z.string(),
  ADMIN_TOKEN: z.string(),
});

export const env = envSchema.parse(process.env);
export const TABLES = {
  order: 'tbl_order_xxx',
  lens_detail: 'tbl_lens_xxx',
  stock_detail: 'tbl_stock_xxx',
  // ... 其他表ID
};