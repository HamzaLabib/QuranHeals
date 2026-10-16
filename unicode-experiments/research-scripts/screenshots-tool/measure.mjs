import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage(); await p.goto(process.argv[2]); await p.evaluate(() => document.fonts.ready);
console.log(await p.evaluate(() => ['a','b','c','d','e'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return `${id}: x ${r.x.toFixed(1)} w ${r.width.toFixed(1)}`; }).join('\n')));
await p.screenshot({ path: process.argv[3] }); await b.close();
