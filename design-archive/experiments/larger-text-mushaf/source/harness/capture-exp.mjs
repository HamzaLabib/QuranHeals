// Larger-text Mushaf experiment: captures pages 4 and 604 from the RUNNING Expo web app (scratch copy with the inert
// experiment patch), original vs candidates, and records DOM measurements and per-line glyph checks against the
// verified relay dataset. Expo Web / headless Chrome; not a device or simulator.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { driver, launch } from './cdp.mjs';

const REPO = 'C:/Users/hamzalabib/OneDrive - McGill University/Documents/Personal/My App/QuranHeals';
const OUT = `${REPO}/design-archive/experiments/larger-text-mushaf`;
const SHOTS = `${OUT}/screenshots`;
const S = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const APP = 'http://localhost:8081';
mkdirSync(SHOTS, { recursive: true });
mkdirSync(`${OUT}/calculations`, { recursive: true });

// ── The verified dataset (relay version de84dc6f…): each page's glyphs, line by line. ──
const VERSION_DIR = `${REPO}/backend/data/mushaf-sync/versions/de84dc6fa58675669b4f5c30/chunks`;
const dataset = {};
for (const f of readdirSync(VERSION_DIR)) {
  const chunk = JSON.parse(gunzipSync(readFileSync(`${VERSION_DIR}/${f}`)));
  for (const p of chunk.pages) if (p.page === 4 || p.page === 604) {
    const lines = {};
    for (const [line, , , , glyph] of p.words) (lines[line] ??= []).push(glyph);
    dataset[p.page] = Object.fromEntries(Object.entries(lines).map(([l, g]) => [l, g.join('')]));
  }
}

// ── Geometry (pageGeometry.ts): candidates by glyph scale k. ──
const TILE = 0.05, TEXT_W = 0.8156829679595278, INSET_Y = 10 / 593, INSET_X = 25 / 593;
const insetFor = (k) => (1 - 2 * TILE - k * TEXT_W) / 2;
const CANDIDATES = [
  { id: 'A-original', k: 1, params: '' },
  { id: 'B-3pct', k: 1.03, params: `&exp_inset=${insetFor(1.03)}&exp_tiles=max&exp_noband=1` },
  { id: 'C-5pct', k: 1.05, params: `&exp_inset=${insetFor(1.05)}&exp_tiles=max&exp_noband=1` },
  // Side margin = the printed top/bottom margin (10/593 of the width): the widest text area with balanced margins.
  { id: 'E-6pct-balanced', k: (1 - 2 * TILE - 2 * INSET_Y) / TEXT_W, params: `&exp_inset=${INSET_Y}&exp_tiles=max&exp_noband=1` },
  { id: 'D-8pct', k: 1.08, params: `&exp_inset=${insetFor(1.08)}&exp_tiles=max&exp_noband=1` },
  // The same taller frame with the printed glyph size: isolates what the frame alone does.
  { id: 'F-frame-only', k: 1, params: `&exp_tiles=max&exp_noband=1` },
];
// Device-equivalent reading areas: the phone's points minus its status bar and home-indicator insets (the web has none,
// so this gives the reader the same space as on the device; the status bar itself is not drawn).
const VIEWPORTS = [
  { id: 'small-iphone-se', label: 'iPhone SE 375×667 (usable 375×647)', width: 375, height: 647, scale: 2 },
  { id: 'standard-iphone-14', label: 'iPhone 14 / 16e 390×844 (usable 390×763)', width: 390, height: 763, scale: 3 },
  { id: 'large-iphone-16-pro-max', label: 'iPhone 16 Pro Max 440×956 (usable 440×860)', width: 440, height: 860, scale: 3 },
  { id: 'android-pixel', label: 'Android Pixel 412×915 (usable 412×867)', width: 412, height: 867, scale: 2.625 },
];
const PAGES = [4, 604];

const browser = await launch({ port: 9340, profile: `${S}chrome-exp` });
const d = driver(browser);
const results = [];

async function open({ page, params, viewport, dark = false }) {
  await d.viewport(viewport);
  await d.colorScheme(dark);
  await d.goto(`${APP}/`);
  await d.waitFor('document.readyState === "complete"', 120000, 'home');
  await d.evaluate(`(() => { localStorage.clear(); localStorage.setItem('quran-heals:app-locale:v1', 'en');
    localStorage.setItem('quran-heals:appearance-preference:v1', ${JSON.stringify(JSON.stringify(dark ? 'dark' : 'light'))});
    localStorage.setItem('quran-heals:mushaf-reading-stops:v1', ${JSON.stringify(JSON.stringify([{ id: 'fajr', name: 'Fajr', page: 120, updatedAt: '2026-10-01T00:00:00.000Z' }]))});
    localStorage.setItem('quran-heals:mushaf-active-reading-stop:v1', 'fajr'); return true; })()`);
  await d.goto(`${APP}/mushaf?page=${page}&source=online${params}`);
  await d.waitFor(`document.querySelector('[data-testid="mushaf-zoom-page"] [data-testid="qpc-v1-text"] [data-testid="qpc-line-1"], [data-testid="mushaf-zoom-page"] [data-testid="qpc-v1-text"] [data-testid="qpc-line-2"], [data-testid="mushaf-zoom-page"] [data-testid="qpc-v1-text"] [data-testid="qpc-line-3"]')`, 120000, `page ${page}`);
  await d.sleep(3500);
}

/** Everything measurable from the DOM (CSS px = pt). */
const MEASURE = `(() => {
  const page = document.querySelector('[data-testid="mushaf-zoom-page"]');
  const text = page.querySelector('[data-testid="qpc-v1-text"]');
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) }; };
  const rows = [...text.querySelectorAll('[data-testid^="qpc-line-"]')].map((row) => {
    const n = Number(row.getAttribute('data-testid').replace('qpc-line-', ''));
    const glyphEls = [...row.querySelectorAll('div, span')].filter((e) => e.children.length === 0 && e.textContent.trim());
    const glyphs = glyphEls.map((e) => e.textContent).join('').replace(/\\s/g, '');
    const fontSizes = [...new Set(glyphEls.map((e) => parseFloat(getComputedStyle(e).fontSize)))];
    const markers = [...row.querySelectorAll('svg')].map(r);
    return { line: n, rect: r(row), glyphs, fontSizes, markers };
  });
  const headings = [...text.querySelectorAll('[data-testid^="qpc-heading-"]')].map((h) => ({ id: h.getAttribute('data-testid'), rect: r(h), ornament: (() => { const o = h.querySelector('svg'); return o ? r(o) : null; })() }));
  const pageNumber = [...page.querySelectorAll('div')].filter((e) => /^[٠-٩]+$/.test(e.textContent.trim()) && e.children.length === 0).map(r).pop() ?? null;
  const pill = document.querySelector('[data-testid="mushaf-wird"]');
  return { page: r(page), text: r(text), rows, headings, pageNumber, pill: pill ? r(pill) : null, viewport: { width: innerWidth, height: innerHeight } };
})()`;

try {
  const PROBE = process.env.PROBE === "1";
  for (const viewport of PROBE ? VIEWPORTS.slice(1, 2) : VIEWPORTS) for (const page of PROBE ? [4] : PAGES) for (const c of PROBE ? [CANDIDATES[0], CANDIDATES[3]] : CANDIDATES) {
    await open({ page, params: c.params, viewport });
    const m = await d.evaluate(MEASURE);
    const file = `p${String(page).padStart(3, '0')}-${viewport.id}-${c.id}.png`;
    await d.shot(`${SHOTS}/${file}`);
    // Glyph integrity: every rendered Quran line equals the dataset's line, glyph for glyph, in order.
    const expected = dataset[page];
    const rendered = Object.fromEntries(m.rows.filter((row) => expected[row.line] !== undefined || row.glyphs).map((row) => [row.line, row.glyphs]));
    const linesMatch = Object.keys(expected).every((l) => rendered[l] === expected[l]) && Object.keys(rendered).every((l) => expected[l] === rendered[l]);
    results.push({ file, page, viewport: viewport.label, viewportId: viewport.id, candidate: c.id, kTarget: +c.k.toFixed(4), params: c.params, measure: m, linesMatch, datasetLines: Object.keys(expected).length });
    console.log(file, 'font', m.rows[0]?.fontSizes, 'lines', m.rows.length, 'match', linesMatch);
  }
  if (PROBE) throw new Error("probe done");
  // Dark mode: original and the balanced candidate, standard phone.
  for (const page of PAGES) for (const c of CANDIDATES.filter((x) => ['A-original', 'E-6pct-balanced', 'C-5pct'].includes(x.id))) {
    const viewport = VIEWPORTS[1];
    await open({ page, params: c.params, viewport, dark: true });
    const m = await d.evaluate(MEASURE);
    const file = `p${String(page).padStart(3, '0')}-${viewport.id}-${c.id}-dark.png`;
    await d.shot(`${SHOTS}/${file}`);
    results.push({ file, page, viewport: viewport.label, viewportId: viewport.id, candidate: c.id, dark: true, kTarget: +c.k.toFixed(4), params: c.params, measure: m });
    console.log(file);
  }
  console.log('console exceptions:', browser.consoleErrors.length, browser.consoleErrors.slice(0, 3));
} finally {
  writeFileSync(`${OUT}/calculations/captures-raw.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), source: 'Expo Web (React Native Web) in headless Chrome, DevTools protocol; scratch copy of the app with the inert experiment patch', relayVersion: 'de84dc6fa58675669b4f5c30', dataset, results }, null, 1)}\n`);
  browser.close();
}
