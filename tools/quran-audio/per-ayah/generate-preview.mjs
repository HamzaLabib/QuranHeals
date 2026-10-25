// Writes mobile/src/audio/generated/perAyahPreview.ts, the app's DEVELOPMENT-ONLY catalogue of per-ayah recordings
// (mobile/src/audio/perAyah.ts; loaded only when __DEV__, so never in a release), from their risk reports
// (classify.mjs).
//
// A surah is listed only when every file it plays (its Basmala file where it has one, and every ayah's) passed the
// automated integrity checks: served as listed, readable MP3, plausible length (`playable` in the report). Its Full
// Surah is then complete. HIGH risk files stay in the preview (they await the owner's listening review in the dashboard);
// a surah with a file that cannot play is left out whole: a gap is never filled and never skipped.
//
// usage: node tools/quran-audio/per-ayah/generate-preview.mjs <risk.json> [<risk.json> ...] [--out <file.ts>]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');
// The canonical ayah count of each surah: a surah is listed only with a file for every ayah, 1..n, nothing more.
const AYAH_COUNTS = JSON.parse(fs.readFileSync(path.join(here, '..', 'audit-data', 'ayah-counts.json'), 'utf8'));
const argv = process.argv.slice(2);
// --release --config <dashboard.config.json>: the RELEASE catalogue (generated/perAyahRelease.ts) instead, written only
// when every gate of release-gate.mjs passes for every recording given (never for one on hold). Publishing still needs
// the owner's approval.
const RELEASE = argv.includes('--release');
const valueOf = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const flagged = new Set(['--out', '--config', '--dashboard'].flatMap((k) => (argv.includes(k) ? [argv.indexOf(k), argv.indexOf(k) + 1] : [])));
if (RELEASE) flagged.add(argv.indexOf('--release'));
const OUT = valueOf('--out') ? path.resolve(valueOf('--out')) : path.join(REPO, 'mobile', 'src', 'audio', 'generated', RELEASE ? 'perAyahRelease.ts' : 'perAyahPreview.ts');
const reports = argv.filter((_, i) => !flagged.has(i)).map((f) => ({ file: f, r: JSON.parse(fs.readFileSync(f, 'utf8')) }));
if (!reports.length) throw new Error('usage: generate-preview.mjs <risk.json> [...]');

if (RELEASE) {
  if (!valueOf('--config')) throw new Error('--release needs --config <dashboard.config.json> (the gates read its rights decisions)');
  const { releaseGate } = await import('./release-gate.mjs');
  for (const rep of reports) {
    const g = await releaseGate({ recordingId: rep.r.recording.id, config: valueOf('--config'), risk: rep.r, dashboardUrl: valueOf('--dashboard') ?? 'http://127.0.0.1:8765' });
    if (!g.pass) throw new Error(`${rep.r.recording.id}: not released, gates blocked: ${g.gates.filter((x) => !x.pass).map((x) => `${x.gate} (${x.why})`).join('; ')}`);
    rep.excluded = new Set(g.excludedSurahs ?? []); // surahs with an unresolved owner override: left out, named below
    rep.overridden = g.includedOverrides ?? []; // starts the owner released by name (unverified): kept, named below
  }
}

const lines = [];
const summary = [];
const overrideNotes = [];
for (const { file, r, excluded = new Set(), overridden = [] } of reports) {
  if (r.kind !== 'per-ayah-risk') throw new Error(`${file}: not a per-ayah risk report`);
  const rec = r.recording;
  const surahs = [];
  const left = [];
  for (let s = 1; s <= 114; s++) {
    if (excluded.has(s)) { left.push(`${s} (unresolved owner override)`); continue; }
    const own = r.items.filter((x) => x.surah === s).sort((a, b) => a.ayah - b.ayah);
    const basmala = own.find((x) => x.ayah === 0) ?? null;
    const ayahs = own.filter((x) => x.ayah > 0);
    if (!own.every((x) => x.playable && x.bytes > 0 && x.durationMs > 0)) { left.push(s); continue; }
    if (ayahs.length !== AYAH_COUNTS[s - 1] || ayahs.some((x, i) => x.ayah !== i + 1)) { left.push(`${s} (incomplete ayahs)`); continue; }
    const fingerprint = crypto.createHash('sha256').update(own.map((x) => `${x.file}:${x.bytes}:${x.sha256}`).join(';')).digest('hex').slice(0, 8);
    const f = (x) => `[${x.bytes}, ${x.durationMs}]`;
    surahs.push(`      ${s}: { fingerprint: '${fingerprint}', basmala: ${basmala ? f(basmala) : 'null'}, ayahs: [${ayahs.map(f).join(', ')}] },`);
  }
  const kept = overridden.filter((o) => surahs.some((line) => line.startsWith(`      ${o.surah}: `)));
  for (const o of kept) overrideNotes.push(` * ${rec.id} ${o.surah}: included on the owner's release override ${o.decision}; its start ${o.surah}:${o.ayah} is accepted`, ' * by owner override only, UNVERIFIED (not independent verification or a listening test).');
  summary.push(`${rec.id}: ${surahs.length} surahs${left.length ? `, left out ${left.join(', ')}` : ''}${kept.length ? `, included on owner release override ${kept.map((o) => `${o.surah}:${o.ayah}`).join(', ')}` : ''}`);
  lines.push(
    '  {',
    `    reciterId: '${rec.id}', nameEn: '${rec.nameEn}', nameAr: '${rec.nameAr}', style: '${rec.style}', provider: '${rec.provider}',`,
    `    base: '${rec.base}',`,
    `    riskReport: '${path.relative(REPO, path.resolve(file)).replaceAll('\\', '/')}', generatedOn: '${r.createdOn}',${RELEASE ? ' released: true,' : ''}`,
    '    surahs: {',
    ...surahs,
    '    },',
    '  },',
  );
}
fs.writeFileSync(OUT, [
  '// GENERATED by tools/quran-audio/per-ayah/generate-preview.mjs from the per-ayah risk reports. Do not edit.',
  '/**',
  ...(RELEASE
    ? [
        ' * The per-ayah recordings a RELEASE build plays (audio/reciters.ts), written only after every gate of',
        ' * tools/quran-audio/per-ayah/release-gate.mjs passed (see its report: device evidence may be the owner\'s risk',
        ' * acceptance, not a test). Surahs with an unresolved owner override are left out. Per surah: the fingerprint of its',
        ' * file set, the Basmala file and every ayah\'s file as [bytes, length in ms]. Automated checks are not a listening review.',
        ...overrideNotes,
      ]
    : [
        ' * DEVELOPMENT PREVIEW ONLY (audio/perAyah.ts): per-ayah recordings on trial, loaded only when __DEV__ is true',
        ' * (audio/reciters.ts), so a release build contains neither the reciters nor this data. Per surah: the fingerprint of',
        ' * its file set, the Basmala file and every ayah\'s file as [bytes, length in ms]. Only surahs whose every file passed',
        ' * the automated integrity checks are listed. Automated checks are not a listening review.',
      ]),
  ' */',
  "import type { PerAyahRecording } from '../perAyah';",
  '',
  RELEASE ? 'export const PER_AYAH_RELEASE: readonly PerAyahRecording[] = [' : 'export const PER_AYAH_PREVIEW: readonly PerAyahRecording[] = [',
  ...lines,
  '];',
  '',
].join('\n'));
console.log(`${path.relative(REPO, OUT)}: ${summary.join('; ')} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
