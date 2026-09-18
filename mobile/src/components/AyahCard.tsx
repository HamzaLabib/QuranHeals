import * as Clipboard from 'expo-clipboard';
import { ArrowUpRight, Check, Copy } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import {
  computeCompactQuranFontSize,
  computeMainQuranFontSize,
  computeQuranLineHeight,
  countArabicWords,
} from '@/localization/quranFontSizePreference';
import { resolveTranslationVisibility } from '@/localization/quranTranslationPreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { Ayah } from '@/types/domain';
import { formatAyahReference } from '@/utils/ayahReference';
import { buildTanzilAyahUrl } from '@/utils/tanzilLink';
import { QuranFontSizeControls } from './QuranFontSizeControls';

type AyahCardProps = {
  ayah: Ayah;
  compact?: boolean;
};

// How long the copy icon is replaced by a checkmark after a successful copy.
const COPY_CONFIRMATION_MS = 1300;

/**
 * Quran Arabic is always shown — the translation `displayMode` setting
 * (`always` | `on-demand` | `off`) never hides it. Only the English
 * Pickthall translation's visibility is governed by that setting.
 * "Revealed on this ayah" (`on-demand` mode) is local, per-card state keyed
 * to `ayah.id` — it resets automatically whenever a different ayah is
 * shown (new `AyahCard` render for that id), and is never written to the
 * persisted global preference. In `on-demand` mode this is a proper
 * show/hide toggle (not a one-way reveal): pressing the control flips
 * between hidden ("Show translation") and visible ("Hide translation").
 */
export function AyahCard({ ayah, compact = false }: AyahCardProps) {
  const { messages } = useAppLocale();
  const { preference } = useQuranTranslationPreference();
  const { preferredSize } = useQuranFontSizePreference();
  const [revealedAyahId, setRevealedAyahId] = useState<string | null>(null);
  const [trackedAyahId, setTrackedAyahId] = useState(ayah.id);
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different ayah loaded: reset the on-demand reveal state and any
  // leftover "copied" confirmation from the previous ayah. Adjusting state
  // directly during render (rather than in an effect) avoids an extra
  // commit/cascading-render pass — see https://react.dev/learn/you-might-not-need-an-effect.
  if (trackedAyahId !== ayah.id) {
    setTrackedAyahId(ayah.id);
    setRevealedAyahId(null);
    setIsCopied(false);
  }

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
    };
  }, []);

  const isRevealed = revealedAyahId === ayah.id;
  const { showTranslation, showToggleControl } = resolveTranslationVisibility(preference.displayMode, isRevealed);
  const toggleLabel = isRevealed ? messages.translation.hideTranslation : messages.translation.showTranslation;

  // Each ayah calculates its own automatic length adjustment from its own
  // word count — never a value cached/shared across different ayahs.
  const wordCount = useMemo(() => countArabicWords(ayah.arabicText), [ayah.arabicText]);
  const arabicFontSize = compact ? computeCompactQuranFontSize(preferredSize, wordCount) : computeMainQuranFontSize(preferredSize, wordCount);
  const arabicLineHeight = computeQuranLineHeight(arabicFontSize);

  const tanzilAyahUrl = buildTanzilAyahUrl(ayah.surahNumber, ayah.ayahNumber);
  const openInTanzil = () => {
    if (!tanzilAyahUrl) return;
    Linking.openURL(tanzilAyahUrl).catch(() => {
      // Best-effort external link: an unavailable browser must not crash the card.
    });
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={messages.ayah.copyAyah}
          onPress={() => void copyAyahText()}
          hitSlop={8}
          style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
          {isCopied ? <Check size={18} color={colors.olive} /> : <Copy size={18} color={colors.ink} />}
        </Pressable>
      </View>

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
          accessibilityState={{ disabled: !tanzilAyahUrl }}
          disabled={!tanzilAyahUrl}
          onPress={openInTanzil}
          style={({ pressed }) => [styles.referenceLink, pressed && styles.pressed]}>
          <Text style={styles.reference}>{formatAyahReference(ayah.surahNumber, ayah.ayahNumber)}</Text>
          {tanzilAyahUrl && <ArrowUpRight size={16} color={colors.olive} accessible={false} />}
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
          onPress={() => setRevealedAyahId(isRevealed ? null : ayah.id)}
          style={({ pressed }) => [styles.revealButton, pressed && styles.pressed]}>
          <Text style={styles.revealButtonText}>{toggleLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
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
    color: colors.ink,
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
    color: colors.ink,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
  },
  compactTranslation: {
    fontSize: typography.body,
    lineHeight: 24,
  },
  revealButton: {
    alignItems: 'center',
    backgroundColor: colors.oliveWash,
    borderRadius: radii.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  revealButtonText: {
    color: colors.olive,
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
  copyButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  referenceRow: {
    borderTopColor: colors.border,
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
    color: colors.olive,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '800',
    // Explicit, not incidental: pins the visual order to
    // English -> number -> Arabic regardless of the app's current locale
    // direction — see formatAyahReference's doc comment.
    writingDirection: 'ltr',
  },
  source: {
    color: colors.softText,
    fontSize: 11,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.78,
  },
});
