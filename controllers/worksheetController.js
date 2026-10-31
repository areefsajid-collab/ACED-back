const prisma = require('../config/prisma');
const mammoth = require('mammoth');

// GET /api/worksheets?subject=maths&grade=5&search=fractions
// ACED-back-master/controllers/worksheetController.js

const getWorksheets = async (req, res) => {
  try {
    const { subject, grade } = req.query;

    const worksheets = await prisma.worksheet.findMany({
      where: {
        subject: subject,
        grade: parseInt(grade) // Ensures string '2' matches integer 2 in Neon
      }
    });

    // ABSOLUTE FIX: Prevent Vercel/Express 304 caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    return res.status(200).json(worksheets);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id
const getWorksheetById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const worksheet = await prisma.worksheet.findFirst({
      where: { id, status: 'approved' },
      select: { id: true, subject: true, grade: true, topic: true, title: true, difficulty: true, content: true },
    });

    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }
    res.json({ worksheet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id/preview
// Converts the stored Word file to HTML and removes the answer key.
const getWorksheetPreview = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const worksheet = await prisma.worksheet.findFirst({
      where: { id, status: 'approved' },
      select: { docx: true },
    });

    if (!worksheet || !worksheet.docx) {
      return res.status(404).json({ error: 'Word file not found' });
    }

    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(worksheet.docx) });
    const cut = html.search(/<h[1-6][^>]*>\s*answer key/i);
    res.json({ html: cut === -1 ? html : html.slice(0, cut) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id/download
const getWorksheetDownload = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const worksheet = await prisma.worksheet.findFirst({
      where: { id, status: 'approved' },
      select: { id: true, subject: true, grade: true, docx: true },
    });

    if (!worksheet || !worksheet.docx) {
      return res.status(404).json({ error: 'Word file not found' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="ACED_${worksheet.subject}_grade${worksheet.grade}_${worksheet.id}.docx"`);
    res.send(Buffer.from(worksheet.docx));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getWorksheets, getWorksheetById, getWorksheetPreview, getWorksheetDownload };