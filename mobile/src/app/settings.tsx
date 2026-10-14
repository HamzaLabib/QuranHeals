import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Flag } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { LayoutAnimation, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { AccountSection } from '@/components/AccountSection';
import { OfflineMushafPanel } from '@/components/OfflineMushafPanel';
import { ReportIssueSheet } from '@/components/ReportIssueSheet';
import { SettingsAccordion } from '@/components/SettingsAccordion';
import { getLegalLinks } from '@/constants/legalLinks';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { EMOTIONS_LANGUAGES, type EmotionsLanguage } from '@/localization/emotionsLanguage';
import { APP_LANGUAGES, APP_LOCALE_DISPLAY_NAMES, getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { QURAN_READING_MODES, useQuranReadingMode } from '@/localization/quranLanguage';
import { useAppLocale } from '@/localization/useAppLocale';
import { useEmotionsLanguage } from '@/localization/useEmotionsLanguage';
import type { AppearanceMode } from '@/theme/appearancePreference';
import { useAppearancePreference } from '@/theme/useAppearancePreference';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

/**
 * The collapsible sections; at most one is open at a time. Account and the
 * Danger Zone are not part of this. Exactly three language settings, in
 * this order: App Language, Emotions Language, Quran Language (no separate
 * Quran Translation row: the ayah screen's Show translation covers it).
 */
type SettingsSectionKey = 'language' | 'emotions' | 'quran' | 'appearance' | 'legal';

/** Animates the next layout change: a section opening/closing and the cards below it moving. */
function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export default function SettingsScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, setLocale, messages } = useAppLocale();
  const { preference: emotionsLanguage, setPreference: setEmotionsLanguage } = useEmotionsLanguage();
  const { mode: quranMode, setMode: setQuranMode } = useQuranReadingMode();
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
  const [isReportVisible, setIsReportVisible] = useState(false);

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
        // reconcilePreferencesOnSignIn, which applies an account-side App
        // Language change via the same setLocale used above (through
        // AuthProvider's applyPreferencesLocally) — shared context state, so
        // this screen re-renders with the synced value automatically; no
        // separate local re-read is needed here.
        await refreshSync();
      } finally {
        setIsRefreshing(false);
      }
    });
  }, [refreshSync]);

  // "Follow App Language" and "English" in the interface's language; the two Arabic choices always in Arabic (their own names).
  const emotionsLanguageLabel: Record<EmotionsLanguage, string> = {
    follow: messages.settings.emotionsFollowApp,
    en: messages.settings.emotionsEnglish,
    ar: messages.settings.emotionsArabicStandard,
    'ar-EG': messages.settings.emotionsArabicEgyptian,
  };
  const emotionsLanguageDirection = (option: EmotionsLanguage) => (option === 'ar' || option === 'ar-EG' ? getDirectionStyle('ar') : direction);
  const quranModeLabel = (id: string) => messages.settings[QURAN_READING_MODES.find((m) => m.id === id)?.labelKey ?? 'quranTextOption'];
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
            {APP_LANGUAGES.map((option) => (
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
            title={messages.settings.emotionsLanguageSection}
            summary={emotionsLanguageLabel[emotionsLanguage]}
            expanded={openSection === 'emotions'}
            onToggle={() => toggleSection('emotions')}
            direction={direction}
            isRtl={isRtl}>
            {EMOTIONS_LANGUAGES.map((option) => (
              <OptionRow
                key={option}
                label={emotionsLanguageLabel[option]}
                selected={option === emotionsLanguage}
                onPress={() => choose(() => setEmotionsLanguage(option))}
                direction={emotionsLanguageDirection(option)}
              />
            ))}
          </SettingsAccordion>

          <SettingsAccordion
            title={messages.settings.quranLanguageSection}
            summary={quranModeLabel(quranMode)}
            expanded={openSection === 'quran'}
            onToggle={() => toggleSection('quran')}
            direction={direction}
            isRtl={isRtl}>
            {/* Only the modes that exist (localization/quranLanguage.ts): today, the Arabic Mushaf. */}
            {QURAN_READING_MODES.map((option) => (
              <OptionRow
                key={option.id}
                label={messages.settings[option.labelKey]}
                selected={option.id === quranMode}
                onPress={() => choose(() => setQuranMode(option.id))}
                direction={direction}
              />
            ))}
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

        {/* The offline Mushaf (shared device content, the same signed in or not): progress and controls — pause, continue, try again, check for updates, remove — also once it is complete. */}
        <OfflineMushafPanel />

        {/* General and technical issues: the same reporting sheet as the ayah screen, with no ayah attached. Signed in or not. */}
        <Pressable
          testID="settings-report-issue"
          accessibilityRole="button"
          accessibilityLabel={messages.issueReport.action}
          accessibilityHint={messages.issueReport.settingsDescription}
          onPress={() => setIsReportVisible(true)}
          style={({ pressed }) => [styles.reportCard, isRtl && styles.optionRowRtl, pressed && styles.pressed]}>
          <Flag size={18} color={colors.icon} strokeWidth={2} />
          <View style={styles.optionTextWrap}>
            <Text style={[styles.optionLabel, direction]}>{messages.issueReport.action}</Text>
            <Text style={[styles.optionHint, direction]}>{messages.issueReport.settingsDescription}</Text>
          </View>
        </Pressable>

        <AccountSection locale={locale} messages={messages} direction={direction} isRtl={isRtl} />
      </ScrollView>
      <ReportIssueSheet visible={isReportVisible} onClose={() => setIsReportVisible(false)} variant="settings" />
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
  // the screen's current locale; the other rows share the screen's direction,
  // except the two Arabic Emotions Language choices, always right to left).
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
  reportCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
