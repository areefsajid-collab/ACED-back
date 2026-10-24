const prisma = require('../config/prisma');

// POST /api/worksheets/:id/complete
const markComplete = async (req, res) => {
  try {
    const worksheetId = parseInt(req.params.id);

    const worksheet = await prisma.worksheet.findUnique({ where: { id: worksheetId } });
    if (!worksheet) {
      return res.status(404).json({ error: 'Worksheet not found' });
    }

    const progress = await prisma.userProgress.upsert({
      where: { userId_worksheetId: { userId: req.userId, worksheetId } },
      update: { isCompleted: true, completedAt: new Date() },
      create: { userId: req.userId, worksheetId, isCompleted: true, completedAt: new Date() },
    });

    res.json({ progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/worksheets/:id/complete
const markIncomplete = async (req, res) => {
  try {
    const worksheetId = parseInt(req.params.id);

    await prisma.userProgress.updateMany({
      where: { userId: req.userId, worksheetId },
      data: { isCompleted: false, completedAt: null },
    });

    res.json({ message: 'Marked as not done' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/users/progress
const getMyProgress = async (req, res) => {
  try {
    const progress = await prisma.userProgress.findMany({
      where: { userId: req.userId, isCompleted: true },
      include: { worksheet: { select: { id: true, subject: true, grade: true, topic: true, title: true } } },
      orderBy: { completedAt: 'desc' },
    });

    res.json({ count: progress.length, progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/users/progress/summary
const getProgressSummary = async (req, res) => {
  try {
    const totals = await prisma.worksheet.groupBy({
      by: ["subject", "grade"],
      where: { status: "approved" },
      _count: { id: true },
    });

    const done = await prisma.userProgress.findMany({
      where: { userId: req.userId, isCompleted: true, worksheet: { status: "approved" } },
      select: { worksheet: { select: { subject: true, grade: true } } },
    });

    const doneCount = {};
    done.forEach(({ worksheet }) => {
      const key = `${worksheet.subject}-${worksheet.grade}`;
      doneCount[key] = (doneCount[key] || 0) + 1;
    });

    const summary = totals.map((row) => ({
      subject: row.subject,
      grade: row.grade,
      total: row._count.id,
      done: doneCount[`${row.subject}-${row.grade}`] || 0,
    }));

    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { markComplete, markIncomplete, getMyProgress, getProgressSummary };