import express from 'express';
import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import { initRedis } from './config/redis.js';
import { initSentry } from './config/sentry.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import agentRoutes from './routes/agents.js';
import { startCronJobs } from './services/cronJobs.js';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

dotenv.config();
initRedis();
initSentry();

const app = express();
const PORT = process.env.PORT || 3210;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(require('./middleware/cors.js').default);

// Swagger API Docs
const swaggerDocument = YAML.load('./docs/swagger.yaml');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/orders', authMiddleware, orderRoutes);
app.use('/api/admin', adminMiddleware, adminRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`🚀 Order System v2.0 running on port ${PORT}`);
  startCronJobs(); // 启动定时任务（AI分析等）
});

export default app;