import { CircleAlert, CircleCheck, Download } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reciterDownloadStatus } from '@/audio/downloadStatus';
import { formatBytes, localDigits, surahRanges } from '@/audio/format';
import { audioDownloads } from '@/audio/index';
import { getReciter, offlineDownloadBytes, reciterName, timedSurahs } from '@/audio/reciters';
import { SOURCE_REGISTRY } from '@/audio/sourceRegistry';
import { useAudioDownload, useStoredAudio } from '@/audio/usePlayback';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { useSheetFrameStyle } from '@/layout/useWindowClass';
import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';
import { deviceNetwork } from '@/mushaf/offline/network';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type Props = { reciterId: string; messages: Messages; isRtl: boolean; direction: { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' } };

/**
 * Settings → Quran → Favorite Reciter's download icon, beside the dropdown: the offline Mushaf row's own icons in its
 * own colours (Download; a spinner while downloading; the accent CircleCheck once fully downloaded and verified; the
 * danger CircleAlert after a failed download), muted while downloads are unavailable. A tap opens a small sheet with
 * the size, any surahs a download leaves out, the progress, and only the actions that apply (download — asking first off
 * Wi-Fi —, pause, resume, cancel, try again, delete). With downloads not permitted it explains why and offers nothing
 * but deleting files already stored. Never downloads by itself.
 */
export function ReciterDownloadControl({ reciterId, messages, isRtl, direction }: Props) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const frame = useSheetFrameStyle('absolute');
  const download = useAudioDownload();
  const stored = useStoredAudio();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<'cellular' | 'delete' | null>(null);
  const copy = messages.audio;
  const reciter = getReciter(reciterId);
  if (!reciter) return null;

  const mine = stored.reciters.find((r) => r.id === reciter.id);
  const storedSurahs = mine?.surahs ?? [];
  // The app's switch and the provider's own offline permission (audio/sourceRegistry.ts).
  const offlinePermitted = SOURCE_REGISTRY.reciterOfflinePermitted(reciter.id);
  const status = reciterDownloadStatus({ permitted: offlinePermitted, reciter, stored: storedSurahs, download });
  const timed = timedSurahs(reciter);
  const total = offlineDownloadBytes(reciter);
  const name = reciterName(reciter, isRtl);
  const size = (bytes: number) => formatBytes(bytes, copy, isRtl);
  const n = (value: number) => localDigits(value, isRtl);
  const job = download.reciterId === reciter.id ? download : null;
  const notIncluded = Array.from({ length: 114 }, (_, i) => i + 1).filter((s) => !reciter.timed[s]);
  const permitted = offlinePermitted;

  const stateLabel = {
    none: copy.offlineStateNone,
    partial: fill(copy.downloadPartial, { done: n(storedSurahs.length), total: n(timed.length) }),
    downloading: copy.offlineStateDownloading,
    paused: copy.offlineStatePaused,
    complete: copy.offlineStateComplete,
    error: copy.offlineStateError,
    'not-permitted': copy.offlineStateUnavailable,
    unavailable: copy.offlineStateUnavailable,
  }[status];
  const muted = status === 'not-permitted' || status === 'unavailable';
  const icon = status === 'complete' ? <CircleCheck testID="reciter-download-icon-complete" size={20} color={colors.accent} />
    : status === 'downloading' ? <ActivityIndicator testID="reciter-download-icon-downloading" size="small" color={colors.accent} />
    : status === 'error' ? <CircleAlert testID="reciter-download-icon-error" size={20} color={colors.danger} />
    : <Download testID={`reciter-download-icon-${status}`} size={20} color={muted ? colors.textMuted : status === 'none' ? colors.icon : colors.accent} />;

  const startDownload = async () => {
    const network = await deviceNetwork.current().catch(() => 'unknown' as const);
    if (network === 'wifi' || network === 'none') audioDownloads.start(reciter.id);
    else setConfirm('cellular');
  };
  const close = () => {
    setOpen(false);
    setConfirm(null);
  };

  let detail: string | null = null;
  if (job?.phase === 'running') {
    const percent = job.bytesTotal > 0 ? Math.floor((job.bytesDone / job.bytesTotal) * 100) : 0;
    detail = fill(copy.downloadProgress, { done: n(job.completed.length), total: n(job.surahs.length), percent: n(percent) });
  } else if (job?.phase === 'paused') {
    detail = fill(copy.downloadPaused, { done: n(job.completed.length), total: n(job.surahs.length) });
  } else if (status === 'error') {
    detail = job?.error === 'storage' ? copy.downloadErrorStorage : job?.error === 'verify' ? copy.downloadErrorVerify : copy.downloadErrorNetwork;
  } else if (status === 'complete') {
    detail = fill(copy.downloadComplete, { n: n(storedSurahs.length), size: size(mine?.bytes ?? 0) });
  } else if (status === 'partial') {
    detail = fill(copy.downloadPartial, { done: n(storedSurahs.length), total: n(timed.length) });
  }

  type Action = { key: string; label: string; kind: 'primary' | 'secondary' | 'danger'; onPress: () => void };
  const actions: Action[] = [];
  if (confirm === 'cellular') {
    actions.push({ key: 'download-anyway', label: copy.wifiConfirm, kind: 'primary', onPress: () => { setConfirm(null); audioDownloads.start(reciter.id); } });
  } else if (confirm === 'delete') {
    actions.push({ key: 'delete-confirm', label: copy.deleteConfirm, kind: 'danger', onPress: () => { setConfirm(null); void audioDownloads.remove(reciter.id); } });
  } else {
    if (permitted && (status === 'none' || status === 'partial')) actions.push({ key: 'download', label: status === 'none' ? copy.download : copy.resumeDownload, kind: 'primary', onPress: () => void startDownload() });
    if (status === 'downloading') actions.push({ key: 'pause', label: copy.pauseDownload, kind: 'secondary', onPress: () => audioDownloads.pause() });
    if (status === 'paused') actions.push({ key: 'resume', label: copy.resumeDownload, kind: 'primary', onPress: () => audioDownloads.resume() });
    if (status === 'downloading' || status === 'paused') actions.push({ key: 'cancel', label: copy.cancelDownload, kind: 'secondary', onPress: () => audioDownloads.cancel() });
    if (status === 'error' && permitted) actions.push({ key: 'retry', label: copy.retryDownload, kind: 'primary', onPress: () => void startDownload() });
    if (storedSurahs.length > 0 && status !== 'downloading' && status !== 'paused') actions.push({ key: 'delete', label: copy.deleteDownload, kind: 'danger', onPress: () => setConfirm('delete') });
  }

  return (
    <>
      <Pressable
        testID="settings-reciter-download"
        accessibilityRole="button"
        accessibilityLabel={`${copy.offlineTitle}: ${name}, ${stateLabel}`}
        accessibilityHint={copy.offlineManageHint}
        accessibilityState={{ busy: status === 'downloading', disabled: muted && storedSurahs.length === 0 }}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [styles.iconButton, muted && styles.muted, pressed && styles.pressed]}>
        {icon}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable testID="settings-reciter-download-backdrop" accessibilityLabel={copy.close} style={styles.backdrop} onPress={close} />
        <View testID="settings-reciter-download-sheet" accessibilityViewIsModal style={[styles.sheet, frame, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.offlineTitle}</Text>
          <Text style={[styles.reciter, direction]}>{name}</Text>
          {status === 'unavailable' ? (
            <Text style={[styles.body, direction]}>{fill(copy.offlineNothing, { reciter: name })}</Text>
          ) : (
            <Text style={[styles.body, direction]}>{fill(copy.offlineDescription, { reciter: name, n: n(timed.length), size: size(total) })}</Text>
          )}
          {status !== 'unavailable' && notIncluded.length > 0 && (
            <Text testID="settings-reciter-download-missing" style={[styles.note, direction]}>{fill(copy.offlineNotIncluded, { list: surahRanges(notIncluded, isRtl) })}</Text>
          )}
          {!permitted && status !== 'unavailable' && (
            <Text testID="settings-reciter-download-not-permitted" style={[styles.note, direction]}>{copy.offlineNotPermitted}</Text>
          )}
          {detail && <Text testID="settings-reciter-download-status" accessibilityLiveRegion="polite" style={[styles.status, status === 'error' && styles.statusError, direction]}>{detail}</Text>}
          {confirm === 'cellular' && <Text style={[styles.body, direction]}>{fill(copy.wifiBody, { size: size(total - (mine?.bytes ?? 0)) })}</Text>}
          {confirm === 'delete' && <Text style={[styles.body, direction]}>{fill(copy.deleteBody, { reciter: name, size: size(mine?.bytes ?? 0) })}</Text>}
          {stored.totalBytes > 0 && <Text testID="settings-reciter-download-total" style={[styles.note, direction]}>{fill(copy.storageTotal, { size: size(stored.totalBytes) })}</Text>}
          <View style={[styles.actions, isRtl && styles.actionsRtl]}>
            <Pressable testID="settings-reciter-download-close" accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>{confirm ? copy.wifiCancel : copy.close}</Text>
            </Pressable>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                testID={`settings-reciter-download-${action.key}`}
                accessibilityRole="button"
                onPress={action.onPress}
                style={({ pressed }) => [styles.button, action.kind === 'primary' ? styles.primary : action.kind === 'danger' ? styles.danger : styles.secondary, pressed && styles.pressed]}>
                <Text style={action.kind === 'primary' ? styles.primaryText : action.kind === 'danger' ? styles.dangerText : styles.secondaryText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

/** The icon as the offline Mushaf row's (a 24-pt box); the sheet as ConfirmSheet's. */
const makeStyles = (colors: Palette) => StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 36,
  },
  muted: {
    opacity: 0.6,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    bottom: 0,
    gap: spacing.sm,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    position: 'absolute',
    right: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 32,
  },
  reciter: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 24,
  },
  note: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  status: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  statusError: {
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.full,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primary: {
    backgroundColor: colors.primaryButton,
  },
  primaryText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  danger: {
    backgroundColor: colors.dangerFill,
  },
  dangerText: {
    color: colors.onDangerFill,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderWidth: 1,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
