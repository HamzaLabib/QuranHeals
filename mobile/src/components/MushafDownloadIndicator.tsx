import { Check } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { mushafAutoDownload } from '@/mushaf/offline/autoDownloadService';
import { useMushafAutoDownload } from '@/mushaf/offline/useMushafAutoDownload';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

/** How long «Your Mushaf is ready for offline reading» stays; shown once per completed download. */
export const READY_NOTICE_MS = 4000;

/**
 * The automatic Mushaf download's only presence outside the reader: one
 * quiet line above the tab bar (never a popup, never on the Mushaf page,
 * which hides the tab bar). It shows only:
 *  - while downloading: «Preparing your Mushaf for offline reading» and its progress;
 *  - on mobile data (or an unknown network) before the first download: the question, answered once;
 *  - after the download completed in this session: «Your Mushaf is ready…», briefly.
 * Waiting, retries, pauses and failures stay quiet here; the panel (Settings,
 * and any page not yet downloaded) explains them.
 */
export function MushafDownloadIndicator() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.mushaf;
  const direction = getDirectionStyle(locale);
  const auto = useMushafAutoDownload();

  useEffect(() => {
    if (!auto.justCompleted) return;
    const timer = setTimeout(() => mushafAutoDownload().dismissCompleted(), READY_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [auto.justCompleted]);

  if (auto.phase === 'downloading') {
    const p = auto.progress;
    // One bar over both steps: the layout (bytes) is about a fifth of the download, the 604 fonts the rest.
    const share = !p ? 0
      : p.phase === 'fonts' || p.phase === 'done' ? 0.2 + 0.8 * ((p.fontsReady ?? 0) / (p.fontsTotal || 604))
      : 0.2 * (p.bytesTotal > 0 ? p.bytesReady / p.bytesTotal : 0);
    const percent = new Intl.NumberFormat(locale, { style: 'percent' }).format(Math.min(1, share));
    return (
      <View testID="mushaf-download-indicator" accessibilityLiveRegion="polite" style={styles.strip}>
        <Text numberOfLines={1} style={[styles.text, direction]}>{`${copy.autoPreparing} · ${percent}`}</Text>
        <View style={[styles.track, isRtlLocale(locale) && styles.trackRtl]}>
          <View testID="mushaf-download-progress" style={[styles.fill, { width: `${Math.round(Math.min(1, share) * 100)}%` }]} />
        </View>
      </View>
    );
  }
  if (auto.phase === 'needs-consent') {
    return (
      <View testID="mushaf-download-consent" style={styles.strip}>
        <Text style={[styles.text, direction]}>{auto.network === 'cellular' ? copy.autoConsentCellular : copy.autoConsentUnknown}</Text>
        <View style={[styles.actions, isRtlLocale(locale) && styles.actionsRtl]}>
          <Pressable accessibilityRole="button" onPress={() => void mushafAutoDownload().waitForWifi()} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <Text style={styles.actionText}>{auto.network === 'cellular' ? copy.autoWaitForWifi : copy.autoNotNow}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void mushafAutoDownload().allowCellular()} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <Text style={[styles.actionText, styles.actionPrimary]}>{copy.autoDownloadNow}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (auto.justCompleted && auto.phase === 'ready') {
    return (
      <View testID="mushaf-download-ready" accessibilityLiveRegion="polite" style={[styles.strip, styles.row, isRtlLocale(locale) && styles.rowRtl]}>
        <Check size={14} color={colors.accent} strokeWidth={2.6} />
        <Text numberOfLines={1} style={[styles.text, direction]}>{copy.autoReady}</Text>
      </View>
    );
  }
  return null;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  strip: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  text: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: '600',
  },
  track: {
    backgroundColor: colors.border,
    borderRadius: 2,
    flexDirection: 'row',
    height: 3,
    overflow: 'hidden',
  },
  trackRtl: {
    flexDirection: 'row-reverse',
  },
  fill: {
    backgroundColor: colors.accent,
    height: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  action: {
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  actionPrimary: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
});
