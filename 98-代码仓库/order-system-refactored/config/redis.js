import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient;

export function initRedis() {
  redisClient = new Redis(env.REDIS_URL);
  
  redisClient.on('connect', () => logger.info('✅ Redis connected'));
  redisClient.on('error', (err) => logger.error('Redis error', { error: err }));

  return redisClient;
}

export { redisClient };