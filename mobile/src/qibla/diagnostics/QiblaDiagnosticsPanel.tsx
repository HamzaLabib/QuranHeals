import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePalette } from '@/theme/useTheme';
import { buildInfoLine } from '@/utils/buildInfo';
import { goBackOrHome } from '@/utils/goBackOrHome';

import { useQiblaCompass } from '../useQiblaCompass';
import { diagnosticsReport, diagnosticsSections } from './formatDiagnostics';

/**
 * DEVELOPMENT BUILDS ONLY. Loaded solely by app/qibla-diagnostics.tsx inside `__DEV__ ? require(...) : null`, so Metro
 * leaves this module (and formatDiagnostics.ts) out of release bundles; a release build's /qibla-diagnostics is a
 * redirect to Home (tests/qiblaDiagnosticsExclusion.test.ts, scripts/verify-qibla-diagnostics-excluded.mjs).
 *
 * Opened with the deep link quranheals://qibla-diagnostics (no button anywhere in the app). Shows the live compass
 * internals for the real-device checks of docs/qibla.md. Never shows, logs, stores or sends a coordinate or the
 * distance to the Kaaba; "Copy report" copies the same rows to the clipboard, for the tester to paste on purpose.
 */

export const QIBLA_DIAGNOSTICS_MARKER = 'QIBLA-DIAGNOSTICS-PANEL (development build only)';

/** A fixed test position (London's centre: a public landmark, not the user's) for the chosen-city checks. */
const TEST_CITY = { coordinates: { latitude: 51.5074, longitude: -0.1278 }, accuracyMeters: 30_000, label: 'London (test city)' };

/** Readings refresh four times a second while the panel is open (development builds only). */
const REFRESH_MS = 250;

type LogRow = { t: number; trueHeading: number | null; magHeading: number | null; accuracy: number | null };

export function QiblaDiagnosticsPanel() {
  const colors = usePalette();
  const compass = useQiblaCompass();
  const { snapshot, getDiagnostics, requestPermission, retry, chooseManualPosition, chooseDevicePosition } = compass;
  const [diagnostics, setDiagnostics] = useState(() => getDiagnostics());
  const [log, setLog] = useState<LogRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let lastCount = -1;
    const timer = setInterval(() => {
      const next = getDiagnostics();
      setDiagnostics(next);
      if (next.heading.eventsThisSubscription !== lastCount && next.heading.eventsThisSubscription > 0) {
        lastCount = next.heading.eventsThisSubscription;
        setLog((rows) =>
          [{ t: Date.now(), trueHeading: next.heading.rawTrueHeading, magHeading: next.heading.rawMagHeading, accuracy: next.heading.rawAccuracy }, ...rows].slice(0, 12),
        );
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [getDiagnostics]);

  const text = { color: colors.textPrimary };
  const muted = { color: colors.textSecondary };
  const relative = diagnostics.relativeAngle;
  const button = (label: string, onPress: () => void, testID: string) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, { borderColor: colors.border, backgroundColor: colors.surface }, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, text]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          {button('Back', goBackOrHome, 'qibla-diagnostics-back')}
          <Text style={[styles.title, text]}>Qibla diagnostics</Text>
        </View>
        <Text style={[styles.small, muted]}>{QIBLA_DIAGNOSTICS_MARKER} · {buildInfoLine()}</Text>

        <View style={[styles.hero, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.big, text]} testID="qibla-diagnostics-state">
            {diagnostics.compass.state.toUpperCase()} · {diagnostics.condition}
          </Text>
          <Text style={[styles.mid, text]}>
            True {diagnostics.heading.trueHeading === null ? '—' : `${diagnostics.heading.trueHeading.toFixed(1)}°`} · Magnetic{' '}
            {diagnostics.heading.rawMagHeading === null ? '—' : `${diagnostics.heading.rawMagHeading.toFixed(1)}°`}
          </Text>
          <Text style={[styles.mid, text]}>
            Qibla {diagnostics.qibla?.kind === 'bearing' ? `${diagnostics.qibla.bearing.toFixed(1)}°` : '—'} · last event{' '}
            {diagnostics.heading.msSinceLastEvent === null ? '—' : `${(diagnostics.heading.msSinceLastEvent / 1000).toFixed(1)} s ago`}
          </Text>
          {/* Where the Qibla is relative to the top of the phone (dimmed unless ready). Geometry is fixed left-to-right. */}
          <View style={[styles.arrowBox, { borderColor: colors.border, direction: 'ltr' }]}>
            {relative !== null && (
              <Text
                style={[styles.arrow, { color: colors.accent, opacity: diagnostics.compass.needle === 'full' ? 1 : 0.4, transform: [{ rotate: `${relative}deg` }] }]}>
                ↑
              </Text>
            )}
          </View>
          <Text style={[styles.small, muted]}>Top of the box = top of the phone. Hold the phone flat, screen up.</Text>
        </View>

        <View style={styles.buttons}>
          {(snapshot.permission === 'needsRequest' || snapshot.permission === 'denied') && button('Request permission', requestPermission, 'qibla-diagnostics-permission')}
          {button('Try again', retry, 'qibla-diagnostics-retry')}
          {snapshot.positionSource === 'manual'
            ? button('Use device position', chooseDevicePosition, 'qibla-diagnostics-device')
            : button('Use test city (London)', () => chooseManualPosition(TEST_CITY), 'qibla-diagnostics-city')}
          {button(copied ? 'Copied' : 'Copy report', () => {
            void Clipboard.setStringAsync(diagnosticsReport(getDiagnostics(), `${QIBLA_DIAGNOSTICS_MARKER}\n${buildInfoLine()}\n${new Date().toISOString()}`)).then(() => setCopied(true));
          }, 'qibla-diagnostics-copy')}
        </View>

        {diagnosticsSections(diagnostics).map((section) => (
          <View key={section.title} style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, text]}>{section.title}</Text>
            {section.rows.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={[styles.label, muted]}>{label}</Text>
                <Text style={[styles.value, text]} selectable>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, text]}>Recent readings (sampled every {REFRESH_MS} ms)</Text>
          {log.length === 0 ? (
            <Text style={[styles.small, muted]}>No heading events yet.</Text>
          ) : (
            log.map((row) => (
              <Text key={row.t} style={[styles.mono, text]}>
                {new Date(row.t).toISOString().slice(11, 23)} true {row.trueHeading ?? '—'} mag {row.magHeading ?? '—'} acc {row.accuracy ?? '—'}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: 12, padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  small: { fontSize: 12 },
  hero: { alignItems: 'center', borderRadius: 12, borderWidth: 1, gap: 6, padding: 12 },
  big: { fontSize: 18, fontWeight: '700' },
  mid: { fontSize: 15 },
  arrowBox: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 120, justifyContent: 'center', width: 120 },
  arrow: { fontSize: 72, fontWeight: '700' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { borderRadius: 10, borderWidth: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  buttonText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  section: { borderRadius: 10, borderWidth: 1, gap: 4, padding: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  label: { flex: 1, fontSize: 13 },
  value: { flex: 1, fontSize: 13, textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
});
