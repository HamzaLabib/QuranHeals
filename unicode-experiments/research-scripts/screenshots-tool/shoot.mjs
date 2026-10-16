// Screenshots of the Unicode Mushaf prototype on the local Expo web dev server (Chrome, headless).
// node shoot.mjs <outDir> <spec.json>
// spec: [{ name, page, width, height, dpr, scheme, tajweed, fullScreen, tapVerse? }]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [outDir, specPath] = process.argv.slice(2);
const specs = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--lang=en-US'] });
const results = [];
try {
  for (const s of specs) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|Network request failed|fetch/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: s.dpr ?? 2, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.evaluate((tajweed, locale, font) => {
      localStorage.setItem('quran-heals:mushaf-guide:v1', JSON.stringify({ status: 'done' }));
      localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode');
      localStorage.setItem('quran-heals:dev-unicode-mushaf:tajweed:v1', tajweed ? 'on' : 'off');
      localStorage.setItem('quran-heals:dev-unicode-mushaf:font:v1', font);
      if (locale) localStorage.setItem('quran-heals:app-locale:v1', locale);
    }, Boolean(s.tajweed), s.locale ?? null, s.font ?? 'hafs');
    const started = Date.now();
    await page.goto(`http://localhost:8083/mushaf?page=${s.page}&renderer=unicode${s.scheme ? `&scheme=${s.scheme}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    let ok = true;
    try {
      await page.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90_000 });
      await page.evaluate(() => document.fonts.ready);
    } catch {
      ok = false;
    }
    const renderMs = Date.now() - started;
    if (ok && s.fullScreen) {
      await page.click('[data-testid="mushaf-fullscreen-toggle"]');
      await new Promise((r) => setTimeout(r, 800));
    }
    if (ok && s.tapVerse) {
      // A tap on the first word of that ayah (its row maps the press to the word).
      const tapped = await page.evaluate((verseKey) => {
        const rows = [...document.querySelectorAll('[data-testid^="unicode-line-"]')];
        return rows.length;
      }, s.tapVerse);
      results.push({ name: s.name, rows: tapped });
    }
    await new Promise((r) => setTimeout(r, 600));
    const metrics = await page.evaluate(() => {
      // The page on screen (its neighbours are drawn beside it, off screen).
      const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; });
      if (!root) return { error: 'no page on screen' };
      const box = root.getBoundingClientRect();
      const fontOk = document.fonts.check('16px QH_KFGQPC_Hafs_v18') || document.fonts.check('16px QH_AmiriQuran');
      // Every line: rendered text runs (Range boxes) must not overlap, and stay inside the text area (1 px tolerance).
      const overlaps = []; const outside = []; let words = 0; let lines = 0; let colouredRuns = 0;
      for (const row of root.querySelectorAll('[data-testid^="unicode-line-"]')) {
        lines++;
        const runs = [...row.querySelectorAll('div')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 || n.nodeName === 'SPAN')).filter((el) => el.closest('[data-testid^="unicode-marker"]') === null).map((el) => { const r = document.createRange(); r.selectNodeContents(el); const t = r.getBoundingClientRect(); return { x: t.x - box.x, w: t.width, text: el.textContent }; }).filter((r) => r.w > 0);
        colouredRuns += row.querySelectorAll('div span').length;
        words += runs.length;
        runs.sort((a, b) => a.x - b.x);
        for (let i = 1; i < runs.length; i++) if (runs[i - 1].x + runs[i - 1].w > runs[i].x + 0.5) overlaps.push(row.dataset.testid + ': ' + runs[i - 1].text + ' / ' + runs[i].text + ' ' + (runs[i - 1].x + runs[i - 1].w - runs[i].x).toFixed(1) + 'px');
        for (const r of runs) if (r.x < -1 || r.x + r.w > box.width + 1) outside.push(row.dataset.testid + ': ' + r.text);
      }
      return { box: { x: box.x, y: box.y, w: box.width, h: box.height }, fontOk, lines, words, colouredRuns, overlaps, outside };
    });
    await page.screenshot({ path: join(outDir, `${s.name}.png`) });
    results.push({ name: s.name, ok, renderMs, ...metrics, errors });
    console.log(`${s.name}: ${ok ? 'ok' : 'NOT RENDERED'} ${renderMs} ms, font ${metrics.fontOk}, lines ${metrics.lines}, words ${metrics.words}, coloured ${metrics.colouredRuns}, overlaps ${metrics.overlaps?.length}, outside ${metrics.outside?.length}, errors ${errors.length}${metrics.overlaps?.length ? ' ' + metrics.overlaps.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
}
