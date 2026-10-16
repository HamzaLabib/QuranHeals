import puppeteer from 'puppeteer-core';
const [pageNo, line] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.evaluate(() => { localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); });
await p.goto(`http://localhost:8083/mushaf?page=${pageNo}&renderer=unicode&scheme=light`, { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90000 });
await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 800));
const out = await p.evaluate((line) => {
  const pages = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')];
  const root = pages.find((el) => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.x < 393; });
  const row = root.querySelector(`[data-testid="unicode-line-${line}"]`);
  const rootX = root.getBoundingClientRect().x;
  return [...row.querySelectorAll('div[dir], div')].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3)).map((el) => {
    const box = el.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(el); const t = range.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return `${el.textContent} box[${(box.x - rootX).toFixed(1)}, ${box.width.toFixed(1)}] text[${(t.x - rootX).toFixed(1)}, ${t.width.toFixed(1)}] dir=${cs.direction} ws=${cs.whiteSpace} align=${cs.textAlign} ov=${cs.textOverflow}`;
  });
}, line);
console.log(out.join('\n')); await b.close();
