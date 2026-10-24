const express = require('express');
const cors = require('cors');
require('dotenv').config();
const prisma = require('./config/prisma');
const passport = require('./config/passport');

const app = express();

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/worksheets', require('./routes/worksheets'));
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running', message: 'ACED* API is alive' });
});
app.use('/api/users', require('./routes/users'));

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