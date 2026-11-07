import type { QiblaDiagnostics } from '../qiblaCompassController';

/**
 * DEVELOPMENT BUILDS ONLY (app/qibla-diagnostics.tsx). The Qibla diagnostics as labelled rows, for the panel and for
 * its "Copy report" text. Built only from QiblaDiagnostics, which has no coordinates and no distance; the fix's
 * accuracy radius and age are shown, never where it is. English only on purpose: a developer tool, kept out of the
 * shared localization files.
 */

export type DiagnosticsSection = { title: string; rows: [label: string, value: string][] };

const deg = (value: number | null, digits = 1) => (value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}°`);
const ms = (value: number | null) => (value === null ? '—' : value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`);
const yes = (value: boolean) => (value ? 'yes' : 'no');

/** expo-location's 0–3 calibration level, with what it means on this platform. */
export function describeAccuracy(level: number | null, platform: QiblaDiagnostics['platform']): string {
  if (level === null) return '—';
  if (platform === 'ios') {
    const meaning = ['none / > 50°', '≤ 50°', '≤ 35°', '≤ 20°'][level] ?? '?';
    return `${level} (iOS: ${meaning})`;
  }
  const meaning = ['unreliable', 'low', 'medium', 'high'][level] ?? '?';
  return `${level} (Android sensor status: ${meaning}; may be the accelerometer's)`;
}

export function diagnosticsSections(d: QiblaDiagnostics): DiagnosticsSection[] {
  const qibla =
    d.qibla === null
      ? 'no position'
      : d.qibla.kind === 'bearing'
        ? deg(d.qibla.bearing, 2)
        : d.qibla.kind === 'undefined'
          ? `undefined (${d.qibla.reason})`
          : d.qibla.kind;
  return [
    {
      title: 'Reliability',
      rows: [
        ['State', d.compass.state],
        ['Condition', d.condition],
        ['Reasons', d.compass.reasons.length > 0 ? d.compass.reasons.join(', ') : '—'],
        ['Needle', d.compass.needle],
        ['Lined up', yes(d.aligned)],
        ['Turn', d.turn ? (d.turn.direction === 'ahead' ? 'ahead' : `${d.turn.degrees}° ${d.turn.direction}`) : '—'],
      ],
    },
    {
      title: 'Heading',
      rows: [
        ['True heading (raw)', d.heading.rawTrueHeading === null ? '—' : String(d.heading.rawTrueHeading)],
        ['Magnetic heading (raw, comparison only)', d.heading.rawMagHeading === null ? '—' : String(d.heading.rawMagHeading)],
        ['True heading (used)', deg(d.heading.trueHeading)],
        ['True − magnetic (declination applied)', deg(d.heading.trueMinusMagneticDeg)],
        ['Smoothed heading', deg(d.heading.smoothedHeading)],
        ['Reported accuracy', describeAccuracy(d.heading.rawAccuracy, d.platform)],
        ['Time since last event', ms(d.heading.msSinceLastEvent)],
        ['Events (last 5 s / this stream)', `${d.heading.eventsLastFiveSeconds} / ${d.heading.eventsThisSubscription}`],
        ['First event after', ms(d.heading.firstEventAfterMs)],
        ['Stream', d.heading.subscribed ? `running ${ms(d.heading.subscribedForMs)}` : d.heading.starting ? 'starting' : 'stopped'],
        ['Android: true north seen', d.platform === 'android' ? yes(d.heading.androidTrueNorthSeen) : 'n/a'],
      ],
    },
    {
      title: 'Errors and retries',
      rows: [
        ['Errors (total)', String(d.errors.total)],
        ['Consecutive failures', `${d.errors.consecutiveFailures} of ${d.errors.maxRetries}`],
        ['Retry pending', yes(d.errors.retryPending)],
        ['Given up', yes(d.errors.streamFailed)],
        ['Last error', d.errors.lastReason === null ? '—' : `${d.errors.lastReason} (${ms(d.errors.msSinceLastError)} ago)`],
      ],
    },
    {
      title: 'Permission and position (no coordinates)',
      rows: [
        ['Permission', d.permission],
        ['Location', d.location],
        ['Position in use', d.position.source ?? 'none'],
        ['Device fix held', yes(d.position.deviceFixAvailable)],
        ['Device fix accuracy', d.position.deviceFixAccuracyMeters === null ? '—' : `${Math.round(d.position.deviceFixAccuracyMeters)} m`],
        ['Device fix age', ms(d.position.deviceFixAgeMs)],
        ['Test city', d.position.manualLabel ?? '—'],
        ['Qibla bearing', qibla],
        ['Bearing uncertainty from position', deg(d.bearingUncertaintyDeg, 2)],
      ],
    },
    {
      title: 'Device and orientation',
      rows: [
        ['Platform', d.platform],
        ['Large screen (tablet)', yes(d.largeScreen)],
        ['Heading supported here', yes(d.headingSupported)],
        ['Accuracy value trusted', yes(d.accuracyTrusted)],
        ['Orientation verified', yes(d.orientationVerified)],
        ['Screen active', yes(d.active)],
      ],
    },
  ];
}

/** The "Copy report" text: the same rows, plain text. */
export function diagnosticsReport(d: QiblaDiagnostics, header: string): string {
  const lines = [header];
  for (const section of diagnosticsSections(d)) {
    lines.push('', `## ${section.title}`);
    for (const [label, value] of section.rows) lines.push(`${label}: ${value}`);
  }
  return lines.join('\n');
}
