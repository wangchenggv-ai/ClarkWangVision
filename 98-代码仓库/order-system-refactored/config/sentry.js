import * as Sentry from '@sentry/node';
import { env } from './env.js';

export function initSentry() {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 1.0,
    });
    console.log('✅ Sentry initialized');
  }
}