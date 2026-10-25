import { BookOpen, Eye } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { useSheetFrameStyle } from '@/layout/useWindowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

import { memorizationLabels } from './labels';

type Props = {
  visible: boolean;
  onNormalGuide: () => void;
  onMemorizationGuide: () => void;
  onClose: () => void;
};

/**
 * Settings → Quran → Mushaf Guide, where Memorization Mode exists: which guide to open — the Mushaf's own guide
 * (unchanged) or the Memorization Mode Guide. A small bottom sheet in the app's palette and ConfirmSheet's design,
 * Light and Dark, mirrored in Arabic; Back, a tap outside or Cancel closes it without opening anything. Choosing
 * changes no setting and records nothing.
 */
export function MushafGuideChooser({ visible, onNormalGuide, onMemorizationGuide, onClose }: Props) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale } = useAppLocale();
  const labels = memorizationLabels(locale);
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  // Tablets: centred and width-capped (layout/windowClass.ts); phones: the full width.
  const frame = useSheetFrameStyle('absolute');
  const option = (testID: string, label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, rtl && styles.optionRtl, pressed && styles.pressed]}>
      {icon}
      <Text style={[styles.optionText, direction]}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable testID="settings-guide-chooser-backdrop" accessibilityLabel={labels.cancel} style={styles.backdrop} onPress={onClose} />
      <View testID="settings-guide-chooser" accessibilityViewIsModal style={[styles.sheet, frame, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text accessibilityRole="header" style={[styles.title, direction]}>{labels.guideChooserTitle}</Text>
        {option('settings-guide-normal', labels.normalGuide, <BookOpen size={20} color={colors.icon} strokeWidth={2} />, onNormalGuide)}
        {option('settings-guide-memorization', labels.memorizationGuide, <Eye size={20} color={colors.icon} strokeWidth={2} />, onMemorizationGuide)}
        <Pressable
          testID="settings-guide-chooser-cancel"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
          <Text style={styles.cancelText}>{labels.cancel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
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
    marginBottom: spacing.xs,
  },
  option: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  optionRtl: {
    flexDirection: 'row-reverse',
  },
  optionText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '700',
  },
  cancel: {
    alignItems: 'center',
    borderRadius: radii.full,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 50,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
