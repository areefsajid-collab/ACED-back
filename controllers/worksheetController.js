const prisma = require('../config/prisma');
const mammoth = require('mammoth');

// GET /api/worksheets?subject=maths&grade=5&search=fractions
const getWorksheets = async (req, res) => {
  try {
    const { subject, grade, topic, search } = req.query;

    const where = { status: 'approved' };
    if (subject) where.subject = subject;
    if (grade) where.grade = parseInt(grade);
    if (topic) where.topic = topic;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { topic: { contains: search, mode: 'insensitive' } },
      ];
    }

    const worksheets = await prisma.worksheet.findMany({
      where,
      select: { id: true, subject: true, grade: true, topic: true, title: true, difficulty: true },
      orderBy: [{ grade: 'asc' }, { topic: 'asc' }],
    });

    // ABSOLUTE FIX: Prevent 304 caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // ABSOLUTE FIX: Return raw array directly so frontend .length checks pass
    res.json(worksheets);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ worksheet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id/preview
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="ACED_${worksheet.subject}_grade${worksheet.grade}_${worksheet.id}.docx"`);
    res.send(Buffer.from(worksheet.docx));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getWorksheets, getWorksheetById, getWorksheetPreview, getWorksheetDownload };