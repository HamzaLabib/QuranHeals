import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// Per-ayah recordings in the review dashboard and the automated risk classification (tools/quran-audio/per-ayah).
// SYNTHETIC evidence only: nothing here reads or writes the real review data or the real catalogue.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const vh = await imp('review/manual/very-high.mjs');
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const { OPENING_RULE } = await imp('review/manual/opening.mjs');
type J = any;

/** A per-ayah package for Al-Ikhlas (112): the Basmala file 4.5 s, then four ayah files. */
function pkg112(risk: Record<number, J> = {}, patch: J = {}): J {
  const { text, basmala } = lib.canon();
  const lens = [4519, 2978, 2534, 3030, 4206];
  const starts = lens.reduce((a: number[], l, i) => [...a, i ? a[i - 1] + lens[i - 1] : 0], []);
  const ayahs = [1, 2, 3, 4].map((a) => ({ ayah: a, startMs: starts[a], endMs: starts[a] + lens[a], text: a === 1 ? text.get('112:1').slice(basmala.length + 1) : text.get(`112:${a}`) }));
  const intro = [0, lens[0]];
  const entries = [{ ayah: 0, startMs: 0, endMs: lens[0] }, ...ayahs.map(({ ayah, startMs, endMs }) => ({ ayah, startMs, endMs }))];
  const total = starts[4] + lens[4];
  return {
    kind: 'ayah-timing-review-package', version: 1, source: 'per-ayah', status: 'test', reciterId: 'gebril', recording: 'test',
    surah: 112, surahAr: 'الإخلاص', surahEn: 'Al-Ikhlaas', ayahCount: 4, url: 'https://everyayah.com/data/Muhammad_Jibreel_128kbps/#112', bytes: 1000, durationMs: total,
    format: { kbps: 128, mode: 'cbr', durationMs: total }, textSource: 't', basmala, ayahs, intro, candidateFingerprint: timingFingerprint(entries),
    boundaries: ayahs.slice(1).map((a) => ({ ayah: a.ayah, ms: a.startMs, flags: [], priority: 3 })), worklist: [], structure: { ok: true, problems: [] },
    completeness: { missing_in_alignment: [], collapsed_runs: [] }, opening: { rule: OPENING_RULE.id, startMs: 0, onsetMs: ayahs[0].startMs },
    perAyah: { base: 'https://everyayah.com/data/Muhammad_Jibreel_128kbps/', basmala: { file: '112000.mp3', startMs: 0, endMs: lens[0] }, files: ['000', '001', '002', '003', '004'].map((k, i) => ({ name: `112${k}.mp3`, startMs: starts[i], endMs: starts[i] + lens[i] })),
      risk: { 1: { risk: 'low', reasons: [] }, 2: { risk: 'low', reasons: [] }, 3: { risk: 'low', reasons: [] }, 4: { risk: 'low', reasons: [] }, ...risk }, reviewCopy: { file: 'x.mp3', kind: 'mp3-frames', bytes: 1000, sha256: 'a'.repeat(64) } },
    experiment: { phase: 'per-ayah', rightsStatus: 'not cleared', sha256: 'a'.repeat(64) }, createdOn: '2026-10-23',
    ...patch,
  };
}
const sessionOf = (p: J) => lib.sessionFromPackage(p, { key: 'gebril-112-everyayah', provider: 'everyayah', sourceId: 't', phase: 'per-ayah', packageFile: 'f', packageSha256: 's', issues: {}, concerns: [], sha256: 'a'.repeat(64) });

describe('per-ayah packages in the review dashboard', () => {
  it('a per-ayah package is valid: the everyayah provider, the per-ayah source, its files and review copy', () => {
    expect(lib.packageProblems(pkg112())).toEqual([]);
    expect(lib.providerOf('https://everyayah.com/data/Muhammad_Jibreel_128kbps/#112')).toBe('everyayah');
    expect(lib.RECITER.get('gebril')).toMatchObject({ nameEn: 'Mohamed Gebril', nameAr: 'محمد جبريل' });
  });

  it('refuses a per-ayah package without its files, risk or review copy, and per-ayah data under another source', () => {
    expect(lib.packageProblems(pkg112({}, { perAyah: undefined }))).toContain('a per-ayah package needs source per-ayah and its perAyah block');
    expect(lib.packageProblems({ ...pkg112(), source: 'aligned' })).toContain('a per-ayah package needs source per-ayah and its perAyah block');
    const p = pkg112();
    p.perAyah.files.pop();
    expect(lib.packageProblems(p).join()).toMatch(/perAyah\.files: 4 files for 4 ayahs and the Basmala/);
    const q = pkg112();
    q.perAyah.reviewCopy.bytes = 5;
    expect(lib.packageProblems(q).join()).toMatch(/reviewCopy/);
  });

  it('becomes a per-ayah verification session that keeps every ayah\'s risk', () => {
    const s = sessionOf(pkg112({ 3: { risk: 'high', reasons: ['text-mismatch: x'] } }));
    expect(s.reviewType).toBe('per-ayah-verification');
    expect(s.proposal.perAyah.risk[3].risk).toBe('high');
    expect(s.proposal.note).toMatch(/Per-ayah recording/);
  });

  it('high-risk ayahs are VERY HIGH RISK starts, ayah 1 (or its Basmala) included; low-risk ones keep their ordinary tier', () => {
    const s = sessionOf(pkg112({ 1: { risk: 'high', reasons: ['Basmala file 112000.mp3: format: x'] }, 3: { risk: 'high', reasons: ['duration: y'] } }));
    const v = vh.staticVeryHigh(s);
    expect([...v.starts.keys()].sort()).toEqual([1, 3]);
    expect(v.starts.get(1)).toMatch(/per-ayah file not cleared by the automated scan: Basmala file 112000\.mp3: format: x/);
    expect(lib.riskOf(s).map((x: J) => x[0])).toEqual(['veryhigh', 'routine', 'veryhigh', 'routine']);
    // Without per-ayah evidence ayah 1 stays the opening's check, as for every other recording.
    expect(lib.riskOf(sessionOf(pkg112())).map((x: J) => x[0])).toEqual(['check', 'routine', 'routine', 'routine']);
  });

  it('the policy leaves exactly the high-risk ayahs to a person (ayah 1 too) and accepts the rest automatically', () => {
    const s = sessionOf(pkg112({ 1: { risk: 'high', reasons: ['x'] }, 4: { risk: 'high', reasons: ['y'] } }));
    const task = { key: 'gebril-112-everyayah', risk: lib.riskOf(s), proposal: { fingerprint: s.proposal.fingerprint } };
    const c = auto.classify(task, s, manual.emptyState());
    expect(c.map((x: J) => [x.ayah, x.decision, x.tier])).toEqual([[1, 'manual', 'veryhigh'], [2, 'eligible', 'routine'], [3, 'eligible', 'routine'], [4, 'manual', 'veryhigh']]);
    // An older acceptance of the opening stops applying once ayah 1 carries per-ayah evidence.
    const entry = { type: 'auto-accept', tier: 'check', ayah: 1, rule: OPENING_RULE.id, proposedMs: 0, fingerprint: s.proposal.fingerprint };
    expect(auto.effectiveAccepted(s, manual.emptyState(), [entry]).size).toBe(0);
    expect(auto.effectiveAccepted(sessionOf(pkg112()), manual.emptyState(), [entry]).size).toBe(1);
  });
});

// ---------------------------------------------------------------- the classifier, end to end on synthetic evidence

const counts: number[] = (() => {
  const c = Array(114).fill(0);
  for (const line of fs.readFileSync(join(tools, '..', 'quran-verification', 'input', 'quran-uthmani.txt'), 'utf8').split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length === 3 && /^\d+$/.test(p[0])) c[Number(p[0]) - 1]++;
  }
  return c;
})();

function syntheticCache(dir: string, artist = 'Muhammad Jibreel', patch: (x: { scan: J; verify: J }) => void = () => undefined) {
  const pad = (n: number) => String(n).padStart(3, '0');
  const names: string[] = [];
  for (let s = 1; s <= 114; s++) {
    if (s !== 9) names.push(`${pad(s)}000.mp3`);
    for (let a = 1; a <= counts[s - 1]; a++) names.push(`${pad(s)}${pad(a)}.mp3`);
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const { text, basmala } = lib.canon();
  // The ayah-1 files hold the ayah without its Basmala (the Basmala is its own file).
  // (By letters: 95:1 and 97:1 spell the Basmala «بِّسْمِ».)
  const bare = (w: string) => (w.match(/[ء-يٱ]/g) ?? []).join('');
  const words = (s: number, a: number) => {
    if (a === 0) return basmala;
    const t = text.get(`${s}:${a}`);
    const ws = t.split(' ');
    return a === 1 && s !== 1 && s !== 9 && ws.slice(0, 4).map(bare).join(' ') === basmala.split(' ').map(bare).join(' ') ? ws.slice(4).join(' ') : t;
  };
  const letters = (s: number, a: number) => (words(s, a).match(/[ء-يٱ]/g) ?? []).length;
  const listing = names.map((n) => ({ name: n, bytes: 50_000, modified: '2023-01-18T02:00:00' }));
  const files: J = {};
  const scan: J = {};
  const verify: J = {};
  for (const n of names) {
    const s = Number(n.slice(0, 3));
    const a = Number(n.slice(3, 6));
    files[n] = { ok: true, status: 200, location: null, contentType: 'audio/mpeg', bytes: 50_000, listedBytes: 50_000, md5: 'm', sha256: n, listedMd5: a === 0 ? null : 'm', md5Match: a === 0 ? null : true };
    // About 0.7 s per ayah plus 85 ms a letter (so short ayahs take longer per letter), ±8 %.
    const voiced = Math.round((700 + letters(s, a) * 85) * (0.92 + 0.16 * rnd()));
    scan[n] = {
      mp3: { id3v2: 105, trailer: ['ID3v1'], seekHeader: null, audioFrames: 100, sampleRates: [44100], channels: ['stereo'], kbpsMin: 128, kbpsMax: 128, kbpsMean: 128, distinctBitrates: 1, durationS: (voiced + 400) / 1000, problems: [], junkBytes: 0, lame: null },
      tags: { v1title: '', v1artist: artist },
      audio: { decodedMs: voiced + 400, loudDb: -12, medianDb: -20, peak: 0.6, clipShare: 0, leadSilenceMs: 150, trailSilenceMs: 150, longestInternalSilenceMs: 300, voicedShare: 0.9, voicedMs: voiced, headEdgeDb: -40, tailEdgeDb: -40, env: Array.from({ length: 64 }, () => Math.round((rnd() * 2 - 1) * 100) / 100) },
    };
    const good = (score: number) => ({ score, firstHalf: score, secondHalf: score, startMs: 150, endMs: voiced + 150, msPerLetter: 90, voicedBeforeMs: 0, voicedAfterMs: 0, greedySimilarity: score + 0.05 });
    verify[n] = a === 0
      ? { scores: { expected: good(0.53), istiadha: good(0.27), ayah1: good(0.22) }, greedy: 'bismillah', frames: 100, decodedMs: voiced + 400 }
      : { scores: { expected: good(0.5 + 0.1 * rnd()), ...(a > 1 ? { prev: good(0.2) } : {}), ...(a < counts[s - 1] ? { next: good(0.21) } : {}), control: good(0.12 + 0.08 * rnd()) }, controlRef: '50:2', greedy: 'x', frames: 100, decodedMs: voiced + 400 };
  }
  // Injected faults: each must come out HIGH risk for exactly this reason.
  verify['002255.mp3'].scores.prev.score = 0.7; // the previous ayah fits better: a wrong file
  delete files['003010.mp3']; // missing: never fetched, so never scanned either
  delete scan['003010.mp3'];
  delete verify['003010.mp3'];
  listing.splice(listing.findIndex((r) => r.name === '003010.mp3'), 1);
  scan['004005.mp3'].mp3 = { ...scan['004005.mp3'].mp3, sampleRates: [11025], channels: ['mono'], kbpsMin: 16, kbpsMax: 16 }; // another source
  scan['005007.mp3'].audio.leadSilenceMs = 5000;
  verify['006001.mp3'].scores.expected.greedySimilarity = 0.1; // transcription far from the ayah
  verify['007000.mp3'].scores.istiadha.score = 0.8; // the "Basmala" file sounds like something else
  files['010003.mp3'].md5Match = false; // replaced after the checksums
  verify['011002.mp3'].scores.expected.voicedAfterMs = 4000; // something recited after the ayah
  scan['012004.mp3'].audio.voicedMs *= 6; // far too long for its words
  listing.push({ name: '038003.mp3.mp3002.mp3', bytes: 7000, modified: 'x' }); // a mis-named copy in the folder
  scan['013005.mp3'].tags.TALB = 'Sudais'; // tagged with another reciter
  scan['014006.mp3'].mp3.problems = ['300 bytes without sync at byte 4000']; // a splice
  patch({ scan, verify });
  fs.writeFileSync(join(dir, 'fetch-manifest.json'), JSON.stringify({ fetchedOn: 'x', checksums: 6237, mistakes: [{ name: '015007.mp3', bytes: 1 }], files }));
  fs.writeFileSync(join(dir, 'listing.json'), JSON.stringify(listing));
  fs.writeFileSync(join(dir, 'scan.json'), JSON.stringify({ files: scan }));
  fs.writeFileSync(join(dir, 'text-verification.json'), JSON.stringify({ files: verify }));
}

describe('the per-ayah risk classification (synthetic evidence)', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'qh-per-ayah-'));
  syntheticCache(dir);
  const out = join(dir, 'risk.json');
  execFileSync(process.execPath, [join(tools, 'per-ayah', 'classify.mjs'), '--recording', 'gebril', '--cache', dir, '--out', out], { encoding: 'utf8' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const high = Object.fromEntries(r.items.filter((x: J) => x.risk === 'high').map((x: J) => [x.ref, x.codes]));

  it('scans every ayah and every Basmala file (6,236 + 112)', () => {
    expect(r.totals.ayahs).toBe(6236);
    expect(r.totals.basmalaFiles).toBe(112);
    expect(r.items.find((x: J) => x.surah === 9 && x.ayah === 0)).toBeUndefined(); // At-Tawbah has none
    expect(r.items.find((x: J) => x.surah === 1 && x.ayah === 0)).toBeUndefined(); // Al-Fatiha's Basmala is its ayah 1
  });

  it('flags exactly the injected faults, each with its reason, and nothing else', () => {
    expect(high).toEqual({
      '2:255': ['text-mismatch'],
      '3:10': ['missing', 'not-fetched', 'decode', 'text-unverified'],
      '4:5': ['format', 'batch'],
      '5:7': ['lead-silence'],
      '6:1': ['transcript-mismatch'], // its transcription is closer to a neighbouring ayah
      '7:0 (Basmala)': ['text-mismatch'],
      '10:3': ['checksum'],
      '11:2': ['extra-after'],
      '12:4': ['duration'],
      '13:5': ['batch', 'tag-album'],
      '14:6': ['splice', 'batch'],
      '15:7': ['mistakes-folder'],
      '38:2': ['stray-name'],
      '38:3': ['stray-name'],
    });
    expect(r.totals.low).toBe(6348 - 14);
  });

  it('a missing file makes its surah unplayable (no Full Surah, never a gap); every other surah plays', () => {
    expect(r.surahs[3]).toMatchObject({ playable: false, notPlayable: ['3:10'] });
    expect(Object.values(r.surahs).filter((x: J) => !x.playable)).toHaveLength(1);
    expect(r.items.find((x: J) => x.ref === '2:255').playable).toBe(true); // high risk, still playable in development
  });

  it('calibrates the text thresholds above the wrong-text controls', () => {
    expect(r.thresholds.minScore).toBeGreaterThanOrEqual(0.3);
    expect(r.thresholds.minScore).toBeGreaterThan(r.calibration.controlScore.at(-2)[1] - 0.01);
  });

  it('the development catalogue lists every complete surah and leaves the incomplete one out', () => {
    const ts = join(dir, 'perAyahPreview.ts');
    execFileSync(process.execPath, [join(tools, 'per-ayah', 'generate-preview.mjs'), out, '--out', ts], { encoding: 'utf8' });
    const src = fs.readFileSync(ts, 'utf8');
    expect(src).toMatch(/reciterId: 'gebril', nameEn: 'Mohamed Gebril', nameAr: 'محمد جبريل'/);
    expect(src).not.toMatch(/^\s+3: \{/m);
    expect(src).toMatch(/^\s+1: \{ fingerprint: '[0-9a-f]{8}', basmala: null, ayahs: \[/m);
    expect(src).toMatch(/^\s+9: \{ fingerprint: '[0-9a-f]{8}', basmala: null, ayahs: \[/m);
    expect(src).toMatch(/^\s+2: \{ fingerprint: '[0-9a-f]{8}', basmala: \[50000, \d+\], ayahs: \[/m);
    expect((src.match(/^\s+\d+: \{ fingerprint/gm) ?? []).length).toBe(113);
  });
});

// ---------------------------------------------------------------- graded recordings (Ali Jaber, Phase 3)

describe('graded per-ayah risk (Ali Jaber): the dashboard tiers', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'qh-per-ayah-graded-'));
  syntheticCache(dir, 'Ali Jaber', ({ verify }) => {
    verify['016003.mp3'].scores.expected = { ...verify['016003.mp3'].scores.expected, score: 0.27, firstHalf: 0.27, secondHalf: 0.27 }; // weak and close to its neighbours: uncertain, nothing structural
  });
  // Identity: 112 found in the full-surah reference; 113:2 not found (another performance).
  const idDir = join(dir, 'identity');
  fs.mkdirSync(idDir);
  const located = (ayah: number, at: number) => ({ ayah, start_ms: at, end_ms: at + 3000, chunks: [[0, at, 0.8], [3000, at + 3000, 0.79]] });
  fs.writeFileSync(join(idDir, '112.json'), JSON.stringify({ surah: 112, ayahs: [1, 2, 3, 4].map((a) => located(a, a * 4000)) }));
  fs.writeFileSync(join(idDir, '113.json'), JSON.stringify({ surah: 113, ayahs: [located(1, 1000), { ayah: 2, start_ms: null, end_ms: null, chunks: [] }, located(3, 9000), located(4, 13000), located(5, 17000)] }));
  // 114: another performance altogether (no ayah found): one voice check on its ayah 1, the rest High.
  fs.writeFileSync(join(idDir, '114.json'), JSON.stringify({ surah: 114, ayahs: [1, 2, 3, 4, 5, 6].map((ayah) => ({ ayah, start_ms: null, end_ms: null, chunks: [] })) }));
  const out = join(dir, 'risk.json');
  execFileSync(process.execPath, [join(tools, 'per-ayah', 'classify.mjs'), '--recording', 'jaber', '--cache', dir, '--out', out, '--identity', idDir], { encoding: 'utf8' });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const tiers = Object.fromEntries(r.items.filter((x: J) => x.risk === 'high').map((x: J) => [x.ref, x.tier]));

  it('only credible structural evidence is Very High; weak text evidence is High; extreme silence is Medium', () => {
    expect(tiers).toEqual({
      '2:255': 'veryhigh', '3:10': 'veryhigh', '4:5': 'veryhigh', '5:7': 'medium', '6:1': 'veryhigh', '7:0 (Basmala)': 'veryhigh',
      '10:3': 'veryhigh', '11:2': 'veryhigh', '12:4': 'veryhigh', '13:5': 'veryhigh', '14:6': 'veryhigh', '15:7': 'veryhigh',
      '16:3': 'high', '38:2': 'veryhigh', '38:3': 'veryhigh', '113:2': 'veryhigh',
      '114:1': 'veryhigh', '114:2': 'high', '114:3': 'high', '114:4': 'high', '114:5': 'high', '114:6': 'high',
    });
    expect(r.items.find((x: J) => x.ref === '16:3').codes).toEqual(['text-ambiguous', 'text-weak']);
    expect(r.totals.byTier).toEqual({ veryhigh: 15, high: 6, medium: 1, low: 6348 - 22 });
    expect(r.items.find((x: J) => x.ref === '114:1').codes).toEqual(['identity-sample']);
    expect(r.items.find((x: J) => x.ref === '114:4').codes).toEqual(['identity-surah']);
  });

  it('a flagged file is never cleared: every graded tier above low stays risk "high" (not verified)', () => {
    for (const ref of Object.keys(tiers)) expect(r.items.find((x: J) => x.ref === ref).risk).toBe('high');
  });

  it('identity: an ayah found in the full-surah reference is noted; one that is not is Very High with the reason', () => {
    expect(r.items.find((x: J) => x.ref === '113:2').reasons.join()).toMatch(/^identity: not found in mp3quran's حفص عن عاصم - مرتل recording of this surah: another performance/);
    expect(r.items.find((x: J) => x.ref === '112:3').notes.join()).toMatch(/identity: located in mp3quran's/);
    expect(r.identity).toMatchObject({ surahsChecked: [112, 113, 114], located: 8, otherPerformanceSurahs: [114] });
    expect(r.identity.notLocated).toEqual(['113:2', '114:1', '114:2', '114:3', '114:4', '114:5', '114:6']);
  });

  it('the artist tag is checked against the recording\'s own name', () => {
    expect(r.items.filter((x: J) => x.codes.includes('tag-artist'))).toHaveLength(0);
  });
});

describe('graded per-ayah packages in the dashboard', () => {
  it('Very High tier ayahs are manual; High and Medium tiers stay High / Medium and are accepted automatically', () => {
    const p = pkg112({ 2: { risk: 'high', tier: 'high', reasons: ['text-weak: x'] }, 3: { risk: 'high', tier: 'veryhigh', reasons: ['cut-end: y'] }, 4: { risk: 'high', tier: 'medium', reasons: ['lead-silence: z'] } });
    p.boundaries = p.boundaries.map((b: J) => ({ ...b, priority: b.ayah === 2 ? 1 : b.ayah === 4 ? 2 : 3, check: b.ayah === 2 ? 'text-weak: x' : undefined }));
    const s = sessionOf(p);
    expect([...vh.staticVeryHigh(s).starts.keys()]).toEqual([3]);
    const risk = lib.riskOf(s);
    expect(risk.map((x: J) => x[0])).toEqual(['check', 'high', 'veryhigh', 'medium']);
    expect(risk[1][1]).toBe('text-weak: x');
    const c = auto.classify({ key: 'k', risk, proposal: { fingerprint: s.proposal.fingerprint } }, s, manual.emptyState());
    expect(c.map((x: J) => [x.ayah, x.decision])).toEqual([[1, 'eligible'], [2, 'eligible'], [3, 'manual'], [4, 'eligible']]);
  });

  it('an ungraded package (Gebril\'s) keeps every flagged ayah Very High, unchanged', () => {
    const s = sessionOf(pkg112({ 2: { risk: 'high', reasons: ['text-weak: x'] } }));
    expect([...vh.staticVeryHigh(s).starts.keys()]).toEqual([2]);
  });
});

const sev = await imp('per-ayah/severity.mjs');
describe('severity.mjs --clearance: an exception is resolved only by clear, independent evidence', () => {
  const C = { unconfirmedScore: 0.229, extraMs: 3000 };
  const texts = { expected: 'a b c', prev: 'd e', next: 'f g', control: '', prevTailText: '', expectedHeadText: '', nextHeadText: '', expectedTailText: '' };
  const item = (codes: string[], reasons: string[]) => ({ surah: 11, ayah: 34, file: '011034.mp3', codes, reasons, evidence: {}, risk: 'high' });
  const clear = (voice: boolean, context: boolean) => ({ voice: { similarity: voice ? 0.8 : 0.4, clearAt: 0.626, cleared: voice }, context: { neighbours: ['11:33', '11:34', '11:35'], fileMs: [1000, 9000], alignedMs: [1100, 8900], score: 0.5, controls: [0.2], voicedCovered: 0.99, cleared: context } });
  const run = (it: J, clearance: J) => sev.severityOf({ item: it, b: null, bPrev: null, bNext: null, C, texts, identity: { checked: true, otherPerformance: false, sampleAyah: null }, formatRun: null, clearance });
  const idItem = () => item(['identity'], ['identity: only partly found in the reference recording']);

  const tierOf = (r: J, code: string) => r.codes.find((o: J) => o.code === code)?.tier;
  it('identity: cleared only with BOTH the voice and the context evidence; the record keeps the evidence', () => {
    expect(tierOf(run(idItem(), null), 'IDENTITY_UNRESOLVED')).toBe('exception');
    expect(tierOf(run(idItem(), clear(false, true)), 'IDENTITY_UNRESOLVED')).toBe('exception');
    expect(tierOf(run(idItem(), clear(true, false)), 'IDENTITY_UNRESOLVED')).toBe('exception');
    const r = run(idItem(), clear(true, true));
    const code = r.codes.find((o: J) => o.code === 'IDENTITY_UNRESOLVED');
    expect(code.tier).toBe('high');
    expect(code.resolved).toMatchObject({ by: 'clearance.py', previousTier: 'exception' });
    expect(code.why).toMatch(/cleared by independent evidence.*voice similarity 0.8/);
    // An unrelated exception (here: no boundary evidence for the file) is never cleared by it: the file stays unresolved.
    expect(tierOf(r, 'CHECK_MISSING')).toBe('exception');
    expect(r.tier).toBe('exception');
  });

  it('text not confirmed: cleared by the context evidence alone', () => {
    const it = item(['text-unverified'], ['text-unverified: the expected text cannot be aligned']);
    expect(tierOf(run(it, null), 'TEXT_UNCONFIRMED')).toBe('exception');
    expect(tierOf(run(it, clear(false, true)), 'TEXT_UNCONFIRMED')).toBe('high');
  });

  it('never a whole-surah voice sample, never a file with very high risk evidence', () => {
    const sample = item(['identity-sample'], ['identity-sample: this whole surah is another performance']);
    expect(tierOf(run(sample, clear(true, true)), 'IDENTITY_UNRESOLVED')).toBe('exception');
    const vh = item(['identity', 'tag-artist'], ['identity: not found', 'tag-artist: artist tag "Someone Else"']);
    expect(run(vh, clear(true, true)).tier).toBe(run(vh, null).tier);
  });
});
