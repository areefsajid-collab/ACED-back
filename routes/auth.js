const express = require('express');
const { register, login, refresh } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const passport = require('passport');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);



router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, grade: true, createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step A: redirect the user to Google's login page
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
}));

// Step B: Google sends the user back here after they log in
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/api/auth/google/failed' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    prisma.refreshToken
      .create({ data: { userId: user.id, token: refreshToken, expiresAt } })
      .then(() => {
        res.json({
          token,
          refreshToken,
          user: { id: user.id, email: user.email, name: user.name },
        });
      })
      .catch((error) => res.status(500).json({ error: error.message }));
  }
);

router.get('/google/failed', (req, res) => {
  res.status(401).json({ error: 'Google login failed' });
});

module.exports = router;