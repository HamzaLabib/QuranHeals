// Writes mobile/src/audio/generated/timingRelease.ts: the reviewed, VBR and timed-preview ayah timing a RELEASE build may
// play (audio/reciters.ts). It only reads, and it fails closed: a surah is released only when every gate below passes,
// and anything it cannot establish is a blocker. With no device-test record, nothing is released.
//
// Inputs (never written): the development files the app already loads in development builds —
//   mobile/src/audio/generated/reviewedTiming.ts   (development/generate-reviewed-timing.mjs: every start accepted)
//   mobile/src/audio/generated/vbrTiming.ts        (development/generate-vbr-timing.mjs)
//   mobile/src/audio/generated/timedPreview.ts     (surah-sources/generate-timed-preview.mjs)
// plus audit-results.json, audit-data/ayah-counts.json, providers.mjs, mobile/src/constants/quranSources.ts and the owner's
// physical-device record, development/timing-device-tests.json (absent: no surah passes `devices`).
//
// Gates, per surah:
//   timing       the delta encoding gives the canonical ayah count, in order, every ayah of positive length, and its
//                FNV-1a fingerprint is the one recorded (the exact timing that was reviewed)
//   review       every start accepted by Reviewer 1 or the automatic policy (Reviewer 2 is not required: owner policy
//                2026-10-24): the surah's recorded reviewer1 + automatic counts must equal its canonical ayah count
//                (preview packages not yet in the dashboard fail)
//   integrity    reviewed / VBR: the catalogue's own MP3Quran file, a listed surah, at the audited size (a positive
//                integer on both sides), without production timing. Timed preview: an https URL and a positive size, and
//                only one recording per reciter (the app keys previews by reciter)
//   exclusive    reviewed / VBR: no development measured timing for the same surah (developmentTiming.ts), which the
//                app would otherwise load first
//   provider     providers.mjs permits streaming from the file's provider, on recorded evidence; or, for a timed preview,
//                an owner permission statement (development/source-permissions.json, kind
//                owner-source-permission-statements, streamingInApp: true) lists that exact recording: reciter, surah,
//                provider AND file URL. A statement never extends to another recording, file or provider
//   attribution  the app's Quran Sources & Credits list the provider
//   devices      timing-device-tests.json has exactly one entry for reciter:surah with the SAME fingerprint and size (and,
//                for a timed preview, the same file URL), and a passed result per platform:
//                { passed: true, device, testedOn: YYYY-MM-DD, build, runtime, nativeSeek, checks } where runtime is the
//                8-hex runtime fingerprint and nativeSeek the exact-seek method shown on the tested binary's build line
//                (Quran Sources & Credits; it must be that platform's patched player: Android 'index', iOS
//                'avfoundation-precise'), and checks contains ayah-starts, full-surah and background (VBR also
//                far-seek). CBR and timed previews need Android AND iOS; a VBR surah is released for each platform that
//                passed, and the app also requires that platform's method to be device-verified (audio/vbrSeek.ts).
//                A malformed record, an unknown kind or duplicate entries release nothing (fail closed).
//                OR a CLASS record (record.classes): the native player verified for the surah's playback class on that
//                platform — mp3quran-cbr (reviewed timing), mp3quran-vbr, host:<provider> (timed previews) — with the
//                same per-platform fields plus samples: ["reciter:surah", ...], at least CLASS_SAMPLES distinct real
//                members of that class (all of them when the class has fewer). A class pass is player evidence for that
//                class, never a claim that each surah was listened to; the report says which basis applied.
//   waiver       owner risk acceptance 2026-10-25 (owner-release-decisions.json, waives: ["device-evidence"]): a layer it
//                lists passes the devices gate WITHOUT device evidence, on both platforms, and the report says so. It is
//                not testing or evidence. Every other gate (timing, review, integrity, exclusive, attribution) still
//                applies, and the app still plays VBR only on a binary that reports the exact-seek capability.
//   measured     the development MEASURED timing (developmentTiming.ts: same evidence, boundary sweep and withdrawal
//                rules as the production measured timing; held only for the owner's listening review and approval) is
//                released only when an owner decision lists the layer "measured-timing" — never by this tool's own
//                choice — with the same timing, integrity, attribution and device (or waiver) gates
//   rights       owner decision 2026-10-25 (development/owner-release-decisions.json): missing rights documentation
//                no longer blocks a layer the decision lists. It is a decision to proceed WITHOUT verified rights
//                documentation, not a permission; the provider gate reports it as such.
//
// usage (from the repository root): node tools/quran-audio/development/generate-timing-release.mjs [--report <file.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';
import { PROVIDERS } from '../providers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const REPO = path.join(tools, '..', '..');
const GENERATED = path.join(REPO, 'mobile', 'src', 'audio', 'generated');

export const DEVICE_RECORD_KIND = 'audio-timing-device-tests';
const BASE_CHECKS = ['ayah-starts', 'full-surah', 'background'];
const PLATFORM_METHOD = { android: 'index', ios: 'avfoundation-precise' };
export const CLASS_SAMPLES = 2;

/** The object or array literal assigned to `name` in one of the app's generated files (our own output: plain JS literals). */
export function readGeneratedLiteral(text, name) {
  const at = text.indexOf(`export const ${name}:`);
  if (at < 0) throw new Error(`${name} not found`);
  const eq = text.indexOf('= ', at);
  const open = text[eq + 2];
  const close = open === '[' ? '\n];' : '\n};';
  const end = text.indexOf(close, eq);
  if (end < 0) throw new Error(`${name}: end not found`);
  return new Function(`return (${text.slice(eq + 2, end + 2)});`)();
}

/** Timing entries from the app's delta encoding: ayah 1's start, then each ayah's length. */
export function entriesOf(deltas) {
  const entries = [];
  let at = deltas[0];
  for (let k = 1; k < deltas.length; k++) {
    entries.push({ ayah: k, startMs: at, endMs: at + deltas[k] });
    at += deltas[k];
  }
  return entries;
}

function timingGate(x, ayahs) {
  const entries = entriesOf(x.deltas ?? []);
  if (entries.length !== ayahs) return [false, `${entries.length} ayahs, canonical ${ayahs}`];
  if (!(x.deltas[0] >= 0) || entries.some((e) => !(e.endMs > e.startMs))) return [false, 'an ayah without positive length'];
  const fp = timingFingerprint(entries);
  return fp === x.fingerprint ? [true, `${ayahs} ayahs; fingerprint ${fp}`] : [false, `fingerprint ${fp} is not the recorded ${x.fingerprint}`];
}

function platformResult(r, platform, checks) {
  if (!r || typeof r !== 'object') return [false, 'no result'];
  if (r.passed !== true) return [false, 'not passed'];
  const missing = checks.filter((c) => !(Array.isArray(r.checks) && r.checks.includes(c)));
  if (missing.length) return [false, `checks missing: ${missing.join(', ')}`];
  if (!(typeof r.device === 'string' && r.device.trim()) || !(typeof r.build === 'string' && r.build.trim()) || !/^\d{4}-\d\d-\d\d$/.test(r.testedOn ?? '')) return [false, 'device, build or date missing'];
  if (!/^[0-9a-f]{8}$/.test(r.runtime ?? '')) return [false, 'runtime fingerprint missing (8 hex characters from the build line)'];
  if (r.nativeSeek !== PLATFORM_METHOD[platform]) return [false, `the tested binary reported exact seek "${r.nativeSeek ?? 'none'}", not ${PLATFORM_METHOD[platform]} (an unpatched or other binary)`];
  return [true, `passed on ${r.device} (${r.testedOn}, build ${r.build}, runtime ${r.runtime}, ${r.nativeSeek})`];
}

/** Platforms whose class record (record.classes) verifies the player for class `cls`, with valid samples from `members`. */
function classPlatforms(record, cls, members, checks) {
  if (record?.kind !== DEVICE_RECORD_KIND || !Array.isArray(record.classes)) return { platforms: [], why: `no class record for ${cls}` };
  const all = record.classes.filter((c) => c?.class === cls);
  if (all.length !== 1) return { platforms: [], why: all.length ? `${all.length} class records for ${cls}: ambiguous` : `no class record for ${cls}` };
  const need = Math.min(CLASS_SAMPLES, members.size);
  const platforms = [];
  const why = [];
  for (const p of ['android', 'ios']) {
    const r = all[0][p];
    const [ok, w] = platformResult(r, p, checks);
    const samples = Array.isArray(r?.samples) ? [...new Set(r.samples)] : [];
    const valid = samples.filter((k) => members.has(k));
    if (ok && valid.length >= need && valid.length === samples.length) { platforms.push(p); why.push(`${p} class ${cls} verified (${w}; samples ${valid.join(', ')})`); }
    else why.push(`${p} class ${cls}: ${!ok ? w : valid.length !== samples.length ? 'a sample is not in this class' : `${valid.length} of ${need} samples`}`);
  }
  return { platforms, why: why.join('; ') };
}

/** Per-surah evidence first, then the class record: the union of the platforms that passed, and why. */
function devicesGateWithClass(record, reciterId, surah, x, checks, cls, members) {
  const one = devicesGate(record, reciterId, surah, x, checks);
  const cl = classPlatforms(record, cls, members, checks);
  return { platforms: ['android', 'ios'].filter((p) => one.platforms.includes(p) || cl.platforms.includes(p)), why: `surah: ${one.why} | ${cl.why}` };
}

/** The device gate: the platforms that passed for exactly this timing ([] when none), and why. */
function devicesGate(record, reciterId, surah, x, checks) {
  if (record?.kind !== DEVICE_RECORD_KIND || !Array.isArray(record.entries)) return { platforms: [], why: 'no physical-device record (development/timing-device-tests.json)' };
  const all = record.entries.filter((y) => y?.reciterId === reciterId && y?.surah === surah);
  if (all.length > 1) return { platforms: [], why: `${all.length} device-test entries for ${reciterId}:${surah}: ambiguous, keep one` };
  const e = all[0];
  if (!e) return { platforms: [], why: `no device-test entry for ${reciterId}:${surah}` };
  if (e.fingerprint !== x.fingerprint || e.bytes !== x.bytes) return { platforms: [], why: `the device-test entry is for other timing or another file (${e.fingerprint}/${e.bytes}, now ${x.fingerprint}/${x.bytes}): test again` };
  if (x.url !== undefined && e.url !== x.url) return { platforms: [], why: `the device-test entry names another file (${e.url ?? 'no url'}, now ${x.url}): test again` };
  const platforms = [];
  const why = [];
  for (const p of ['android', 'ios']) {
    const [ok, w] = platformResult(e[p], p, checks);
    if (ok) platforms.push(p);
    why.push(`${p} ${w}`);
  }
  return { platforms, why: why.join('; ') };
}

/**
 * Every release decision, pure (tests call it with fixtures). Returns the released timing and a report of every gate for
 * every candidate surah.
 */
export function releaseTiming({ reviewed, vbr, timedPreview, development = {}, permissions = null, decisions = null, record, audit, ayahCounts, providers, credits }) {
  const decisionList = decisions?.kind === 'owner-release-decisions' && Array.isArray(decisions.decisions) ? decisions.decisions : [];
  /** The owner's decision to proceed without verified rights documentation for a layer, or undefined. */
  const decisionFor = (layer) => decisionList.find((d) => Array.isArray(d?.layers) && d.layers.includes(layer) && !Array.isArray(d.waives));
  /** The owner's risk acceptance waiving device evidence for a layer, or undefined. */
  const waiverFor = (layer) => decisionList.find((d) => Array.isArray(d?.layers) && d.layers.includes(layer) && Array.isArray(d.waives) && d.waives.includes('device-evidence'));
  /** Device evidence, or the owner's waiver when evidence is incomplete: both platforms, reported as a waiver. */
  const withWaiver = (dev, layer) => {
    const w = waiverFor(layer);
    if (!w || dev.platforms.length === 2) return dev;
    return { platforms: ['android', 'ios'], why: `shipped without device evidence: owner risk acceptance ${w.id} (${w.decidedOn}), not testing | evidence so far: ${dev.why}` };
  };
  const keyOf = (id, s) => `${id}:${s}`;
  const members = { 'mp3quran-cbr': new Set(), 'mp3quran-vbr': new Set() };
  for (const [id, ss] of Object.entries(reviewed)) for (const s of Object.keys(ss)) members['mp3quran-cbr'].add(keyOf(id, s));
  for (const [id, ss] of Object.entries(vbr)) for (const s of Object.keys(ss)) members['mp3quran-vbr'].add(keyOf(id, s));
  for (const rec of timedPreview) for (const [s, x] of Object.entries(rec.surahs)) (members[`host:${x.provider}`] ??= new Set()).add(keyOf(rec.reciterId, s));
  const statements = permissions?.kind === 'owner-source-permission-statements' && Array.isArray(permissions.statements) ? permissions.statements : [];
  /** The owner statement covering exactly this recording (same reciter, surah, provider and file), or undefined. */
  const statementFor = (reciterId, surah, x) => statements.find((st) => st?.streamingInApp === true && Array.isArray(st.recordings)
    && st.recordings.some((r) => r?.reciterId === reciterId && r?.surah === surah && r?.provider === x.provider && r?.url === x.url));
  const ayahsOf = (s) => ayahCounts[s - 1];
  const size = (n) => Number.isInteger(n) && n > 0;
  const reviewGate = (x, ayahs) => {
    const accepted = (Number.isInteger(x.reviewer1) ? x.reviewer1 : 0) + (Number.isInteger(x.automatic) ? x.automatic : 0);
    return accepted === ayahs ? [true, `every start accepted (Reviewer 1: ${x.reviewer1 ?? 0}, automatic: ${x.automatic ?? 0})`] : [false, `${accepted} of ${ayahs} starts accepted in the review dashboard`];
  };
  const auditOf = new Map(audit.reciters.map((r) => [r.id, r]));
  const providerGate = (id) => {
    const p = providers.find((x) => x.id === id);
    return p?.streaming?.permitted === true && String(p.streaming.evidence ?? '').trim() ? [true, `streaming permitted: ${p.streaming.evidence}`] : [false, p ? `${p.name} does not permit streaming: ${p.streaming.evidence}` : `${id} is not in providers.mjs`];
  };
  const attributionGate = (id) => (new RegExp(`key: '${id}'`).test(credits) ? [true, `Quran Sources & Credits list ${id}`] : [false, `Quran Sources & Credits do not list ${id}`]);
  const report = { reviewed: {}, vbr: {}, timedPreview: {}, measured: {} };
  const out = { reviewed: {}, vbr: {}, timedPreview: [], measured: {} };

  const catalogue = (kind, data, checks) => {
    for (const [reciterId, surahs] of Object.entries(data)) {
      for (const [sk, x] of Object.entries(surahs)) {
        const s = Number(sk);
        const aud = auditOf.get(reciterId);
        const integrity = !aud?.server ? [false, 'not a catalogue recording'] : !aud.surahs.includes(s) ? [false, 'MP3Quran does not list this surah'] : aud.timed?.[s] ? [false, 'production timing exists'] : !size(x.bytes) || aud.bytes?.[s] !== x.bytes ? [false, `size ${x.bytes} is not the audited ${aud.bytes?.[s]}`] : [true, `${aud.server}${String(s).padStart(3, '0')}.mp3 at the audited ${x.bytes} bytes`];
        const exclusive = development[reciterId]?.[s] ? [false, 'development measured timing exists for this surah (the app would load it first)'] : [true, 'no other app-shipped timing'];
        const cls = kind === 'reviewed' ? 'mp3quran-cbr' : 'mp3quran-vbr';
        const dev = withWaiver(devicesGateWithClass(record, reciterId, s, x, checks, cls, members[cls]), kind === 'reviewed' ? 'reviewed-timing' : 'vbr-timing');
        const needBoth = kind === 'reviewed';
        const gates = [
          ['timing', ...timingGate(x, ayahsOf(s))],
          ['review', ...reviewGate(x, ayahsOf(s))],
          ['integrity', ...integrity],
          ['exclusive', ...exclusive],
          ['provider', ...providerGate('mp3quran')],
          ['attribution', ...attributionGate('mp3quran')],
          ['devices', needBoth ? dev.platforms.length === 2 : dev.platforms.length > 0, dev.why],
        ].map(([gate, pass, why]) => ({ gate, pass: !!pass, why }));
        const pass = gates.every((g) => g.pass);
        (report[kind][reciterId] ??= {})[s] = { gates, released: pass, ...(kind === 'vbr' ? { platforms: pass ? dev.platforms : [] } : {}) };
        if (!pass) continue;
        const entry = { fingerprint: x.fingerprint, bytes: x.bytes, reviewer1: x.reviewer1, automatic: x.automatic, deltas: x.deltas };
        (out[kind][reciterId] ??= {})[s] = kind === 'vbr' ? { ...entry, platforms: dev.platforms.map((p) => PLATFORM_METHOD[p]) } : entry;
      }
    }
  };
  catalogue('reviewed', reviewed, BASE_CHECKS);
  catalogue('vbr', vbr, [...BASE_CHECKS, 'far-seek']);

  // Development measured timing: released only on an explicit owner decision for the layer "measured-timing".
  const included = decisionList.find((d) => Array.isArray(d?.layers) && d.layers.includes('measured-timing'));
  for (const [reciterId, surahs] of Object.entries(development)) {
    for (const [sk, x] of Object.entries(surahs)) {
      const s = Number(sk);
      const aud = auditOf.get(reciterId);
      const integrity = !aud?.server ? [false, 'not a catalogue recording'] : !aud.surahs.includes(s) ? [false, 'MP3Quran does not list this surah'] : aud.timed?.[s] ? [false, 'production timing exists'] : !size(x.bytes) || aud.bytes?.[s] !== x.bytes ? [false, `size ${x.bytes} is not the audited ${aud.bytes?.[s]}`] : [true, `${aud.server}${String(s).padStart(3, '0')}.mp3 at the audited ${x.bytes} bytes`];
      const dev = withWaiver(devicesGateWithClass(record, reciterId, s, x, BASE_CHECKS, 'mp3quran-cbr', members['mp3quran-cbr']), 'measured-timing');
      const gates = [
        ['timing', ...timingGate(x, ayahsOf(s))],
        ['inclusion', !!included, included ? `owner decision ${included.id} (${included.decidedOn}) includes measured-timing; automated audit rules only, not a listening review` : 'not included: no owner decision lists "measured-timing" (its hold is the owner listening review and approval: development/supplement-measured.mjs)'],
        ['integrity', ...integrity],
        ['provider', ...providerGate('mp3quran')],
        ['attribution', ...attributionGate('mp3quran')],
        ['devices', dev.platforms.length === 2, dev.why],
      ].map(([gate, pass, why]) => ({ gate, pass: !!pass, why }));
      const pass = gates.every((g) => g.pass);
      (report.measured[reciterId] ??= {})[s] = { gates, released: pass };
      if (pass) (out.measured[reciterId] ??= {})[s] = { fingerprint: x.fingerprint, bytes: x.bytes, deltas: x.deltas };
    }
  }

  const recordingsOf = (id) => timedPreview.filter((r) => r.reciterId === id).length;
  for (const rec of timedPreview) {
    const released = {};
    const single = recordingsOf(rec.reciterId) === 1;
    for (const [sk, x] of Object.entries(rec.surahs)) {
      const s = Number(sk);
      const ayahs = ayahsOf(s);
      const dev = withWaiver(devicesGateWithClass(record, rec.reciterId, s, x, BASE_CHECKS, `host:${x.provider}`, members[`host:${x.provider}`]), 'alternative-source-recordings');
      const gates = [
        ['timing', ...timingGate(x, ayahs)],
        ['review', ...reviewGate(x, ayahs)],
        ['integrity', single && /^https:\/\//.test(x.url) && size(x.bytes), single ? `${x.url} (${x.bytes} bytes)` : `${recordingsOf(rec.reciterId)} preview recordings for ${rec.reciterId}: ambiguous`],
        ['provider', ...(() => {
          const [ok, why] = providerGate(x.provider);
          if (ok) return [ok, why];
          const st = statementFor(rec.reciterId, s, x);
          if (st) return [true, `owner permission statement ${st.id} (${st.statedBy}, ${st.statedOn}) covers this recording; documents: ${st.documentsStatus}`];
          const d = decisionFor('alternative-source-recordings');
          return d ? [true, `owner decision ${d.id} (${d.decidedOn}): proceed without verified rights documentation (not a permission)`] : [false, why];
        })()],
        ['attribution', ...attributionGate(x.provider)],
        ['devices', dev.platforms.length === 2, dev.why],
      ].map(([gate, pass, why]) => ({ gate, pass: !!pass, why }));
      const pass = gates.every((g) => g.pass);
      (report.timedPreview[rec.reciterId] ??= {})[s] = { provider: x.provider, gates, released: pass };
      if (pass) released[s] = x;
    }
    if (Object.keys(released).length) out.timedPreview.push({ ...rec, surahs: released, released: true });
  }
  return { ...out, report };
}

const lit = (v) => JSON.stringify(v).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1: ').replace(/"/g, "'").replace(/,(?=[^\s])/g, ', ');

/** The generated TypeScript (deterministic: no dates, sorted as the inputs). */
export function renderTimingRelease({ reviewed, vbr, timedPreview, measured = {} }) {
  const block = (data) => Object.entries(data).flatMap(([id, surahs]) => [`  '${id}': {`, ...Object.entries(surahs).map(([s, x]) => `    ${s}: ${lit(x)},`), '  },']);
  const empty = !Object.keys(reviewed).length && !Object.keys(vbr).length && !Object.keys(measured).length && !timedPreview.length;
  return [
    '// GENERATED by tools/quran-audio/development/generate-timing-release.mjs. Do not edit.',
    '/**',
    ' * The reviewed, VBR and timed-preview ayah timing a RELEASE build plays (audio/reciters.ts): only surahs that passed',
    ' * every gate of the generator — timing fingerprint, review, integrity, provider permission or owner decision,',
    ' * attribution, and a physical-device record for that exact timing (development/timing-device-tests.json) or the',
    " * owner's recorded acceptance of the risk of shipping without one (development/owner-release-decisions.json: a",
    ' * decision, never a test result). Development builds load the full development files instead.',
    ...(empty ? [' * Empty: nothing has passed yet.'] : []),
    ' */',
    "import type { TimedPreviewRecording } from '../timedPreview';",
    "import type { NativeMp3Seek } from '../vbrSeek';",
    '',
    'export type ReleasedTimingSurah = { fingerprint: string; bytes: number; reviewer1: number; automatic: number; deltas: readonly number[] };',
    '',
    '/** Reviewed timing of MP3Quran catalogue surahs (CBR), released on both platforms. */',
    'export const REVIEWED_RELEASE: Readonly<Record<string, Readonly<Record<number, ReleasedTimingSurah>>>> = {',
    ...block(reviewed),
    '};',
    '',
    '/** VBR catalogue surahs, each with the exact-seek methods (platforms) whose device test it passed. */',
    'export const VBR_RELEASE: Readonly<Record<string, Readonly<Record<number, ReleasedTimingSurah & { platforms: readonly NativeMp3Seek[] }>>>> = {',
    ...block(vbr),
    '};',
    '',
    '/** Development measured timing of MP3Quran catalogue surahs, released only on an owner decision for "measured-timing". */',
    'export const MEASURED_RELEASE: Readonly<Record<string, Readonly<Record<number, { fingerprint: string; bytes: number; deltas: readonly number[] }>>>> = {',
    ...block(measured),
    '};',
    '',
    '/** Timed whole-surah recordings outside the catalogue, released on both platforms (`released: true`). */',
    'export const TIMED_PREVIEW_RELEASE: readonly TimedPreviewRecording[] = [',
    ...timedPreview.map((r) => `  ${lit(r)},`),
    '];',
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const read = (f) => fs.readFileSync(f, 'utf8');
  const recordFile = path.join(here, 'timing-device-tests.json');
  const result = releaseTiming({
    reviewed: readGeneratedLiteral(read(path.join(GENERATED, 'reviewedTiming.ts')), 'REVIEWED_TIMING'),
    vbr: readGeneratedLiteral(read(path.join(GENERATED, 'vbrTiming.ts')), 'VBR_TIMING'),
    development: readGeneratedLiteral(read(path.join(GENERATED, 'developmentTiming.ts')), 'DEVELOPMENT_TIMING'),
    permissions: fs.existsSync(path.join(here, 'source-permissions.json')) ? JSON.parse(read(path.join(here, 'source-permissions.json'))) : null,
    decisions: fs.existsSync(path.join(here, 'owner-release-decisions.json')) ? JSON.parse(read(path.join(here, 'owner-release-decisions.json'))) : null,
    timedPreview: readGeneratedLiteral(read(path.join(GENERATED, 'timedPreview.ts')), 'TIMED_PREVIEW'),
    record: fs.existsSync(recordFile) ? JSON.parse(read(recordFile)) : null,
    audit: JSON.parse(read(path.join(tools, 'audit-results.json'))),
    ayahCounts: JSON.parse(read(path.join(tools, 'audit-data', 'ayah-counts.json'))),
    providers: PROVIDERS,
    credits: read(path.join(REPO, 'mobile', 'src', 'constants', 'quranSources.ts')),
  });
  fs.writeFileSync(path.join(GENERATED, 'timingRelease.ts'), renderTimingRelease(result));
  if (a.includes('--report')) fs.writeFileSync(a[a.indexOf('--report') + 1], JSON.stringify(result.report, null, 1));
  for (const kind of ['reviewed', 'vbr', 'timedPreview', 'measured']) {
    const all = Object.values(result.report[kind]).flatMap((x) => Object.values(x));
    const blockers = {};
    for (const r of all) for (const g of r.gates) if (!g.pass) blockers[g.gate] = (blockers[g.gate] ?? 0) + 1;
    console.log(`${kind}: ${all.filter((r) => r.released).length} of ${all.length} surahs released; failing gates: ${JSON.stringify(blockers)}`);
  }
}
