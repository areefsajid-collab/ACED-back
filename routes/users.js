const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getMyProgress, getProgressSummary} = require('../controllers/progressController');

const router = express.Router();

router.get('/progress', requireAuth, getMyProgress);
router.get('/progress/summary', requireAuth, getProgressSummary);
module.exports = router;