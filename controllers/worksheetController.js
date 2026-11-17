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

    res.json({ count: worksheets.length, worksheets });
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
    res.json({ worksheet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id/preview
// Converts the stored Word file to HTML and removes the answer key.
// GET /api/worksheets/:id/preview
const getWorksheetPreview = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const worksheet = await prisma.worksheet.findFirst({
      where: { id, status: 'approved' },
      select: { docx: true, htmlPreview: true }, // Select the cached HTML
    });

    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }

    // 1. CACHE HIT: If the HTML is already saved, return it instantly!
    if (worksheet.htmlPreview) {
      return res.json({ html: worksheet.htmlPreview });
    }

    // 2. CACHE MISS: If not, check if we have the Word file
    if (!worksheet.docx) {
      return res.status(404).json({ error: 'Word file not found' });
    }

    // 3. Convert the Word file to HTML
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(worksheet.docx) });

    // 4. Cut off the answer key (same logic as before)
    const cut = html.search(/<h[1-6][^>]*>\s*answer key/i);
    const finalHtml = cut === -1 ? html : html.slice(0, cut);

    // 5. Save it to the database for next time!
    await prisma.worksheet.update({
      where: { id },
      data: { htmlPreview: finalHtml }
    });

    res.json({ html: finalHtml });
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