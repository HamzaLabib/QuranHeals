import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, type Palette } from '@/constants/theme';
import { useThemedStyles } from '@/theme/useTheme';
import {
  computeCompactQuranFontSize,
  computeQuranLineHeight,
  countArabicWords,
} from '@/localization/quranFontSizePreference';
import { resolveAyahTranslationDisplay } from '@/localization/quranTranslationPreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';
import { useQuranTranslationDisplayMode } from '@/localization/useQuranTranslationPreference';
import { getDirectionStyle } from '@/localization/locales';
import { ayahTranslationLookup, type AyahTranslation as LoadedTranslation } from '@/services/ayahTranslationLookup';
import { AyahTranslation, makeAyahTranslationStyles } from './AyahTranslation';

export type ReflectionTranslationState = ReturnType<typeof useReflectionTranslation>;

/**
 * The translation for one reflection's ayah, shown by Saved Ayahs' rule (resolveAyahTranslationDisplay, compact):
 * Show Translation OFF → none and no button (and nothing is fetched); ON → hidden with Show / Hide translation; not
 * loaded or unavailable → nothing in its place. Resolved from the reflection's verseKey alone, so every reflection —
 * including ones saved before translations appeared here — gets it without changing what is stored.
 *
 * `initialRevealed`: the list card's toggle carried into the opened reflection. `retryKey`: changes on pull-to-refresh
 * so a translation that couldn't load (offline) is tried again. `skip`: nothing shown (the reflection window opened over
 * an ayah already on screen), so nothing is fetched.
 */
export function useReflectionTranslation(
  verseKey: string,
  { initialRevealed = null, retryKey = 0, skip = false }: { initialRevealed?: boolean | null; retryKey?: number; skip?: boolean } = {},
) {
  const { messages } = useAppLocale();
  const displayMode = useQuranTranslationDisplayMode();
  const enabled = !skip && displayMode !== 'off';
  const [loaded, setLoaded] = useState<{ verseKey: string; translation: LoadedTranslation | null } | null>(null);
  const translation = (loaded?.verseKey === verseKey ? loaded.translation : null) ?? ayahTranslationLookup.peek(verseKey);
  const [toggledRevealed, setToggledRevealed] = useState<boolean | null>(initialRevealed);

  useEffect(() => {
    if (!enabled || translation) return;
    let cancelled = false;
    void ayahTranslationLookup.load(verseKey).then((result) => {
      if (!cancelled) setLoaded({ verseKey, translation: result });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, translation, verseKey, retryKey]);

  const display = resolveAyahTranslationDisplay(displayMode, { compact: true, toggledRevealed, unavailable: translation === null });
  return {
    translation,
    ...display,
    toggleLabel: display.isRevealed ? messages.translation.hideTranslation : messages.translation.showTranslation,
    toggle: () => setToggledRevealed(!display.isRevealed),
  };
}

type ReflectionAyahProps = {
  /** The verified local Arabic, or null when this verseKey couldn't be resolved on the device. */
  arabicText: string | null;
  translation: ReflectionTranslationState;
  /** My Reflections' list: two lines of Arabic and of translation, and a small text toggle. Otherwise the full ayah. */
  preview?: boolean;
  /** The opened reflection's colours (they may be the Mushaf reader's); the app palette otherwise. */
  colors?: Palette;
};

/**
 * A reflection's ayah: the Arabic first, its translation directly underneath (AyahTranslation, the markup Saved Ayahs
 * uses, at Saved Ayahs' compact sizes). The person's reflection is drawn by the caller, in its own section below.
 */
export function ReflectionAyah({ arabicText, translation, preview = false, colors: override }: ReflectionAyahProps) {
  const themedStyles = useThemedStyles(makeStyles);
  const themedTranslationStyles = useThemedStyles(makeAyahTranslationStyles);
  const styles = useMemo(() => (override ? makeStyles(override) : themedStyles), [override, themedStyles]);
  const translationStyles = useMemo(() => (override ? makeAyahTranslationStyles(override) : themedTranslationStyles), [override, themedTranslationStyles]);
  const { locale, messages } = useAppLocale();
  const { preferredSize } = useQuranFontSizePreference();
  const wordCount = arabicText ? countArabicWords(arabicText) : 0;
  const arabicFontSize = computeCompactQuranFontSize(preferredSize, wordCount);
  const arabicLineHeight = computeQuranLineHeight(arabicFontSize);

  return (
    <View style={preview ? styles.previewBlock : styles.block}>
      {arabicText ? (
        <Text numberOfLines={preview ? 2 : undefined} style={[styles.arabic, { fontSize: arabicFontSize, lineHeight: arabicLineHeight }]}>
          {arabicText}
        </Text>
      ) : (
        <Text style={[styles.unresolvedNote, getDirectionStyle(locale)]}>{messages.reflections.referenceUnresolved}</Text>
      )}
      {/* Only under its verified Arabic: never a translation standing in for an ayah the device couldn't resolve. */}
      {arabicText && translation.translation && (
        <AyahTranslation
          text={translation.translation.text}
          source={translation.translation.source}
          showTranslation={translation.showTranslation}
          showToggleControl={translation.showToggleControl}
          toggleLabel={translation.toggleLabel}
          onToggle={translation.toggle}
          compact
          preview={preview}
          styles={translationStyles}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  previewBlock: {
    gap: spacing.sm,
  },
  arabic: {
    color: colors.textPrimary,
    fontWeight: '600',
    letterSpacing: 0,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  unresolvedNote: {
    color: colors.danger,
    fontSize: typography.caption,
    lineHeight: 18,
  },
});
