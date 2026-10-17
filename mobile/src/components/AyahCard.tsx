import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ArrowUpRight, Check, Copy } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import {
  computeCompactQuranFontSize,
  computeMainQuranFontSize,
  computeQuranLineHeight,
  countArabicWords,
} from '@/localization/quranFontSizePreference';
import { AYAH_SCREEN_TRANSLATION_MODE, resolveTranslationVisibility } from '@/localization/quranTranslationPreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';
import { useQuranTranslationDisplayMode } from '@/localization/useQuranTranslationPreference';
import type { Ayah } from '@/types/domain';
import { formatAyahReference } from '@/utils/ayahReference';
import { translationPending } from '@/services/ayahTranslation';
import { mushafRouteForAyah } from '@/mushaf/ayahInMushaf';
import { isRtlLocale } from '@/localization/locales';
import { AyahAudioButton, type AyahAudioProblem } from './AyahAudioButton';
import { QuranFontSizeControls } from './QuranFontSizeControls';

type AyahCardProps = {
  ayah: Ayah;
  compact?: boolean;
};

// How long the copy icon is replaced by a checkmark after a successful copy.
const COPY_CONFIRMATION_MS = 1300;

/**
 * Quran Arabic is always shown. The English Pickthall translation (with its
 * attribution) follows Settings → Show Translation (the stored display mode,
 * quranTranslationPreference.ts):
 *  - OFF ('off'): never shown, and no Show translation button;
 *  - ON + On Demand ('on-demand'): hidden, with the Show / Hide translation
 *    toggle (AYAH_SCREEN_TRANSLATION_MODE);
 *  - ON + Always ('always'): shown at once, with the toggle to hide it for
 *    this ayah; the next ayah is shown again.
 * The compact card (Favorites) follows OFF, and otherwise always starts hidden
 * with the toggle, as before. Outside the preference provider (a card rendered
 * alone) it behaves as On Demand.
 *
 * The reader's toggle is local, per-card state keyed to `ayah.id`: it resets
 * whenever a different ayah is shown, and is never written to the persisted
 * global preference.
 */
export function AyahCard({ ayah, compact = false }: AyahCardProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const { preferredSize } = useQuranFontSizePreference();
  const displayMode = useQuranTranslationDisplayMode();
  // Set only once the reader taps the toggle on this ayah; until then the Show Translation setting decides.
  const [toggled, setToggled] = useState<{ ayahId: string; revealed: boolean } | null>(null);
  const [trackedAyahId, setTrackedAyahId] = useState(ayah.id);
  const [isCopied, setIsCopied] = useState(false);
  // The play button's message (no verified recording by the Favorite Reciter, network), shown under the controls.
  const [audioProblem, setAudioProblem] = useState<AyahAudioProblem>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different ayah loaded: reset the on-demand reveal state and any
  // leftover "copied" confirmation from the previous ayah. Adjusting state
  // directly during render (rather than in an effect) avoids an extra
  // commit/cascading-render pass — see https://react.dev/learn/you-might-not-need-an-effect.
  if (trackedAyahId !== ayah.id) {
    setTrackedAyahId(ayah.id);
    setToggled(null);
    setIsCopied(false);
    setAudioProblem(null);
  }

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
    };
  }, []);

  const translationOff = displayMode === 'off';
  const startsRevealed = !compact && displayMode === 'always';
  const isRevealed = toggled?.ayahId === ayah.id ? toggled.revealed : startsRevealed;
  const visibility = resolveTranslationVisibility(AYAH_SCREEN_TRANSLATION_MODE, isRevealed);
  // Show Translation OFF: neither the translation nor its button. Nor while an ayah saved offline still waits for its
  // translation (services/ayahForAction.ts): nothing is shown in its place, never an empty block.
  const noTranslation = translationOff || translationPending(ayah);
  const showTranslation = !noTranslation && visibility.showTranslation;
  const showToggleControl = !noTranslation && visibility.showToggleControl;
  const toggleLabel = isRevealed ? messages.translation.hideTranslation : messages.translation.showTranslation;

  // Each ayah calculates its own automatic length adjustment from its own
  // word count — never a value cached/shared across different ayahs.
  const wordCount = useMemo(() => countArabicWords(ayah.arabicText), [ayah.arabicText]);
  const arabicFontSize = compact ? computeCompactQuranFontSize(preferredSize, wordCount) : computeMainQuranFontSize(preferredSize, wordCount);
  const arabicLineHeight = computeQuranLineHeight(arabicFontSize);

  // The reference opens this exact ayah in the app's own Mushaf (its page, the ayah selected), never a website.
  const mushafRoute = mushafRouteForAyah(ayah.surahNumber, ayah.ayahNumber);
  const openInMushaf = () => {
    const route = mushafRouteForAyah(ayah.surahNumber, ayah.ayahNumber);
    if (route) router.navigate(route);
  };

  const copyAyahText = async () => {
    // Arabic ayah text + Surah/ayah reference only — never the translation,
    // never invoked automatically.
    const text = `${ayah.arabicText}\n\n${formatAyahReference(ayah.surahNumber, ayah.ayahNumber)}`;
    try {
      const succeeded = await Clipboard.setStringAsync(text);
      if (!succeeded) return;
      setIsCopied(true);
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = setTimeout(() => setIsCopied(false), COPY_CONFIRMATION_MS);
    } catch {
      // Best-effort: clipboard access failed (permissions, platform quirk) —
      // never crashes the screen, and never shows a false success state.
    }
  };

  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <Text style={[styles.arabic, { fontSize: arabicFontSize, lineHeight: arabicLineHeight }]}>{ayah.arabicText}</Text>

      {/* Left: A-/A+ font-size controls. Right: copy icon. This physical
          order is fixed in every app language — it never reverses for RTL
          locales (Arabic/Egyptian Arabic), matching the reference line
          below. Rendered for both the main (non-compact) card and
          Favorites' compact card, unlike the font-size controls, which
          remain main-screen only. */}
      <View style={styles.controlsRow}>
        <View style={styles.controlsLeft}>{!compact && <QuranFontSizeControls />}</View>
        <View style={styles.controlsRight}>
        {/* The ayah screens (not Favorites' compact cards): play this ayah once in the Favorite Reciter, beside Copy. */}
        {!compact && (
          <AyahAudioButton
            surah={ayah.surahNumber}
            ayah={ayah.ayahNumber}
            copy={messages.audio}
            rtl={isRtlLocale(locale)}
            color={colors.icon}
            accent={colors.accent}
            onProblem={setAudioProblem}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={messages.ayah.copyAyah}
          onPress={() => void copyAyahText()}
          hitSlop={8}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
          {isCopied ? <Check size={18} color={colors.accent} /> : <Copy size={18} color={colors.icon} />}
        </Pressable>
        </View>
      </View>
      {!compact && audioProblem && (
        <Text testID="ayah-audio-problem" accessibilityLiveRegion="polite" style={[styles.audioProblem, isRtlLocale(locale) && styles.audioProblemRtl]}>{audioProblem}</Text>
      )}

      <View style={styles.referenceRow}>
        {/* Always "English Surah name · Surah:Ayah · Arabic Surah name", in
            that exact order, in every app language — writingDirection is
            forced to 'ltr' here regardless of the current app locale so an
            RTL context (Arabic/Egyptian Arabic) can never reorder the three
            segments; the Arabic name itself still renders correctly as an
            embedded RTL run within that fixed LTR ordering. */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${messages.ayah.readInQuran}: ${formatAyahReference(ayah.surahNumber, ayah.ayahNumber)}`}
          accessibilityState={{ disabled: !mushafRoute }}
          disabled={!mushafRoute}
          onPress={openInMushaf}
          style={({ pressed }) => [styles.referenceLink, pressed && styles.pressed]}>
          <Text style={styles.reference}>{formatAyahReference(ayah.surahNumber, ayah.ayahNumber)}</Text>
          {mushafRoute && <ArrowUpRight size={16} color={colors.accent} />}
        </Pressable>
        <Text style={styles.source}>Quran text: Tanzil · Uthmani 1.1</Text>
      </View>

      {showTranslation && (
        <View style={styles.translationBlock}>
          <Text style={[styles.translation, compact && styles.compactTranslation]}>{ayah.englishTranslation}</Text>
          <Text style={styles.source}>{ayah.translationSource}</Text>
        </View>
      )}

      {showToggleControl && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          onPress={() => setToggled({ ayahId: ayah.id, revealed: !isRevealed })}
          style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}>
          <Text style={styles.revealButtonText}>{toggleLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    ...shadows.soft,
  },
  compactCard: {
    borderRadius: radii.md,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  arabic: {
    color: colors.textPrimary,
    fontWeight: '600',
    letterSpacing: 0,
    // fontSize/lineHeight are computed per-render (preferred size + automatic
    // length adjustment) — see computeMainQuranFontSize/computeCompactQuranFontSize
    // and computeQuranLineHeight in quranFontSizePreference.ts.
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  translationBlock: {
    gap: spacing.xs,
  },
  translation: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
  },
  compactTranslation: {
    fontSize: typography.body,
    lineHeight: 24,
  },
  revealButton: {
    alignItems: 'center',
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  revealButtonText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  controlsLeft: {
    flexDirection: 'row',
  },
  controlsRight: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  audioProblem: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: -spacing.sm,
    textAlign: 'left',
  },
  audioProblemRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  copyButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  referenceRow: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  referenceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  reference: {
    color: colors.accent,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '800',
    // Explicit, not incidental: pins the visual order to
    // English -> number -> Arabic regardless of the app's current locale
    // direction — see formatAyahReference's doc comment.
    writingDirection: 'ltr',
  },
  source: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.78,
  },
});
