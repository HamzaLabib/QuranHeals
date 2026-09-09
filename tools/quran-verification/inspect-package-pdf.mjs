// Optional read-only evidence step. Install pdfjs-dist only in ignored staging.
import { readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from '../quran-import/staging/inspection/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { sha256 } from './verify.mjs';

const input = new URL('../quran-import/staging/kfgqpc/UthmanicHafs_v2-0 font/uthmanic_hafs_v2-0.pdf', import.meta.url);
const bytes = readFileSync(input);
const loadingTask = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: new URL('../quran-import/staging/inspection/node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href });
const doc = await loadingTask.promise;
const hits = []; let extractedCharacters = 0;
const pattern = /licen|copyright|permiss|redistrib|rights|مجمع|حقوق|استخدام|نسخ|نشر|تعديل/iu;
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const strings = content.items.filter(i => typeof i.str === 'string').map(i => i.str);
  extractedCharacters += strings.join('').length;
  strings.forEach((text, i) => {
    if (pattern.test(text)) hits.push({ page: n, text, context: strings.slice(Math.max(0,i-2),i+3).join(' ') });
  });
  page.cleanup();
}
const metadata = await doc.getMetadata();
const result = { internalPath: 'UthmanicHafs_v2-0 font/uthmanic_hafs_v2-0.pdf', sha256: sha256(bytes), pages: doc.numPages, extractedCharacters, metadata: metadata.info, method: 'PDF.js text extraction across every page; keyword/context inspection, not a visual certification or legal determination. Standard-font loading warning occurred; text extraction completed with Arabic display-order artifacts.', hits };
writeFileSync(new URL('./output/kfgqpc-pdf-inspection.json', import.meta.url), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pages: result.pages, extractedCharacters, keywordHits: hits.length, distinctHitTexts: [...new Set(hits.map(h=>h.text))]},null,2));
await loadingTask.destroy();
