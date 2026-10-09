import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { LayoutAnimation, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { AccountSection } from '@/components/AccountSection';
import { SettingsAccordion } from '@/components/SettingsAccordion';
import { getLegalLinks } from '@/constants/legalLinks';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { APP_LOCALES, APP_LOCALE_DISPLAY_NAMES, getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import type { AppearanceMode } from '@/theme/appearancePreference';
import { useAppearancePreference } from '@/theme/useAppearancePreference';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

const TRANSLATION_DISPLAY_MODES: readonly TranslationDisplayMode[] = ['always', 'on-demand', 'off'];
const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

/** The four collapsible sections; at most one is open at a time. Account and the Danger Zone are not part of this. */
type SettingsSectionKey = 'language' | 'translation' | 'appearance' | 'legal';

/** Animates the next layout change: a section opening/closing and the cards below it moving. */
function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export default function SettingsScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, setLocale, messages } = useAppLocale();
  const { preference, setDisplayMode } = useQuranTranslationPreference();
  const { mode, setMode } = useAppearancePreference();
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
  // Local UI state only: opening/closing a section never touches a
  // preference, storage, or the network.
  const [openSection, setOpenSection] = useState<SettingsSectionKey | null>(null);

  const toggleSection = (section: SettingsSectionKey) => {
    animateNextLayout();
    setOpenSection((current) => (current === section ? null : section));
  };

  // Applies a choice through its existing preference setter (which updates
  // and persists it immediately), then closes the section — no Save step.
  const choose = (apply: () => void) => {
    apply();
    animateNextLayout();
    setOpenSection(null);
  };

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
  const appearanceModeLabel: Record<AppearanceMode, string> = {
    system: messages.appearance.system,
    light: messages.appearance.light,
    dark: messages.appearance.dark,
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
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.icon} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, direction]}>{messages.settings.title}</Text>
            <Text style={[styles.subtitle, direction]}>{messages.settings.subtitle}</Text>
          </View>
        </View>

        <View style={styles.accordionGroup}>
          <SettingsAccordion
            title={messages.settings.appLanguageSection}
            summary={APP_LOCALE_DISPLAY_NAMES[locale]}
            expanded={openSection === 'language'}
            onToggle={() => toggleSection('language')}
            direction={direction}
            isRtl={isRtl}>
            {APP_LOCALES.map((option) => (
              <OptionRow
                key={option}
                label={APP_LOCALE_DISPLAY_NAMES[option]}
                selected={option === locale}
                onPress={() => choose(() => setLocale(option))}
                direction={getDirectionStyle(option)}
              />
            ))}
          </SettingsAccordion>

          <SettingsAccordion
            title={messages.settings.quranTranslationSection}
            summary={translationModeLabel[preference.displayMode]}
            expanded={openSection === 'translation'}
            onToggle={() => toggleSection('translation')}
            direction={direction}
            isRtl={isRtl}>
            {TRANSLATION_DISPLAY_MODES.map((mode) => (
              <OptionRow
                key={mode}
                label={translationModeLabel[mode]}
                hint={translationModeHint[mode]}
                selected={mode === preference.displayMode}
                onPress={() => choose(() => setDisplayMode(mode))}
                direction={direction}
              />
            ))}
            {/* <Text style={[styles.note, direction]}>{messages.settings.quranArabicNote}</Text> */}
          </SettingsAccordion>

          <SettingsAccordion
            title={messages.appearance.sectionLabel}
            summary={appearanceModeLabel[mode]}
            expanded={openSection === 'appearance'}
            onToggle={() => toggleSection('appearance')}
            direction={direction}
            isRtl={isRtl}>
            {APPEARANCE_MODES.map((option) => (
              <OptionRow
                key={option}
                label={appearanceModeLabel[option]}
                selected={option === mode}
                onPress={() => choose(() => setMode(option))}
                direction={direction}
              />
            ))}
          </SettingsAccordion>

          <SettingsAccordion
            title={messages.settings.legalSection}
            expanded={openSection === 'legal'}
            onToggle={() => toggleSection('legal')}
            direction={direction}
            isRtl={isRtl}>
            {/* The public legal pages in the app's language (constants/legalLinks.ts), opened in the browser. Available signed in or not. */}
            {getLegalLinks(locale).map(({ key, url }) => (
              <LinkRow
                key={key}
                label={messages.settings[key]}
                hint={messages.settings.opensInBrowser}
                onPress={() => {
                  Linking.openURL(url).catch(() => {
                    // Best-effort external link, like AyahCard's "Read in Quran".
                  });
                }}
                direction={direction}
              />
            ))}
          </SettingsAccordion>
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
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
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
      {selected && <Check size={20} color={colors.accent} strokeWidth={2.5} />}
    </Pressable>
  );
}

type LinkRowProps = {
  label: string;
  hint: string;
  onPress: () => void;
  direction: { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };
};

/** Same row as OptionRow, for a page that opens outside the app (a forward chevron instead of a checkmark). */
function LinkRow({ label, hint, onPress, direction }: LinkRowProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const isRtl = direction.writingDirection === 'rtl';
  // "Forward" points toward the end of the reading direction.
  const ForwardIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, isRtl && styles.optionRowRtl, pressed && styles.pressed]}>
      <View style={styles.optionTextWrap}>
        <Text style={[styles.optionLabel, direction]}>{label}</Text>
      </View>
      <ForwardIcon size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  accordionGroup: {
    gap: spacing.sm,
  },
  optionRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
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
    backgroundColor: colors.accentSoft,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  optionHint: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },
});
