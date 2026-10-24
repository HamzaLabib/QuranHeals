// The unified audio review dashboard (Phase 4.8): discovery, validation and registration of every pending listening
// review, from configured sources only. It reads; it never approves, activates or changes timing:
//   - manual-sessions  Phase 4.6 manual-timing sessions (review/manual/prepare.py + queue.json): referenced in place, with
//                      their own data folder (the existing Rifaat review database is used where it is, never copied);
//   - review-packages  an index.json of kind ayah-timing-review-index (review/make-packages.mjs, or any later phase that
//                      writes the same format): each package becomes a session with a read-only automatic PROPOSAL;
//   - legacy-flags     Phase 4 <reciter>/<surah>.flags.json candidates: read only to record what newer packages supersede.
// Plus discovery: index.json / queue.json manifests of those kinds found under the configured scan roots (JSON only,
// schema-validated; nothing is executed).
//
// Every package is validated before it is registered: known reciter, canonical ayah count, the Arabic text verbatim
// from the app's runtime source, timing in order inside the audio, an https URL of a known provider, and its own timing
// fingerprint (so a package edited after it was made is refused). One task per RECORDING (reciter, surah, URL, size):
// duplicates are recorded as superseded, never counted twice. A session that already has a review log is never
// replaced: a changed package for it is reported as an import problem and the review keeps the version it started on.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../../fingerprint.mjs';
import { PER_AYAH_RECORDINGS } from '../../per-ayah/recordings.mjs';
import { RECITERS } from '../../reciters.mjs';
import { openingOf, openingReason, OPENING_RULE } from '../manual/opening.mjs';
import { staticVeryHigh } from '../manual/very-high.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOOLS = path.join(here, '..', '..');
export const REPO = path.join(TOOLS, '..', '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sha256Text = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- canonical text (the app's runtime source)

let canonCache = null;
export function canon(repo = REPO) {
  if (canonCache) return canonCache;
  const text = new Map();
  for (const line of fs.readFileSync(path.join(repo, 'tools', 'quran-verification', 'input', 'quran-uthmani.txt'), 'utf8').split(/\r?\n/)) {
    const p = line.split('|');
    if (p.length === 3 && /^\d+$/.test(p[0])) text.set(`${p[0]}:${p[1]}`, p[2]);
  }
  const xml = fs.readFileSync(path.join(repo, 'tools', 'quran-verification', 'input', 'quran-data.xml'), 'utf8');
  const meta = new Map([...xml.matchAll(/<sura index="(\d+)" ayas="(\d+)"[^>]* name="([^"]+)" tname="([^"]+)"/g)].map((m) => [Number(m[1]), { ar: m[3], en: m[4], ayahs: Number(m[2]) }]));
  canonCache = { text, meta, basmala: text.get('1:1') };
  return canonCache;
}

/** Problems with a package's (or session's) Arabic text: it must be the runtime text verbatim (Basmala shown apart). */
export function textProblems(surah, basmala, ayahs) {
  const { text, basmala: B } = canon();
  const problems = [];
  for (const a of ayahs) {
    const want = text.get(`${surah}:${a.ayah}`);
    const got = a.ayah === 1 && basmala ? `${basmala} ${a.text}` : a.text;
    if (want !== got) problems.push(`ayah ${a.ayah}: the text differs from tools/quran-verification/input/quran-uthmani.txt`);
  }
  if (basmala && basmala !== B) problems.push('the Basmala differs from 1:1 of the runtime text');
  return problems;
}

// ---------------------------------------------------------------- identity

// The catalogue's reciters, and the per-ayah recordings under evaluation (per-ayah/recordings.mjs: never in a release).
export const RECITER = new Map([...RECITERS, ...PER_AYAH_RECORDINGS].map((r) => [r.id, r]));
const PROVIDERS = [[/(^|\.)mp3quran\.net$/, 'mp3quran'], [/(^|\.)archive\.org$/, 'archive'], [/(^|\.)way2quran\.com$/, 'way2quran'], [/(^|\.)everyayah\.com$/, 'everyayah'], [/(^|\.)assabile\.com$/, 'assabile'], [/(^|\.)quranicaudio\.com$/, 'quranicaudio']];
export function providerOf(url) {
  let host;
  try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname; } catch { return null; }
  return PROVIDERS.find(([re]) => re.test(host))?.[1] ?? null;
}
/** One key per recording: reciter-surah for MP3Quran (as the Phase 4.6 sessions already are), plus the provider otherwise. */
export const keyFor = (reciterId, surah, provider) => `${reciterId}-${surah}${provider && provider !== 'mp3quran' ? `-${provider}` : ''}`;
/** A recording: reciter, surah, URL and size (all four, so a mislabelled package is never merged into another surah). */
const identity = (t) => `${t.reciterId}|${t.surah}|${t.url}|${t.bytes}`;

// ---------------------------------------------------------------- configuration

/** Reads the dashboard configuration; every path in it is relative to the file's folder. */
export function readConfig(file) {
  const cfg = readJson(file);
  if (cfg.kind !== 'audio-review-dashboard-config') throw new Error(`${file}: not an audio-review-dashboard-config`);
  const base = path.dirname(path.resolve(file));
  const abs = (p) => (p == null ? p : path.resolve(base, p));
  return {
    file: path.resolve(file), base, raw: cfg,
    dataDir: abs(cfg.dataDir ?? 'data'), registryDir: abs(cfg.registryDir ?? 'registry'), cacheDir: abs(cfg.cacheDir ?? 'cache'),
    backupDir: abs(cfg.backupDir ?? 'backups'), rightsDir: abs(cfg.rightsDecisions ?? 'rights'), python: cfg.python ?? 'python',
    backupEveryMinutes: cfg.backupEveryMinutes ?? 15, keepBackups: cfg.keepBackups ?? 60,
    sources: (cfg.sources ?? []).map((s) => ({ ...s, dir: abs(s.dir), sessions: abs(s.sessions), audio: abs(s.audio), data: abs(s.data) })),
    scanRoots: (cfg.scanRoots ?? []).map(abs), scanDepth: cfg.scanDepth ?? 3,
    localAudio: (cfg.localAudio ?? []).map((l) => ({ ...l, dir: abs(l.dir) })),
  };
}

// ---------------------------------------------------------------- risk of each ayah start

/** Tier of an ayah start, most urgent first. */
export const TIERS = ['veryhigh', 'high', 'medium', 'check', 'routine'];
const P1_TEXT = { 'configs-disagree': 'two alignment runs disagree', 'no-pause': 'no pause found', 'competing-pause': 'a competing pause', 'shallow-pause': 'no clear silence', 'extra-audio': 'extra sound in the pause', anchored: 'checked once only (window cut)', reordered: 'very short ayahs: repaired', 'past-own-end': 'snapped past its own end: repaired', 'opening-squeezed': 'opening squeezed: set by ear', 'short-pause': 'very short pause', 'snap-far': 'pause far from the words', 'low-score': 'weak text match', 'sweep-displaced': 'inside recitation (sweep)', 'sweep-unconfirmed': 'no pause seen (sweep)', 'mp3quran-differs': 'MP3Quran timing differs', displaced: 'production start inside recitation, a pause close by (boundary sweep)', unconfirmed: 'production start not in a clear pause (boundary sweep)', 'listening-check': 'source-audit listening check' };

/** [tier, reason] for every ayah start 1..N of a session. */
export function riskOf(session) {
  const n = session.ayahCount;
  const out = Array.from({ length: n }, () => ['routine', '']);
  if (session.proposal) {
    const wl = new Set(session.proposal.worklist ?? []);
    for (const b of session.proposal.boundaries ?? []) {
      if (b.ayah < 1 || b.ayah > n) continue;
      const why = (b.flags ?? []).map((f) => P1_TEXT[f] ?? f).join(', ');
      out[b.ayah - 1] = b.priority === 1 ? ['high', b.check ?? (why || 'priority 1')] : b.priority === 2 ? ['medium', why || 'priority 2'] : wl.has(b.ayah) ? ['check', b.check ?? 'on the worklist (sample, first or last)'] : ['routine', ''];
    }
    // Ayah 1: the opening (Basmala, isti'adha, an intro, or none in a prayer) must always be heard.
    if (out[0][0] === 'routine') out[0] = ['check', session.proposal.intro ? 'opening: intro before ayah 1' : 'opening: where ayah 1 begins'];
  } else if (session.evidence?.starts) {
    for (const s of session.evidence.starts) {
      if (s.ayah < 1 || s.ayah > n) continue;
      out[s.ayah - 1] = s.kind === 'conflict' ? ['high', 'Phase 4.5: conflicting evidence'] : s.kind === 'unbracketed' ? ['high', 'Phase 4.5: no evidence bracket'] : s.kind === 'single pause' ? ['check', 'Phase 4.5: one pause in the bracket'] : ['medium', `Phase 4.5: ${s.pausesInBracket ?? 'several'} pauses in the bracket`];
    }
  }
  if (Array.isArray(session.scope) && session.scope.length) {
    const scope = new Set(session.scope);
    for (let a = 1; a <= n; a++) if (!scope.has(a)) out[a - 1] = ['n/a', 'not part of this check'];
  }
  // Phase 4.8.8: the opening ayah of a complete recording plays from 0:00.000 (opening.mjs), so its start is a check
  // only. Its earlier flags stay visible in the reason and in the task's opening exceptions; no other start changes.
  const o = openingOf(session);
  if (o.applies && n >= 1) out[0] = ['check', openingReason(o)];
  // Phase 4.8.9: Very High Risk on credible structural evidence only (very-high.mjs). A whole-recording finding marks
  // every start but the opening (which plays from 0:00.000 whatever happens after it).
  const vh = staticVeryHigh(session);
  for (let a = 1; a <= n; a++) {
    // The opening is settled by the rule, unless evidence concerns ayah 1 itself (a per-ayah file).
    if (out[a - 1][0] === 'n/a' || (a === 1 && o.applies && !vh.starts.has(1))) continue;
    const why = [vh.starts.get(a), vh.recording && `whole recording: ${vh.recording}`].filter(Boolean);
    if (why.length) out[a - 1] = ['veryhigh', `very high risk: ${why.join('; ')}${out[a - 1][1] ? ` (was ${out[a - 1][0]}: ${out[a - 1][1]})` : ''}`];
  }
  return out;
}

/** The task's view of the opening rule (rule, applied/excluded, original first timestamp, exceptions). */
const openingSummary = (session) => { const o = openingOf(session); return { rule: o.rule, status: o.status, applies: o.applies, reason: o.reason, onsetMs: o.onsetMs, introMs: o.introMs, exceptions: o.exceptions }; };

// ---------------------------------------------------------------- package -> session

/** Problems with a review package (empty when valid). */
export function packageProblems(pkg) {
  const p = [];
  const { meta } = canon();
  if (pkg?.kind !== 'ayah-timing-review-package' || pkg.version !== 1) return ['not an ayah-timing-review-package (version 1)'];
  if (!['aligned', 'development', 'per-ayah'].includes(pkg.source)) p.push(`source ${pkg.source}: only aligned, development and per-ayah packages are reviewable here`);
  if (!RECITER.has(pkg.reciterId)) p.push(`unknown reciter ${pkg.reciterId}`);
  const m = meta.get(pkg.surah);
  if (!m) return [...p, `no surah ${pkg.surah}`];
  if (pkg.ayahCount !== m.ayahs) p.push(`ayahCount ${pkg.ayahCount}, canonical ${m.ayahs}`);
  if (!providerOf(pkg.url)) p.push(`URL ${pkg.url} is not https from a known provider (mp3quran, archive.org, way2quran, everyayah, assabile, quranicaudio)`);
  // A per-ayah package (per-ayah/make-review-packages.mjs) names every file it joins and its local review copy; it is
  // never downloaded from its URL (a folder, not a file).
  if (pkg.source === 'per-ayah' || pkg.perAyah) {
    const pa = pkg.perAyah;
    if (pkg.source !== 'per-ayah' || !pa) p.push('a per-ayah package needs source per-ayah and its perAyah block');
    else {
      if (!Array.isArray(pa.files) || pa.files.length !== m.ayahs + (pa.basmala ? 1 : 0)) p.push(`perAyah.files: ${pa.files?.length} files for ${m.ayahs} ayahs${pa.basmala ? ' and the Basmala' : ''}`);
      if (!(pa.reviewCopy && typeof pa.reviewCopy.file === 'string' && pa.reviewCopy.bytes === pkg.bytes && /^[0-9a-f]{64}$/.test(pa.reviewCopy.sha256 ?? ''))) p.push('perAyah.reviewCopy: file, bytes (the package size) and sha256 are required');
      if (!pa.risk || typeof pa.risk !== 'object') p.push('perAyah.risk: the automated risk of every ayah is required');
    }
  }
  if (!(Number.isInteger(pkg.bytes) && pkg.bytes > 0)) p.push('no file size');
  const dur = pkg.durationMs ?? pkg.format?.durationMs;
  if (!(dur > 0)) p.push('no duration');
  if (!Array.isArray(pkg.ayahs) || pkg.ayahs.length !== m.ayahs) return [...p, `ayahs: ${pkg.ayahs?.length} of ${m.ayahs}`];
  pkg.ayahs.forEach((a, k) => {
    if (a.ayah !== k + 1) p.push(`ayah ${k + 1} out of order`);
    if (!(a.endMs > a.startMs) || a.startMs < 0 || (k && a.startMs < pkg.ayahs[k - 1].startMs)) p.push(`ayah ${a.ayah}: timing ${a.startMs}-${a.endMs} not in order`);
  });
  if (pkg.ayahs.at(-1).endMs > dur + 50) p.push(`last ayah ends after the audio (${pkg.ayahs.at(-1).endMs} > ${dur} ms)`);
  p.push(...textProblems(pkg.surah, pkg.basmala, pkg.ayahs));
  const e = pkg.ayahs.map((a) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs }));
  if (pkg.intro) e.unshift({ ayah: 0, startMs: pkg.intro[0], endMs: pkg.intro[1] });
  if (timingFingerprint(e) !== pkg.candidateFingerprint) p.push(`fingerprint ${pkg.candidateFingerprint} does not match the package's own timing (edited after it was made?)`);
  for (const b of pkg.boundaries ?? []) if (!(b.ayah >= 2 && b.ayah <= m.ayahs && [1, 2, 3].includes(b.priority))) { p.push(`boundary ${b.ayah}: invalid`); break; }
  // Phase 4.8.8: a package that declares its opening (make-packages.mjs) must play ayah 1 from 0 and keep its onset.
  if (pkg.opening !== undefined && (pkg.opening?.rule !== OPENING_RULE.id || pkg.opening.startMs !== OPENING_RULE.startMs || pkg.opening.onsetMs !== pkg.ayahs[0].startMs)) p.push(`opening ${JSON.stringify(pkg.opening)}: ayah 1 must play from 0 ms (${OPENING_RULE.id}) and keep the first timestamp ${pkg.ayahs[0].startMs} ms as its onset`);
  return p;
}

const KFGQPC = 'Reserved For KFGQPC';
/**
 * The owner's rights decisions (<rightsDecisions>/*.json, kind owner-rights-decision). Only the owner writes them. A
 * decision counts only if it names this exact recording: reciter, surah, URL, size AND the SHA-256 of the reviewed
 * file, says cleared: true, and gives the basis, who decided and when. Anything else is reported and ignored.
 */
export function readRightsDecisions(dir) {
  const out = { decisions: [], problems: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let d;
    try { d = readJson(path.join(dir, f)); } catch (error) { out.problems.push({ source: 'rights', file: f, problem: `unreadable: ${error.message}` }); continue; }
    const ok = d.kind === 'owner-rights-decision' && RECITER.has(d.reciterId) && Number.isInteger(d.surah) && providerOf(d.url) && Number.isInteger(d.bytes) && /^[0-9a-f]{64}$/.test(d.sha256 ?? '')
      && d.cleared === true && String(d.basis ?? '').trim() && String(d.decidedBy ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(d.decidedOn ?? '');
    if (ok) out.decisions.push({ ...d, file: f });
    else out.problems.push({ source: 'rights', file: f, problem: 'refused: an owner rights decision must give kind, reciterId, surah, url, bytes, sha256, cleared: true, basis, decidedBy and decidedOn' });
  }
  return out;
}
const decisionFor = (decisions, s) => decisions.find((d) => d.reciterId === s.reciterId && d.surah === s.surah && d.url === s.url && d.bytes === s.bytes && s.sha256 && d.sha256 === s.sha256) ?? null;

function rightsFor(reciterId, provider, pkg, issues) {
  const notes = (issues.rights ?? []).filter((r) => r.reciterIds.includes(reciterId) && r.provider === provider).map((r) => `${r.text} (${r.source})`);
  let reason;
  if (provider === 'mp3quran') reason = 'MP3Quran\'s streaming permission is site-wide; rights for this recording are not established.';
  else reason = `no permission for app use (${pkg?.experiment?.rightsStatus ?? 'unknown'}).`;
  return { cleared: false, reason: [reason, ...notes].join(' '), ...(notes.some((n) => n.includes(KFGQPC)) ? { id3Copyright: KFGQPC } : {}) };
}

export function sessionFromPackage(pkg, { key, provider, sourceId, phase, packageFile, packageSha256, issues, concerns, sha256 }) {
  const r = RECITER.get(pkg.reciterId);
  const durationMs = pkg.durationMs ?? pkg.format.durationMs;
  const starts = Object.fromEntries(pkg.ayahs.map((a) => [a.ayah, a.startMs]));
  const boundaries = [
    { ayah: 1, ms: pkg.ayahs[0].startMs, flags: [], priority: 3, opening: true },
    ...(pkg.boundaries ?? []).map((b) => ({ ayah: b.ayah, ms: b.ms, flags: b.flags ?? [], priority: b.priority, acoustic: b.acoustic ?? null, pauseMs: b.pauseMs ?? null, ...(b.problemAt ? { problemAt: true } : {}), ...(b.repairedFromMs !== undefined ? { repairedFromMs: b.repairedFromMs } : {}), ...(b.sweep ? { sweep: b.sweep, mp3quran: b.mp3quran } : {}), ...(b.score !== undefined ? { score: b.score } : {}), ...(b.check ? { check: b.check } : {}), ...(b.identity ? { identity: b.identity } : {}) })),
  ];
  return {
    kind: 'manual-timing-session', version: 2, synthetic: pkg.synthetic === true,
    reviewType: pkg.source === 'per-ayah' ? 'per-ayah-verification' : pkg.source === 'development' ? 'development-verification' : 'alignment-verification',
    key, reciterId: pkg.reciterId, reciterEn: r.nameEn, reciterAr: r.nameAr, recording: pkg.recording,
    surah: pkg.surah, surahAr: pkg.surahAr, surahEn: pkg.surahEn, ayahCount: pkg.ayahCount,
    url: pkg.url, provider, bytes: pkg.bytes, sha256: sha256 ?? pkg.experiment?.sha256 ?? null,
    durationMs, format: pkg.format ?? null,
    timeline: 'decoded audio (miniaudio, the aligner\'s timeline); browser playback of a CBR file may differ by up to one MP3 frame (26 ms); VBR files play from a lossless PCM decode',
    textSource: pkg.textSource, basmala: pkg.basmala ?? null, ayahs: pkg.ayahs.map((a) => ({ ayah: a.ayah, text: a.text })),
    peaks: null, quiet: null, evidence: null,
    proposal: {
      source: pkg.source, status: pkg.status, fingerprint: pkg.candidateFingerprint, starts, endMs: pkg.ayahs.at(-1).endMs, intro: pkg.intro ?? null,
      boundaries, worklist: pkg.worklist ?? [], worklistRule: pkg.worklistRule ?? null, checks: pkg.checks ?? null, structure: pkg.structure ?? null,
      completeness: pkg.completeness ?? null, evidence: pkg.evidence ?? null, recovery: pkg.recovery ? { evidence: pkg.recovery.evidence } : null, experiment: pkg.experiment ?? null,
      ...(pkg.perAyah ? { perAyah: { base: pkg.perAyah.base, basmala: pkg.perAyah.basmala ?? null, files: pkg.perAyah.files, risk: pkg.perAyah.risk, riskReport: pkg.perAyah.riskReport ?? null, reviewCopy: { kind: pkg.perAyah.reviewCopy.kind, sha256: pkg.perAyah.reviewCopy.sha256 } } } : {}),
      note: pkg.source === 'per-ayah'
        ? 'Per-ayah recording: every ayah is its own file, and each start is exactly where that file begins in this review copy (the files joined in the app\'s order, the Basmala first). Nothing is estimated. Listen to the ayah: Confirm it if it is the right ayah, complete and clean; otherwise Reject it, with a note. Automated checks are evidence, not a decision.'
        : 'Automatic proposal: shown as a starting point to listen from. Nothing here is a human decision; every start must be confirmed or corrected by ear.',
    },
    concerns, playbackBlocked: pkg.playbackBlocked ?? [], blocked: pkg.blocked ?? [],
    rights: rightsFor(pkg.reciterId, provider, pkg, issues),
    provenance: { sourceId, phase, packageFile, packageSha256, packageCreatedOn: pkg.createdOn, candidateFingerprint: pkg.candidateFingerprint },
  };
}

// ---------------------------------------------------------------- production boundary checks

const latest = (dir, re) => fs.readdirSync(dir).filter((f) => re.test(f)).sort().at(-1);
/**
 * Production recordings with documented, unresolved listening checks (a completed approval is reopened ONLY for these):
 * every boundary the source audit left "to be checked by listening" (audit-results.json `review`: displaced or
 * unconfirmed, with the production start the boundary sweep tested), and the source audit's own listening checks
 * (known-issues.json `productionChecks`). One scoped session per recording: only those starts are reviewed.
 */
export function productionSessions(src, issues) {
  const out = { sessions: [], problems: [], evidence: [] };
  const audit = readJson(path.join(TOOLS, 'audit-results.json'));
  const ad = path.join(TOOLS, 'audit-data');
  const sweepName = src.sweep ?? latest(ad, /^boundary-sweep-\d{4}-\d\d-\d\d\.json$/);
  const sweep = readJson(path.join(ad, sweepName));
  const formats = readJson(path.join(ad, latest(ad, /^recording-formats-\d{4}-\d\d-\d\d\.json$/))).recordings;
  const measured = readJson(path.join(TOOLS, 'measured-timing.json'));
  out.evidence.push('tools/quran-audio/audit-results.json (review)', `tools/quran-audio/audit-data/${sweepName}`, 'docs/audio/source-audit.md');
  const wanted = new Map();
  const add = (id, s, item) => {
    const k = `${id}:${s}`;
    if (!wanted.has(k)) wanted.set(k, new Map());
    const m = wanted.get(k);
    const old = m.get(item.ayah);
    m.set(item.ayah, old ? { ...item, ...old, ms: old.ms ?? item.ms, priority: Math.min(old.priority, item.priority), flags: [...new Set([...old.flags, ...item.flags])], ...(item.check ? { check: item.check, checkSource: item.checkSource } : {}) } : item);
  };
  for (const r of audit.reciters) {
    for (const [s, list] of Object.entries(r.review ?? {})) {
      for (const x of list) {
        const [ref, cls] = x.split(' ');
        const ayah = Number(ref.split(':')[1]);
        const e = sweep.reciters?.[r.id]?.surahs?.[s]?.notInPause?.find((y) => y[0] === ayah);
        if (!e) { out.problems.push({ source: src.id, key: `${r.id}-${s}`, problem: `${x}: not found in ${sweepName}` }); continue; }
        add(r.id, Number(s), { ayah, ms: e[1], flags: [cls], priority: cls === 'displaced' ? 1 : 2, sweep: { nearRatio: e[2], atRatio: e[3], nearestPauseRelativeMs: e[5] } });
      }
    }
  }
  for (const c of issues.productionChecks ?? []) {
    for (const s of c.surahs) {
      const n = canon().meta.get(s)?.ayahs ?? 0;
      for (const a of c.ayahs === 'all' ? Array.from({ length: n }, (_, i) => i + 1) : c.ayahs) {
        const ms = measured.reciters?.[c.reciterId]?.surahs?.[s]?.[a - 1]?.[0] ?? null;
        add(c.reciterId, s, { ayah: a, ms, flags: ['listening-check'], priority: c.priority ?? 3, check: c.text, checkSource: c.source });
      }
    }
  }
  const { text, meta, basmala: B } = canon();
  for (const [k, items] of wanted) {
    const [id, sStr] = k.split(':');
    const s = Number(sStr);
    const r = audit.reciters.find((x) => x.id === id);
    const rec = RECITER.get(id);
    const m = meta.get(s);
    if (!r?.timed?.[s]) { out.problems.push({ source: src.id, key: `${id}-${s}`, problem: 'listed for a production check but has no production timing (not registered)' }); continue; }
    const fmt = formats[id]?.files?.[s];
    if (!fmt?.durationMs) { out.problems.push({ source: src.id, key: `${id}-${s}`, problem: 'no audited duration for this file' }); continue; }
    const scope = [...items.keys()].sort((a, b) => a - b);
    const boundaries = scope.map((a) => items.get(a));
    const words = B.split(' ').length;
    let basmala = null;
    const ayahs = Array.from({ length: m.ayahs }, (_, i) => {
      let t = text.get(`${s}:${i + 1}`);
      if (i === 0 && s !== 1 && s !== 9 && t.split(' ').slice(0, words).join(' ') === B) { basmala = B; t = t.split(' ').slice(words).join(' '); }
      return { ayah: i + 1, text: t };
    });
    const checks = [...new Set(boundaries.filter((b) => b.check).map((b) => `${b.check} (${b.checkSource})`))];
    const fp = sha256Text(JSON.stringify({ scope, boundaries })).slice(0, 8);
    const rights = rightsFor(id, 'mp3quran', null, issues);
    out.sessions.push({
      kind: 'manual-timing-session', version: 2, synthetic: false, reviewType: 'production-boundary-check',
      key: keyFor(id, s, 'mp3quran'), reciterId: id, reciterEn: rec.nameEn, reciterAr: rec.nameAr, recording: r.moshafName,
      surah: s, surahAr: m.ar, surahEn: m.en, ayahCount: m.ayahs, url: `${r.server}${String(s).padStart(3, '0')}.mp3`, provider: 'mp3quran', bytes: r.bytes[s], sha256: null,
      durationMs: fmt.durationMs, format: { kbps: fmt.kbps, mode: fmt.bitrateMode, durationMs: fmt.durationMs },
      timeline: 'decoded audio (miniaudio); the production starts are those the boundary sweep tested on the same file',
      textSource: "tools/quran-verification/input/quran-uthmani.txt (Tanzil Uthmani 1.1, the app's runtime text), verbatim",
      basmala, ayahs, peaks: null, quiet: null, evidence: null, scope,
      proposal: {
        source: 'production', status: 'production timing: it plays in the app today, and this check never changes it', fingerprint: fp,
        starts: Object.fromEntries(boundaries.filter((b) => b.ms != null).map((b) => [b.ayah, b.ms])), endMs: null, intro: null,
        boundaries: boundaries.map((b) => ({ ayah: b.ayah, ms: b.ms, flags: b.flags, priority: b.priority, ...(b.sweep ? { sweep: b.sweep } : {}), ...(b.check ? { check: b.check } : {}) })),
        worklist: scope, worklistRule: 'production starts left for listening by the source audit: displaced (priority 1), unconfirmed (priority 2), and its listening checks',
        note: 'Production starts: the times the app uses now. Confirm each one that is right; place it by ear where it is not. A disagreement with production is a finding for the owner.',
      },
      concerns: [...concernsFor(issues, id, s, 'mp3quran'), ...checks.map((c) => ({ kind: 'listening-check', text: c, source: 'docs/audio/source-audit.md' }))],
      playbackBlocked: [], blocked: [],
      rights: { ...rights, reason: `production recording (already in the app). ${rights.reason} This check never changes rights or timing.` },
      provenance: { sourceId: src.id, phase: src.phase ?? null, evidence: out.evidence, packageFile: null, packageSha256: fp, candidateFingerprint: fp, productionFingerprint: r.timed[s]?.fingerprint ?? null },
    });
  }
  return out;
}

// ---------------------------------------------------------------- sources

function concernsFor(issues, reciterId, surah, provider) {
  return (issues.concerns ?? []).filter((c) => c.reciterId === reciterId && (c.surahs === 'all' || c.surahs.includes(surah)) && (c.provider ?? 'mp3quran') === provider)
    .map((c) => ({ kind: c.kind, text: c.text, source: c.source }));
}

function readManualSource(src, ctx) {
  const out = { tasks: [], blocked: [], problems: [] };
  const qf = path.join(src.sessions, 'queue.json');
  const queue = fs.existsSync(qf) ? readJson(qf) : { items: [], excluded: {} };
  if (queue.kind && queue.kind !== 'manual-timing-queue') { out.problems.push({ source: src.id, file: qf, problem: `not a manual-timing-queue (${queue.kind})` }); return out; }
  const files = fs.readdirSync(src.sessions).filter((f) => f.endsWith('.json') && f !== 'queue.json');
  for (const f of files) {
    const key = f.slice(0, -5);
    const file = path.join(src.sessions, f);
    let s;
    try { s = readJson(file); } catch (error) { out.problems.push({ source: src.id, file, problem: `unreadable: ${error.message}` }); continue; }
    const p = [];
    if (s.kind !== 'manual-timing-session') p.push('not a manual-timing-session');
    if (!/^[a-z0-9-]+$/.test(key)) p.push(`key ${key} has characters other than a-z 0-9 -`);
    if (!RECITER.has(s.reciterId) && s.synthetic !== true) p.push(`unknown reciter ${s.reciterId}`);
    if (canon().meta.get(s.surah)?.ayahs !== s.ayahCount || s.ayahs?.length !== s.ayahCount) p.push('ayah count differs from the canonical count');
    else p.push(...textProblems(s.surah, s.basmala, s.ayahs));
    const audio = s.audioFile ? path.join(src.audio, s.audioFile) : null;
    if (p.length) { out.problems.push({ source: src.id, file, problem: p.join('; ') }); continue; }
    const provider = providerOf(s.url) ?? 'local';
    const meta = queue.items.find((x) => x.key === key) ?? {};
    out.tasks.push({
      key, reviewType: s.synthetic ? 'synthetic-practice' : 'manual-timing', sourceId: src.id, sourceKind: src.kind, phase: src.phase ?? null,
      reciterId: s.reciterId, surah: s.surah, url: s.url, provider, bytes: s.bytes, sha256: s.sha256 ?? null, durationMs: s.durationMs, ayahCount: s.ayahCount,
      surahEn: s.surahEn, surahAr: s.surahAr, format: null, synthetic: s.synthetic === true,
      sessionFile: file, dataDir: src.data, audioFile: audio && fs.existsSync(audio) && fs.statSync(audio).size === s.bytes ? audio : null,
      audioProblem: !audio ? 'the session names no audio file' : !fs.existsSync(audio) ? `missing local audio ${audio}` : fs.statSync(audio).size !== s.bytes ? `local audio ${audio} has the wrong size` : null,
      group: meta.group ?? null, note: meta.note ?? null, queueIndex: queue.items.indexOf(meta),
      concerns: concernsFor(ctx.issues, s.reciterId, s.surah, provider), playbackBlocked: [], rights: s.rights ?? { cleared: false, reason: 'not recorded' },
      risk: riskOf(s), counts: countsOf(s), proposal: null, evidence: s.evidence ? { verdict: s.evidence.verdict, source: s.evidence.source } : null, opening: openingSummary(s),
      provenance: { sourceId: src.id, phase: src.phase ?? null, sessionFile: file, sessionSha256: sha256File(file), prepared: 'review/manual/prepare.py' },
    });
  }
  for (const [why, surahs] of Object.entries(queue.excluded ?? {})) {
    for (const s of surahs) {
      const reciterId = queue.items[0]?.key?.split('-').slice(0, -1).join('-') || src.reciterId || 'rifaat';
      out.blocked.push({ key: keyFor(reciterId, s, 'mp3quran'), reciterId, surah: s, provider: 'mp3quran', reason: why, source: `${src.id}: ${qf}`, evidence: queue.source ?? null });
    }
  }
  return out;
}

function countsOf(session) {
  const risk = riskOf(session);
  const scoped = Array.isArray(session.scope) && session.scope.length;
  const c = { starts: scoped ? session.scope.length : session.ayahCount, veryhigh: 0, high: 0, medium: 0, check: 0, routine: 0, worklist: session.proposal?.worklist?.length ?? null, boundariesProposed: session.proposal ? session.proposal.boundaries.filter((b) => !b.opening).length : null };
  for (const [t] of risk) if (t !== 'n/a') c[t]++;
  if (session.proposal) {
    c.p1 = session.proposal.boundaries.filter((b) => b.priority === 1 && !b.opening).length;
    c.p2 = session.proposal.boundaries.filter((b) => b.priority === 2).length;
  }
  return c;
}

function readPackageSource(src, ctx) {
  const out = { tasks: [], blocked: [], problems: [], packages: [] };
  const ixFile = path.join(src.dir, 'index.json');
  let ix;
  try { ix = readJson(ixFile); } catch (error) { out.problems.push({ source: src.id, file: ixFile, problem: `unreadable index: ${error.message}` }); return out; }
  if (ix.kind !== 'ayah-timing-review-index' || !Array.isArray(ix.packages)) { out.problems.push({ source: src.id, file: ixFile, problem: 'not an ayah-timing-review-index' }); return out; }
  for (const entry of ix.packages) {
    const file = path.resolve(src.dir, entry.file ?? '');
    if (!file.startsWith(path.resolve(src.dir) + path.sep)) { out.problems.push({ source: src.id, file: entry.file, problem: 'package path leaves the source folder' }); continue; }
    let raw, pkg;
    try { raw = fs.readFileSync(file, 'utf8'); pkg = JSON.parse(raw); } catch (error) { out.problems.push({ source: src.id, file, problem: `unreadable: ${error.message}` }); continue; }
    const problems = packageProblems(pkg);
    if (problems.length) { out.problems.push({ source: src.id, file, problem: problems.join('; '), reciterId: pkg.reciterId, surah: pkg.surah }); continue; }
    const provider = providerOf(pkg.url);
    out.packages.push({ src, file, raw, pkg, provider, key: keyFor(pkg.reciterId, pkg.surah, provider), phase: pkg.experiment?.phase ?? src.phase ?? null });
  }
  return out;
}

function readLegacyFlags(src) {
  const out = [];
  for (const id of fs.readdirSync(src.dir).filter((d) => RECITER.has(d) && fs.statSync(path.join(src.dir, d)).isDirectory())) {
    for (const f of fs.readdirSync(path.join(src.dir, id)).filter((x) => x.endsWith('.flags.json'))) {
      try {
        const fl = readJson(path.join(src.dir, id, f));
        if (fl.url && fl.candidate?.fingerprint) out.push({ reciterId: id, surah: fl.surah, url: fl.url, bytes: fl.bytes, fingerprint: fl.candidate.fingerprint, file: path.join(src.dir, id, f) });
      } catch { /* not a flags file */ }
    }
  }
  return out;
}

/** index.json / queue.json manifests of the known kinds under the scan roots that no configured source already covers. */
export function discoverSources(cfg) {
  const known = new Set(cfg.sources.map((s) => path.resolve(s.dir ?? s.sessions ?? '')));
  const skip = new Set([cfg.dataDir, cfg.registryDir, cfg.cacheDir, cfg.backupDir, cfg.base].map((p) => path.resolve(p)));
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < cfg.scanDepth && !skip.has(path.resolve(p)) && !e.name.startsWith('.') && e.name !== 'node_modules') walk(p, depth + 1); continue; }
      if (e.name !== 'index.json' && e.name !== 'queue.json') continue;
      if (known.has(path.resolve(dir))) continue;
      let j;
      try { j = readJson(p); } catch { continue; }
      if (e.name === 'index.json' && j.kind === 'ayah-timing-review-index') found.push({ id: `discovered:${path.relative(cfg.base, dir).replaceAll('\\', '/')}`, kind: 'review-packages', dir, phase: j.phase ?? null, discovered: true });
      if (e.name === 'queue.json' && j.kind === 'manual-timing-queue') {
        const ws = path.dirname(dir);
        found.push({ id: `discovered:${path.relative(cfg.base, dir).replaceAll('\\', '/')}`, kind: 'manual-sessions', sessions: dir, audio: path.join(ws, 'audio'), data: path.join(ws, 'data'), phase: j.phase ?? null, discovered: true });
      }
    }
  };
  for (const root of cfg.scanRoots) walk(root, 0);
  return found;
}

// ---------------------------------------------------------------- local audio

function shaIndex(cfg) {
  const file = path.join(cfg.cacheDir, 'sha-index.json');
  const idx = fs.existsSync(file) ? readJson(file) : {};
  let dirty = false;
  return {
    get(p) {
      const st = fs.statSync(p);
      const k = path.resolve(p);
      const hit = idx[k];
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha256;
      const sha256 = sha256File(p);
      idx[k] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
      dirty = true;
      return sha256;
    },
    save() { if (dirty) { fs.mkdirSync(cfg.cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(idx)); } },
  };
}

/**
 * A validated local copy of a package's recording, or null. Cached copy first (dashboard cache), then the configured
 * local folders: by naming pattern (size must match), or by size + SHA-256 (for files named otherwise). A local file
 * of the wrong size or hash is never used.
 */
function findLocalAudio(cfg, t, sha, bySize) {
  const cached = path.join(cfg.cacheDir, 'audio', `${t.key}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size === t.bytes && (!t.sha256 || sha.get(cached) === t.sha256)) return { file: cached, how: 'dashboard cache' };
  for (const l of cfg.localAudio) {
    if (!fs.existsSync(l.dir)) continue;
    let file = null;
    if (l.naming) {
      const p = path.join(l.dir, l.naming.replace('{reciterId}', t.reciterId).replace('{surah}', String(t.surah)).replace('{surah3}', String(t.surah).padStart(3, '0')));
      if (fs.existsSync(p) && fs.statSync(p).size === t.bytes && (!t.sha256 || sha.get(p) === t.sha256)) file = p;
    } else if (l.match === 'sha256' && t.sha256) {
      for (const p of bySize(l.dir).get(t.bytes) ?? []) if (sha.get(p) === t.sha256) { file = p; break; }
    }
    if (!file) continue;
    if (l.copyToCache) {
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.copyFileSync(file, `${cached}.part`);
      if (sha.get(`${cached}.part`) !== sha.get(file)) { fs.rmSync(`${cached}.part`); continue; }
      fs.renameSync(`${cached}.part`, cached);
      return { file: cached, how: `copied to the dashboard cache from ${file}` };
    }
    return { file, how: `local copy (${l.label ?? l.dir})` };
  }
  return null;
}

/**
 * A per-ayah package's review copy (the surah's files joined, outside the repository), or null when it is missing or
 * not the packaged file (size and SHA-256). Never downloaded: the package URL is a folder.
 */
function reviewCopyOf(pkg, sha) {
  const rc = pkg.perAyah.reviewCopy;
  const file = path.resolve(rc.file);
  if (!fs.existsSync(file) || fs.statSync(file).size !== rc.bytes || sha.get(file) !== rc.sha256) return null;
  return { file, how: `per-ayah review copy (${rc.kind === 'wav' ? 'PCM decode' : 'MP3 frames'} of the ${pkg.perAyah.files.length} files, joined)` };
}

// ---------------------------------------------------------------- the import

/** Recording priority: the owner's "start here" list first, then by risk. Lower rank = sooner. */
function prioritize(t, issues) {
  const start = issues.startHere?.keys ?? [];
  const reasons = [];
  if (start.includes(t.key)) return { label: 'start here', rank: start.indexOf(t.key), reasons: ['named first by the owner (Phase 4.8)'] };
  const share = t.counts.starts ? ((t.counts.veryhigh ?? 0) * 2 + t.counts.high + 0.5 * t.counts.medium) / t.counts.starts : 0;
  if (t.reviewType === 'production-boundary-check') {
    // Already in the app: only the listed starts are checked. A displaced start (heard inside recitation) comes first.
    return { label: t.counts.high ? 'high' : 'normal', rank: 130 + (t.counts.high ? 0 : 5) + 1 / (1 + t.counts.starts), reasons: [`in the app now: ${t.counts.starts} documented start(s) to check${t.counts.high ? `, ${t.counts.high} displaced or a listening check` : ''}`] };
  }
  let group = 3;
  if (t.reviewType === 'manual-timing') { group = 1; reasons.push('every start is placed by ear'); }
  if (t.phase === '4.7') { group = 1; reasons.push('Phase 4.7 candidate'); }
  if (t.reviewType === 'development-verification') { group = 2; reasons.push('already plays in development builds without a listening review'); }
  if (t.reviewType === 'per-ayah-verification') { group = 2; reasons.push('per-ayah development preview: only the ayahs the automated scan could not clear need listening'); }
  if (t.concerns.some((c) => ['content', 'repetition', 'production-history', 'boundary'].includes(c.kind))) { group = Math.min(group, 2); reasons.push('documented concern'); }
  if (t.playbackBlocked.some((x) => /VBR|seek/i.test(x))) { group = Math.max(group, 4); reasons.push('VBR: cannot reach the app until a seekable copy is hosted'); }
  if (share >= 0.3) reasons.push(`${Math.round(share * 100)} % of starts are high/medium risk`);
  const label = group <= 1 ? 'high' : group === 2 ? 'high' : group === 3 ? (share >= 0.3 ? 'high' : 'normal') : 'low';
  const within = t.reviewType === 'manual-timing' && t.queueIndex >= 0 ? t.queueIndex / 100 : 1 - share;
  return { label, rank: 100 + group * 10 + within, reasons };
}

/**
 * Discovers, validates and registers every review task. Writes the generated sessions (only when new, or changed and
 * not yet reviewed) and registry/inventory.json. Returns the inventory.
 */
export function importAll(cfg, { now = () => new Date().toISOString(), issuesFile = path.join(here, 'known-issues.json'), hasLog = () => false, log = () => {} } = {}) {
  const issues = readJson(issuesFile);
  const discovered = discoverSources(cfg);
  const sources = [...cfg.sources, ...discovered];
  const sha = shaIndex(cfg);
  const sizeIndex = new Map();
  const bySize = (dir) => {
    if (!sizeIndex.has(dir)) {
      const m = new Map();
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.mp3$/i.test(e.name)) { const s = fs.statSync(p).size; if (!m.has(s)) m.set(s, []); m.get(s).push(p); } } };
      walk(dir);
      sizeIndex.set(dir, m);
    }
    return sizeIndex.get(dir);
  };
  const audit = readJson(path.join(TOOLS, 'audit-results.json'));
  const devTiming = readJson(path.join(TOOLS, 'development', 'development-timing.json'));
  const rights = readRightsDecisions(cfg.rightsDir);
  const problems = [...rights.problems];
  const blocked = [];
  const superseded = [];
  const manualTasks = [];
  const packages = [];
  const legacy = [];
  const productionSources = [];
  const sourceReport = [];
  for (const src of sources) {
    const where = src.kind === 'production-review' ? null : src.dir ?? src.sessions ?? '';
    if (where !== null && !fs.existsSync(where)) { problems.push({ source: src.id, problem: `source folder missing: ${src.dir ?? src.sessions}` }); sourceReport.push({ id: src.id, kind: src.kind, phase: src.phase, ok: false }); continue; }
    if (src.kind === 'manual-sessions') {
      const r = readManualSource(src, { issues });
      manualTasks.push(...r.tasks); blocked.push(...r.blocked); problems.push(...r.problems);
      sourceReport.push({ id: src.id, kind: src.kind, phase: src.phase, discovered: !!src.discovered, path: src.sessions, tasks: r.tasks.length, blocked: r.blocked.length, problems: r.problems.length });
    } else if (src.kind === 'review-packages') {
      const r = readPackageSource(src, { issues });
      packages.push(...r.packages); problems.push(...r.problems);
      sourceReport.push({ id: src.id, kind: src.kind, phase: src.phase, discovered: !!src.discovered, path: src.dir, packages: r.packages.length, problems: r.problems.length });
    } else if (src.kind === 'production-review') {
      productionSources.push(src);
    } else if (src.kind === 'legacy-flags') {
      const r = readLegacyFlags(src);
      legacy.push(...r.map((x) => ({ ...x, src })));
      sourceReport.push({ id: src.id, kind: src.kind, phase: src.phase, path: src.dir, candidates: r.length });
    } else problems.push({ source: src.id, problem: `unknown source kind ${src.kind}` });
  }

  // One task per recording. Manual sessions first (the prepared human route), then packages: unblocked over blocked,
  // newest first, then configuration order.
  const tasks = new Map();
  const byIdentity = new Map();
  for (const t of manualTasks) {
    if (tasks.has(t.key)) { problems.push({ source: t.sourceId, problem: `duplicate session key ${t.key} (kept the first)` }); continue; }
    tasks.set(t.key, t); byIdentity.set(identity(t), t.key);
  }
  /**
   * Writes a generated session into the registry: new, or changed and not yet reviewed. A session whose review has
   * begun keeps the version it started on (the change is reported); its concerns and rights still follow the current
   * documents, since they are not what is reviewed. Mutates `session` back to the frozen version. Returns the file.
   */
  function register(session, { source, file }) {
    const key = session.key;
    const decision = decisionFor(rights.decisions, session);
    if (decision) session.rights = { cleared: true, basis: decision.basis, decidedBy: decision.decidedBy, decidedOn: decision.decidedOn, decision: decision.file, reason: `rights cleared by ${decision.decidedBy} on ${decision.decidedOn}: ${decision.basis}` };
    const sessionFile = path.join(cfg.registryDir, 'sessions', `${key}.json`);
    const json = JSON.stringify(session);
    if (!fs.existsSync(sessionFile)) {
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, json);
      log(`registered ${key}`);
      return sessionFile;
    }
    const old = readJson(sessionFile);
    const changed = old.proposal?.fingerprint !== session.proposal.fingerprint || old.provenance?.packageSha256 !== session.provenance.packageSha256 || old.sha256 !== session.sha256 || JSON.stringify(old.scope ?? null) !== JSON.stringify(session.scope ?? null);
    const notes = JSON.stringify([old.concerns, old.rights]) !== JSON.stringify([session.concerns, session.rights]);
    if (changed && hasLog(key, cfg.dataDir)) {
      problems.push({ source, file, key, problem: `the package changed (fingerprint ${old.proposal?.fingerprint} → ${session.proposal.fingerprint}) after the review of ${key} began; the review keeps the version it started on (${old.provenance?.packageFile ?? old.provenance?.evidence})` });
      Object.assign(session, { proposal: old.proposal, provenance: old.provenance, sha256: old.sha256, durationMs: old.durationMs, ayahs: old.ayahs, basmala: old.basmala, scope: old.scope });
      if (notes) fs.writeFileSync(sessionFile, JSON.stringify({ ...old, concerns: session.concerns, rights: session.rights }));
    } else if (changed || notes) {
      fs.writeFileSync(sessionFile, json);
      log(`updated ${key}`);
    }
    return sessionFile;
  }
  const order = (a) => (a.pkg.blocked?.length ? 1 : 0);
  packages.sort((a, b) => order(a) - order(b) || String(b.pkg.createdOn).localeCompare(String(a.pkg.createdOn)) || sources.indexOf(a.src) - sources.indexOf(b.src));
  const blockedKeys = new Set(blocked.map((b) => b.key));
  for (const p of packages) {
    const { pkg } = p;
    const id = identity(pkg);
    const what = { reciterId: pkg.reciterId, surah: pkg.surah, source: p.src.id, phase: p.phase, file: p.file, fingerprint: pkg.candidateFingerprint };
    if (byIdentity.has(id)) {
      const winner = tasks.get(byIdentity.get(id));
      superseded.push({ ...what, by: winner.key, reason: winner.sourceKind === 'manual-sessions' ? `the recording is on the manual-timing route (${winner.sourceId})${pkg.blocked?.length ? `; this package was blocked: ${pkg.blocked.join('; ')}` : ''}` : winner.proposal?.fingerprint === pkg.candidateFingerprint ? `the same candidate is also in ${winner.sourceId}` : `a newer candidate of the same recording (${winner.sourceId}, ${winner.proposal?.fingerprint})` });
      continue;
    }
    if (blockedKeys.has(p.key)) {
      const b = blocked.find((x) => x.key === p.key);
      superseded.push({ ...what, by: null, reason: `recording unavailable: ${b.reason}${pkg.blocked?.length ? `; this package was blocked: ${pkg.blocked.join('; ')}` : ''}` });
      continue;
    }
    const entry = audit.reciters.find((r) => r.id === pkg.reciterId);
    if (entry?.timed?.[pkg.surah] && `${entry.server}${String(pkg.surah).padStart(3, '0')}.mp3` === pkg.url) {
      superseded.push({ ...what, by: null, reason: 'this recording already has production timing (a completed approval is not reopened without a documented issue)' });
      continue;
    }
    if (pkg.blocked?.length) {
      blocked.push({ key: p.key, reciterId: pkg.reciterId, surah: pkg.surah, provider: p.provider, reason: pkg.blocked.join('; '), source: `${p.src.id}: ${p.file}` });
      continue;
    }
    let key = p.key;
    if (tasks.has(key)) { key = `${key}-b`; problems.push({ source: p.src.id, file: p.file, problem: `another recording already uses key ${p.key}; registered as ${key}` }); }
    const t0 = { key, reciterId: pkg.reciterId, surah: pkg.surah, bytes: pkg.bytes, sha256: pkg.experiment?.sha256 ?? pkg.perAyah?.reviewCopy?.sha256 ?? null };
    const local = pkg.perAyah ? reviewCopyOf(pkg, sha) : findLocalAudio(cfg, t0, sha, bySize);
    const audioSha = local ? sha.get(local.file) : null;
    const session = sessionFromPackage(pkg, { key, provider: p.provider, sourceId: p.src.id, phase: p.phase, packageFile: p.file, packageSha256: sha256Text(p.raw), issues, concerns: concernsFor(issues, pkg.reciterId, pkg.surah, p.provider), sha256: audioSha });
    const sessionFile = register(session, { source: p.src.id, file: p.file });
    const active = devTiming.reciters?.[pkg.reciterId]?.surahs?.[pkg.surah] && devTiming.reciters[pkg.reciterId].audio && `${devTiming.reciters[pkg.reciterId].audio}${String(pkg.surah).padStart(3, '0')}.mp3` === pkg.url;
    const t = {
      key, reviewType: session.reviewType, sourceId: p.src.id, sourceKind: 'review-packages', phase: p.phase,
      reciterId: pkg.reciterId, surah: pkg.surah, url: pkg.url, provider: p.provider, bytes: pkg.bytes, sha256: session.sha256, durationMs: session.durationMs, ayahCount: pkg.ayahCount,
      surahEn: pkg.surahEn, surahAr: pkg.surahAr, format: pkg.format ?? null, synthetic: false,
      sessionFile, dataDir: cfg.dataDir, audioFile: local?.file ?? null, audioHow: local?.how ?? null,
      audioProblem: local ? null : pkg.perAyah ? `the local review copy ${pkg.perAyah.reviewCopy.file} is missing or not the packaged file: re-run per-ayah/make-review-packages.mjs` : 'no validated local copy: it is downloaded from the original URL when the recording is opened',
      perAyah: !!pkg.perAyah,
      group: p.phase ? `Phase ${p.phase}` : null, note: null, queueIndex: -1,
      concerns: session.concerns, playbackBlocked: session.playbackBlocked, rights: session.rights, activeInDevelopment: !!active,
      risk: riskOf(session), counts: countsOf(session), proposal: { source: pkg.source, fingerprint: pkg.candidateFingerprint }, opening: openingSummary(session),
      provenance: session.provenance,
    };
    tasks.set(key, t); byIdentity.set(id, key);
  }
  for (const src of productionSources) {
    const r = productionSessions(src, issues);
    problems.push(...r.problems);
    sourceReport.push({ id: src.id, kind: src.kind, phase: src.phase, path: r.evidence.join(', '), tasks: r.sessions.length, problems: r.problems.length });
    for (const session of r.sessions) {
      if (tasks.has(session.key)) { problems.push({ source: src.id, key: session.key, problem: `${session.key} already has a task (${tasks.get(session.key).sourceId}); the production check is not registered twice` }); continue; }
      const local = findLocalAudio(cfg, { key: session.key, reciterId: session.reciterId, surah: session.surah, bytes: session.bytes, sha256: null }, sha, bySize);
      session.sha256 = local ? sha.get(local.file) : null;
      const sessionFile = register(session, { source: src.id, file: r.evidence.join(', ') });
      tasks.set(session.key, {
        key: session.key, reviewType: session.reviewType, sourceId: src.id, sourceKind: 'production-review', phase: src.phase ?? null,
        reciterId: session.reciterId, surah: session.surah, url: session.url, provider: 'mp3quran', bytes: session.bytes, sha256: session.sha256, durationMs: session.durationMs, ayahCount: session.ayahCount,
        surahEn: session.surahEn, surahAr: session.surahAr, format: session.format, synthetic: false,
        sessionFile, dataDir: cfg.dataDir, audioFile: local?.file ?? null, audioHow: local?.how ?? null, audioProblem: local ? null : 'no validated local copy: it is downloaded from the original URL when the recording is opened',
        group: 'production check', note: null, queueIndex: -1,
        concerns: session.concerns, playbackBlocked: [], rights: session.rights, activeInDevelopment: false, inProduction: true,
        risk: riskOf(session), counts: countsOf(session), proposal: { source: 'production', fingerprint: session.proposal.fingerprint }, opening: openingSummary(session),
        provenance: session.provenance,
      });
      byIdentity.set(identity(session), session.key);
    }
  }
  for (const l of legacy) {
    const winner = byIdentity.get(identity(l));
    const w = winner ? tasks.get(winner) : null;
    const b = !w && blocked.find((x) => x.reciterId === l.reciterId && x.surah === l.surah);
    superseded.push({ reciterId: l.reciterId, surah: l.surah, source: l.src.id, phase: l.src.phase, file: l.file, fingerprint: l.fingerprint, by: w?.key ?? null,
      reason: w ? (w.proposal?.fingerprint === l.fingerprint ? `identical candidate in ${w.sourceId}` : w.sourceKind === 'manual-sessions' ? `the recording is on the manual-timing route (${w.sourceId})` : `newer candidate in ${w.sourceId} (${w.proposal?.fingerprint})`) : b ? `recording unavailable: ${b.reason}` : 'no current task for this recording (not re-registered: an older Phase 4 candidate)' });
  }
  for (const n of issues.notReviewable ?? []) {
    blocked.push({ key: `${n.reciterId}-${Array.isArray(n.surahs) ? n.surahs.join('.') : n.surahs}-${n.provider}`, reciterId: n.reciterId, surah: n.surahs, provider: n.provider, reason: n.reason, source: n.source, noPackage: true });
  }
  sha.save();
  for (const t of tasks.values()) {
    const r = RECITER.get(t.reciterId) ?? { nameEn: 'SYNTHETIC TEST DATA (not a recitation)', nameAr: '' };
    t.reciterEn = r.nameEn; t.reciterAr = r.nameAr;
    t.priority = prioritize(t, issues);
    if (t.activeInDevelopment === undefined) t.activeInDevelopment = false;
  }
  const list = [...tasks.values()].sort((a, b) => a.priority.rank - b.priority.rank || a.reciterId.localeCompare(b.reciterId) || a.surah - b.surah);
  const inventory = {
    kind: 'audio-review-inventory', version: 1, createdAt: now(), config: cfg.file,
    rules: [
      'one task per recording (reciter, surah, URL, size); duplicates and older candidates are listed as superseded, never counted twice',
      'a task is an ayah-start review of the whole recording: every start is accepted by Reviewer 1 or by the automatic acceptance policy (owner, 2026-10-24: Reviewer 2 is not required; a second review stays possible and is reported apart)',
      'blocked or unavailable recordings are listed apart and are not reviewable here',
      'nothing is treated as reviewed without a review log: there are no human decisions in packages',
      `${OPENING_RULE.id}: ${OPENING_RULE.rule}`,
    ],
    sources: sourceReport, tasks: list, blocked, superseded, problems,
    totals: totalsOf(list, blocked, superseded, problems),
  };
  fs.mkdirSync(cfg.registryDir, { recursive: true });
  fs.writeFileSync(path.join(cfg.registryDir, 'inventory.json'), JSON.stringify(inventory, null, 1));
  return inventory;
}

export function totalsOf(list, blocked, superseded, problems) {
  const sum = (f) => list.reduce((a, t) => a + f(t), 0);
  const byType = {};
  const byReciter = {};
  for (const t of list) {
    byType[t.reviewType] = (byType[t.reviewType] ?? 0) + 1;
    const r = (byReciter[t.reciterId] ??= { recordings: 0, starts: 0, high: 0 });
    r.recordings++; r.starts += t.counts.starts; r.high += t.counts.high;
  }
  return {
    recordings: list.length, ayahStarts: sum((t) => t.counts.starts), veryhigh: sum((t) => t.counts.veryhigh ?? 0), recordingsVeryHigh: list.filter((t) => t.counts.veryhigh).length, high: sum((t) => t.counts.high), medium: sum((t) => t.counts.medium), check: sum((t) => t.counts.check), routine: sum((t) => t.counts.routine),
    proposalBoundaries: sum((t) => t.counts.boundariesProposed ?? 0), worklist: sum((t) => t.counts.worklist ?? 0), p1: sum((t) => t.counts.p1 ?? 0), p2: sum((t) => t.counts.p2 ?? 0),
    byType, byReciter, blocked: blocked.length, superseded: superseded.length, problems: problems.length,
    withLocalAudio: list.filter((t) => t.audioFile).length,
    // Phase 4.8.8: the opening rule over every registered recording.
    opening: { rule: OPENING_RULE.id, applied: list.filter((t) => t.opening?.status === 'applied').length, excluded: list.filter((t) => t.opening?.status === 'excluded').length, outOfScope: list.filter((t) => t.opening?.status === 'out-of-scope').length, withExceptions: list.filter((t) => t.opening?.exceptions?.length).length },
  };
}
