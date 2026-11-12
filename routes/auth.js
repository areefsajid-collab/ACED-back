const express = require('express');
const { issueTokens, refresh } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const prisma = require('../config/prisma');
const passport = require('passport');

const router = express.Router();

router.post('/refresh', refresh);

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, createdAt: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google Auth ONLY
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/api/auth/google/failed' }),
  async (req, res) => {
    try {
      const user = req.user;
      const tokens = await issueTokens(user);
      const frontend = process.env.FRONTEND_URL || 'http://127.0.0.1:5500/index.html';

      // Send them back to the frontend with the tokens
      res.redirect(`${frontend}#token=${tokens.token}&refresh=${tokens.refreshToken}`);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get('/google/failed', (req, res) => {
  res.status(401).json({ error: 'Google login failed' });
});

module.exports = router;