import { fill } from '@/localization/fill';

import type { CompassReason } from './compassReliability';
import type { QiblaSnapshot } from './qiblaCompassController';
import type { Messages } from '@/localization/messages';

type QiblaTexts = Messages['qibla'];

/**
 * What the /qibla screen shows for one snapshot (qiblaCompassController.ts), as data: the screen only lays it out.
 * Pure, so every state of the reliability model has a tested wording. The rules: "Lined up with the Qibla bearing" only
 * when the compass is ready; any other needle is labelled approximate and its hint says "About …"; no needle when the
 * compass is not usable; silence asks for a small movement, never says the sensor is bad.
 */

export type QiblaAction = 'allowLocation' | 'openSettings' | 'tryAgain' | 'chooseCity' | 'useMyLocation';

export type QiblaPresentation = {
  /** "136° from true north", or null without a bearing. */
  bearingText: string | null;
  /** At the Kaaba, near its antipode, at a pole: replaces the compass. */
  special: string | null;
  /** A card about permission or location (title optional). */
  notice: { title: string | null; body: string } | null;
  /** One line about the compass; tone drives its colour and whether it is announced as an alert. */
  status: { text: string; tone: 'ok' | 'info' | 'warning' | 'alert' } | null;
  turnText: string | null;
  aligned: boolean;
  approximate: boolean;
  needle: 'hidden' | 'dimmed' | 'full';
  /** Whether to draw the compass dial at all. */
  showDial: boolean;
  positionLine: string | null;
  actions: QiblaAction[];
  /** The dial's screen-reader label. */
  accessibilitySummary: string;
};

/** Which approximate reason the status line names, most actionable first. */
const APPROXIMATE_ORDER: readonly CompassReason[] = [
  'lowAccuracy',
  'refreshNeeded',
  'recentError',
  'positionUncertain',
  'settling',
  'manualPosition',
  'orientationUnverified',
  'accuracyUntrusted',
];

function statusFor(snapshot: QiblaSnapshot, m: QiblaTexts): QiblaPresentation['status'] {
  const { state, reasons } = snapshot.compass;
  const has = (reason: CompassReason) => reasons.includes(reason);
  if (state === 'ready') return snapshot.aligned ? { text: m.aligned, tone: 'ok' } : null;
  if (has('noBearing') || has('noPermission')) return null;
  if (has('noHeadingSupport')) return { text: m.statusNoHeadingSupport, tone: 'info' };
  if (has('streamFailed')) return { text: m.statusStreamFailed, tone: 'alert' };
  if (has('sensorErrorRetrying')) return { text: m.statusSensorRetrying, tone: 'warning' };
  if (has('noHeadingEvents') || has('noTrueHeading')) return { text: m.statusNoReading, tone: 'warning' };
  if (has('waitingForMovement')) return { text: m.statusWaitingForMovement, tone: 'info' };
  if (has('starting') || has('waitingForTrueHeading')) return { text: m.statusStarting, tone: 'info' };
  if (has('uncalibrated')) return { text: m.statusCalibrate, tone: 'warning' };
  const first = APPROXIMATE_ORDER.find(has);
  switch (first) {
    case 'lowAccuracy':
      return { text: m.statusCalibrate, tone: 'warning' };
    case 'refreshNeeded':
      return { text: m.statusRefreshNeeded, tone: 'info' };
    case 'recentError':
      return { text: m.statusRecentError, tone: 'warning' };
    case 'positionUncertain':
      return { text: m.statusPositionUncertain, tone: 'warning' };
    case 'settling':
      return { text: m.statusSettling, tone: 'info' };
    case 'manualPosition':
      return { text: m.statusManualPosition, tone: 'info' };
    case 'orientationUnverified':
      return { text: m.statusOrientation, tone: 'info' };
    case 'accuracyUntrusted':
      return { text: m.statusUntrusted, tone: 'info' };
    default:
      return null;
  }
}

export function presentQibla(snapshot: QiblaSnapshot, m: QiblaTexts): QiblaPresentation {
  const qibla = snapshot.qibla;
  const bearing = qibla?.kind === 'bearing' ? qibla.bearing : null;
  const bearingDegrees = bearing === null ? null : Math.round(bearing) % 360;
  const bearingText = bearingDegrees === null ? null : fill(m.bearingValue, { degrees: bearingDegrees });
  const manual = snapshot.positionSource === 'manual';
  const positionLine = manual ? fill(m.usingCity, { city: snapshot.manualLabel ?? '' }) : snapshot.positionSource === 'device' ? m.usingMyLocation : null;

  const base: QiblaPresentation = {
    bearingText,
    special: null,
    notice: null,
    status: null,
    turnText: null,
    aligned: false,
    approximate: false,
    needle: 'hidden',
    showDial: false,
    positionLine,
    actions: [],
    accessibilitySummary: bearingDegrees === null ? m.dialLabel : fill(m.dialNoNeedle, { bearing: bearingDegrees }),
  };

  // Where a bearing cannot be given.
  if (qibla?.kind === 'atKaaba') return { ...base, special: m.atKaaba, actions: manual ? ['useMyLocation', 'chooseCity'] : ['chooseCity'] };
  if (qibla?.kind === 'undefined') return { ...base, special: qibla.reason === 'pole' ? m.pole : m.antipode, actions: ['chooseCity'] };

  // No position yet: permission and location.
  if (!qibla) {
    switch (snapshot.permission) {
      case 'unsupported':
        return { ...base, notice: { title: null, body: m.webNote }, actions: ['chooseCity'] };
      case 'needsRequest':
        return { ...base, notice: { title: m.permissionTitle, body: m.permissionBody }, actions: ['allowLocation', 'chooseCity'] };
      case 'requesting':
        return { ...base, notice: { title: m.permissionTitle, body: m.requesting } };
      case 'denied':
        return { ...base, notice: { title: m.deniedTitle, body: m.deniedBody }, actions: ['allowLocation', 'chooseCity'] };
      case 'blocked':
        return { ...base, notice: { title: m.deniedTitle, body: m.blockedBody }, actions: ['openSettings', 'chooseCity'] };
      case 'granted':
        if (snapshot.location === 'servicesOff') return { ...base, notice: { title: null, body: m.servicesOff }, actions: ['openSettings', 'chooseCity'] };
        if (snapshot.location === 'unavailable') return { ...base, notice: { title: null, body: m.locationUnavailable }, actions: ['tryAgain', 'chooseCity'] };
        return { ...base, status: { text: m.locating, tone: 'info' } };
      default:
        return base; // checking
    }
  }

  // A bearing. The compass, as far as it can be trusted.
  const needle = snapshot.compass.needle;
  const showNeedle = needle !== 'hidden' && snapshot.turn !== null;
  const approximate = showNeedle && needle === 'dimmed';
  let turnText: string | null = null;
  if (showNeedle && snapshot.turn) {
    const { direction, degrees } = snapshot.turn;
    if (direction === 'ahead') turnText = approximate ? m.aboutAhead : m.ahead;
    else if (approximate) turnText = fill(direction === 'right' ? m.aboutRight : m.aboutLeft, { degrees });
    else turnText = fill(direction === 'right' ? m.turnRight : m.turnLeft, { degrees });
  }
  const aligned = snapshot.compass.state === 'ready' && snapshot.aligned;

  const actions: QiblaAction[] = [];
  let notice: QiblaPresentation['notice'] = null;
  if (manual && snapshot.permission !== 'granted') {
    // A chosen city without location access: the bearing only, never presented as a live compass.
    notice = { title: null, body: m.bearingOnlyNote };
    if (snapshot.permission === 'needsRequest' || snapshot.permission === 'denied') actions.push('allowLocation');
    if (snapshot.permission === 'blocked') actions.push('openSettings');
  }
  const reasons = snapshot.compass.reasons;
  if (reasons.includes('streamFailed') || reasons.includes('noHeadingEvents') || reasons.includes('noTrueHeading')) actions.push('tryAgain');
  if (manual && snapshot.permission === 'granted') actions.push('useMyLocation');
  actions.push('chooseCity');

  const summaryParts = showNeedle && turnText ? [m.dialLabel, turnText, ...(approximate ? [m.approximate] : []), ...(aligned ? [m.aligned] : [])] : [];
  return {
    ...base,
    notice,
    status: statusFor(snapshot, m),
    turnText,
    aligned,
    approximate,
    needle: showNeedle ? needle : 'hidden',
    showDial: true,
    actions,
    accessibilitySummary: summaryParts.length > 0 ? `${summaryParts.join('. ')}. ${bearingText}` : base.accessibilitySummary,
  };
}
