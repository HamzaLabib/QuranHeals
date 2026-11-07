import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * /qibla-diagnostics: the Qibla compass diagnostics, DEVELOPMENT BUILDS ONLY (docs/qibla.md, "Device diagnostics").
 * Opened by the deep link quranheals://qibla-diagnostics; nothing in the app links here.
 *
 * In a release bundle `__DEV__` is false, Metro folds the condition and drops the require, so the panel's code is not
 * in the bundle at all; this route then only redirects to Home (tests/qiblaDiagnosticsExclusion.test.ts, and
 * scripts/verify-qibla-diagnostics-excluded.mjs on a real production export).
 */
const DiagnosticsPanel: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/qibla/diagnostics/QiblaDiagnosticsPanel') as typeof import('@/qibla/diagnostics/QiblaDiagnosticsPanel')).QiblaDiagnosticsPanel
  : null;

export default function QiblaDiagnosticsRoute() {
  if (!DiagnosticsPanel) return <Redirect href="/" />;
  return <DiagnosticsPanel />;
}
