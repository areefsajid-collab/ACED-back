const express = require('express');
const cors = require('cors');
require('dotenv').config();
const prisma = require('./config/prisma');
const passport = require('./config/passport');

const rateLimit = require('express-rate-limit');

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// 1. Set up the limiter
const apiLimiter = rateLimit({
  windowMs: 15*60*1000, // 25 seconds
  max: 250, // Limit each IP to 10 requests
  message: { error: 'Too many requests from this IP, please try again after 25 seconds.' }
});

// 2. APPLY IT HERE (Before all your routes!)
app.use('/api', apiLimiter);

// 3. NOW your routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/worksheets', require('./routes/worksheets'));
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running', message: 'ACED* API is alive' });
});
app.use('/api/users', require('./routes/users'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/api/health`);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});