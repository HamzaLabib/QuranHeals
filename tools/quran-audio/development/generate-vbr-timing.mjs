// Writes mobile/src/audio/generated/vbrTiming.ts: DEVELOPMENT timing for the MP3Quran VBR recordings of Islam Sobhi,
// Yasser Mahmoud Salama (48) and Ahmed Al-Agamy (42), used by the app ONLY when the installed binary seeks VBR files
// exactly (mobile/src/audio/vbrSeek.ts; native-patches/expo-audio-exact-mp3-seek). Every other reciter and surah is
// out of scope by construction (TARGETS).
//
// The timing is the review dashboard's accepted timing (acceptedTiming, as generate-reviewed-timing.mjs: Reviewer 1
// where a person reviewed, the automatic policy elsewhere), read only. A surah is listed only when: it is a target; its
// task is the catalogue's own MP3Quran file at the audited size; its only playback block is VBR seeking; every start is
// accepted; and it is not EXCLUDED (structural or opening defects found on 2026-10-24, kept for a person).
//
// usage (from tools/quran-audio): node development/generate-vbr-timing.mjs --config <dashboard.config.json> [--out f] [--report f]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';
import { ledgerFile, openLedger } from '../review/dashboard/auto-accept.mjs';
import { readConfig } from '../review/dashboard/dashboard-lib.mjs';
import { openOverrides, overrideFile } from '../review/dashboard/owner-override.mjs';
import { createLogStore } from '../review/manual/log-store.mjs';
import { acceptedTiming } from './generate-reviewed-timing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const REPO = path.join(tools, '..', '..');
export const TARGETS = { 'islam-sobhi': () => true, 'yasser-salama': (s) => s === 48, ajmi: (s) => s === 42 };
export const EXCLUDED = {
  'islam-sobhi:17': 'unresolved structure: the two alignment configurations disagree by 5.0-12.7 s at 17:22, 58, 88 (extra audio), in the original and in its CBR copy',
  'islam-sobhi:24': 'unresolved structure: the two alignment configurations disagree by 3.1-11.2 s at 24:9, 34, 37, 41, 42, 57 (extra audio); a CBR copy\'s alignment and the accepted timing disagree by 1.7 s (24:34) and 5.1 s (24:57)',
  'islam-sobhi:74': 'opening possibly clipped: the file starts with sound (-14.5 dB in its first 50 ms, recitation level within 100 ms)',
  'islam-sobhi:109': 'opening clipped: the file starts at full recitation level (a CBR copy has sound before this point); ayah 1 itself complete from 1.9 s',
};
const VBR_BLOCK = /^the app streams MP3Quran's original, which it cannot seek to an ayah/;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (!opt('--config')) throw new Error('usage: node development/generate-vbr-timing.mjs --config <dashboard.config.json> [--out f] [--report f]');
  const cfg = readConfig(opt('--config'));
  const OUT = opt('--out') ? path.resolve(opt('--out')) : path.join(REPO, 'mobile', 'src', 'audio', 'generated', 'vbrTiming.ts');
  const audit = new Map(readJson(path.join(tools, 'audit-results.json')).reciters.map((r) => [r.id, r]));
  const inv = readJson(path.join(cfg.registryDir, 'inventory.json'));
  const tasks = new Map(inv.tasks.map((t) => [t.key, t]));
  const store = createLogStore({ locate: (k) => tasks.get(k) ?? null });
  const ledger = openLedger(ledgerFile(cfg.dataDir));
  if (ledger.problem) throw new Error(ledger.problem);
  const overrides = openOverrides(overrideFile(cfg.dataDir));
  if (overrides.problem) throw new Error(overrides.problem);
  const repairs = readJson(path.join(tools, 'surah-sources', 'boundary-repairs.json')).repairs ?? [];
  const out = {};
  const report = { kind: 'vbr-timing-report', createdAt: new Date().toISOString(), reciters: {} };
  for (const t of [...tasks.values()].sort((x, y) => x.reciterId.localeCompare(y.reciterId) || x.surah - y.surah)) {
    if (t.reviewType !== 'alignment-verification' || t.provider !== 'mp3quran' || t.format?.mode !== 'vbr' || !TARGETS[t.reciterId]?.(t.surah)) continue;
    const rr = (report.reciters[t.reciterId] ??= { enabled: {}, unavailable: {} });
    const no = (why) => { rr.unavailable[t.surah] = why; };
    const aud = audit.get(t.reciterId);
    if (!aud?.server || t.url !== `${aud.server}${String(t.surah).padStart(3, '0')}.mp3` || t.bytes !== aud.bytes[t.surah]) { no('not the catalogue\'s MP3Quran file at the audited size'); continue; }
    if (EXCLUDED[`${t.reciterId}:${t.surah}`]) { no(EXCLUDED[`${t.reciterId}:${t.surah}`]); continue; }
    const other = (t.playbackBlocked ?? []).filter((b) => !VBR_BLOCK.test(b));
    if (other.length) { no(`playback-blocked: ${other.join('; ')}`); continue; }
    const { session, state } = store.load(t.key);
    // The recording is VBR: exact seeking is what the native patch provides; every other condition is checked as usual.
    const r = acceptedTiming({ ...t, playbackBlocked: [] }, { ...session, format: { ...session.format, mode: 'cbr' } }, state, ledger.forKey(t.key), overrides.forKey(t.key), t.ayahCount);
    if (r.why) { no(r.why); continue; }
    // Recorded boundary repairs (surah-sources/boundary-repairs.json) made for this exact file and accepted start only.
    const fixes = repairs.filter((x) => x.reciterId === t.reciterId && x.surah === t.surah && x.url === t.url);
    const bad = fixes.find((x) => { const k = x.ayah - 1; return !(k > 0 && k < r.entries.length) || r.entries[k].startMs !== x.fromMs || !(x.toMs > r.entries[k - 1].startMs && x.toMs < r.entries[k].endMs); });
    if (bad) { no(`boundary repair of ${t.surah}:${bad.ayah} does not apply (made for ${bad.fromMs} ms)`); continue; }
    for (const x of fixes) { r.entries[x.ayah - 1].startMs = x.toMs; r.entries[x.ayah - 2].endMs = x.toMs; }
    const fingerprint = timingFingerprint(r.entries);
    const points = [...r.entries.map((e) => e.startMs), r.entries.at(-1).endMs];
    (out[t.reciterId] ??= {})[t.surah] = { fingerprint, bytes: t.bytes, reviewer1: r.how.reviewer1, automatic: r.how.automatic, deltas: points.map((p, k) => (k === 0 ? p : p - points[k - 1])) };
    rr.enabled[t.surah] = { key: t.key, fingerprint, reviewer1: r.how.reviewer1, automatic: r.how.automatic, ...(fixes.length ? { repaired: fixes.map((x) => `${x.ayah}: ${x.fromMs} -> ${x.toMs} ms`) } : {}) };
  }
  const lines = [
    '// GENERATED by tools/quran-audio/development/generate-vbr-timing.mjs from the review dashboard. Do not edit.',
    '/**',
    ' * DEVELOPMENT ONLY, and only on a binary that seeks VBR MP3 files exactly (audio/vbrSeek.ts): the accepted ayah timing',
    ' * of the MP3Quran VBR recordings of Islam Sobhi, Yasser Mahmoud Salama (48) and Ahmed Al-Agamy (42). Per surah: the',
    ' * timing fingerprint, the audited file size, the starts Reviewer 1 and the automatic policy accepted, and the timing',
    ' * delta-encoded (ayah 1\'s start, then each ayah\'s length).',
    ' */',
    'export const VBR_TIMING: Readonly<Record<string, Readonly<Record<number, { fingerprint: string; bytes: number; reviewer1: number; automatic: number; deltas: readonly number[] }>>>> = {',
  ];
  for (const [id, surahs] of Object.entries(out)) {
    lines.push(`  '${id}': {`);
    for (const [s, x] of Object.entries(surahs)) lines.push(`    ${s}: { fingerprint: '${x.fingerprint}', bytes: ${x.bytes}, reviewer1: ${x.reviewer1}, automatic: ${x.automatic}, deltas: [${x.deltas.join(', ')}] },`);
    lines.push('  },');
  }
  lines.push('};', '');
  fs.writeFileSync(OUT, lines.join('\n'));
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));
  for (const [id, r] of Object.entries(report.reciters)) console.log(`${id}: ${Object.keys(r.enabled).length} enabled (${Object.keys(r.enabled).join(',')}); not: ${JSON.stringify(Object.fromEntries(Object.entries(r.unavailable).map(([s, w]) => [s, w.slice(0, 50)])))}`);
}
