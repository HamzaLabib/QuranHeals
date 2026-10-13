import { router, useLocalSearchParams } from 'expo-router';
import { AArrowDown, AArrowUp, ArrowLeft, ArrowRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { fill } from '@/localization/fill';
import { DEFAULT_KHATM_DUA_SIZE, KHATM_DUA, KHATM_DUA_SIZES, type KhatmDuaText } from '@/mushaf/khatmDua';
import { confirmKhatma, loadReadingData, type Wird } from '@/mushaf/khatmas';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

/** Back to the reader's page 604: the reader is under this screen when it opened it; otherwise open it there. */
function backToPage604() {
  if (router.canGoBack()) router.back();
  else router.replace('/mushaf?page=604');
}

/**
 * دعاء ختم القرآن (/khatm-dua), opened from page 604 of the Mushaf reader.
 * Optional, and not Quran: no ayah markers, the system's Arabic font (not the
 * Mushaf's), and a note saying what it is. Always right to left, in every app
 * language. Reading it records nothing. Opened for a ورد whose completion
 * awaits confirmation (?wird=<id>, from أورادي وختماتي), it also offers
 * تأكيد إتمام الختمة: a separate, deliberate tap, never implied by opening,
 * reading or scrolling. The text itself is empty until a verified version is
 * approved (mushaf/khatmDua.ts); the screen then says it is not available yet.
 */
export default function KhatmDuaScreen({ dua = KHATM_DUA }: { dua?: KhatmDuaText | null }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const copy = messages.khatmDua;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [sizeIndex, setSizeIndex] = useState<number>(DEFAULT_KHATM_DUA_SIZE);
  const size = KHATM_DUA_SIZES[sizeIndex];
  const params = useLocalSearchParams<{ wird?: string }>();
  // Only a ورد that is really pending (a save took it to page 604) is offered; anything else shows nothing.
  const [pending, setPending] = useState<Wird | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const confirmingRef = useRef(false);
  useEffect(() => {
    if (!params.wird) return undefined;
    let cancelled = false;
    void loadReadingData()
      .then((data) => {
        if (!cancelled) setPending(data.wirds.find((w) => w.stop.id === params.wird && w.status === 'pending') ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.wird]);
  const confirm = async () => {
    if (!pending || confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmFailed(false);
    try {
      const { record } = await confirmKhatma(pending.stop.id, pending.cycle.id);
      setPending(null);
      router.replace({ pathname: '/khatma-complete', params: { id: record.id } });
    } catch {
      setConfirmFailed(true);
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  };
  const confirmBlock = pending ? (
    <View testID="khatm-dua-khatma" style={styles.confirmCard}>
      <Text style={[styles.note, direction]}>{fill(copy.confirmFor, { name: pending.stop.name })}</Text>
      {confirmFailed && <Text accessibilityRole="alert" style={[styles.error, direction]}>{messages.khatma.failed}</Text>}
      <Pressable
        testID="khatm-dua-confirm-khatma"
        accessibilityRole="button"
        accessibilityState={{ disabled: confirming, busy: confirming }}
        disabled={confirming}
        onPress={() => void confirm()}
        style={({ pressed }) => [styles.confirmButton, confirming && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.confirmText}>{copy.confirm}</Text>
      </Pressable>
    </View>
  ) : null;

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
          <Text accessibilityRole="header" style={[styles.title, styles.arabic]}>{copy.title}</Text>
          {copy.subtitle !== copy.title && <Text style={[styles.subtitle, direction]}>{copy.subtitle}</Text>}
        </View>
      </View>

      {dua ? (
        <ScrollView testID="khatm-dua-scroll" style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
          <Text testID="khatm-dua-note" style={[styles.note, direction]}>{copy.note}</Text>
          <View style={[styles.sizeRow, isRtl && styles.rowReverse]}>
            <Pressable
              testID="khatm-dua-smaller"
              accessibilityRole="button"
              accessibilityLabel={copy.smaller}
              accessibilityState={{ disabled: sizeIndex === 0 }}
              disabled={sizeIndex === 0}
              onPress={() => setSizeIndex((i) => Math.max(0, i - 1))}
              style={({ pressed }) => [styles.sizeButton, sizeIndex === 0 && styles.disabled, pressed && styles.pressed]}>
              <AArrowDown size={22} color={colors.icon} />
            </Pressable>
            <Pressable
              testID="khatm-dua-larger"
              accessibilityRole="button"
              accessibilityLabel={copy.larger}
              accessibilityState={{ disabled: sizeIndex === KHATM_DUA_SIZES.length - 1 }}
              disabled={sizeIndex === KHATM_DUA_SIZES.length - 1}
              onPress={() => setSizeIndex((i) => Math.min(KHATM_DUA_SIZES.length - 1, i + 1))}
              style={({ pressed }) => [styles.sizeButton, sizeIndex === KHATM_DUA_SIZES.length - 1 && styles.disabled, pressed && styles.pressed]}>
              <AArrowUp size={22} color={colors.icon} />
            </Pressable>
          </View>
          <View testID="khatm-dua-text" style={styles.duaCard}>
            {dua.paragraphs.map((paragraph, index) => (
              <Text key={index} testID={`khatm-dua-paragraph-${index}`} selectable style={[styles.arabic, styles.dua, { fontSize: size, lineHeight: Math.round(size * 1.9) }]}>
                {paragraph}
              </Text>
            ))}
          </View>
          <Text testID="khatm-dua-source" style={[styles.source, direction]}>{`${copy.sourceLabel}: ${dua.source}`}</Text>
          {confirmBlock}
        </ScrollView>
      ) : (
        <View style={styles.unavailable}>
          <Text testID="khatm-dua-unavailable" style={[styles.note, direction]}>{copy.unavailable}</Text>
          {confirmBlock}
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
  headerText: {
    flex: 1,
    gap: 2,
  },
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
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.body,
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
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  sizeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  duaCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  // The du'a is Arabic in every app language: right to left, centred like the printed pages.
  arabic: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  dua: {
    color: colors.textPrimary,
  },
  source: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  unavailable: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  confirmCard: {
    backgroundColor: colors.sageSurface,
    borderColor: colors.sageBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.full,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  confirmText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
