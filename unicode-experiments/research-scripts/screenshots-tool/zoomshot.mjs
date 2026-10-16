// High-DPR crop of one page region: node zoomshot.mjs page out.png x y w h [scheme] [tajweed] [font]
import puppeteer from 'puppeteer-core';
const [pageNo, out, x, y, w, h, scheme = 'light', tajweed = 'on', font = 'hafs'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 4, isMobile: true, hasTouch: true });
await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.evaluate((t, f) => { localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); localStorage.setItem('quran-heals:dev-unicode-mushaf:tajweed:v1', t); localStorage.setItem('quran-heals:dev-unicode-mushaf:font:v1', f); }, tajweed, font);
await p.goto(`http://localhost:8083/mushaf?page=${pageNo}&renderer=unicode&scheme=${scheme}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90000 });
await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 900));
await p.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } }); await b.close();
