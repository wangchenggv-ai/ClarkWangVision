import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { findAgent } from '../services/agentService.js';

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.query.t || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });

    // 支持旧 token（向后兼容） + 新 JWT
    if (token.length < 50) {
      const agent = await findAgent(token);
      if (!agent) return res.status(401).json({ error: 'Invalid agent token' });
      req.agent = agent;
      return next();
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.agent = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const adminMiddleware = (req, res, next) => {
  if (req.query.adminToken !== env.ADMIN_TOKEN && req.headers['x-admin-token'] !== env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};