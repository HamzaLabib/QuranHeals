import { CircleAlert, CircleCheck, Download } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import type { Messages } from '@/localization/messages';
import type { AutoState } from '@/mushaf/offline/autoDownload';
import { mushafAutoDownload } from '@/mushaf/offline/autoDownloadService';
import type { OfflineStatus } from '@/mushaf/offline/offlineMushaf';
import { useMushafAutoDownload } from '@/mushaf/offline/useMushafAutoDownload';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };
export type OfflineRowStatus = 'available' | 'required' | 'downloading' | 'failed';

/**
 * What the row says, from the engine's own status and the download controller's phase:
 *  - available: only when the engine reports the Mushaf installed AND complete (layout installed, every page font
 *    verified on the device) — never from a phase or a progress count alone;
 *  - downloading: a download is running now;
 *  - failed: the last attempt failed (whether or not an automatic retry is waiting);
 *  - required: anything else (nothing yet, partly downloaded, paused, removed, waiting for Wi-Fi or a network).
 * null while the status is still being read, so the row never shows a guess.
 */
export function offlineRowStatus(status: OfflineStatus | null, phase: AutoState['phase']): OfflineRowStatus | null {
  if (status === null) return null;
  const fontsDone = !status.fonts || status.fonts.ready >= status.fonts.total;
  if (status.installed && status.complete !== false && fontsDone) return 'available';
  if (phase === 'downloading') return 'downloading';
  if (phase === 'failed' || phase === 'retrying') return 'failed';
  return 'required';
}

/**
 * Real progress, when there is one to show: the page fonts (all 604, nearly all of the download) by count. The layout
 * step before them reports bytes of its own, which would make the number start over, so it shows no number.
 */
export function offlineRowPercent(progress: AutoState['progress']): number | null {
  if (!progress || progress.phase !== 'fonts' || !progress.fontsTotal) return null;
  return Math.min(1, Math.max(0, (progress.fontsReady ?? 0) / progress.fontsTotal));
}

type OfflineMushafSettingsRowProps = { messages: Messages; locale: string; direction: Direction; isRtl: boolean };

/**
 * Settings → Quran → Offline Mushaf: one compact row like its neighbours — the name, the actual status underneath,
 * and a small status icon at the far end. When a download is needed (or the last one failed), tapping the row starts
 * it through the one download controller (mushaf/offline/autoDownload.ts, the same action as the reader's Download /
 * Try again); otherwise the row is information only. Mirrors in Arabic.
 */
export function OfflineMushafSettingsRow({ messages, locale, direction, isRtl }: OfflineMushafSettingsRowProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const auto = useMushafAutoDownload();
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const s = messages.settings;

  const refresh = useCallback(() => mushafAutoDownload().status().then(setStatus, () => setStatus(null)), []);
  // Again whenever a download, update or removal ends, and when the phase changes.
  useEffect(() => {
    void refresh();
  }, [refresh, auto.runs, auto.phase]);

  const rowStatus = offlineRowStatus(status, auto.phase);
  const percent = rowStatus === 'downloading' ? offlineRowPercent(auto.progress) : null;
  const subtitle = rowStatus === 'available' ? s.offlineMushafAvailable
    : rowStatus === 'downloading' ? (percent === null ? s.offlineMushafDownloading : `${s.offlineMushafDownloading} ${new Intl.NumberFormat(locale, { style: 'percent' }).format(percent)}`)
    : rowStatus === 'failed' ? s.offlineMushafFailed
    : rowStatus === 'required' ? s.offlineMushafRequired
    : '';
  const actionable = rowStatus === 'required' || rowStatus === 'failed';

  const icon = rowStatus === 'available' ? <CircleCheck testID="offline-mushaf-icon-available" size={20} color={colors.accent} />
    : rowStatus === 'downloading' ? <ActivityIndicator testID="offline-mushaf-icon-downloading" size="small" color={colors.accent} />
    : rowStatus === 'failed' ? <CircleAlert testID="offline-mushaf-icon-failed" size={20} color={colors.danger} />
    : rowStatus === 'required' ? <Download testID="offline-mushaf-icon-required" size={20} color={colors.icon} />
    : null;

  return (
    <View style={styles.card}>
      <Pressable
        testID="settings-offline-mushaf"
        accessibilityRole={actionable ? 'button' : undefined}
        accessibilityLabel={subtitle ? `${s.offlineMushafTitle}, ${subtitle}` : s.offlineMushafTitle}
        accessibilityHint={actionable ? s.offlineMushafDownloadHint : undefined}
        accessibilityState={{ disabled: !actionable, busy: rowStatus === 'downloading' }}
        disabled={!actionable}
        onPress={() => void mushafAutoDownload().resume()}
        style={({ pressed }) => [styles.row, isRtl && styles.rowRtl, pressed && actionable && styles.pressed]}>
        <View style={styles.textWrap}>
          <Text style={[styles.title, direction]}>{s.offlineMushafTitle}</Text>
          {subtitle !== '' && (
            <Text testID="settings-offline-mushaf-status" accessibilityLiveRegion="polite" style={[styles.subtitle, direction, rowStatus === 'failed' && styles.subtitleError]}>
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.iconBox}>{icon}</View>
      </Pressable>
    </View>
  );
}

/** The same card as Settings' switch rows (Keep Screen Awake) and accordions. */
const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    ...shadows.soft,
  },
  /** The whole card is the tap target. */
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  subtitleError: {
    color: colors.danger,
  },
  iconBox: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  pressed: {
    opacity: 0.78,
  },
});
