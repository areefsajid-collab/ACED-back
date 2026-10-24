// scripts/manage.js
// Commands:
//   node scripts/manage.js add-all
//   node scripts/manage.js add "imports/Grade 1 English - Blending CVC words [D].docx"
//   node scripts/manage.js list
//   node scripts/manage.js approve 12
//   node scripts/manage.js approve-all
//   node scripts/manage.js draft 12
//   node scripts/manage.js replace 12 "imports/new version.docx"
//   node scripts/manage.js delete 12
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const prisma = require("../config/prisma");

const IMPORTS = path.join(__dirname, "..", "imports");
const SUBJECTS = {
  math: "maths", maths: "maths", mathematics: "maths",
  english: "english", science: "science", urdu: "urdu",
};

// Reads grade, subject and title from names like:
//   "Grade 1 English - Blending CVC words [D].docx"
//   "grade3_science_plants.docx"
function parseName(file) {
  let base = path.basename(file, ".docx");
  base = base.replace(/\[[^\]]*\]/g, " ");
  base = base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const low = base.toLowerCase();

  const gm = low.match(/\bgrade\s*([1-8])\b/) || low.match(/(?:^|[\s-])g([1-8])(?=[\s-]|$)/);
  const grade = gm ? parseInt(gm[1], 10) : null;

  let subject = null;
  for (const [word, key] of Object.entries(SUBJECTS)) {
    if (new RegExp(`\\b${word}\\b`).test(low)) { subject = key; break; }
  }

  let rest = base;
  if (gm) rest = rest.replace(new RegExp(gm[0], "i"), " ");
  for (const word of Object.keys(SUBJECTS)) {
    rest = rest.replace(new RegExp(`\\b${word}\\b`, "i"), " ");
  }
  rest = rest.replace(/^[\s\-:]+|[\s\-:]+$/g, "").replace(/\s+/g, " ").trim();

  const title = rest || base;
  return { grade, subject, title, topic: title.toLowerCase() };
}

async function addFile(file) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${file}`);

  const { grade, subject, title, topic } = parseName(fullPath);
  if (!grade || !subject) {
    throw new Error(`Could not read grade and subject from "${path.basename(file)}"`);
  }

  const docx = fs.readFileSync(fullPath);
  const difficulty = grade <= 3 ? "easy" : grade <= 6 ? "medium" : "hard";

  const row = await prisma.worksheet.upsert({
    where: { subject_grade_topic: { subject, grade, topic } },
    update: { title, docx, difficulty },
    create: {
      subject, grade, topic, title, difficulty,
      content: { title, source: "manual" },
      generatedBy: "manual",
      status: "draft",
      docx,
    },
  });

  console.log(`OK    id ${row.id}  Grade ${grade} ${subject}  "${title}"`);
}

async function addAll() {
  const files = fs.readdirSync(IMPORTS).filter((f) => f.toLowerCase().endsWith(".docx"));
  console.log(`Found ${files.length} files in imports/\n`);

  let ok = 0, failed = 0;
  for (const f of files) {
    try {
      await addFile(path.join(IMPORTS, f));
      ok++;
    } catch (e) {
      failed++;
      console.log(`FAIL  ${f}  (${e.message})`);
    }
  }
  console.log(`\nAdded ${ok}, failed ${failed}.`);
}

async function list() {
  const rows = await prisma.worksheet.findMany({
    orderBy: [{ subject: "asc" }, { grade: "asc" }, { topic: "asc" }],
    select: { id: true, status: true, subject: true, grade: true, title: true, docx: true },
  });
  rows.forEach((r) => {
    const file = r.docx ? "file" : "NO FILE";
    console.log(`${String(r.id).padStart(4)}  ${r.status.padEnd(9)} G${r.grade} ${r.subject.padEnd(8)} ${file.padEnd(8)} ${r.title}`);
  });
  console.log(`\n${rows.length} worksheets`);
}

async function setStatus(id, status) {
  const row = await prisma.worksheet.update({ where: { id }, data: { status } });
  console.log(`id ${row.id} is now ${status}`);
}

async function approveAll() {
  const result = await prisma.worksheet.updateMany({
    where: { status: "draft", docx: { not: null } },
    data: { status: "approved" },
  });
  console.log(`Approved ${result.count} worksheets.`);
}

async function replace(id, file) {
  if (!file) throw new Error('Give the new file, e.g. "imports/new version.docx"');
  const docx = fs.readFileSync(path.resolve(file));
  await prisma.worksheet.update({ where: { id }, data: { docx } });
  console.log(`id ${id}: file replaced`);
}

async function remove(id) {
  await prisma.worksheet.delete({ where: { id } });
  console.log(`id ${id} deleted`);
}

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "add-all") await addAll();
    else if (cmd === "add") await addFile(a);
    else if (cmd === "list") await list();
    else if (cmd === "approve") await setStatus(parseInt(a), "approved");
    else if (cmd === "approve-all") await approveAll();
    else if (cmd === "draft") await setStatus(parseInt(a), "draft");
    else if (cmd === "replace") await replace(parseInt(a), b);
    else if (cmd === "delete") await remove(parseInt(a));
    else console.log("Commands: add-all | add <file> | list | approve <id> | approve-all | draft <id> | replace <id> <file> | delete <id>");
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await prisma.$disconnect();
  }
})();