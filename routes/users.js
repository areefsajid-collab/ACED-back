const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMyProgress } = require('../controllers/progressController');

const router = express.Router();

router.get('/progress', requireAuth, getMyProgress);

module.exports = router;