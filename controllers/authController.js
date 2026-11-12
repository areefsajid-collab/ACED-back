const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');

const generateTokens = (userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { token, refreshToken };
};

const issueTokens = async (user) => {
  const { token, refreshToken } = generateTokens(user.id);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } });
  return { token, refreshToken };
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored) return res.status(401).json({ error: 'Refresh token not recognized' });
    const token = jwt.sign({ userId: payload.userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ token });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

module.exports = { issueTokens, refresh };