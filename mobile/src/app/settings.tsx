import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { AccountSection } from '@/components/AccountSection';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { APP_LOCALES, APP_LOCALE_DISPLAY_NAMES, getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

const TRANSLATION_DISPLAY_MODES: readonly TranslationDisplayMode[] = ['always', 'on-demand', 'off'];

export default function SettingsScreen() {
  const { locale, setLocale, messages } = useAppLocale();
  const { preference, setDisplayMode } = useQuranTranslationPreference();
  const { refreshSync } = useAuth();
  const direction = getDirectionStyle(locale);
  // A "back" arrow should point toward where the previous screen visually
  // is — the right in RTL reading order, the left in LTR.
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  // Guards a rapid repeated pull gesture the same way Home/Favorites do —
  // see pullToRefresh.ts's doc comment for why this needs a ref, not just
  // the `isRefreshing` state below.
  const refreshGuardRef = useRef<RefreshInFlightRef>({ current: false });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onPullToRefresh = useCallback(async () => {
    await runGuardedRefresh(refreshGuardRef.current, async () => {
      setIsRefreshing(true);
      try {
        // Reuses the exact same account sync used everywhere else (a no-op
        // for a guest) — never a duplicate preference-sync implementation.
        // Preferences already flow through runFullSync's
        // reconcilePreferencesOnSignIn, which applies any account-side
        // locale/translation-display change via the exact setLocale/
        // setDisplayMode above (through AuthProvider's
        // applyPreferencesLocally) — both are shared context state, so this
        // screen re-renders with the synced values automatically; no
        // separate local re-read is needed here.
        await refreshSync();
      } finally {
        setIsRefreshing(false);
      }
    });
  }, [refreshSync]);

  const translationModeLabel: Record<TranslationDisplayMode, string> = {
    always: messages.settings.translationDisplayAlways,
    'on-demand': messages.settings.translationDisplayOnDemand,
    off: messages.settings.translationDisplayOff,
  };
  const translationModeHint: Record<TranslationDisplayMode, string> = {
    always: messages.settings.translationDisplayAlwaysHint,
    'on-demand': messages.settings.translationDisplayOnDemandHint,
    off: messages.settings.translationDisplayOffHint,
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.olive}
            colors={[colors.olive]}
          />
        }>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, direction]}>{messages.settings.title}</Text>
            <Text style={[styles.subtitle, direction]}>{messages.settings.subtitle}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, direction]}>{messages.settings.appLanguageSection}</Text>
          <View style={styles.optionList}>
            {APP_LOCALES.map((option) => (
              <OptionRow
                key={option}
                label={APP_LOCALE_DISPLAY_NAMES[option]}
                selected={option === locale}
                onPress={() => setLocale(option)}
                direction={getDirectionStyle(option)}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, direction]}>{messages.settings.quranTranslationSection}</Text>
          <View style={styles.optionList}>
            {TRANSLATION_DISPLAY_MODES.map((mode) => (
              <OptionRow
                key={mode}
                label={translationModeLabel[mode]}
                hint={translationModeHint[mode]}
                selected={mode === preference.displayMode}
                onPress={() => setDisplayMode(mode)}
                direction={direction}
              />
            ))}
          </View>
          {/* <Text style={[styles.note, direction]}>{messages.settings.quranArabicNote}</Text> */}
        </View>

        <AccountSection locale={locale} messages={messages} direction={direction} isRtl={isRtl} />
      </ScrollView>
    </SafeAreaView>
  );
}

type OptionRowProps = {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  direction: { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };
};

function OptionRow({ label, hint, selected, onPress, direction }: OptionRowProps) {
  // Each row mirrors to match its own label's direction (App Language rows
  // each display — and so mirror for — their own language, independent of
  // the screen's current locale; Quran Translation rows all share the
  // screen's single direction).
  const isRtl = direction.writingDirection === 'rtl';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        isRtl && styles.optionRowRtl,
        selected && styles.optionRowSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.optionTextWrap}>
        <Text style={[styles.optionLabel, direction]}>{label}</Text>
        {hint && <Text style={[styles.optionHint, direction]}>{hint}</Text>}
      </View>
      {selected && <Check size={20} color={colors.olive} strokeWidth={2.5} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchment,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerRtl: {
    flexDirection: 'row-reverse',
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
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.olive,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  optionList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.soft,
  },
  optionRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionRowRtl: {
    flexDirection: 'row-reverse',
  },
  optionRowSelected: {
    backgroundColor: colors.oliveWash,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  optionHint: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  note: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },
});
