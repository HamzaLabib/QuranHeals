import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// Ahmed Mohamed Salama (Phase 4): whole-surah candidate sources (tools/quran-audio/surah-sources), the source choice and
// the development catalogue's gate. SYNTHETIC data only, in temporary folders.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const { OPENING_RULE } = await imp('review/manual/opening.mjs');
type J = any;

describe('source choice (select.mjs): one whole, unmodified file per surah, never a splice', () => {
  const local = fs.mkdtempSync(join(os.tmpdir(), 'qh-sources-'));
  const root = join(local, 'QuranHeals', 'surah-cache', 'ahmed-salama');
  const fmt = (durationMs: number, mode = 'cbr', problems: string[] = []) => ({ mode, kbps: mode === 'cbr' ? 128 : 140, kbpsRange: [128, 128], sampleRates: [44100], channels: ['stereo'], seekHeader: null, durationMs, problems, junkBytes: 0, id3v2: 0, tags: {} });
  const man = (s: number, ok = true) => (ok ? { ok: true, url: `https://x/${s}.mp3`, bytes: 1000 + s, sha256: 'a'.repeat(64), status: 200 } : { ok: false, status: 404, error: 'HTTP 404' });
  for (const [src, files] of [
    ['way2quran', { 1: man(1), 2: man(2), 3: man(3), 4: man(4), 5: man(5, false), 6: man(6), 7: man(7) }],
    ['assabile', { 1: man(1), 2: man(2), 3: man(3), 4: man(4), 5: man(5), 6: man(6), 7: man(7) }],
  ] as const) {
    fs.mkdirSync(join(root, src), { recursive: true });
    fs.writeFileSync(join(root, src, 'manifest.json'), JSON.stringify({ files }));
  }
  fs.writeFileSync(join(root, 'way2quran', 'formats.json'), JSON.stringify({ 1: fmt(60_000), 2: fmt(29_500), 3: fmt(29_500), 4: fmt(50_000), 6: fmt(60_000, 'cbr', ['300 bytes without sync at byte 4']), 7: fmt(60_000) }));
  fs.writeFileSync(join(root, 'assabile', 'formats.json'), JSON.stringify({ 1: fmt(60_100), 2: fmt(30_000), 3: fmt(30_000), 4: fmt(60_000), 5: fmt(40_000), 6: fmt(60_000), 7: fmt(60_000, 'vbr') }));
  const same = { verdict: 'same', found: 6, pieces: 6, lagSpreadMs: 0 };
  fs.writeFileSync(join(root, 'compare-part1.json'), JSON.stringify({ 1: same, 2: same, 3: same, 4: same, 6: same, 7: { verdict: 'partly', found: 6, pieces: 6, lagSpreadMs: 400_000 } }));
  fs.writeFileSync(join(root, 'compare-reverse.json'), JSON.stringify({ 2: same, 3: { verdict: 'partly', found: 5, pieces: 6, lagSpreadMs: 100 } }));
  execFileSync(process.execPath, [join(tools, 'surah-sources', 'select.mjs'), '--recording', 'ahmed-salama', '--primary', 'way2quran', '--reference', 'assabile'], { env: { ...process.env, LOCALAPPDATA: local }, encoding: 'utf8' });
  const sel = JSON.parse(fs.readFileSync(join(root, 'selected.json'), 'utf8'));
  const src = (s: number) => sel.surahs[s]?.source;

  it('the better copy where it is the same performance and the same length', () => {
    expect(src(1)).toBe('way2quran');
    expect(sel.surahs[1].why).toMatch(/same performance as assabile.*duration ratio 0\.998/);
  });
  it('a slightly shorter copy only when the reference is found in it in full (padding, not a cut)', () => {
    expect(src(2)).toBe('way2quran');
    expect(sel.surahs[2].why).toMatch(/0\.5 s shorter, yet every piece of assabile's file is in it too \(6\/6\): padding only/);
    expect(src(3)).toBe('assabile'); // the reference's pieces are not all in it: something may be cut
    expect(sel.surahs[3].why).toMatch(/not all in it \(partly: 5\/6\)/);
  });
  it('the complete reference for a cut, edited, missing or damaged copy', () => {
    expect(src(4)).toBe('assabile'); // 17 % shorter
    expect(src(5)).toBe('assabile'); // way2quran has no file
    expect(sel.surahs[5].why).toMatch(/way2quran has no file \(HTTP 404\)/);
    expect(src(6)).toBe('assabile'); // a broken stream
  });
  it('never a VBR file (no exact seeking): the surah is left out with its reason', () => {
    expect(src(7)).toBeUndefined();
    expect(sel.left[7]).toMatch(/VBR: the app cannot seek it to an ayah exactly/);
  });
});

// ---------------------------------------------------------------- the development catalogue's gate

function pkg(surah: number, patch: J = {}): J {
  const { text, basmala, meta } = lib.canon();
  const n = meta.get(surah).ayahs;
  const ayahs = Array.from({ length: n }, (_, i) => {
    let t = text.get(`${surah}:${i + 1}`);
    if (i === 0 && surah !== 1 && surah !== 9) t = t.slice(basmala.length + 1);
    return { ayah: i + 1, startMs: 5000 + i * 4000, endMs: 5000 + (i + 1) * 4000 - 300, text: t };
  });
  const entries = [{ ayah: 0, startMs: 0, endMs: 4800 }, ...ayahs.map(({ ayah, startMs, endMs }) => ({ ayah, startMs, endMs }))];
  return {
    kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-23', reciterId: 'ahmed-salama', reciterEn: 'Ahmed Mohamed Salama', reciterAr: 'أحمد محمد سلامة', recording: 'way2quran (128 kbps CBR)',
    surah, surahAr: meta.get(surah).ar, surahEn: meta.get(surah).en, ayahCount: n, url: `https://media.way2quran.com/ahmed-mohamed-salama/hafs-an-asim/${String(surah).padStart(3, '0')}.mp3`, bytes: 400_000,
    format: { kbps: 128, mode: 'cbr', durationMs: 5000 + n * 4000 + 1000 }, durationMs: 5000 + n * 4000 + 1000, textSource: 't', basmala: surah === 1 ? null : basmala, ayahs, intro: [0, 4800],
    candidateFingerprint: timingFingerprint(entries), checks: {}, structure: { ok: true, problems: [] }, completeness: { median_score: 0.5, collapsed: 0, collapsed_runs: [], missing_in_alignment: [] },
    boundaries: ayahs.slice(1).map((a) => ({ ayah: a.ayah, ms: a.startMs, flags: [], priority: 3 })), worklist: [], opening: { rule: OPENING_RULE.id, startMs: 0, onsetMs: 5000 },
    experiment: { phase: 'ahmed-salama', source: 'way2quran', sha256: 'b'.repeat(64), rightsStatus: 'not cleared' },
    ...patch,
  };
}

describe('the development catalogue (generate-timed-preview.mjs): only reliable timing', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'qh-timed-preview-'));
  const write = (name: string, p: J) => { fs.mkdirSync(join(dir, 'aligned'), { recursive: true }); fs.writeFileSync(join(dir, 'aligned', name), JSON.stringify(p)); return { file: `aligned/${name}` }; };
  const reordered = pkg(113);
  reordered.boundaries[1] = { ...reordered.boundaries[1], flags: ['reordered'], priority: 1 };
  const uncertain = pkg(112);
  uncertain.boundaries[0] = { ...uncertain.boundaries[0], flags: ['no-pause'], priority: 1 };
  const entries = [
    write('112.json', uncertain), // a high-risk boundary only: accepted under the policy, enabled
    write('113.json', reordered), // very high risk: not enabled until a person decides
    write('114.json', pkg(114, { blocked: ['structure failed: x'] })),
    write('108.json', pkg(108, { format: { kbps: 140, mode: 'vbr', durationMs: 20_000 } })),
    write('103.json', pkg(103, { candidateFingerprint: '00000000' })), // edited after it was made
  ];
  fs.writeFileSync(join(dir, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', createdOn: '2026-10-23', packages: entries }));
  const ts = join(dir, 'timedPreview.ts');
  const reportFile = join(dir, 'report.json');
  execFileSync(process.execPath, [join(tools, 'surah-sources', 'generate-timed-preview.mjs'), dir, '--out', ts, '--report', reportFile], { encoding: 'utf8' });
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))['ahmed-salama'];
  const src = fs.readFileSync(ts, 'utf8');

  it('enables a valid, unblocked CBR surah whose risks are all accepted by the policy', () => {
    expect(report.enabled).toEqual([112]);
    expect(src).toMatch(/^\s+112: \{ provider: 'way2quran', url: 'https:\/\/media\.way2quran\.com\/ahmed-mohamed-salama\/hafs-an-asim\/112\.mp3', bytes: 400000, durationMs: \d+, fingerprint: '[0-9a-f]{8}', reviewer1: 0, automatic: 4, deltas: \[5000, 4000, 4000, 4000, 3700\] \},$/m); // the last ayah ends at its own end
  });
  it('keeps every other surah unavailable, with the reason: very high risk, blocked, VBR, invalid', () => {
    expect(report.blocked[113]).toMatch(/very high risk start\(s\) 3: awaiting a person/);
    expect(report.blocked[114]).toMatch(/^blocked: structure failed/);
    expect(report.blocked[108]).toMatch(/not CBR \(vbr\)/);
    expect(report.blocked[103]).toMatch(/^invalid package: .*fingerprint/);
  });
  it('the generated timing passes the app\'s own check (fingerprint, ayahs, inside the file)', async () => {
    const { previewTiming } = await import('@/audio/timedPreview');
    // The generated object literal, evaluated as the app reads it (not hand-parsed).
    const surah = new Function(`return ${/112: (\{.*\}),$/m.exec(src)![1]}`)();
    expect(previewTiming({ reciterId: 'ahmed-salama', evidence: 'x', generatedOn: 'x', surahs: { 112: surah } }, 112)).not.toBeNull();
  });
});

describe('a suspected other voice (voice.py) is very high risk, on one start that stands for the surah', () => {
  it('identity-sample: very high with the evidence; the opening and every other start keep their tier', async () => {
    const vh = await imp('review/manual/very-high.mjs');
    const p = pkg(112);
    p.boundaries[0] = { ...p.boundaries[0], flags: ['identity-sample'], priority: 1, identity: 'speaker similarity 0.6 to the recording\'s other surahs' };
    const s = lib.sessionFromPackage(p, { key: 'k', provider: 'way2quran', sourceId: 't', phase: null, packageFile: 'f', packageSha256: '', issues: {}, concerns: [], sha256: null });
    expect(vh.staticVeryHigh(s).starts.get(2)).toMatch(/voice of this surah differs .*speaker similarity 0\.6.*this start stands for the surah/);
    expect(lib.riskOf(s).map((x: J) => x[0])).toEqual(['check', 'veryhigh', 'routine', 'routine']);
  });
});

describe('the dashboard knows the sources (provider) and the reciter (never Yasser Salama)', () => {
  it('assabile and way2quran are known https providers; Ahmed Mohamed Salama is his own reciter', () => {
    expect(lib.providerOf('https://media.assabile.com/a.mp3')).toBe('assabile');
    expect(lib.providerOf('https://media.way2quran.com/a.mp3')).toBe('way2quran');
    expect(lib.RECITER.get('ahmed-salama').nameAr).toBe('أحمد محمد سلامة');
    expect(lib.RECITER.get('yasser-salama').nameAr).toBe('ياسر محمود سلامة');
    expect(lib.keyFor('ahmed-salama', 112, 'way2quran')).toBe('ahmed-salama-112-way2quran');
    expect(lib.packageProblems(pkg(112))).toEqual([]);
  });
});
