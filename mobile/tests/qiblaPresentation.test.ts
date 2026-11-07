import { describe, expect, it } from 'vitest';

import type { CompassAssessment, CompassReason } from '@/qibla/compassReliability';
import type { QiblaSnapshot } from '@/qibla/qiblaCompassController';
import { MESSAGES } from '@/localization/messages';
import { presentQibla } from '@/qibla/qiblaPresentation';

const en = MESSAGES.en.qibla;
const ar = MESSAGES.ar.qibla;

const compass = (state: CompassAssessment['state'], reasons: CompassReason[] = []): CompassAssessment => ({
  state,
  reasons,
  needle: state === 'ready' ? 'full' : state === 'approximate' ? 'dimmed' : 'hidden',
});

const snap = (overrides: Partial<QiblaSnapshot> = {}): QiblaSnapshot => ({
  active: true,
  permission: 'granted',
  location: 'located',
  positionSource: 'device',
  manualLabel: null,
  qibla: { kind: 'bearing', bearing: 136.137 },
  bearingUncertaintyDeg: 0.01,
  compass: compass('ready'),
  heading: 120,
  relativeAngle: 16.137,
  turn: { direction: 'right', degrees: 16 },
  aligned: false,
  headingRetry: null,
  ...overrides,
});

describe('presentQibla: the compass', () => {
  it('ready: full needle, exact turn hint, no "approximate", the bearing from true north', () => {
    const view = presentQibla(snap(), en);
    expect(view).toMatchObject({ showDial: true, needle: 'full', approximate: false, aligned: false, turnText: 'Turn 16° right', bearingText: '136° from true north', status: null, positionLine: 'Using your current location' });
    expect(view.actions).toEqual(['chooseCity']);
    expect(presentQibla(snap({ turn: { direction: 'left', degrees: 3 } }), ar).turnText).toBe('استدر 3° إلى اليسار');
  });

  it('ready and lined up: the approved wording, in the ok tone', () => {
    const view = presentQibla(snap({ aligned: true, turn: { direction: 'ahead', degrees: 0 }, relativeAngle: 0.1 }), en);
    expect(view).toMatchObject({ aligned: true, status: { text: 'Lined up with the Qibla bearing', tone: 'ok' }, turnText: 'Straight ahead' });
    expect(presentQibla(snap({ aligned: true }), ar).status?.text).toBe('متّجه نحو القبلة');
  });

  it('"lined up" is NEVER shown outside the ready state, even if the snapshot says aligned', () => {
    for (const state of ['approximate', 'calibrate', 'unavailable'] as const) {
      const view = presentQibla(snap({ compass: compass(state, state === 'approximate' ? ['accuracyUntrusted'] : ['starting']), aligned: true }), en);
      expect(view.aligned, state).toBe(false);
      expect(view.status?.text, state).not.toBe(en.aligned);
    }
  });

  it('approximate: dimmed needle, "About …" hint, the Approximate label, and why', () => {
    const view = presentQibla(snap({ compass: compass('approximate', ['accuracyUntrusted']) }), en);
    expect(view).toMatchObject({ needle: 'dimmed', approximate: true, turnText: 'About 16° to the right', status: { text: en.statusUntrusted, tone: 'info' } });
    expect(view.accessibilitySummary).toContain('Approximate');
    expect(presentQibla(snap({ compass: compass('approximate', ['accuracyUntrusted']), turn: { direction: 'ahead', degrees: 0 } }), en).turnText).toBe('About straight ahead');
  });

  it('silence after a valid heading asks for a small movement — it does not say the sensor is bad', () => {
    const view = presentQibla(snap({ compass: compass('approximate', ['accuracyUntrusted', 'refreshNeeded']) }), en);
    expect(view.status).toEqual({ text: en.statusRefreshNeeded, tone: 'info' });
    expect(view.status?.text).not.toMatch(/accuracy|calibrat/i);
  });

  it('explicitly poor accuracy asks for calibration (figure-8); it outranks silence', () => {
    expect(presentQibla(snap({ compass: compass('approximate', ['lowAccuracy', 'refreshNeeded']) }), en).status).toEqual({ text: en.statusCalibrate, tone: 'warning' });
    const level0 = presentQibla(snap({ compass: compass('calibrate', ['uncalibrated']), turn: null, heading: null }), en);
    expect(level0).toMatchObject({ needle: 'hidden', turnText: null, status: { text: en.statusCalibrate } });
  });

  it('each other reason has its own line', () => {
    const cases: [CompassAssessment, string][] = [
      [compass('approximate', ['positionUncertain']), en.statusPositionUncertain],
      [compass('approximate', ['settling']), en.statusSettling],
      [compass('approximate', ['manualPosition']), en.statusManualPosition],
      [compass('approximate', ['orientationUnverified']), en.statusOrientation],
      [compass('approximate', ['recentError']), en.statusRecentError],
      [compass('calibrate', ['starting']), en.statusStarting],
      [compass('calibrate', ['waitingForTrueHeading']), en.statusStarting],
      [compass('calibrate', ['waitingForMovement']), en.statusWaitingForMovement],
      [compass('calibrate', ['sensorErrorRetrying']), en.statusSensorRetrying],
      [compass('unavailable', ['noHeadingEvents']), en.statusNoReading],
      [compass('unavailable', ['noTrueHeading']), en.statusNoReading],
      [compass('unavailable', ['streamFailed']), en.statusStreamFailed],
      [compass('unavailable', ['noHeadingSupport']), en.statusNoHeadingSupport],
    ];
    for (const [assessment, text] of cases) {
      expect(presentQibla(snap({ compass: assessment, turn: assessment.needle === 'hidden' ? null : { direction: 'right', degrees: 16 } }), en).status?.text, assessment.reasons.join()).toBe(text);
    }
  });

  it('a failed or silent compass offers Try again; the needle stays hidden and the bearing stays shown', () => {
    for (const reason of ['streamFailed', 'noHeadingEvents', 'noTrueHeading'] as const) {
      const view = presentQibla(snap({ compass: compass('unavailable', [reason]), turn: null, heading: null }), en);
      expect(view.actions[0]).toBe('tryAgain');
      expect(view).toMatchObject({ needle: 'hidden', bearingText: '136° from true north', showDial: true });
      expect(view.accessibilitySummary).toBe('Qibla compass. The Qibla bearing is 136 degrees from true north.');
    }
  });
});

describe('presentQibla: permission and location', () => {
  const noPosition = { qibla: null, positionSource: null, compass: compass('unavailable', ['noBearing']), turn: null, heading: null } as const;

  it('never asked: the explanation card with Allow location (shown only from a tap) and Choose a city', () => {
    const view = presentQibla(snap({ ...noPosition, permission: 'needsRequest' }), en);
    expect(view).toMatchObject({ notice: { title: en.permissionTitle, body: en.permissionBody }, actions: ['allowLocation', 'chooseCity'], showDial: false, bearingText: null });
  });

  it('asking: waiting for the answer; refused: ask again or choose a city; refused for good: Settings or a city', () => {
    expect(presentQibla(snap({ ...noPosition, permission: 'requesting' }), en)).toMatchObject({ notice: { body: en.requesting }, actions: [] });
    expect(presentQibla(snap({ ...noPosition, permission: 'denied' }), en)).toMatchObject({ notice: { title: en.deniedTitle, body: en.deniedBody }, actions: ['allowLocation', 'chooseCity'] });
    expect(presentQibla(snap({ ...noPosition, permission: 'blocked' }), en)).toMatchObject({ notice: { body: en.blockedBody }, actions: ['openSettings', 'chooseCity'] });
  });

  it('granted: finding the location; services off; no fix', () => {
    expect(presentQibla(snap({ ...noPosition, location: 'locating' }), en)).toMatchObject({ status: { text: en.locating }, actions: [] });
    expect(presentQibla(snap({ ...noPosition, location: 'servicesOff' }), en)).toMatchObject({ notice: { body: en.servicesOff }, actions: ['openSettings', 'chooseCity'] });
    expect(presentQibla(snap({ ...noPosition, location: 'unavailable' }), en)).toMatchObject({ notice: { body: en.locationUnavailable }, actions: ['tryAgain', 'chooseCity'] });
  });

  it('web (no device location): choose a city', () => {
    expect(presentQibla(snap({ ...noPosition, permission: 'unsupported' }), en)).toMatchObject({ notice: { body: en.webNote }, actions: ['chooseCity'] });
  });
});

describe('presentQibla: a chosen city', () => {
  it('without location access: the bearing only, never presented as a live compass', () => {
    const view = presentQibla(
      snap({ permission: 'blocked', positionSource: 'manual', manualLabel: 'Paris, France', compass: compass('unavailable', ['noPermission']), turn: null, heading: null }),
      en,
    );
    expect(view).toMatchObject({ needle: 'hidden', turnText: null, status: null, notice: { body: en.bearingOnlyNote }, positionLine: 'Using Paris, France', bearingText: '136° from true north' });
    expect(view.actions).toEqual(['openSettings', 'chooseCity']);
  });

  it('with location access: a capped live compass, and the way back to the device location', () => {
    const view = presentQibla(snap({ positionSource: 'manual', manualLabel: 'Paris, France', compass: compass('approximate', ['manualPosition']) }), en);
    expect(view).toMatchObject({ needle: 'dimmed', approximate: true, status: { text: en.statusManualPosition } });
    expect(view.actions).toEqual(['useMyLocation', 'chooseCity']);
  });
});

describe('presentQibla: where no bearing can be given', () => {
  it('at the Kaaba, near the antipode, at a pole: a message instead of the compass', () => {
    expect(presentQibla(snap({ qibla: { kind: 'atKaaba' } }), en)).toMatchObject({ special: en.atKaaba, showDial: false, bearingText: null });
    expect(presentQibla(snap({ qibla: { kind: 'undefined', reason: 'antipode' } }), en)).toMatchObject({ special: en.antipode, showDial: false });
    expect(presentQibla(snap({ qibla: { kind: 'undefined', reason: 'pole' } }), ar)).toMatchObject({ special: ar.pole });
    expect(presentQibla(snap({ qibla: { kind: 'atKaaba' }, positionSource: 'manual', manualLabel: 'Mecca' }), en).actions).toEqual(['useMyLocation', 'chooseCity']);
  });
});

describe('presentQibla: numbers', () => {
  it('rounds the bearing to whole degrees in Western digits, 359.6° → 0°', () => {
    expect(presentQibla(snap({ qibla: { kind: 'bearing', bearing: 359.6 } }), en).bearingText).toBe('0° from true north');
    expect(presentQibla(snap(), ar).bearingText).toBe('136° من الشمال الجغرافي');
  });
});
