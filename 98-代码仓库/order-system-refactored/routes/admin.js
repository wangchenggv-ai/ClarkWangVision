import express from 'express';
const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.json({ message: 'Admin Dashboard (Mock)' });
});

export default router;