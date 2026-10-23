const express = require('express');
const { getWorksheets, getWorksheetById, getWorksheetDownload } = require('../controllers/worksheetController');
const { requireAuth } = require('../middleware/auth');
const { markComplete, markIncomplete } = require('../controllers/progressController');

const router = express.Router();

// Public
router.get('/', getWorksheets);
router.get('/:id', getWorksheetById);
router.get('/:id/download', getWorksheetDownload);

// Logged in
router.post('/:id/complete', requireAuth, markComplete);
router.delete('/:id/complete', requireAuth, markIncomplete);

module.exports = router;