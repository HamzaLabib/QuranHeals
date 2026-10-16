import puppeteer from 'puppeteer-core';
const [url, out, w = '900', h = '2400'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: out, fullPage: true }); await b.close();
