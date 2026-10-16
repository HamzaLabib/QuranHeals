import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage(); await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.evaluate(() => { localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); });
for (const [page, ayah] of [[61, '3:84'], [604, '114:1'], [3, '2:8']]) {
  await p.goto(`http://localhost:8083/mushaf?page=${page}&ayah=${ayah}&at=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await p.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90000 }); await p.waitForFunction((page) => { const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const x = el.getBoundingClientRect(); return x.x > -5 && x.right < innerWidth + 5; }); return root && root.getAttribute('aria-label')?.endsWith(' ' + page); }, { timeout: 60000 }, page); await new Promise((r) => setTimeout(r, 800));
  const r = await p.evaluate(() => { const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const x = el.getBoundingClientRect(); return x.x > -5 && x.right < innerWidth + 5; }); return { highlights: root.querySelectorAll('[data-testid^="unicode-highlight-"]').length, label: root.getAttribute('aria-label') }; });
  console.log(`page ${page} ayah ${ayah}:`, JSON.stringify(r));
}
await b.close();
