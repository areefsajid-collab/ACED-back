// scripts/cache-all.js
require('dotenv').config();
const prisma = require('../config/prisma');
const mammoth = require('mammoth');

async function cacheAll() {
  console.log("Fetching worksheets from database...");

  // Find any worksheet that has a Word file but no cached HTML
  const worksheets = await prisma.worksheet.findMany({
    where: {
      docx: { not: null },
      htmlPreview: null
    },
    select: { id: true, title: true, docx: true }
  });

  if (worksheets.length === 0) {
    console.log("All worksheets are already cached! Nothing to do.");
    return;
  }

  console.log(`Found ${worksheets.length} uncached worksheets. Starting conversion...`);

  let count = 0;
  for (const ws of worksheets) {
    try {
      // 1. Convert Word to HTML
      const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(ws.docx) });

      // 2. Cut off the answer key
      const cut = html.search(/<h[1-6][^>]*>\s*answer key/i);
      const finalHtml = cut === -1 ? html : html.slice(0, cut);

      // 3. Save to database
      await prisma.worksheet.update({
        where: { id: ws.id },
        data: { htmlPreview: finalHtml }
      });

      count++;
      console.log(`[${count}/${worksheets.length}] Cached: ${ws.title} (ID: ${ws.id})`);
    } catch (error) {
      console.error(`Failed to cache ID ${ws.id}:`, error.message);
    }
  }

  console.log(`\nDone! Successfully cached ${count} worksheets.`);
}

cacheAll()
  .catch(console.error)
  .finally(() => prisma.$disconnect());