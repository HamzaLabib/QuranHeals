import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { resolveTranslationVisibility } from '@/localization/quranTranslationPreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { Ayah } from '@/types/domain';

type AyahCardProps = {
  ayah: Ayah;
  compact?: boolean;
};

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
  const [revealedAyahId, setRevealedAyahId] = useState<string | null>(null);
  const [trackedAyahId, setTrackedAyahId] = useState(ayah.id);

  // A different ayah loaded: reset the on-demand reveal state. Adjusting
  // state directly during render (rather than in an effect) avoids an extra
  // commit/cascading-render pass — see https://react.dev/learn/you-might-not-need-an-effect.
  if (trackedAyahId !== ayah.id) {
    setTrackedAyahId(ayah.id);
    setRevealedAyahId(null);
  }

  const isRevealed = revealedAyahId === ayah.id;
  const { showTranslation, showToggleControl } = resolveTranslationVisibility(preference.displayMode, isRevealed);
  const toggleLabel = isRevealed ? messages.translation.hideTranslation : messages.translation.showTranslation;

  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <Text style={[styles.arabic, compact && styles.compactArabic]}>{ayah.arabicText}</Text>

      <View style={styles.referenceRow}>
        <Text style={styles.reference}>
          {ayah.surahNameEnglish} • {ayah.surahNumber}:{ayah.ayahNumber}
        </Text>
        <Text accessibilityRole="link" onPress={() => void Linking.openURL('https://tanzil.net')} style={styles.source}>
          Quran text: Tanzil · Uthmani 1.1
        </Text>
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
    fontSize: typography.arabic,
    fontWeight: '600',
    letterSpacing: 0,
    // Ratio 1.6 — still generous headroom so harakat/tashkeel above and
    // below each letter never clip against the line box (Arabic diacritics
    // need more vertical clearance than Latin ascenders/descenders).
    lineHeight: 48,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  compactArabic: {
    fontSize: 23,
    lineHeight: 36,
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
  referenceRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  reference: {
    color: colors.olive,
    fontSize: typography.body,
    fontWeight: '800',
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
