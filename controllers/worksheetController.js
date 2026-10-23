const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const { get } = require('http');

// GET /api/worksheets?subject=maths&grade=5&topic=addition
const getWorksheets = async (req, res) => {
  try {
    const { subject, grade, topic } = req.query;

    const where = {status : "approved"};
    if (subject) where.subject = subject;
    if (grade) where.grade = parseInt(grade);
    if (topic) where.topic = topic;

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
    const worksheet = await prisma.worksheet.findUnique({ where: { id, status : "approved" } });

    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }

    res.json({ worksheet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/worksheets/:id/download
const getWorksheetDownload = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const worksheet = await prisma.worksheet.findFirst({ where: { id, status: 'approved' } });
    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }

    const file = path.join(__dirname, '..', 'output', `g${worksheet.grade}_${worksheet.subject}_${worksheet.id}.docx`);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Word file not generated yet' });
    }

    res.download(file, `ACED_${worksheet.subject}_grade${worksheet.grade}_${worksheet.id}.docx`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


module.exports = { getWorksheets, getWorksheetById, getWorksheetDownload };
