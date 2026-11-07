import { Check, CircleAlert, Download, Lock } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { fill } from '@/localization/fill';
import type { TafsirEditionId, TafsirEditionInfo } from '@/tafsir/editions';
import type { TafsirLabels } from '@/tafsir/labels';
import type { TafsirEditionState, TafsirLibrarySnapshot } from '@/tafsir/library';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

/** "2.4 MB" (one decimal below 10 MB), in the app language's digits. */
export function formatMegabytes(bytes: number, digits: (text: string) => string): string {
  const mb = bytes / (1024 * 1024);
  return `${digits(mb < 10 ? mb.toFixed(1) : String(Math.round(mb)))} MB`;
}

/**
 * The four editions, in their fixed order, as a 2 × 2 grid at the top of the reader (right to left in Arabic). Each
 * card names the work and says where it stands: Reading (selected), On this device, Download · size, Downloading n%,
 * Checking…, Download failed · Retry, or Not available yet (disabled). A tap reads a ready edition, or downloads one.
 */
export function TafsirEditionSelector({ editions, states, selected, labels, rtl, digits, onSelect, onDownload }: {
  editions: readonly TafsirEditionInfo[];
  states: TafsirLibrarySnapshot;
  selected: TafsirEditionId | null;
  labels: TafsirLabels;
  rtl: boolean;
  digits: (text: string) => string;
  onSelect: (id: TafsirEditionId) => void;
  onDownload: (id: TafsirEditionId) => void;
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={labels.chooseEdition} style={[styles.grid, rtl && styles.gridRtl]}>
      {editions.map((edition) => {
        const state = states[edition.id];
        const isSelected = selected === edition.id && state.kind === 'ready';
        const status = statusText(state, isSelected, edition, labels, digits);
        const disabled = state.kind === 'unavailable' || state.kind === 'downloading' || state.kind === 'verifying';
        const hint = state.kind === 'unavailable' ? labels.unavailableHint : state.kind === 'ready' ? labels.selectHint : labels.downloadHint;
        return (
          <Pressable
            key={edition.id}
            testID={`tafsir-edition-${edition.id}`}
            accessibilityRole="radio"
            accessibilityLabel={`${edition.title}, ${status}`}
            accessibilityHint={hint}
            accessibilityState={{ selected: isSelected, disabled, busy: state.kind === 'downloading' || state.kind === 'verifying' }}
            disabled={disabled}
            onPress={() => (state.kind === 'ready' ? onSelect(edition.id) : onDownload(edition.id))}
            style={({ pressed }) => [
              styles.card,
              isSelected && styles.cardSelected,
              state.kind === 'unavailable' && styles.cardUnavailable,
              pressed && styles.pressed,
            ]}>
            <Text numberOfLines={1} style={[styles.title, isSelected && styles.titleSelected, styles.arabicTitle]}>{edition.title}</Text>
            <View style={[styles.statusRow, rtl && styles.gridRtl]}>
              <StatusIcon state={state} selected={isSelected} colors={colors} />
              <Text testID={`tafsir-edition-${edition.id}-status`} numberOfLines={1} style={[styles.status, state.kind === 'failed' && styles.statusFailed, align]}>{status}</Text>
            </View>
            {(state.kind === 'downloading') && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round((state.progress ?? 0) * 100)}%` }, rtl && styles.progressRtl]} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function statusText(state: TafsirEditionState, selected: boolean, edition: TafsirEditionInfo, labels: TafsirLabels, digits: (text: string) => string): string {
  switch (state.kind) {
    case 'ready':
      return selected ? labels.selected : labels.ready;
    case 'notDownloaded':
      return edition.pin ? fill(labels.downloadSize, { size: formatMegabytes(edition.pin.bytes, digits) }) : labels.download;
    case 'downloading':
      return fill(labels.downloading, { percent: digits(String(Math.round((state.progress ?? 0) * 100))) });
    case 'verifying':
      return labels.verifying;
    case 'failed':
      return `${labels.failed} · ${labels.retry}`;
    case 'unavailable':
      return labels.unavailable;
  }
}

function StatusIcon({ state, selected, colors }: { state: TafsirEditionState; selected: boolean; colors: Palette }) {
  if (state.kind === 'downloading' || state.kind === 'verifying') return <ActivityIndicator size="small" color={colors.accent} />;
  if (state.kind === 'ready') return <Check size={14} color={selected ? colors.accent : colors.textMuted} />;
  if (state.kind === 'failed') return <CircleAlert size={14} color={colors.danger} />;
  if (state.kind === 'unavailable') return <Lock size={13} color={colors.textMuted} />;
  return <Download size={14} color={colors.accent} />;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridRtl: {
    flexDirection: 'row-reverse',
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  cardSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  cardUnavailable: {
    opacity: 0.6,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  // The works' Arabic titles, always right to left.
  arabicTitle: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  titleSelected: {
    color: colors.accent,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  status: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: typography.small,
  },
  statusFailed: {
    color: colors.danger,
  },
  progressTrack: {
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 3,
    marginTop: 2,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: 3,
  },
  progressRtl: {
    alignSelf: 'flex-end',
  },
  pressed: {
    opacity: 0.78,
  },
});
