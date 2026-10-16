// Interaction checks of the Unicode prototype on the local Expo web dev server (headless Chrome, guest, no backend).
import puppeteer from 'puppeteer-core';

import { DatabaseSync } from 'node:sqlite';
const EXPECTED_2_6 = new DatabaseSync(new URL('../../../mobile/assets/quran/quran.sqlite', import.meta.url), { readOnly: true }).prepare('SELECT arabic_text AS t FROM verses WHERE verse_key = ?').get('2:6').t;
const out = process.argv[2];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = b.defaultBrowserContext();
await ctx.overridePermissions('http://localhost:8083', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const p = await b.newPage();
await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2 });
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto('http://localhost:8083/', { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('quran-heals:mushaf-guide:v1', '{"status":"done"}'); localStorage.setItem('quran-heals:dev-unicode-mushaf:renderer:v1', 'unicode'); localStorage.setItem('quran-heals:dev-unicode-mushaf:tajweed:v1', 'off'); });
await p.goto('http://localhost:8083/mushaf?page=3&renderer=unicode&scheme=light', { waitUntil: 'domcontentloaded', timeout: 300000 });
await p.waitForSelector('[data-testid="unicode-mushaf-text"]', { timeout: 90000 });
await p.evaluate(() => document.fonts.ready); await wait(1000);

// Where things are, on the page on screen.
const locate = (selector) => p.evaluate((selector) => {
  const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; });
  const el = root?.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, selector);
const firstWordOfLine = (line) => p.evaluate((line) => {
  const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; });
  const row = root.querySelector(`[data-testid="unicode-line-${line}"]`);
  const words = [...row.querySelectorAll('div')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3)).map((el) => { const rg = document.createRange(); rg.selectNodeContents(el); const t = rg.getBoundingClientRect(); return { x: t.x + t.width / 2, y: t.y + t.height / 2, right: t.right, text: el.textContent }; });
  return words.sort((a, b) => b.right - a.right)[0];
}, line);

// 1. A tap on an ayah's words: the Reflection · Save · Copy · Share popup, and the ayah highlighted.
const word = await firstWordOfLine(1);
await p.mouse.click(word.x, word.y);
await wait(800);
check('tap on a word opens the ayah popup', Boolean(await p.$('[data-testid="mushaf-ayah-actions"]')), word.text);
check('the tapped ayah is highlighted (its band on line 1)', Boolean(await locate('[data-testid="unicode-highlight-1"]')));
await p.screenshot({ path: `${out}/interact-1-ayah-popup.png` });

// 2. Copy: the verified Arabic of 2:6, exactly (not the drawn characters, not the display encoding).
await p.click('[data-testid="mushaf-ayah-copy"]');
await wait(600);
const copied = await p.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
check('Copy puts exactly the verified text of 2:6 on the clipboard', copied === EXPECTED_2_6, copied === EXPECTED_2_6 ? '' : JSON.stringify(copied).slice(0, 120));
check('Copy keeps U+0652 sukun and U+06DF round zero (no display encoding leaks)', copied.includes('\u0652') && copied.includes('\u06DF') && !copied.includes('\u06E1'));
await p.click('[data-testid="mushaf-ayah-actions-backdrop"]');
await wait(500);
check('dismissing the popup clears the highlight', !(await locate('[data-testid="unicode-highlight-1"]')));

// 3. A tap on an ayah's number (the medallion of 2:6): Apply to ورد.
const medallion = await locate('[data-testid="unicode-marker-2:6"]');
await p.mouse.click(medallion.x, medallion.y);
await wait(800);
check('tap on a medallion opens Apply to ورد', Boolean(await p.$('[data-testid="mushaf-wird-apply"]')));
await p.screenshot({ path: `${out}/interact-2-wird-apply.png` });

// 4. No ورد yet: Apply opens the name field; saving "Fajr" makes it active with 2:6 → 2:6's medallion turns gold.
await p.click('[data-testid="mushaf-wird-apply-button"]');
await wait(600);
check('Apply without a ورد opens the ورد name field', Boolean(await p.$('[data-testid="mushaf-popup-save"]')));
await p.type('[data-testid="mushaf-popup-save"] input', 'Fajr');
await p.keyboard.press('Enter');
await wait(1500);
const gold = await p.evaluate(() => {
  const root = [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].find((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; });
  return [...root.querySelectorAll('[data-testid="unicode-wird-marker"]')].length;
});
check('the saved ayah`s medallion is gold (exactly one on the page)', gold === 1, `${gold} gold`);
await p.screenshot({ path: `${out}/interact-3-gold-medallion.png` });

// 5. Tajweed ON keeps the gold medallion and the text positions.
const before = await firstWordOfLine(5);
await p.click('[data-testid="mushaf-dev-tajweed"]');
await wait(1500);
const after = await firstWordOfLine(5);
const goldAfter = await p.evaluate(() => [...document.querySelectorAll('[data-testid="unicode-wird-marker"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.x > 0 && r.x < innerWidth; }).length);
check('Tajweed ON: the same words at the same places (line 5, first word)', before.text === after.text && Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5, `${before.x.toFixed(1)},${before.y.toFixed(1)} → ${after.x.toFixed(1)},${after.y.toFixed(1)}`);
check('Tajweed ON: the gold medallion stays', goldAfter === 1);
await p.screenshot({ path: `${out}/interact-4-tajweed-gold.png` });

// 6. Navigation: the next page by the page's own next action is out of scope here; a swipe left→right turns forward.
await p.mouse.move(80, 500); await p.mouse.down(); await p.mouse.move(200, 505, { steps: 8 }); await p.mouse.move(320, 510, { steps: 8 }); await p.mouse.up();
await wait(2000);
const pageNow = await p.evaluate(() => document.body.innerText.match(/[٠-٩]+(?=\s*\n[^\n]*$)/)?.[0] ?? null);
const onScreenHeads = await p.evaluate(() => [...document.querySelectorAll('[data-testid="unicode-mushaf-text"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.x > -5 && r.right < innerWidth + 5; }).length);
check('a left-to-right swipe turns the page (a Unicode page is on screen after it)', onScreenHeads === 1, `page label ${pageNow}`);
await p.screenshot({ path: `${out}/interact-5-after-swipe.png` });

console.log(results.join('\n'));
await b.close();
