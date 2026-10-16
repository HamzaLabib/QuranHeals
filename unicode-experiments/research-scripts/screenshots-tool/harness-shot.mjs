import puppeteer from 'puppeteer-core';
const [url, out, w = '356', h = '650', dpr = '3'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr });
await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => document.body.dataset.ready === '1', { timeout: 30000 }); await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: out }); await b.close();
