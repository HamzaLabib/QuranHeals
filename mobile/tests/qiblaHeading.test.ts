import { describe, expect, it } from 'vitest';

import { interpretHeading, newHeadingTracker, toCalibrationLevel, type RawHeadingEvent } from '@/qibla/headingNormalize';

const event = (trueHeading: number, accuracy = 3, magHeading = 0): RawHeadingEvent => ({ trueHeading, magHeading, accuracy });

describe('iOS true heading (CLHeading.trueHeading)', () => {
  it('0–359.9 is a true heading; negative means none', () => {
    const tracker = newHeadingTracker();
    expect(interpretHeading('ios', event(0), tracker).trueHeading).toBe(0);
    expect(interpretHeading('ios', event(136.5), tracker).trueHeading).toBe(136.5);
    expect(interpretHeading('ios', event(359.9), tracker).trueHeading).toBeCloseTo(359.9, 9);
    expect(interpretHeading('ios', event(-1), tracker).trueHeading).toBeNull();
    expect(interpretHeading('ios', event(-0.5), tracker).trueHeading).toBeNull();
  });

  it('never substitutes the magnetic heading', () => {
    expect(interpretHeading('ios', event(-1, 3, 120), newHeadingTracker()).trueHeading).toBeNull();
  });
});

describe('Android true heading ((magnetic + declination) % 360, or -1 before the GeomagneticField)', () => {
  it('-1 before any other value means "no true north yet"', () => {
    const tracker = newHeadingTracker();
    expect(interpretHeading('android', event(-1, 3, 210), tracker).trueHeading).toBeNull();
    expect(interpretHeading('android', event(-1), tracker).trueHeading).toBeNull();
    expect(tracker.sawValidTrueHeading).toBe(false);
  });

  it('after the first real value, a negative value is a real heading (Kotlin % keeps the sign)', () => {
    const tracker = newHeadingTracker();
    expect(interpretHeading('android', event(12), tracker).trueHeading).toBe(12);
    // magnetic 1°, declination −5°: native sends −4, which is 356°.
    expect(interpretHeading('android', event(-4), tracker).trueHeading).toBe(356);
    // magnetic 4°, declination −5°: exactly −1 is now the real 359°, not "unavailable".
    expect(interpretHeading('android', event(-1), tracker).trueHeading).toBe(359);
    expect(interpretHeading('android', event(-359.5), tracker).trueHeading).toBe(0.5);
  });

  it('a negative first value other than -1 is already real', () => {
    const tracker = newHeadingTracker();
    expect(interpretHeading('android', event(-4), tracker).trueHeading).toBe(356);
    expect(tracker.sawValidTrueHeading).toBe(true);
  });

  it('each subscription starts over', () => {
    const first = newHeadingTracker();
    interpretHeading('android', event(50), first);
    const second = newHeadingTracker();
    expect(interpretHeading('android', event(-1), second).trueHeading).toBeNull();
  });

  it('malformed values never count and never unlock the -1 rule', () => {
    const tracker = newHeadingTracker();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 360, 1000, -360, -1000]) {
      expect(interpretHeading('android', event(bad), tracker).trueHeading).toBeNull();
    }
    expect(tracker.sawValidTrueHeading).toBe(false);
    expect(interpretHeading('android', event(-1), tracker).trueHeading).toBeNull();
    expect(interpretHeading('android', null as unknown as RawHeadingEvent, tracker)).toEqual({ trueHeading: null, accuracy: 0 });
  });
});

describe('calibration level', () => {
  it('clamps to 0–3; anything malformed is 0 (unreliable)', () => {
    expect([0, 1, 2, 3].map(toCalibrationLevel)).toEqual([0, 1, 2, 3]);
    expect(toCalibrationLevel(-1)).toBe(0);
    expect(toCalibrationLevel(7)).toBe(3);
    expect(toCalibrationLevel(2.4)).toBe(2);
    expect(toCalibrationLevel(Number.NaN)).toBe(0);
    expect(toCalibrationLevel(undefined)).toBe(0);
    expect(toCalibrationLevel('3')).toBe(0);
  });

  it('is reported alongside the heading, even when the heading is unusable', () => {
    expect(interpretHeading('ios', event(-1, 2), newHeadingTracker())).toEqual({ trueHeading: null, accuracy: 2 });
  });
});
