import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// Phase 4.1 tooling (tools/quran-audio): the Husary long-pause rule and the listening-review approval gate.
const tools = resolve(__dirname, '../../tools/quran-audio');
const work = mkdtempSync(join(tmpdir(), 'qh-review-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

type Ayah = { ayah: number; start_ms: number; end_ms: number; voiced_start_ms: number; voiced_end_ms: number; chunks: number[][]; quiet: number[][] };
/** A measured surah (audit/align_everyayah.py shape): three ayahs, every chunk found, the given pauses between them. */
function measured(pauses: number[]) {
  const ayahs: Ayah[] = [];
  let t = 1000;
  for (let a = 1; a <= 3; a++) {
    if (a > 1) t += pauses[a - 2];
    ayahs.push({ ayah: a, start_ms: t - 100, end_ms: t + 3100, voiced_start_ms: t, voiced_end_ms: t + 3000, chunks: [[0, t, 0.95]], quiet: [] });
    t += 3000;
  }
  return { surah: 103, duration_ms: t + 2000, ayahs };
}
const voicing = (voiced: number[]) => ({ gaps: voiced.map((v, k) => ({ ayah: k + 2, kind: 'gap', voicedMs: v })) });

describe('measured timing: long pauses (development/supplement-measured.mjs LONG_PAUSE)', async () => {
  const { acceptMeasured, LONG_PAUSE, MEASURE } = await import(pathToFileURL(join(tools, 'development/supplement-measured.mjs')).href);

  it('keeps the audited 4 s rule for every reciter and limits the exception to Husary', () => {
    expect(MEASURE.maxPauseMs).toBe(4000);
    expect(LONG_PAUSE).toEqual({ reciters: ['husary'], maxPauseMs: 10000, maxVoicedMs: 1000 });
  });

  it('accepts a long Husary pause only with evidence that it holds no recitation', () => {
    expect(acceptMeasured(measured([2000, 6500]), 3).ok).toBe(false); // no evidence, no reciter
    expect(acceptMeasured(measured([2000, 6500]), 3, { reciterId: 'husary' }).reasons[0]).toMatch(/no gap voicing measured/);
    const ok = acceptMeasured(measured([2000, 6500]), 3, { reciterId: 'husary', gapVoicing: voicing([300, 400]) });
    expect(ok.ok).toBe(true);
    expect(ok.longPauses).toEqual(['103:3: 6500 ms pause, 400 ms voiced']);
  });

  it('rejects the pause when it holds recitation, is over 10 s, or the reciter is not Husary', () => {
    expect(acceptMeasured(measured([2000, 6500]), 3, { reciterId: 'husary', gapVoicing: voicing([300, 1440]) }).reasons[0]).toMatch(/1440 ms voiced inside/);
    expect(acceptMeasured(measured([2000, 10500]), 3, { reciterId: 'husary', gapVoicing: voicing([300, 200]) }).ok).toBe(false);
    expect(acceptMeasured(measured([2000, 6500]), 3, { reciterId: 'shuraim', gapVoicing: voicing([300, 200]) }).ok).toBe(false);
    // Under 4 s nothing changes, with or without evidence.
    expect(acceptMeasured(measured([2000, 3900]), 3).ok).toBe(true);
  });
});

describe('listening review: development/apply-review.mjs refuses anything short of a whole-surah approval', () => {
  const dev = JSON.parse(readFileSync(join(tools, 'development/development-timing.json'), 'utf8'));
  const audit = JSON.parse(readFileSync(join(tools, 'audit-results.json'), 'utf8')).reciters.find((r: { id: string }) => r.id === 'shatri');
  const timing: [number, number][] = dev.reciters.shatri.surahs['103'];
  const fingerprint: string = dev.reciters.shatri.evidence['103'].fingerprint;
  const url = `${audit.server}103.mp3`;
  const pkg = {
    kind: 'ayah-timing-review-package', version: 1, source: 'development', reciterId: 'shatri', surah: 103, url, bytes: audit.bytes[103],
    candidateFingerprint: fingerprint, worklist: [2, 3],
    ayahs: timing.map(([startMs, endMs], k) => ({ ayah: k + 1, startMs, endMs, text: '' })),
    boundaries: timing.slice(1).map(([ms], k) => ({ ayah: k + 2, ms, flags: [], priority: 3 })),
  };
  const review = (patch: Record<string, unknown> = {}, verdicts: (string | null)[] = ['correct', 'correct'], moveMs = 0) => ({
    kind: 'ayah-timing-review', version: 2, source: 'development', reciterId: 'shatri', surah: 103, url, bytes: audit.bytes[103],
    candidateFingerprint: fingerprint, reviewer: 'Test', reviewedOn: '2026-10-18', approved: true, approvedBy: 'Test', approvedOn: '2026-10-18', notes: '',
    decisions: [2, 3].map((a, k) => ({ ayah: a, original: timing[a - 1][0], final: timing[a - 1][0] + (k === 0 ? moveMs : 0), verdict: verdicts[k] })),
    ...patch,
  });
  let n = 0;
  function apply(r: object) {
    const p = join(work, `pkg-${++n}.json`);
    const rv = join(work, `review-${n}.json`);
    const out = join(work, `dev-${n}.json`);
    writeFileSync(p, JSON.stringify(pkg));
    writeFileSync(rv, JSON.stringify(r));
    writeFileSync(out, JSON.stringify(dev));
    try {
      execFileSync('node', [join(tools, 'development/apply-review.mjs'), p, rv], { env: { ...process.env, QH_DEVELOPMENT_TIMING: out }, stdio: 'pipe' });
      return { ok: true as const, dev: JSON.parse(readFileSync(out, 'utf8')) };
    } catch (error) {
      // Node prints the throwing source line first; the message follows "Error: ".
      return { ok: false as const, why: String((error as { stderr?: Buffer }).stderr).match(/Error: (refused: [^\r\n]*)/)?.[1] };
    }
  }

  it('records an approved review as listening evidence, and a moved boundary as new timing', () => {
    const same = apply(review());
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.dev.reciters.shatri.surahs['103']).toEqual(timing);
      expect(same.dev.reciters.shatri.evidence['103'].listening).toMatch(/^Test, 2026-10-18 .*2 boundaries heard, all correct, 0 moved/);
    }
    const moved = apply(review({}, ['correct', 'correct'], 120));
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.dev.reciters.shatri.surahs['103'][1][0]).toBe(timing[1][0] + 120);
      expect(moved.dev.reciters.shatri.surahs['103'][0][1]).toBe(timing[1][0] + 120);
      expect(moved.dev.reciters.shatri.evidence['103'].correctedFrom).toBe(fingerprint);
    }
  });

  it('refuses an approved review of a recording the app cannot play accurately yet (Phase 4.3 playbackBlocked)', () => {
    const blocked = { ...pkg, playbackBlocked: ['the app streams the original VBR file; a seekable copy must be hosted'] };
    const p = join(work, 'pkg-playback.json');
    const rv = join(work, 'review-playback.json');
    const out = join(work, 'dev-playback.json');
    writeFileSync(p, JSON.stringify(blocked));
    writeFileSync(rv, JSON.stringify(review()));
    writeFileSync(out, JSON.stringify(dev));
    let message = '';
    try {
      execFileSync('node', [join(tools, 'development/apply-review.mjs'), p, rv], { env: { ...process.env, QH_DEVELOPMENT_TIMING: out }, stdio: 'pipe' });
    } catch (error) {
      message = String((error as { stderr?: Buffer }).stderr);
    }
    expect(message).toMatch(/refused: not playable in the app yet/);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(dev); // nothing written
  });

  it.each([
    ['not approved as a whole', review({ approved: false }), /not approved/],
    ['a boundary needing correction', review({}, ['correct', 'needs-correction']), /not marked correct: 103:3 \(needs-correction\)/],
    ['an unresolved boundary', review({}, ['unresolved', 'correct']), /103:2 \(unresolved\)/],
    ['an undecided worklist boundary', review({}, ['correct', null]), /103:3 not reviewed/],
    ['another timing', review({ candidateFingerprint: '00000000' }), /fingerprint/],
    ['no reviewer', review({ reviewer: '' }), /no reviewer/],
  ])('refuses %s', (_label, r, why) => {
    const result = apply(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toMatch(why);
  });
});
