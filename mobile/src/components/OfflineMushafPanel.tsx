import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { mushafAutoDownload } from '@/mushaf/offline/autoDownloadService';
import type { OfflineErrorKind, OfflineStatus } from '@/mushaf/offline/offlineMushaf';
import { useMushafAutoDownload } from '@/mushaf/offline/useMushafAutoDownload';
import { useThemedStyles } from '@/theme/useTheme';

/**
 * The offline Mushaf's status and controls: progress, Pause, Download /
 * Continue / Try again, Check for updates and Remove. Shown on a page that
 * isn't downloaded yet (Settings has its own compact row, OfflineMushafSettingsRow). Every action goes through the one
 * automatic-download controller (mushaf/offline/autoDownload.ts), so the
 * panel, the tab bar's indicator and the automatic start never compete.
 */
export function OfflineMushafPanel() {
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.mushaf;
  const direction = getDirectionStyle(locale);
  const auto = useMushafAutoDownload();
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const refresh = useCallback(() => mushafAutoDownload().status().then(setStatus, () => setStatus(null)), []);
  // Again whenever a download, update or removal ends, and when the phase changes.
  useEffect(() => {
    void refresh();
  }, [refresh, auto.runs, auto.phase]);

  const explain = (kind: OfflineErrorKind | null) =>
    kind === 'offline' ? copy.offlineErrorOffline
      : kind === 'unavailable' ? copy.offlineErrorUnavailable
      : kind === 'insufficient_storage' ? copy.offlineErrorStorage
      : kind === 'integrity' ? copy.offlineErrorIntegrity
      : copy.offlineErrorGeneric;

  const start = () => {
    setNotice(null);
    void mushafAutoDownload().resume();
  };
  const checkForUpdate = async () => {
    setNotice(null);
    const outcome = await mushafAutoDownload().checkForUpdate();
    if (outcome === 'updated') setNotice({ tone: 'info', text: copy.offlineUpdated });
    else if (outcome === 'up-to-date' || outcome === 'not-due') setNotice({ tone: 'info', text: copy.offlineUpToDate });
    else if (outcome === 'offline') setNotice({ tone: 'error', text: copy.offlineErrorOffline });
    else if (outcome === 'failed') setNotice({ tone: 'error', text: copy.offlineErrorGeneric });
  };
  const remove = async () => {
    setNotice(null);
    try {
      await mushafAutoDownload().remove();
    } catch {
      setNotice({ tone: 'error', text: copy.offlineErrorGeneric });
    }
  };

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
  const progress = auto.phase === 'downloading' ? auto.progress : null;
  // Two steps: the layout (by bytes), then the page fonts (by count).
  const inFonts = progress?.phase === 'fonts';
  const percent = !progress ? 0
    : inFonts ? (progress.fontsReady ?? 0) / (progress.fontsTotal || 604)
    : progress.bytesTotal > 0 ? progress.bytesReady / progress.bytesTotal : 0;
  const complete = status?.installed === true && status.complete !== false;
  const downloading = auto.phase === 'downloading';
  const action = auto.phase === 'failed' || auto.phase === 'retrying' ? copy.offlineRetry
    : status?.installed || (status && status.stagedChunks > 0) || auto.phase === 'paused' ? copy.offlineResume
    : copy.offlineDownload;
  const phaseLine = auto.phase === 'paused' ? { text: copy.offlinePaused, error: false }
    : auto.phase === 'waiting-wifi' ? { text: copy.offlineWaitingWifi, error: false }
    : auto.phase === 'waiting-network' ? { text: copy.offlineWaitingNetwork, error: false }
    : auto.phase === 'retrying' ? { text: `${explain(auto.error)} ${copy.offlineRetrying}`, error: true }
    : auto.phase === 'failed' ? { text: explain(auto.error), error: true }
    : null;

  return (
    <View testID="offline-mushaf" style={styles.panel}>
      <Text style={[styles.label, direction]}>{copy.offlineTitle}</Text>
      {status?.installed ? (
        <>
          <Text style={[styles.muted, direction]}>{`${complete && status.fonts ? copy.offlineComplete : copy.offlineReady} · ${copy.offlineUpdatedFrom}: ${formatDate(status.syncedAt)}`}</Text>
          {status.fonts && <Text style={[styles.muted, direction]}>{`${copy.offlineFontsCount}: ${number(status.fonts.ready)} / ${number(status.fonts.total)}`}</Text>}
        </>
      ) : (
        <Text style={[styles.muted, direction]}>{copy.offlineIntro}</Text>
      )}
      {downloading ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[styles.status, direction]}>
            {inFonts
              ? `${copy.offlineFonts} ${number(progress?.fontsReady ?? 0)} / ${number(progress?.fontsTotal ?? 604)}`
              : `${!progress || progress.phase === 'downloading' || progress.phase === 'checking' ? copy.offlineDownloading : copy.offlineVerifying} ${new Intl.NumberFormat(locale, { style: 'percent' }).format(percent)}`}
          </Text>
          <PanelButton label={copy.offlinePause} onPress={() => void mushafAutoDownload().pause()} styles={styles} />
        </>
      ) : (
        <>
          {phaseLine && <Text accessibilityLiveRegion="polite" style={[styles.status, direction, phaseLine.error && styles.statusError]}>{phaseLine.text}</Text>}
          {!complete && <PanelButton label={action} disabled={status === null} onPress={start} styles={styles} />}
          {status?.installed && <PanelButton label={copy.offlineCheckUpdate} onPress={() => void checkForUpdate()} styles={styles} />}
          {status?.installed && <PanelButton label={copy.offlineRemove} onPress={() => void remove()} styles={styles} />}
        </>
      )}
      {notice && <Text accessibilityLiveRegion="polite" style={[styles.status, direction, notice.tone === 'error' && styles.statusError]}>{notice.text}</Text>}
      {/* Until the copy is complete: before the download and beside its progress. */}
      {!complete && <Text testID="offline-mushaf-one-time-note" style={[styles.muted, direction]}>{copy.offlineOneTimeNote}</Text>}
    </View>
  );
}

function PanelButton({ label, onPress, disabled, styles }: { label: string; onPress: () => void; disabled?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

/** The panel's look, as it was inside the reader (app/(tabs)/mushaf.tsx). */
const makeStyles = (colors: Palette) => StyleSheet.create({
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  status: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  statusError: {
    color: colors.danger,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.78,
  },
});

