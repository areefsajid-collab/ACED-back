// scripts/generateMockWorksheet.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { PrismaClient } = require("@prisma/client");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle, ShadingType,
} = require("docx");

const prisma = new PrismaClient();

const MODEL = "gemini-3.8-flash";
const MAX_TRIES = 3;
const OUT_DIR = path.join(__dirname, "..", "output");

const PAIR_RANGE = { 1: [3, 3], 2: [3, 4], 3: [4, 4], 4: [4, 5], 5: [5, 5], 6: [5, 6], 7: [6, 6], 8: [6, 7] };
const SPLIT = { short: 6, long: 4, matching: 4, diagram: 4, free: 2 };
const TAGS = ["D", "C", "P", "R", "W", "X", "O"];

// Mock batch: one subject, one or two grades, a few topics each.
// Add or remove entries here. Each one runs generate, validate and save.
const MOCK_BATCH = [
  { subject: "Science", grade: 3, topic: "Life cycles of animals and plants", tags: ["C"] },
  { subject: "Science", grade: 3, topic: "Push and pull forces", tags: ["C"] },
  { subject: "Science", grade: 3, topic: "Magnets and their poles", tags: ["X"] },
];

// ---------- Prompt ----------
function buildPrompt(t, feedback) {
  const [lo, hi] = PAIR_RANGE[t.grade];
  let prompt = `You write one printable worksheet for ACED*, a free worksheet site for children in Pakistan.
Subject: ${t.subject}. Grade: ${t.grade}. Topic: ${t.topic}.
Syllabus tags that must be covered by the questions together: ${t.tags.join(", ")}.
Tag meanings: D drill, C conceptual, P problem-solving, R reading, W writing, X practical/data, O oral.

Return ONLY valid JSON. No prose, no code fences. Shape:
{"title": "string", "questions": [ 20 question objects ]}

Exactly 20 questions with this split:
- 6 "short": a short answer. Give "answer".
- 4 "long": an open answer that needs working space. Give "markingPoints", an array of 3 to 5 key ideas a correct answer must include.
- 4 "matching": give "left" and "right" arrays of EQUAL length, each with ${lo} to ${hi} items, and "pairs" as [leftIndex, rightIndex] for every item, each used once. Each left item must match exactly one right item.
- 4 "diagram": describe a simple labelled picture in words, in a field "diagramDescription" (for example "A bean seed with a root, a stem and two leaves, and the parts labelled A to D"). The child reads the description and answers the question. Give "answer".
- 2 "free": any of the formats above. Give "format" set to "short", "long", "matching" or "diagram", plus the fields that format needs.

Every question has "id" (q1 to q20), "section" ("short", "long", "matching", "diagram" or "free"), "tags" (an array of tag letters), and "question" (the text a child reads).
Use language and numbers suited to Grade ${t.grade}. Every answer must be factually correct for the Pakistani curriculum at this grade. Use no emoji. Do not repeat questions.`;

  if (feedback) {
    prompt += `\n\nYour previous answer failed these checks. Fix them and return the full JSON again:\n- ${feedback.join("\n- ")}`;
  }
  return prompt;
}

// ---------- Validation ----------
function checkMatching(q, lo, hi, errs) {
  if (!Array.isArray(q.left) || !Array.isArray(q.right) || q.left.length !== q.right.length) {
    errs.push(`${q.id}: left and right must be equal-length arrays`);
    return;
  }
  const n = q.left.length;
  if (n < lo || n > hi) errs.push(`${q.id}: ${n} pairs, this grade needs ${lo} to ${hi}`);
  if (!Array.isArray(q.pairs) || q.pairs.length !== n) {
    errs.push(`${q.id}: pairs must list all ${n} items`);
    return;
  }
  const usedL = new Set(q.pairs.map((p) => p[0]));
  const usedR = new Set(q.pairs.map((p) => p[1]));
  if (usedL.size !== n || usedR.size !== n) errs.push(`${q.id}: each item must appear exactly once in pairs`);
}

function checkDiagram(q, errs) {
  if (!q.diagramDescription || q.diagramDescription.length < 20) {
    errs.push(`${q.id}: diagram question needs a diagramDescription of at least 20 characters`);
  }
  if (!q.answer) errs.push(`${q.id}: diagram question needs an answer`);
}

function validate(data, t) {
  const errs = [];
  if (!data || !Array.isArray(data.questions)) return ["Missing questions array."];
  const qs = data.questions;
  if (qs.length !== 20) errs.push(`Expected 20 questions, got ${qs.length}.`);

  const [lo, hi] = PAIR_RANGE[t.grade];
  const counts = {};
  const ids = new Set();
  const covered = new Set();

  qs.forEach((q) => {
    if (!q.id || ids.has(q.id)) errs.push(`Duplicate or missing id: ${q.id}`);
    ids.add(q.id);
    counts[q.section] = (counts[q.section] || 0) + 1;

    const type = q.section === "free" ? q.format : q.section;
    if (!["short", "long", "matching", "diagram"].includes(type)) {
      errs.push(`${q.id}: unknown type "${type}"`);
      return;
    }
    if (!q.question) errs.push(`${q.id}: no question text`);
    if (!Array.isArray(q.tags) || q.tags.some((x) => !TAGS.includes(x))) {
      errs.push(`${q.id}: tags must be letters from D, C, P, R, W, X, O`);
    } else {
      q.tags.forEach((x) => covered.add(x));
    }
    if (type === "short" && !q.answer) errs.push(`${q.id}: short question needs an answer`);
    if (type === "long" && (!Array.isArray(q.markingPoints) || q.markingPoints.length < 3 || q.markingPoints.length > 5)) {
      errs.push(`${q.id}: long question needs 3 to 5 markingPoints`);
    }
    if (type === "matching") checkMatching(q, lo, hi, errs);
    if (type === "diagram") checkDiagram(q, errs);
  });

  for (const [sec, n] of Object.entries(SPLIT)) {
    if ((counts[sec] || 0) !== n) errs.push(`Section "${sec}" needs ${n} questions, got ${counts[sec] || 0}.`);
  }
  for (const tag of t.tags) {
    if (!covered.has(tag)) errs.push(`Syllabus tag ${tag} is not covered by any question.`);
  }
  return errs;
}

// ---------- Generation with retries ----------
async function generate(t) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let feedback = null;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(t, feedback),
      config: { responseMimeType: "application/json" },
    });

    let data;
    try {
      data = JSON.parse(res.text);
    } catch (e) {
      feedback = ["Output was not valid JSON."];
      console.log(`Attempt ${attempt}: invalid JSON, retrying`);
      continue;
    }

    const errs = validate(data, t);
    if (errs.length === 0) {
      console.log(`Attempt ${attempt}: passed all checks`);
      return data;
    }
    feedback = errs;
    console.log(`Attempt ${attempt}: failed ${errs.length} checks`, errs.slice(0, 5));
  }
  throw new Error(`No valid worksheet after ${MAX_TRIES} tries`);
}

// ---------- Word file: matches the sample's design ----------
const NAVY = "23213D", TOMATO = "FF5A36";
const BANNER = [
  { text: "LOOK CLOSELY", fill: "FFC93C" },
  { text: "ASK WHY", fill: "3B82F6" },
  { text: "THINK LIKE A SCIENTIST", fill: "FFF6E1" },
];
const UNDERLINE_LINE = "_".repeat(80);

const run = (text, o = {}) =>
  new TextRun({
    text,
    font: o.font || "Cambria",
    size: o.size || 24,
    bold: !!o.bold,
    italics: !!o.italics,
    color: o.color || "000000",
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
  });

const para = (children, spacing = { after: 120 }, extra = {}) =>
  new Paragraph({ children, spacing, ...extra });

const rule = () =>
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080", space: 1 } },
    spacing: { before: 240, after: 240 },
    children: [],
  });

const sectionHead = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 120 },
    children: [run(text, { font: "Calibri", size: 28, bold: true, color: NAVY })],
  });

const writeLine = () => para([run(UNDERLINE_LINE)], { after: 120 });
const lines = (n) => Array.from({ length: n }, writeLine);

function matchingBlock(q) {
  const letters = "ABCDEFGHI";
  const order = q.right.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = [para([run("Write the letter of the matching answer on each line.", { italics: true })], { after: 160 })];
  q.left.forEach((item, i) => out.push(para([run(`${i + 1}. ${item}   ____________`)], { after: 160 })));
  out.push(para([run("Options", { bold: true })], { before: 200, after: 120 }));
  order.forEach((ri, k) => out.push(para([run(`${letters[k]}. ${q.right[ri]}`)], { after: 120 })));
  return out;
}

function buildDocx(data, t) {
  const kids = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 0 },
      children: [run(`ACED* ${t.subject} Worksheet`, { font: "Calibri", size: 32, bold: true, color: NAVY })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 60, after: 240 },
      children: [run(data.title, { font: "Calibri", size: 28, bold: true, color: TOMATO })],
    }),
    para([
      run(BANNER[0].text, { fill: BANNER[0].fill }),
      run("   "),
      run(BANNER[1].text, { fill: BANNER[1].fill }),
      run("   "),
      run(BANNER[2].text, { fill: BANNER[2].fill }),
    ], { after: 240 }),
    para([
      run("Name:", { bold: true }),
      run(" ____________________________________    "),
      run("Date:", { bold: true }),
      run(" ____________________"),
    ], { after: 200 }),
    para([run(`Grade ${t.grade}`, { bold: true })], { after: 200 }),
    para([run("Answer each question. Use the lines to show your working.", { fill: "FFF6E1" })], { after: 120 }),
    rule(),
  ];

  const groups = { short: [], long: [], matching: [], diagram: [] };
  data.questions.forEach((q) => groups[q.section === "free" ? q.format : q.section].push(q));
  const names = { short: "Short answer", long: "Long answer", matching: "Matching", diagram: "Diagram questions" };
  const instr = {
    short: "Answer in one or two sentences.",
    long: "Explain your answer. Show all your working.",
    diagram: "Read the description of the picture, then answer.",
  };

  let n = 0;
  for (const type of Object.keys(groups)) {
    if (!groups[type].length) continue;
    kids.push(sectionHead(names[type]));
    if (instr[type]) kids.push(para([run(instr[type], { italics: true })], { after: 160 }));

    for (const q of groups[type]) {
      n++;
      if (type === "diagram") {
        kids.push(para([run("Picture: ", { bold: true }), run(q.diagramDescription, { italics: true })], { before: 200, after: 120 }));
      }
      kids.push(para([run(`${n}. ${q.question}`, { bold: true })], { before: type === "diagram" ? 60 : 200, after: 120 }));
      if (type === "short") kids.push(...lines(3));
      if (type === "long") kids.push(...lines(8));
      if (type === "matching") kids.push(...matchingBlock(q));
      if (type === "diagram") kids.push(...lines(4));
    }
  }

  kids.push(rule());
  kids.push(para([run("GREAT WORK! Every careful answer helps you learn more.", { bold: true, color: NAVY })], { before: 240 }));

  return new Document({
    creator: "ACED",
    title: data.title,
    styles: { default: { document: { run: { font: "Cambria", size: 24 } } } },
    sections: [{
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
      },
      children: kids,
    }],
  });
}

// ---------- Run: mock batch, saves drafts to PostgreSQL ----------
async function runOne(t) {
  const data = await generate(t);
  const difficulty = t.grade <= 3 ? "easy" : t.grade <= 6 ? "medium" : "hard";

  const row = await prisma.worksheet.upsert({
    where: { subject_grade_topic: { subject: t.subject.toLowerCase(), grade: t.grade, topic: t.topic } },
    update: { title: data.title, difficulty, content: data, generatedBy: MODEL },
    create: {
      subject: t.subject.toLowerCase(),
      grade: t.grade,
      topic: t.topic,
      title: data.title,
      difficulty,
      content: data,
      generatedBy: MODEL,
    },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = `g${t.grade}_${t.subject.toLowerCase()}_${row.id}`;
  const buf = await Packer.toBuffer(buildDocx(data, t));
  fs.writeFileSync(path.join(OUT_DIR, `${base}.docx`), buf);

  console.log(`Saved draft id ${row.id}: ${data.title} -> output/${base}.docx`);
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing from .env");

  for (const t of MOCK_BATCH) {
    try {
      await runOne(t);
    } catch (e) {
      console.error(`Failed: ${t.topic}. ${e.message}`);
    }
  }

  await prisma.$disconnect();
  console.log("Batch finished. Review drafts in Prisma Studio (npx prisma studio).");
})();