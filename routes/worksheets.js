// routes/worksheets.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getWorksheets,
  getWorksheetById,
  getWorksheetDownload,
  getWorksheetPreview
} = require('../controllers/worksheetController');
const {
  markComplete,
  markIncomplete,
  getMyProgress,
  getProgressSummary
} = require('../controllers/progressController');

const router = express.Router();

// Worksheet listing, details, and downloads
router.get('/', getWorksheets);
router.get('/:id', getWorksheetById);
router.get('/:id/download', getWorksheetDownload);
router.get('/:id/preview', getWorksheetPreview);

// Worksheet completion & progress
router.post('/:id/complete', requireAuth, markComplete);
router.delete('/:id/complete', requireAuth, markIncomplete);
router.get('/progress', requireAuth, getMyProgress);
router.get('/progress/summary', requireAuth, getProgressSummary);

module.exports = router;