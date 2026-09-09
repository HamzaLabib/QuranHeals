import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the installed browser-driver executable path.');
const browserUrl = 'http://localhost:8083';
const apiUrl = 'http://127.0.0.1:4000';
function browser(...args) {
  const raw = execFileSync(executable, ['--session', 'quran-runtime', '--json', ...args], { encoding: 'utf8', timeout: 45000, windowsHide: true });
  const result = JSON.parse(raw);
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}
function evaluate(source) { return browser('eval', source).result; }
async function ready(label) {
  const deadline = Date.now() + 30000;
  while (!evaluate(`Boolean(document.querySelector('[aria-label="${label}"]'))`)) {
    if (Date.now() > deadline) throw new Error(`Browser did not render ${label}: ${evaluate('document.body.innerText')}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
function click(label) { evaluate(`document.querySelector('[aria-label="${label}"]').click()`); }
function displayed() {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll('div')];
    const text = nodes.find(node => node.getAttribute('dir') === 'rtl' || node.style.writingDirection === 'rtl');
    const candidates = nodes.filter(node => getComputedStyle(node).direction === 'rtl' && node.children.length === 0);
    const arabic = text?.textContent ?? candidates[0]?.textContent;
    const reference = document.body.innerText.match(/(?:•|\\u2022) (\\d+:\\d+)/)?.[1];
    return {arabic, reference};
  })()`);
}

const db = new DatabaseSync(fileURLToPath(new URL('../../mobile/assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
try {
  const report = { environment: 'isolated browser-driver session, local read-only development API', emotions: [], checks: {} };
  assert.equal(evaluate('crossOriginIsolated'), true);
  const emotions = (await (await fetch(`${apiUrl}/api/emotions`)).json()).data;
  for (const emotion of emotions) {
    browser('open', `${browserUrl}/ayah/${emotion.key}`);
    await ready('Load another ayah');
    const value = displayed();
    assert.ok(value.reference, `Missing reference for ${emotion.key}`);
    const original = db.prepare('SELECT arabic_text FROM verses WHERE verse_key = ?').get(value.reference);
    assert.equal(value.arabic, original.arabic_text, `${emotion.key} displayed Arabic differs`);
    report.emotions.push({ emotion: emotion.key, verseKey: value.reference, exactArabic: true });
    console.log(`Verified ${emotion.key}: ${value.reference}`);
  }

  // Test data is confined to this fresh test browser origin/session.
  const payload = (await (await fetch(`${apiUrl}/api/ayahs/random?emotion=sad`)).json()).data;
  const original = db.prepare('SELECT arabic_text FROM verses WHERE verse_key = ?').get(payload.verseKey).arabic_text;
  const oldFavorite = { ...payload, arabicText: 'UNTRUSTED_LEGACY_SNAPSHOT', savedAt: '2026-01-01T00:00:00.000Z' };
  delete oldFavorite.verseKey;
  delete oldFavorite.referenceKey; // Only reliable numeric reference remains.
  const stored = JSON.stringify([oldFavorite, { id: '66f100000000000000000099' }]);
  evaluate(`localStorage.setItem('quran-heals:favorites', ${JSON.stringify(stored)})`);
  browser('open', `${browserUrl}/favorites`);
  await ready('Share saved ayah');
  assert.equal(displayed().arabic, original);
  assert.equal(evaluate(`localStorage.getItem('quran-heals:favorites')`), stored);
  assert.equal(evaluate(`document.body.innerText.includes('UNTRUSTED_LEGACY_SNAPSHOT')`), false);
  assert.equal(evaluate(`document.body.innerText.includes('1 saved ayah could not be resolved')`), true);
  report.checks.legacyFavorite = 'Numeric-only reference resolves; original snapshot/date/id and unresolved record retained; cached Arabic absent';

  evaluate(`Object.defineProperty(navigator, 'share', {configurable:true, value: async value => {window.__quranShared = value;}})`);
  click('Share saved ayah');
  await new Promise(resolve => setTimeout(resolve, 300));
  const shared = evaluate('window.__quranShared');
  assert.ok(shared?.text?.startsWith(original + '\n\n'));
  report.checks.share = 'Shared Arabic exactly equals SQLite';

  // Block every application fetch in this page. Cached local SQLite remains usable.
  evaluate(`window.fetch = async () => { throw new Error('Offline verification'); }; document.querySelector('[aria-label="Try Again"]')?.click()`);
  // The retry action uses StateView's text label rather than an aria-label.
  evaluate(`[...document.querySelectorAll('[role="button"]')].find(node => node.textContent === 'Try Again')?.click()`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(displayed().arabic, original);
  report.checks.offlineFavorite = 'Existing initialized local reader works without API fetch';

  // This emotion's single mapping is distinct from every sad mapping, ensuring
  // the save check creates a new favorite rather than toggling the old fixture.
  browser('open', `${browserUrl}/ayah/confused`);
  await ready('Load another ayah');
  if (evaluate(`Boolean(document.querySelector('[aria-label="Save ayah to favorites"]'))`)) click('Save ayah to favorites');
  await new Promise(resolve => setTimeout(resolve, 300));
  const favorites = evaluate(`JSON.parse(localStorage.getItem('quran-heals:favorites'))`);
  assert.ok(favorites.some(row => row.verseKey));
  assert.ok(favorites.some(row => row.id === '66f100000000000000000099'));
  const oldIds = evaluate(`JSON.parse(localStorage.getItem('quran-heals:recent-ayahs')).confused`);
  const keys = evaluate(`JSON.parse(localStorage.getItem('quran-heals:recent-verse-keys:v1')).confused`);
  assert.ok(oldIds.every(id => /^[a-f0-9]{24}$/i.test(id)));
  assert.ok(keys.every(key => /^\d+:\d+$/.test(key)));
  click('Load another ayah');
  await ready('Load another ayah');
  report.checks.saveAndHistory = 'New favorites have verseKey; unresolved old entry retained; old-ID exclusions and stable companion keys coexist';
  report.checks.browserErrors = browser('errors');
  writeFileSync(new URL('../../docs/quran-runtime-browser-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log('Browser runtime flow checks passed.');
} finally { db.close(); }
