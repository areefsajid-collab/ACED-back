const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/worksheets?subject=maths&grade=5&topic=addition
const getWorksheets = async (req, res) => {
  try {
    const { subject, grade, topic } = req.query;

    const where = {};
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
    const worksheet = await prisma.worksheet.findUnique({ where: { id } });

    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }

    res.json({ worksheet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getWorksheets, getWorksheetById };
