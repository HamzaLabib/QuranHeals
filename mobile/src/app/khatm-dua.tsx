import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { pageHeaderText, radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { DEFAULT_KHATM_DUA_SIZE, KHATM_DUA, KHATM_DUA_SIZES, type KhatmDuaText } from '@/mushaf/khatmDua';
import { KhatmDuaArch, KhatmDuaDivider, khatmDuaFrameColor } from '@/components/KhatmDuaOrnament';
import { usePalette, useThemedStyles, useThemeName } from '@/theme/useTheme';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

/**
 * The − / + text-size buttons: a compact 36-pt circle with a 16-pt icon in lucide's finer 1.75 stroke (was a 44-pt
 * circle and a 22-pt icon at 2). The hit slop keeps each one a full 44 × 44-pt touch target, and the row's 14-pt gap
 * keeps the two targets apart.
 */
const SIZE_BUTTON = 36;
const SIZE_ICON = 16;
const SIZE_ICON_STROKE = 1.75;
const SIZE_BUTTON_SLOP = (44 - SIZE_BUTTON) / 2;

/** Back to the reader's page 604: the reader is under this screen when it opened it; otherwise open it there. */
function backToPage604() {
  if (router.canGoBack()) router.back();
  else router.replace('/mushaf?page=604');
}

/**
 * دعاء ختم القرآن (/khatm-dua), opened from page 604 of the Mushaf reader.
 * Not Quran: no ayah markers, the system's Arabic font (not the Mushaf's).
 * The title and the du'a only, with no explanatory note (owner's decision,
 * 2026-10-13). Always right to left, in every app language. It has no
 * Khatma action and reads or writes no reading data: opening, reading or
 * leaving it never records a Khatma. A completed Khatma is confirmed only in
 * أورادي وختماتي (app/(tabs)/my-reading.tsx). The text is the owner-approved du'a (mushaf/khatmDua.ts),
 * shown exactly as approved; without a text the screen says it is not available.
 */
export default function KhatmDuaScreen({ dua = KHATM_DUA }: { dua?: KhatmDuaText | null }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const dark = useThemeName() === 'dark';
  const frameColor = khatmDuaFrameColor(dark);
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const copy = messages.khatmDua;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [sizeIndex, setSizeIndex] = useState<number>(DEFAULT_KHATM_DUA_SIZE);
  const size = KHATM_DUA_SIZES[sizeIndex];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.header, isRtl && styles.rowReverse]}>
        <Pressable
          testID="khatm-dua-back"
          accessibilityRole="button"
          accessibilityLabel={copy.back}
          onPress={backToPage604}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <BackIcon size={22} color={colors.icon} />
        </Pressable>
        <View style={styles.headerText}>
          {/* The title alone, in every app language: no subtitle or translation under it. */}
          <Text accessibilityRole="header" accessibilityLanguage="ar" style={[styles.title, styles.arabic]}>{dua?.title ?? copy.title}</Text>
        </View>
        {/* Balances the Back button so the title is centred on the screen. */}
        <View style={styles.headerSpacer} />
      </View>

      {dua ? (
        <ScrollView testID="khatm-dua-scroll" style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
          <View style={[styles.sizeRow, isRtl && styles.rowReverse]}>
            <Pressable
              testID="khatm-dua-smaller"
              accessibilityRole="button"
              accessibilityLabel={copy.smaller}
              accessibilityState={{ disabled: sizeIndex === 0 }}
              disabled={sizeIndex === 0}
              onPress={() => setSizeIndex((i) => Math.max(0, i - 1))}
              hitSlop={SIZE_BUTTON_SLOP}
              style={({ pressed }) => [styles.sizeButton, sizeIndex === 0 && styles.disabled, pressed && styles.pressed]}>
              <Minus size={SIZE_ICON} strokeWidth={SIZE_ICON_STROKE} color={colors.icon} />
            </Pressable>
            <Pressable
              testID="khatm-dua-larger"
              accessibilityRole="button"
              accessibilityLabel={copy.larger}
              accessibilityState={{ disabled: sizeIndex === KHATM_DUA_SIZES.length - 1 }}
              disabled={sizeIndex === KHATM_DUA_SIZES.length - 1}
              onPress={() => setSizeIndex((i) => Math.min(KHATM_DUA_SIZES.length - 1, i + 1))}
              hitSlop={SIZE_BUTTON_SLOP}
              style={({ pressed }) => [styles.sizeButton, sizeIndex === KHATM_DUA_SIZES.length - 1 && styles.disabled, pressed && styles.pressed]}>
              <Plus size={SIZE_ICON} strokeWidth={SIZE_ICON_STROKE} color={colors.icon} />
            </Pressable>
          </View>
          {/* A manuscript-style panel: a fine gold rule inside the card's edge, an arch over the du'a and a divider under it. Shapes only; the text is untouched. */}
          <View testID="khatm-dua-text" style={styles.duaCard}>
            <View testID="khatm-dua-frame" pointerEvents="none" style={[styles.innerFrame, { borderColor: frameColor }]} />
            <KhatmDuaArch dark={dark} card={colors.card} />
            {dua.paragraphs.map((paragraph, index) => (
              <Text key={index} testID={`khatm-dua-paragraph-${index}`} selectable accessibilityLanguage="ar" style={[styles.arabicRight, styles.dua, { fontSize: size, lineHeight: Math.round(size * 1.9) }]}>
                {paragraph}
              </Text>
            ))}
            <KhatmDuaDivider dark={dark} />
          </View>
        </ScrollView>
      ) : (
        <View style={styles.unavailable}>
          <Text testID="khatm-dua-unavailable" style={[styles.note, direction]}>{copy.unavailable}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  headerText: pageHeaderText(colors).block,
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerSpacer: {
    width: 48,
  },
  title: {
    ...pageHeaderText(colors).title,
    // Room above and below for the vowel marks, so none is clipped.
    lineHeight: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  note: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 22,
  },
  sizeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  sizeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: SIZE_BUTTON,
    justifyContent: 'center',
    width: SIZE_BUTTON,
  },
  duaCard: {
    // A comfortable reading measure on iPad; full width on phones.
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    // A clear pause between paragraphs, wider than the lines' own spacing.
    gap: spacing.xl,
    maxWidth: 720,
    paddingBottom: spacing.xl,
    // Clear of the inner gold rule (inset 6) on both sides.
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    width: '100%',
  },
  // Out of the layout (absolute): a second, fine rule just inside the card's edge, as on a manuscript page.
  // Softened gold (it has no content, so opacity affects only the rule): it frames the text without competing with it.
  innerFrame: {
    borderRadius: radii.lg - 4,
    borderWidth: 1,
    bottom: 6,
    left: 6,
    opacity: 0.45,
    position: 'absolute',
    right: 6,
    top: 6,
  },
  // The title is Arabic in every app language: right to left, centred.
  arabic: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  // The du'a's paragraphs: right to left and right-aligned in every app language. The app never
  // flips layout globally (I18nManager), so 'right' is always the physical right edge.
  arabicRight: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dua: {
    color: colors.textPrimary,
  },
  unavailable: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
