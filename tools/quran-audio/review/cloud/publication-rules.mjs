// Phase 4.8.3: when a reviewed recording may be published to the app, and exactly what is published. Pure functions
// (no database, no network): the publication worker (publisher.mjs) gathers the evidence and calls them; the tests call
// them directly.
//
// SUPERSEDED POLICY (owner, 2026-10-24): Reviewer 2 is no longer required for Quran Heals. These rules (and
// publisher.mjs, which publishes the two reviewers' agreed timing) still encode the former two-reviewer publication;
// the cloud service is not deployed and must not be used to publish until it is redesigned for one reviewer plus the
// automatic acceptance policy. The independent requirements below (technical, authorization, conflict) stay.
//
// A recording is published only when EVERY check passes:
//   review          both reviewers finished the whole recording (final submissions), independently (two different
//                   people / accounts), the server's blind views were in force, every boundary agreed or formally
//                   resolved, every whole-recording question answered "yes", no flag that one start per ayah cannot
//                   represent, the append-only hash chain intact; never a production boundary check (findings only),
//                   never synthetic test data;
//   technical       the canonical ayah count (Kufan, Hafs), every timestamp inside the recording, in order, with a
//                   positive length; the exact file (size and SHA-256, hashed by this server from the provider's file)
//                   still served by its provider at that size, with byte ranges (exact seeking); a CBR file (a VBR MP3
//                   never plays ayah by ayah in the app); a reciter the app knows;
//   authorization   an administrator's recorded authorization for this provider (and reciter / exact file), with its
//                   evidence and the riwayah (Hafs). A working URL is never taken as permission. A recording whose file
//                   carries a third-party rights notice (e.g. «Reserved For KFGQPC») needs an authorization for that
//                   exact file that acknowledges the notice;
//   conflict        no OTHER recording of the same reciter and surah is active (an approved recording is never replaced
//                   because the reciter and surah match: an administrator decides).
// A check that lacks its evidence (not computed yet, the provider unreachable) is 'pending', never 'pass'.
//
// Listening: Phase 4.8.4.1 removed the browser's playback gate. Nothing here treats missing playback telemetry as
// evidence of listening, and nothing claims listening: the evidence published is the reviewers' own final submissions
// and answers (their attestation), which is exactly what the review log records.
import crypto from 'node:crypto';

import { canon, RECITER } from '../dashboard/dashboard-lib.mjs';
import { timingFingerprint } from '../../fingerprint.mjs';
import { finalTiming, openingOnset, recordingStatus, requiredChecks, scopeOf, verifyChain, CHECKS } from '../manual/manual-lib.mjs';

export const ENVIRONMENTS = ['development', 'production'];
export const RIWAYAH = 'hafs';

// ---------------------------------------------------------------- Phase 4.8.5: playback compatibility, per recording
//
// A recording is published only where the app can seek it EXACTLY on every platform it is published to (both).
//   cbr-exact  a CBR file whose host answers byte ranges: the app's player seeks by constant bitrate (every recording
//              the app plays ayah by ayah today; error 0-26 ms, one MP3 frame);
//   vbr-mllt   a VBR file (LAME + Xing TOC, like the 32 known candidates) played through a native data source that puts an
//              exact MLLT seek table in front of the UNCHANGED stream (docs/audio/vbr-cross-platform-phase-4-4: Android
//              lab-verified with the real Media3 extractor, -0.5..+25.6 ms; NOT built; iOS untested). Without it a VBR
//              file seeks seconds off (Media3 XingSeeker: -8.35..+5.35 s), so it is never "compatible" by being VBR.
// Which methods the released app ships, per platform, is the service's configuration (appCapabilities); a VBR recording
// additionally needs a DEVICE measurement of that exact file (SHA-256) on each platform within SEEK_TOLERANCE_MS, recorded
// by an administrator with its evidence (registry seek_verifications). Automated playback never counts.
export const PLATFORMS = ['android', 'ios'];
export const SEEK_TOLERANCE_MS = 60;
export const DEFAULT_APP_CAPABILITIES = Object.freeze({ 'cbr-exact': ['android', 'ios'], 'vbr-mllt': [] });
export const COMPATIBILITY = {
  'cbr-compatible': 'CBR Compatible',
  'vbr-compatibility-verified': 'VBR Compatibility Verified',
  'vbr-android-verified-ios-pending': 'VBR Android Verified / iOS Pending',
  'vbr-ios-verified-android-pending': 'VBR iOS Verified / Android Pending',
  'vbr-compatibility-pending': 'VBR Compatibility Pending',
  'compatibility-pending': 'Compatibility Pending',
  unsupported: 'Unsupported Recording',
};

/**
 * The playback compatibility of one exact recording: { status, method, platforms, result: 'pass'|'pending'|'fail', detail }.
 *   mode: 'cbr' | 'vbr' | null (the file's bitrate mode); fileRead: the server has read the file's encoder frame;
 *   verifications: [{ recordingSha256, platform, method, passed, maxAbsErrorMs, samples, appBuild, at, revokedAt }].
 */
export function playbackCompatibility({ mode, rangeRequests = true, sha256 = null, fileRead = false, verifications = [], appCapabilities = DEFAULT_APP_CAPABILITIES }) {
  const shipped = (method) => PLATFORMS.filter((p) => (appCapabilities[method] ?? []).includes(p));
  if (mode === 'cbr') {
    const on = shipped('cbr-exact');
    if (!rangeRequests) return { status: 'unsupported', method: 'cbr-exact', platforms: [], result: 'fail', detail: 'its host does not answer byte ranges: no exact seeking' };
    return on.length === PLATFORMS.length
      ? { status: 'cbr-compatible', method: 'cbr-exact', platforms: on, result: 'pass', detail: 'constant bitrate with byte ranges: exact seeking on Android and iOS (one MP3 frame, ≤ 26 ms)' }
      : { status: 'compatibility-pending', method: 'cbr-exact', platforms: on, result: 'pending', detail: `the app's CBR seeking is configured for ${on.join(', ') || 'no platform'}` };
  }
  if (mode === 'vbr') {
    const on = shipped('vbr-mllt');
    const latest = (p) => verifications.filter((v) => !v.revokedAt && v.method === 'vbr-mllt' && v.platform === p && v.recordingSha256 === sha256).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null;
    const failedOn = PLATFORMS.filter((p) => latest(p) && !latest(p).passed);
    if (failedOn.length) return { status: 'unsupported', method: 'vbr-mllt', platforms: [], result: 'fail', detail: `measured on ${failedOn.map((p) => `${p} (${latest(p).maxAbsErrorMs} ms)`).join(', ')}: outside ±${SEEK_TOLERANCE_MS} ms` };
    const ok = PLATFORMS.filter((p) => on.includes(p) && latest(p)?.passed);
    const missing = [
      ...(on.length < PLATFORMS.length ? [`the app ships no exact-seek method for VBR on ${PLATFORMS.filter((p) => !on.includes(p)).join(' and ')} (Android: native MLLT data source not built; iOS: untested)`] : []),
      ...PLATFORMS.filter((p) => !latest(p)).map((p) => `no ${p} device measurement of this exact file`),
    ];
    if (ok.length === PLATFORMS.length) return { status: 'vbr-compatibility-verified', method: 'vbr-mllt', platforms: ok, result: 'pass', detail: PLATFORMS.map((p) => `${p} ${latest(p).maxAbsErrorMs} ms over ${latest(p).samples} seeks (${latest(p).appBuild})`).join('; ') };
    const status = ok.length === 1 ? (ok[0] === 'android' ? 'vbr-android-verified-ios-pending' : 'vbr-ios-verified-android-pending') : 'vbr-compatibility-pending';
    return { status, method: 'vbr-mllt', platforms: ok, result: 'pending', detail: `VBR seeks seconds off without an exact seek table; ${missing.join('; ') || 'pending'}` };
  }
  if (fileRead) return { status: 'unsupported', method: null, platforms: [], result: 'fail', detail: 'the bitrate mode of the file could not be established (no Info/Xing encoder frame)' };
  return { status: 'compatibility-pending', method: null, platforms: [], result: 'pending', detail: 'read from the file\'s encoder frame once both reviews are complete' };
}

/** The review timeline must be the original file's decoded timeline: the one the app's exact seeking reproduces. */
export const timelineCompatible = (session) => /^decoded audio \(miniaudio/.test(session.timeline ?? '');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** The exact recording: what the app must play. Null fields make the identity incomplete (the check says so). */
export function recordingIdentity(session, evidence = {}) {
  return {
    reciterId: session.reciterId ?? null,
    surah: session.surah,
    provider: session.provider ?? null,
    url: session.url ?? null,
    bytes: session.bytes ?? null,
    sha256: evidence.sha256 ?? session.sha256 ?? null,
    durationMs: session.durationMs ?? null,
    format: { mode: session.format?.mode ?? null, kbps: session.format?.kbps ?? null },
  };
}
/** One id per exact recording: reciter, surah, provider, URL, size and SHA-256 (never reciter + surah alone). */
export const recordingIdOf = (id) => `rec_${sha(['recording-v1', id.reciterId, id.surah, id.provider, id.url, id.bytes, id.sha256].join('|')).slice(0, 24)}`;

/** The two-reviewer verified timing as entries (canonical verse ids), or null. */
export function verifiedEntries(session, state) {
  const pairs = finalTiming(session, state);
  if (!pairs) return null;
  return pairs.map(([startMs, endMs], i) => ({ ayah: i + 1, verse: `${session.surah}:${i + 1}`, startMs, endMs }));
}

/** Problems with timing entries for a recording (empty: valid). The same rules the app applies (audio/timing.ts). */
export function timingProblems(entries, { surah, durationMs, ayahCount }) {
  const p = [];
  if (!Array.isArray(entries)) return ['no timing'];
  if (entries.length !== ayahCount) p.push(`${entries.length} ayahs; the canonical count for surah ${surah} is ${ayahCount}`);
  let prevEnd = 0;
  entries.forEach((e, i) => {
    if (e.ayah !== i + 1 || e.verse !== `${surah}:${i + 1}`) p.push(`entry ${i + 1} is ${e.verse ?? e.ayah}, not ${surah}:${i + 1}`);
    if (!Number.isInteger(e.startMs) || !Number.isInteger(e.endMs)) p.push(`${surah}:${i + 1}: times must be whole milliseconds`);
    if (!(e.startMs >= 0)) p.push(`${surah}:${i + 1} starts before the recording`);
    if (!(e.endMs > e.startMs)) p.push(`${surah}:${i + 1} has no positive length`);
    if (e.startMs < prevEnd) p.push(`${surah}:${i + 1} overlaps the previous ayah`);
    if (!(e.endMs <= durationMs)) p.push(`${surah}:${i + 1} ends at ${e.endMs} ms, after the recording (${durationMs} ms)`);
    prevEnd = e.endMs;
  });
  return p;
}

/**
 * The immutable published document of one timing version (what the app downloads). Its id is derived from the
 * recording and the timing only, so the same verified timing processed twice is the same version (idempotent); the
 * review evidence is kept beside it in the registry, never inside (a later comment does not make a new version).
 */
export function timingContent(identity, entries, playback = { method: 'cbr-exact', platforms: ['android', 'ios'] }, { introEndMs } = {}) {
  const recordingId = recordingIdOf(identity);
  // Phase 4.8.8: entries[0].startMs is 0 (opening rule: playback); introEndMs is where ayah 1's words begin (highlighting).
  const intro = Number.isInteger(introEndMs) && introEndMs >= entries[0].startMs && introEndMs < entries[0].endMs ? introEndMs : entries[0].startMs;
  const timing = { introEndMs: intro, entries: entries.map((e) => ({ ayah: e.ayah, verse: e.verse, startMs: e.startMs, endMs: e.endMs })) };
  const fingerprint = timingFingerprint(timing.entries);
  // Phase 4.8.5: how the app must seek this file, and on which platforms that was verified; an app lacking the method
  // (or on another platform) does not offer the recording at all.
  const body = { kind: 'quran-heals-verified-timing', format: 1, recordingId, recording: identity, playback: { method: playback.method, platforms: [...playback.platforms] }, timing: { ...timing, fingerprint }, source: 'two-reviewer human verification (audio review dashboard)' };
  const contentSha256 = sha(JSON.stringify(body));
  return { versionId: `tv_${contentSha256.slice(0, 24)}`, recordingId, contentSha256, fingerprint, body };
}

/** The authorization (if any) that covers this recording: provider, then reciter, then exact file; never revoked. */
export function authorizationFor(identity, authorizations = []) {
  const live = authorizations.filter((a) => !a.revokedAt && a.provider === identity.provider && (!a.reciterId || a.reciterId === identity.reciterId) && (!a.recordingSha256 || a.recordingSha256 === identity.sha256));
  // The most specific first: an exact-file authorization, then a reciter's, then the provider's.
  return live.sort((a, b) => (b.recordingSha256 ? 2 : b.reciterId ? 1 : 0) - (a.recordingSha256 ? 2 : a.reciterId ? 1 : 0))[0] ?? null;
}

/**
 * Evaluates one recording for publication.
 *   evidence: { waveform: { bytes, sha256 } | null, source: { ok, bytes, rangeRequests, problem, network, at } | null }
 *   authorizations: the administrator's records; activeOthers: other recordings of this reciter and surah that are
 *   active in an environment ([{ recordingId, environment }]); accounts: { 1: accountId|null, 2: accountId|null }.
 * Returns { stage, eligible, checks: [{ id, group, label, result: 'pass'|'fail'|'pending', detail }], blockers,
 * identity, entries, content }.
 */
export function evaluatePublication({ session, state, events = [], evidence = {}, authorizations = [], activeOthers = [], accounts = null, allowSynthetic = false, seekVerifications = [], appCapabilities = DEFAULT_APP_CAPABILITIES }) {
  const checks = [];
  const add = (group, id, label, result, detail) => checks.push({ group, id, label, result, detail });
  const r1 = state.reviewers[1];
  const r2 = state.reviewers[2];
  const st = recordingStatus(session, state);
  const both = !!(r1?.submittedAt && r2?.submittedAt);

  // ---- review
  add('review', 'reviewer-1-complete', 'Reviewer 1 finished the whole recording', r1?.submittedAt ? 'pass' : 'pending', r1 ? (r1.submittedAt ? `${r1.name}, ${r1.submittedAt}` : `${r1.name}: ${Object.keys(r1.submitted ?? {}).length} start(s) submitted, final submission pending`) : 'no Reviewer 1 yet');
  add('review', 'reviewer-2-complete', 'Reviewer 2 finished the whole recording independently', r2?.submittedAt ? 'pass' : 'pending', r2 ? (r2.submittedAt ? `${r2.name}, ${r2.submittedAt}` : `${r2.name}: ${Object.keys(r2.submitted ?? {}).length} start(s) submitted, final submission pending`) : 'no Reviewer 2 yet');
  const sameAccount = accounts && accounts[1] && accounts[2] && accounts[1] === accounts[2];
  add('review', 'independent-reviewers', 'Two different people reviewed it', !r1 || !r2 ? 'pending' : r1.name.trim().toLowerCase() === r2.name.trim().toLowerCase() || sameAccount ? 'fail' : 'pass',
    !r1 || !r2 ? 'two reviewers needed' : sameAccount ? 'both reviews were made from the same account' : `${r1.name} and ${r2.name}${accounts?.[1] && accounts?.[2] ? ' (separate signed-in accounts)' : ''}`);
  add('review', 'blind-review', 'The second review was blind to the first', !both ? 'pending' : 'pass', 'enforced by the server: each reviewer\'s times are withheld until both have submitted that start; a change made after the reveal never counts as agreement (it needs a formal resolution)');
  const verified = both && st.verified === true;
  add('review', 'agreement', 'Every boundary agreed or formally resolved; no dispute', !both ? 'pending' : verified ? 'pass' : 'fail', !both ? 'compared once both reviews are complete' : verified ? `${st.comparison.filter((c) => c.outcome === 'agreed').length} agreed, ${st.comparison.filter((c) => c.outcome === 'resolved').length} resolved` : `${st.status}: ${(st.reasons ?? []).slice(0, 4).join('; ')}`);
  const unanswered = both ? [r1, r2].flatMap((r) => requiredChecks(session).filter((k) => r.work.checks[k] !== 'yes').map((k) => `Reviewer ${r.role}: ${CHECKS[k]} (${r.work.checks[k] ?? 'unanswered'})`)) : [];
  add('review', 'human-questions', 'Both reviewers answered every whole-recording question "yes"', !both ? 'pending' : unanswered.length ? 'fail' : 'pass', unanswered.length ? unanswered.slice(0, 4).join('; ') : !both ? 'answered with the final submissions' : `${requiredChecks(session).length} questions × 2 reviewers`);
  const broken = events.length ? verifyChain(events) : -2;
  add('review', 'audit-chain', 'The append-only review history is intact', broken === -1 ? 'pass' : broken === -2 ? 'pending' : 'fail', broken === -1 ? `${events.length} events, every hash verified` : broken === -2 ? 'no review history' : `the hash chain breaks at event ${broken + 1}`);
  add('review', 'whole-recording', 'A whole-recording review (not a boundary check)', scopeOf(session) ? 'fail' : 'pass', scopeOf(session) ? 'a production boundary check yields findings for the owner, never published timing' : 'every ayah start and the recitation end');
  add('review', 'not-synthetic', 'Real review data (never synthetic test data)', session.synthetic && !allowSynthetic ? 'fail' : 'pass', session.synthetic ? (allowSynthetic ? 'synthetic: allowed only in a test registry' : 'synthetic test data is never published') : 'real recording');

  // ---- technical
  const ayahCount = canon().meta.get(session.surah)?.ayahs ?? null;
  const entries = verified ? verifiedEntries(session, state) : null;
  add('technical', 'canonical-count', 'The canonical ayah count (Kufan, as the app uses)', ayahCount == null ? 'fail' : session.ayahCount !== ayahCount ? 'fail' : 'pass', ayahCount == null ? `no surah ${session.surah}` : `${session.ayahCount} ayahs; canonical ${ayahCount}`);
  const tp = entries ? timingProblems(entries, { surah: session.surah, durationMs: session.durationMs, ayahCount }) : null;
  add('technical', 'timing-valid', 'Every ayah inside the recording, in order, no overlap', !entries ? 'pending' : tp.length ? 'fail' : 'pass', !entries ? 'available once the review is verified' : tp.length ? tp.slice(0, 4).join('; ') : `${entries.length} ayahs, 0-${entries.at(-1).endMs} ms of ${session.durationMs} ms`);
  const w = evidence.waveform;
  const idFail = w && (w.bytes !== session.bytes || (session.sha256 && w.sha256 !== session.sha256));
  add('technical', 'identity-hash', 'The exact reviewed file (size and SHA-256, hashed by this server)', !w ? 'pending' : idFail ? 'fail' : !w.sha256 ? 'pending' : 'pass', !w ? 'not hashed yet: the server reads the file from its provider' : idFail ? `the provider's file (${w.bytes} bytes, ${String(w.sha256).slice(0, 12)}…) is not the reviewed recording (${session.bytes} bytes${session.sha256 ? `, ${session.sha256.slice(0, 12)}…` : ''})` : `${w.bytes} bytes, SHA-256 ${String(w.sha256).slice(0, 16)}…`);
  const s = evidence.source;
  add('technical', 'source-live', 'Its provider still serves exactly that file, with byte ranges', !s ? 'pending' : s.ok && s.rangeRequests ? 'pass' : s.ok ? 'fail' : s.network ? 'pending' : 'fail', !s ? 'checked at the provider before publication' : s.ok && s.rangeRequests ? `${session.bytes} bytes, byte ranges answered (${s.at})` : s.ok ? 'the provider does not answer byte-range requests: the app could not seek ayah by ayah' : `${s.problem}${s.network ? ' (retried)' : ''}`);
  // Phase 4.8.5: per recording and platform (replaces the blanket "CBR only"); unknown stays pending until the file is read.
  const compat = playbackCompatibility({ mode: session.format?.mode ?? null, rangeRequests: s?.ok ? s.rangeRequests !== false : true, sha256: w?.sha256 ?? session.sha256 ?? null, fileRead: !!w?.format, verifications: seekVerifications, appCapabilities });
  add('technical', 'playback-compatibility', 'Exact ayah seeking of this exact file on Android and iOS', compat.result, `${COMPATIBILITY[compat.status]}: ${compat.detail}`);
  add('technical', 'timing-coordinates', 'The timestamps are on the original file\'s decoded timeline (what the app\'s exact seeking reproduces)', timelineCompatible(session) ? 'pass' : 'fail',
    timelineCompatible(session) ? session.timeline : `the review timeline is ${session.timeline ? `"${session.timeline}"` : 'not recorded'}: not the original file's decoded timeline`);
  add('technical', 'reciter-known', 'A reciter of the app', RECITER.has(session.reciterId) ? 'pass' : 'fail', RECITER.get(session.reciterId)?.nameEn ?? `unknown reciter ${session.reciterId}`);
  const urlOk = /^https:\/\//.test(session.url ?? '') && !!session.provider;
  add('technical', 'source-url', 'An https source of a known provider', urlOk ? 'pass' : 'fail', urlOk ? `${session.provider}: ${session.url}` : `no https provider source (${session.url ?? 'none'})`);

  // ---- authorization (never inferred from a working URL)
  const identity = recordingIdentity(session, { sha256: w?.sha256 ?? null });
  const auth = authorizationFor(identity, authorizations);
  add('authorization', 'source-authorized', 'An administrator authorized this source for the app', auth ? 'pass' : 'fail', auth ? `${auth.id}: ${auth.provider}${auth.reciterId ? ` · ${auth.reciterId}` : ''}${auth.recordingSha256 ? ` · file ${auth.recordingSha256.slice(0, 12)}…` : ''} (${auth.decidedBy}, ${auth.decidedAt}): ${auth.evidence}` : `no authorization recorded for ${identity.provider ?? 'this provider'}${session.rights?.reason ? ` (${session.rights.reason})` : ''}`);
  add('authorization', 'riwayah', 'Hafs ʿan ʿĀṣim, as recorded in the authorization', !auth ? 'fail' : auth.riwayah === RIWAYAH ? 'pass' : 'fail', !auth ? 'recorded with the source authorization' : `authorization says ${auth.riwayah ?? 'nothing'}`);
  const notice = session.rights?.id3Copyright ?? null;
  const noticeOk = !notice || (auth?.recordingSha256 && auth.recordingSha256 === identity.sha256 && auth.acknowledgesNotice === true);
  add('authorization', 'rights-notice', 'Any rights notice in the file is cleared for this exact file', noticeOk ? 'pass' : 'fail', !notice ? 'no rights notice recorded' : noticeOk ? `«${notice}» acknowledged by ${auth.id}` : `the file carries «${notice}»: only an authorization of this exact file that acknowledges it clears it`);

  // ---- conflict
  add('conflict', 'no-other-recording', 'No other recording of this reciter and surah is active', activeOthers.length ? 'fail' : 'pass', activeOthers.length ? `${activeOthers.map((o) => `${o.recordingId} in ${o.environment}`).join(', ')}: an administrator chooses which recording the app plays` : 'none');

  const failed = checks.filter((c) => c.result === 'fail');
  const pending = checks.filter((c) => c.result === 'pending');
  const reviewPending = pending.some((c) => c.group === 'review');
  let stage;
  if (!r1 || (!r1.submittedAt && !r2?.submittedAt)) stage = 'human-review-pending';
  else if (!both) stage = r1.submittedAt ? 'reviewer-1-complete' : 'reviewer-2-complete';
  // A dispute is shown as such; an unanswered question, a flag or a refused check blocks.
  else if (!verified) stage = st.status === 'disputed' ? 'disputed' : 'publication-blocked';
  else if (failed.length) stage = 'publication-blocked';
  else if (pending.length) stage = reviewPending ? 'human-review-pending' : 'technical-validation-pending';
  else stage = 'ready-for-publication';
  const eligible = stage === 'ready-for-publication';
  const content = eligible ? timingContent(identity, entries, { method: compat.method, platforms: compat.platforms }, { introEndMs: openingOnset(session, state)?.ms }) : null;
  return { stage, eligible, checks, blockers: failed.map((c) => `${c.label}: ${c.detail}`), outstanding: pending.map((c) => `${c.label}: ${c.detail}`), identity, entries, content, reviewStatus: st.status, compatibility: compat };
}

/** Whether a blocker is definitive (the published version must be withdrawn) rather than temporary (wait, retry). */
export const definitiveFailure = (evaluation) => evaluation.checks.some((c) => c.result === 'fail' && c.id !== 'no-other-recording');
