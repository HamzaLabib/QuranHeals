import puppeteer from 'puppeteer-core';
const [out, localeKey] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [w, locale] of [[360, 'en'], [360, 'ar'], [393, 'ar']]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: 800, deviceScaleFactor: 2 });
  await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  await p.evaluate((k, l) => { localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); localStorage.setItem('quran-heals:dev-unicode-mushaf:tajweed:v1', 'on'); localStorage.setItem(k, l); }, localeKey, locale);
  await p.goto('http://localhost:8083/mushaf?page=3&renderer=unicode&scheme=light', { waitUntil: 'domcontentloaded', timeout: 300000 });
  await p.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90000 }); await new Promise((r) => setTimeout(r, 1200));
  const overlap = await p.evaluate(() => {
    const r = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    const chips = ['mushaf-dev-renderer', 'mushaf-dev-font', 'mushaf-dev-check', 'mushaf-dev-tajweed'].map(r).filter(Boolean);
    const icons = ['mushaf-back', 'mushaf-guide-open', 'mushaf-fullscreen-toggle'].map(r).filter(Boolean);
    let n = 0; for (const c of chips) for (const i of icons) if (c.left < i.right && c.right > i.left && c.top < i.bottom && c.bottom > i.top) n++;
    return { chips: chips.length, overlaps: n, tajweedText: document.querySelector('[data-testid="mushaf-dev-tajweed"]')?.textContent };
  });
  console.log(w, locale, JSON.stringify(overlap));
  await p.screenshot({ path: `${out}/topbar-${w}-${locale}.png`, clip: { x: 0, y: 0, width: w, height: 70 } });
  await p.close();
}
await b.close();
