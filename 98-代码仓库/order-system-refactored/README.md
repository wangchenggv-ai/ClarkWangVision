# 高视星订单系统 v2.0（重构版）

## 已完成的 8 项重大改进

### 1. 模块化重构 ✅
- `server.js` 拆分为 `routes/`, `services/`, `middleware/`, `utils/`, `config/`
- 每个文件 < 200 行，职责单一

### 2. 引入 Express + 中间件 ✅
- 完整 Express 应用
- 统一错误处理、CORS、JSON 解析中间件

### 3. JWT + 角色权限 ✅
- 支持新 JWT + 旧 token 向后兼容
- `authMiddleware` + `adminMiddleware`

### 4. Redis 分布式锁 + 缓存 ✅
- `config/redis.js` 初始化 ioredis
- 库存扣减使用 Redis 分布式锁（`withLock` 升级版）

### 5. 统一配置中心 ✅
- `config/env.js` 使用 Zod 严格校验所有环境变量
- 集中管理 TABLES、打印机配置等

### 6. Swagger API 文档 ✅
- `/api-docs` 自动生成完整接口文档

### 7. 定时任务（AI 周报） ✅
- `node-cron` 实现每周一自动运行 `ai_analysis.js`

### 8. 监控 & 结构化日志 ✅
- Winston 结构化日志 + 文件输出
- Sentry 错误追踪（`config/sentry.js`）

## 快速启动

```bash
npm install
npm run dev
```

访问：http://localhost:3210/api-docs 查看完整 API 文档

---

**原仓库**：https://github.com/wangchenggv-ai/ClarkWangVision  
**本 Mock 仓库**：用于演示重构能力

**作者**：Grok (xAI) - 2026-04-23
