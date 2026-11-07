import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALIGN_ENTER_DEG,
  ALIGN_EXIT_DEG,
  FIRST_EVENT_GIVE_UP_MS,
  FIRST_EVENT_NUDGE_MS,
  HEADING_RETRY_DELAYS_MS,
  READY_DWELL_MS,
  RECENT_ERROR_MS,
  STALE_READING_MS,
  assessCompass,
  headingCondition,
  headingRetryDelayMs,
  nextAligned,
  nextReassessAtMs,
  trackBestAccuracySince,
  type CompassInput,
} from '@/qibla/compassReliability';
import type { CalibrationLevel } from '@/qibla/headingNormalize';

const NOW = 100_000;

/** Every condition for ready met; each test breaks one. */
const ready = (overrides: Partial<CompassInput> = {}): CompassInput => ({
  nowMs: NOW,
  headingSupported: true,
  permissionGranted: true,
  subscribedAtMs: NOW - 20_000,
  firstEventAtMs: NOW - 19_000,
  trueHeading: 120,
  accuracy: 3,
  accuracyTrusted: true,
  bestAccuracySinceMs: NOW - READY_DWELL_MS - 500,
  lastBestEventAtMs: NOW - 500,
  lastEventAtMs: NOW - 500,
  lastErrorAtMs: null,
  streamFailed: false,
  retryPending: false,
  bearingUncertaintyDeg: 0.05,
  orientationVerified: true,
  manualPosition: false,
  ...overrides,
});

describe('assessCompass', () => {
  it('ready only when everything holds; full needle', () => {
    expect(assessCompass(ready())).toEqual({ state: 'ready', reasons: [], needle: 'full' });
  });

  it('unavailable: no heading support, no permission, failed stream (needle hidden)', () => {
    expect(assessCompass(ready({ headingSupported: false }))).toEqual({ state: 'unavailable', reasons: ['noHeadingSupport'], needle: 'hidden' });
    expect(assessCompass(ready({ permissionGranted: false }))).toMatchObject({ state: 'unavailable', reasons: ['noPermission'] });
    expect(assessCompass(ready({ streamFailed: true }))).toMatchObject({ state: 'unavailable', reasons: ['streamFailed'] });
  });

  it('before the first event: starting, then a nudge to move (Android is silent until moved), then unavailable', () => {
    const base = { firstEventAtMs: null, trueHeading: null };
    expect(assessCompass(ready({ ...base, subscribedAtMs: null }))).toMatchObject({ state: 'calibrate', reasons: ['starting'], needle: 'hidden' });
    expect(assessCompass(ready({ ...base, subscribedAtMs: NOW - 1_000 }))).toMatchObject({ state: 'calibrate', reasons: ['starting'] });
    expect(assessCompass(ready({ ...base, subscribedAtMs: NOW - FIRST_EVENT_NUDGE_MS }))).toMatchObject({ state: 'calibrate', reasons: ['waitingForMovement'] });
    expect(assessCompass(ready({ ...base, subscribedAtMs: NOW - FIRST_EVENT_GIVE_UP_MS }))).toMatchObject({ state: 'unavailable', reasons: ['noHeadingEvents'] });
  });

  it('events without a true heading: waiting, then unavailable; never the magnetic heading', () => {
    expect(assessCompass(ready({ trueHeading: null, subscribedAtMs: NOW - 3_000, firstEventAtMs: NOW - 2_000 }))).toMatchObject({ state: 'calibrate', reasons: ['waitingForTrueHeading'], needle: 'hidden' });
    expect(assessCompass(ready({ trueHeading: null }))).toMatchObject({ state: 'unavailable', reasons: ['noTrueHeading'] });
    expect(assessCompass(ready({ trueHeading: Number.NaN }))).toMatchObject({ state: 'unavailable', reasons: ['noTrueHeading'] });
  });

  it('calibration level 0: calibrate, needle hidden', () => {
    expect(assessCompass(ready({ accuracy: 0, bestAccuracySinceMs: null }))).toEqual({ state: 'calibrate', reasons: ['uncalibrated'], needle: 'hidden' });
  });

  it('levels 1 and 2: approximate (dimmed), never ready', () => {
    for (const accuracy of [1, 2] as CalibrationLevel[]) {
      expect(assessCompass(ready({ accuracy, bestAccuracySinceMs: null }))).toEqual({ state: 'approximate', reasons: ['lowAccuracy'], needle: 'dimmed' });
    }
  });

  it('an accuracy value that cannot be believed (stock Android) caps the compass at approximate', () => {
    expect(assessCompass(ready({ accuracyTrusted: false }))).toMatchObject({ state: 'approximate', reasons: ['accuracyUntrusted'] });
  });

  it('best calibration must be RE-REPORTED across READY_DWELL_MS: an unchanged old value is not a confirmation', () => {
    // One best reading 5 s ago and nothing since: time passed, but nothing confirmed it.
    expect(assessCompass(ready({ bestAccuracySinceMs: NOW - 5_000, lastBestEventAtMs: NOW - 5_000, lastEventAtMs: NOW - 5_000 }))).toMatchObject({ state: 'approximate', reasons: ['settling'] });
    // Re-reported, but the run is still shorter than the dwell.
    expect(assessCompass(ready({ bestAccuracySinceMs: NOW - 1_000, lastBestEventAtMs: NOW, lastEventAtMs: NOW }))).toMatchObject({ state: 'approximate', reasons: ['settling'] });
    expect(assessCompass(ready({ bestAccuracySinceMs: null, lastBestEventAtMs: null }))).toMatchObject({ state: 'approximate', reasons: ['settling'] });
    // Re-reported across exactly the dwell: ready.
    expect(assessCompass(ready({ bestAccuracySinceMs: NOW - READY_DWELL_MS, lastBestEventAtMs: NOW, lastEventAtMs: NOW })).state).toBe('ready');
  });

  it('a valid heading with no event for STALE_READING_MS needs a refresh (a small movement), whatever its accuracy', () => {
    const quietBest = ready({ bestAccuracySinceMs: NOW - 20_000, lastBestEventAtMs: NOW - STALE_READING_MS, lastEventAtMs: NOW - STALE_READING_MS });
    expect(assessCompass(quietBest)).toEqual({ state: 'approximate', reasons: ['refreshNeeded'], needle: 'dimmed' });
    // Quiet is NOT a calibration verdict: with a good last reading it reads "quiet", not "poor accuracy".
    expect(headingCondition(assessCompass(quietBest))).toBe('quiet');
    expect(assessCompass(ready({ bestAccuracySinceMs: NOW - 20_000, lastBestEventAtMs: NOW - STALE_READING_MS + 1, lastEventAtMs: NOW - STALE_READING_MS + 1 })).state).toBe('ready');
    // A quiet heading whose last reading was explicitly low: both are listed; the explicit reading outranks quiet.
    const quietLow = ready({ accuracy: 2, bestAccuracySinceMs: null, lastBestEventAtMs: null, lastEventAtMs: NOW - STALE_READING_MS });
    expect(assessCompass(quietLow).reasons).toEqual(['lowAccuracy', 'refreshNeeded']);
    expect(headingCondition(assessCompass(quietLow))).toBe('poorAccuracy');
  });

  it('a restart pending after a stream error: calibrate (needle hidden), as a sensor error, not as "no heading yet"', () => {
    const waiting = assessCompass(ready({ retryPending: true, subscribedAtMs: null, firstEventAtMs: null, trueHeading: null }));
    expect(waiting).toEqual({ state: 'calibrate', reasons: ['sensorErrorRetrying'], needle: 'hidden' });
    expect(headingCondition(waiting)).toBe('sensorError');
  });

  it('a chosen city (manual position) is capped at approximate until device diagnostics verify the heading', () => {
    expect(assessCompass(ready({ manualPosition: true }))).toMatchObject({ state: 'approximate', reasons: ['manualPosition'] });
  });

  it('an uncertain position (approximate location near Makkah, a city radius, unknown accuracy) caps at approximate', () => {
    expect(assessCompass(ready({ bearingUncertaintyDeg: 3.01 }))).toMatchObject({ state: 'approximate', reasons: ['positionUncertain'] });
    expect(assessCompass(ready({ bearingUncertaintyDeg: Number.POSITIVE_INFINITY }))).toMatchObject({ state: 'approximate', reasons: ['positionUncertain'] });
    expect(assessCompass(ready({ bearingUncertaintyDeg: Number.NaN }))).toMatchObject({ state: 'approximate', reasons: ['positionUncertain'] });
    expect(assessCompass(ready({ bearingUncertaintyDeg: 3 })).state).toBe('ready');
  });

  it('an unverified orientation (e.g. iPad in landscape before its device check) caps at approximate', () => {
    expect(assessCompass(ready({ orientationVerified: false }))).toMatchObject({ state: 'approximate', reasons: ['orientationUnverified'] });
  });

  it('a recent stream error caps at approximate for RECENT_ERROR_MS', () => {
    expect(assessCompass(ready({ lastErrorAtMs: NOW - RECENT_ERROR_MS + 1 }))).toMatchObject({ state: 'approximate', reasons: ['recentError'] });
    expect(assessCompass(ready({ lastErrorAtMs: NOW - RECENT_ERROR_MS })).state).toBe('ready');
  });

  it('lists every reason, most important first', () => {
    const result = assessCompass(ready({ lastErrorAtMs: NOW, accuracyTrusted: false, accuracy: 2, bestAccuracySinceMs: null, lastBestEventAtMs: null, lastEventAtMs: NOW - STALE_READING_MS, bearingUncertaintyDeg: 10, manualPosition: true, orientationVerified: false }));
    expect(result).toEqual({ state: 'approximate', reasons: ['recentError', 'accuracyUntrusted', 'lowAccuracy', 'refreshNeeded', 'positionUncertain', 'manualPosition', 'orientationUnverified'], needle: 'dimmed' });
  });

  it('a perfectly steady heading with low calibration is never ready (steady ≠ accurate)', () => {
    // The same heading, sampled for a minute, at level 1: still approximate at every moment.
    for (let t = 0; t <= 60_000; t += 500) {
      const result = assessCompass(ready({ nowMs: NOW + t, trueHeading: 120, accuracy: 1, bestAccuracySinceMs: null, lastBestEventAtMs: null }));
      expect(result.state).toBe('approximate');
    }
  });

  it('a phone lying still (no new events for minutes) never gains confidence; a ready compass asks for a refresh', () => {
    expect(assessCompass(ready({ nowMs: NOW + 300_000, accuracy: 2, bestAccuracySinceMs: null, lastBestEventAtMs: null })).state).toBe('approximate');
    expect(assessCompass(ready({ nowMs: NOW + 300_000 }))).toMatchObject({ state: 'approximate', reasons: ['refreshNeeded'] });
  });

  it('property: with no new event (and no error), time passing alone never raises the state', () => {
    const rank = { unavailable: 0, calibrate: 1, approximate: 2, ready: 3 } as const;
    const starts: Partial<CompassInput>[] = [
      {},
      { firstEventAtMs: null, trueHeading: null, subscribedAtMs: NOW - 1_000 },
      { trueHeading: null, subscribedAtMs: NOW - 1_000, firstEventAtMs: NOW - 900 },
      { accuracy: 2, bestAccuracySinceMs: null, lastBestEventAtMs: null },
      { bestAccuracySinceMs: NOW - 500, lastBestEventAtMs: NOW - 500 },
      { accuracy: 0, bestAccuracySinceMs: null, lastBestEventAtMs: null },
      { accuracyTrusted: false },
    ];
    for (const start of starts) {
      let previous = rank[assessCompass(ready(start)).state];
      for (let later = 0; later <= 120_000; later += 250) {
        const current = rank[assessCompass(ready({ ...start, nowMs: NOW + later })).state];
        expect(current, JSON.stringify({ start, later })).toBeLessThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it('has no input describing stability, variance or quietness', () => {
    // Source scan: the input type must not grow a field that would let steadiness raise confidence.
    const source = readFileSync(resolve(__dirname, '../src/qibla/compassReliability.ts'), 'utf-8');
    const inputType = source.match(/export type CompassInput = \{([\s\S]*?)\n\};/)?.[1] ?? '';
    expect(inputType.length).toBeGreaterThan(0);
    expect(inputType).not.toMatch(/stab|varian|jitter|steady|quiet|still|spread|deviation/i);
  });
});

describe('nextReassessAtMs: the one timer that replaces polling', () => {
  it('before the first event: the nudge, then the give-up moment', () => {
    const base = { firstEventAtMs: null, trueHeading: null, subscribedAtMs: NOW - 1_000 };
    expect(nextReassessAtMs(ready(base))).toBe(NOW - 1_000 + FIRST_EVENT_NUDGE_MS);
    expect(nextReassessAtMs(ready({ ...base, nowMs: NOW + FIRST_EVENT_NUDGE_MS }))).toBe(NOW - 1_000 + FIRST_EVENT_GIVE_UP_MS);
    expect(nextReassessAtMs(ready({ ...base, nowMs: NOW + 60_000 }))).toBeNull();
  });

  it('events but no true heading: the give-up moment', () => {
    expect(nextReassessAtMs(ready({ trueHeading: null, subscribedAtMs: NOW - 1_000, firstEventAtMs: NOW - 900 }))).toBe(NOW - 1_000 + FIRST_EVENT_GIVE_UP_MS);
  });

  it('a usable heading: when the reading goes stale, or a recent error expires, whichever is first', () => {
    expect(nextReassessAtMs(ready())).toBe(NOW - 500 + STALE_READING_MS);
    expect(nextReassessAtMs(ready({ lastErrorAtMs: NOW - 1_000 }))).toBe(NOW - 1_000 + RECENT_ERROR_MS);
    // Low readings go quiet too: the refresh request applies to every valid heading.
    expect(nextReassessAtMs(ready({ accuracy: 2, bestAccuracySinceMs: null, lastBestEventAtMs: null }))).toBe(NOW - 500 + STALE_READING_MS);
  });

  it('nothing to wait for when unsupported, without permission, failed or not subscribed', () => {
    expect(nextReassessAtMs(ready({ headingSupported: false }))).toBeNull();
    expect(nextReassessAtMs(ready({ permissionGranted: false }))).toBeNull();
    expect(nextReassessAtMs(ready({ streamFailed: true }))).toBeNull();
    expect(nextReassessAtMs(ready({ subscribedAtMs: null }))).toBeNull();
    expect(nextReassessAtMs(ready({ retryPending: true }))).toBeNull(); // the retry timer itself wakes the controller
  });
});

describe('headingCondition: the four situations kept apart', () => {
  const condition = (overrides: Partial<CompassInput>) => headingCondition(assessCompass(ready(overrides)));

  it('no initial heading received', () => {
    expect(condition({ firstEventAtMs: null, trueHeading: null, subscribedAtMs: NOW - 1_000 })).toBe('noInitialHeading');
    expect(condition({ firstEventAtMs: null, trueHeading: null, subscribedAtMs: NOW - FIRST_EVENT_NUDGE_MS })).toBe('noInitialHeading');
    expect(condition({ firstEventAtMs: null, trueHeading: null, subscribedAtMs: NOW - FIRST_EVENT_GIVE_UP_MS })).toBe('noInitialHeading');
    expect(condition({ trueHeading: null, subscribedAtMs: NOW - 1_000, firstEventAtMs: NOW - 900 })).toBe('noInitialHeading');
  });

  it('a valid heading, then no recent events: quiet (ask for a small movement)', () => {
    expect(condition({ lastEventAtMs: NOW - STALE_READING_MS, lastBestEventAtMs: NOW - STALE_READING_MS })).toBe('quiet');
  });

  it('sensor errors: retrying, recently recovered, given up', () => {
    expect(condition({ retryPending: true })).toBe('sensorError');
    expect(condition({ lastErrorAtMs: NOW - 1_000 })).toBe('sensorError');
    expect(condition({ streamFailed: true })).toBe('sensorError');
  });

  it('explicitly poor accuracy readings', () => {
    expect(condition({ accuracy: 0, bestAccuracySinceMs: null, lastBestEventAtMs: null })).toBe('poorAccuracy');
    expect(condition({ accuracy: 1, bestAccuracySinceMs: null, lastBestEventAtMs: null })).toBe('poorAccuracy');
  });

  it('limited by something else, unavailable, ok', () => {
    expect(condition({ accuracyTrusted: false })).toBe('limited');
    expect(condition({ manualPosition: true })).toBe('limited');
    expect(condition({ permissionGranted: false })).toBe('unavailable');
    expect(headingCondition({ state: 'unavailable', reasons: ['noBearing'], needle: 'hidden' })).toBe('unavailable');
    expect(condition({})).toBe('ok');
  });
});

describe('trackBestAccuracySince', () => {
  it('starts a run at the first best reading, keeps it, and drops it on any lower reading', () => {
    let since = trackBestAccuracySince(null, null, 3, 1_000);
    expect(since).toBe(1_000);
    since = trackBestAccuracySince(since, 1_000, 3, 2_500);
    expect(since).toBe(1_000);
    since = trackBestAccuracySince(since, 2_500, 2, 2_600);
    expect(since).toBeNull();
    since = trackBestAccuracySince(since, null, 3, 3_000);
    expect(since).toBe(3_000);
  });

  it('a silence of STALE_READING_MS between best readings breaks the run (silence is not continuity)', () => {
    expect(trackBestAccuracySince(1_000, 2_000, 3, 2_000 + STALE_READING_MS - 1)).toBe(1_000);
    expect(trackBestAccuracySince(1_000, 2_000, 3, 2_000 + STALE_READING_MS)).toBe(2_000 + STALE_READING_MS);
  });
});

describe('"Lined up with the Qibla bearing" (hysteresis, ready only)', () => {
  it('uses ±5° to enter and ±8° to leave', () => {
    expect(ALIGN_ENTER_DEG).toBe(5);
    expect(ALIGN_EXIT_DEG).toBe(8);
    expect(nextAligned(false, 'ready', 5)).toBe(true);
    expect(nextAligned(false, 'ready', 355)).toBe(true); // −5°
    expect(nextAligned(false, 'ready', 5.01)).toBe(false);
    expect(nextAligned(true, 'ready', 8)).toBe(true);
    expect(nextAligned(true, 'ready', 352)).toBe(true); // −8°
    expect(nextAligned(true, 'ready', 8.01)).toBe(false);
  });

  it('works across north (relative angle near 0/360)', () => {
    expect(nextAligned(false, 'ready', 0)).toBe(true);
    expect(nextAligned(false, 'ready', 359.5)).toBe(true);
    expect(nextAligned(true, 'ready', 180)).toBe(false);
  });

  it('never outside ready, and leaves at once when the compass stops being ready', () => {
    for (const state of ['approximate', 'calibrate', 'unavailable'] as const) {
      expect(nextAligned(false, state, 0)).toBe(false);
      expect(nextAligned(true, state, 0)).toBe(false);
    }
    expect(nextAligned(true, 'ready', Number.NaN)).toBe(false);
  });
});

describe('heading stream retries', () => {
  it('2 s, 4 s, 8 s, 8 s, 8 s, then give up', () => {
    expect(HEADING_RETRY_DELAYS_MS).toEqual([2_000, 4_000, 8_000, 8_000, 8_000]);
    expect([1, 2, 3, 4, 5].map(headingRetryDelayMs)).toEqual([2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(headingRetryDelayMs(6)).toBeNull();
    expect(headingRetryDelayMs(0)).toBeNull();
    expect(headingRetryDelayMs(1.5)).toBeNull();
  });
});
