// scripts/generateAll.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { Packer } = require("docx");
const { generate, buildDocx, MODEL } = require("./generateMockWorksheet");

const prisma = new PrismaClient();

const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const AUTO_APPROVE = process.env.AUTO_APPROVE === "true";
const OUT_DIR = path.join(__dirname, "..", "output");
const FAIL_FILE = path.join(OUT_DIR, "failed.json");
const BUSY = /high demand|503|overloaded|UNAVAILABLE|429/i;
const QUOTA = /RESOURCE_EXHAUSTED|quota/i;

const SUBJECTS = {
  Mathematics: { key: "maths", name: "Maths" },
  English: { key: "english", name: "English" },
  Science: { key: "science", name: "Science" },
  Urdu: { key: "urdu", name: "Urdu" },
};

// Reads data/syllabus.txt into one entry per topic
function loadSyllabus() {
  const file = path.join(__dirname, "..", "data", "syllabus.txt");
  const items = [];
  let grade = null;
  let subject = null;

  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    let m = line.match(/^#\s*Grade\s+(\d)/);
    if (m) { grade = Number(m[1]); continue; }

    m = line.match(/^##\s*(.+)$/);
    if (m) { subject = SUBJECTS[m[1].trim()] || null; continue; }

    if (!grade || !subject) continue;

    const tagMatch = line.match(/\[([A-Z/]+)\]\s*$/);
    const tags = tagMatch ? tagMatch[1].split("/") : ["C"];
    const topic = line.replace(/\s*\[[A-Z/]+\]\s*$/, "");

    items.push({ subject: subject.key, subjectName: subject.name, grade, topic, tags });
  }
  return items;
}

let quotaHit = false;
const failed = [];

// Retries the model when it's busy, with growing waits
async function withRetry(fn, label) {
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e) {
      if (QUOTA.test(e.message)) { quotaHit = true; throw e; }
      if (!BUSY.test(e.message) || i === 4) throw e;
      const wait = 15000 * (i + 1);
      console.log(`  ${label}: model busy, waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function doOne(item) {
  const key = { subject_grade_topic: { subject: item.subject, grade: item.grade, topic: item.topic } };

  // Skip what's already approved, so re-runs only do the rest
  const existing = await prisma.worksheet.findUnique({ where: key });
  if (existing && existing.status === "approved") return "skipped";

  const t = { ...item, subject: item.subjectName };
  const data = await withRetry(() => generate(t), `G${item.grade} ${item.subjectName}`);

  const difficulty = item.grade <= 3 ? "easy" : item.grade <= 6 ? "medium" : "hard";
  const status = AUTO_APPROVE ? "approved" : "draft";
  const row = await prisma.worksheet.upsert({
    where: key,
    update: { title: data.title, difficulty, content: data, generatedBy: MODEL, status },
    create: {
      subject: item.subject, grade: item.grade, topic: item.topic,
      title: data.title, difficulty, content: data, generatedBy: MODEL, status,
    },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = `g${item.grade}_${item.subject}_${row.id}`;
  fs.writeFileSync(path.join(OUT_DIR, `${base}.docx`), await Packer.toBuffer(buildDocx(data, t)));
  return "saved";
}

(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing from .env");

  const items = loadSyllabus();
  console.log(`Loaded ${items.length} topics. Concurrency ${CONCURRENCY}. Auto-approve: ${AUTO_APPROVE}`);

  const counts = { saved: 0, skipped: 0, failed: 0 };
  const started = Date.now();
  let next = 0;

  async function worker(id) {
    while (next < items.length && !quotaHit) {
      const item = items[next++];
      const label = `[${next}/${items.length}] G${item.grade} ${item.subjectName}: ${item.topic.slice(0, 50)}`;
      try {
        const result = await doOne(item);
        counts[result]++;
        console.log(`${result === "skipped" ? "Skipped" : "Saved"} ${label}`);
      } catch (e) {
        counts.failed++;
        failed.push({ ...item, error: e.message });
        console.log(`Failed ${label}. ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(FAIL_FILE, JSON.stringify(failed, null, 2));

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} min. Saved ${counts.saved}, skipped ${counts.skipped}, failed ${counts.failed}.`);
  if (quotaHit) console.log("Stopped early: the daily quota ran out. Run the same command again tomorrow. Finished topics are skipped.");
  if (failed.length) console.log(`Failed topics are listed in output/failed.json. Run the command again to retry them.`);

  await prisma.$disconnect();
})();