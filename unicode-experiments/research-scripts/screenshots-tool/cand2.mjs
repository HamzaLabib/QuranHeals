// Text-area screenshots of each Unicode candidate (app, web) and of QCF V1 (harness), same size, dpr 3.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The QCF V1 reference pages written by qcf-reference/make-qcf.mjs (kept local: QF content); QCF_REFERENCE_DIR or ./qcf.
const QCF_DIR = pathToFileURL(resolve(process.env.QCF_REFERENCE_DIR ?? 'qcf')).href;
const [out, pagesArg, fontsArg, tajweed = 'off'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pages = pagesArg.split(',').map(Number), fonts = fontsArg.split(',');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 3 });
const PAD = 10; const shot = async (h, path) => { const r = await h.boundingBox(); await p.screenshot({ path, clip: { x: r.x - PAD, y: r.y - 4, width: r.width + 2 * PAD, height: r.height + 8 } }); };
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
for (const font of fonts) {
  for (const page of pages) {
    if (font === 'qcf') {
      await p.goto(`${QCF_DIR}/page-${page}.html`, { waitUntil: 'load' });
      await p.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 });
      await shot(await p.$("#area"), `${out}/p${String(page).padStart(3, "0")}-qcf.png`);
      continue;
    }
    if (!p.url().startsWith('http://localhost:8083')) await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
    await p.evaluate((f, t) => { localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); localStorage.setItem('quran-heals:dev-unicode-mushaf:tajweed:v1', t); localStorage.setItem('quran-heals:dev-unicode-mushaf:font:v1', f); }, font, tajweed);
    await p.goto(`http://localhost:8083/mushaf?page=${page}&renderer=unicode&scheme=light&t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    await p.waitForFunction(() => [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].some((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; }), { timeout: 120000 });
    await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 900));
    const el = await p.evaluateHandle(() => [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((e) => { const r = e.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; }));
    await shot(el.asElement(), `${out}/p${String(page).padStart(3, '0')}-${font}${tajweed === 'on' ? '-tajweed' : ''}.png`);
  }
}
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await b.close();
