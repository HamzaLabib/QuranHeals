import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CircleHelp, Flag } from 'lucide-react-native';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { getReciter, reciterName } from '@/audio/reciters';
import { useFavoriteReciter } from '@/audio/useFavoriteReciter';
import { AccountSection } from '@/components/AccountSection';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { NotificationReminderRow } from '@/components/NotificationReminderRow';
import { OfflineMushafSettingsRow } from '@/components/OfflineMushafSettingsRow';
import { ReciterDownloadControl } from '@/components/ReciterDownloadControl';
import { ReciterList } from '@/components/ReciterList';
import { ReportIssueSheet } from '@/components/ReportIssueSheet';
import { SettingsAccordion } from '@/components/SettingsAccordion';
import { TranslationSettingRow } from '@/components/TranslationSettingRow';
import { getLegalLinks } from '@/constants/legalLinks';
import { pageHeaderText, radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { useContentColumnStyle } from '@/layout/useWindowClass';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { deviceUses24HourClock } from '@/localization/deviceLocale';
import { EMOTIONS_LANGUAGES, type EmotionsLanguage } from '@/localization/emotionsLanguage';
import { APP_LANGUAGES, APP_LOCALE_DISPLAY_NAMES, getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { QURAN_READING_MODES, useQuranReadingMode } from '@/localization/quranLanguage';
import { isShowTranslationOn, translationModeOf } from '@/localization/quranTranslationPreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useEmotionsLanguage } from '@/localization/useEmotionsLanguage';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { useKeepAwakePreference } from '@/mushaf/useKeepAwakePreference';
import { useWordMeaningsVisibility } from '@/mushaf/useWordMeaningsVisibility';
import { reminderFrequencies, type NotificationKind } from '@/notifications/types';
import { useNotifications, type ReminderChange } from '@/notifications/useNotifications';
import type { AppearanceMode } from '@/theme/appearancePreference';
import { useAppearancePreference } from '@/theme/useAppearancePreference';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';
import { isWordMeaningsBundled } from '@/wordMeanings/bundledDataset';
import { WORD_MEANINGS_ENABLED } from '@/wordMeanings/config';
import { isMemorizationModeAvailable } from '@/memorization/config';
import { memorizationLabels } from '@/memorization/labels';
import { MushafGuideChooser } from '@/memorization/MushafGuideChooser';
import { useMemorizationModeSetting } from '@/memorization/useMemorizationModeSetting';

const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark'];

/**
 * Settings: exactly five sections, in this order (no separate Notifications
 * section — each reminder sits in the section it belongs to):
 *  1. App — App Language (English / العربية), Appearance (System / Light / Dark).
 *  2. Emotions — Emotions Language, Show Translation, Emotional Check-in.
 *  3. Quran — Favorite Reciter (the 17 reciters, each with its coverage; its
 *     offline download as a small icon beside the dropdown), Quran Translation,
 *     Keep Screen Awake, Wird Reminder, Random Quran Ayah, Word Meanings (where
 *     the feature exists), Memorization Mode (where it exists), the offline
 *     Mushaf, and Mushaf Guide (opens the Mushaf's six-step guide again; where
 *     Memorization Mode exists, first a choice of it or the Memorization Mode
 *     Guide). The owner's approved order (2026-10-24).
 *  4. Support — Report an Issue, Legal & Privacy.
 *  5. Account — AccountSection (sign in / out, Delete Account), unchanged.
 *
 * The collapsible cards hold the choice lists; at most one is open at a time.
 * Exactly three language settings: App Language, Emotions Language and
 * Quran Translation (stored as quranLanguage; today its one option is None).
 */
type SettingsSectionKey = 'language' | 'emotions' | 'quran' | 'reciter' | 'appearance' | 'legal';

/** Animates the next layout change: a section opening/closing and the cards below it moving. */
function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export default function SettingsScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  // Tablets: a centred content column (layout/windowClass.ts); phones: unchanged.
  const column = useContentColumnStyle();
  const { locale, setLocale, messages } = useAppLocale();
  const { preference: emotionsLanguage, setPreference: setEmotionsLanguage } = useEmotionsLanguage();
  const { mode: quranMode, setMode: setQuranMode } = useQuranReadingMode();
  const { mode, setMode } = useAppearancePreference();
  const { enabled: keepAwake, setEnabled: setKeepAwake } = useKeepAwakePreference();
  const { visible: wordMeaningsVisible, setVisible: setWordMeaningsVisible } = useWordMeaningsVisibility();
  const { visible: memorizationVisible, setVisible: setMemorizationVisible } = useMemorizationModeSetting();
  const memorizationCopy = memorizationLabels(locale);
  // Settings → Mushaf Guide's choice of guide (where Memorization Mode exists): open or not. Local UI state only.
  const [isGuideChooserVisible, setIsGuideChooserVisible] = useState(false);
  const { reciterId: favoriteReciterId, setReciterId: setFavoriteReciterId } = useFavoriteReciter();
  const favoriteReciter = getReciter(favoriteReciterId);
  const { preference: translationPreference, setShowTranslation, setTranslationMode } = useQuranTranslationPreference();
  const notifications = useNotifications();
  const [uses24HourClock] = useState(() => deviceUses24HourClock());
  const [isPermissionSheetVisible, setIsPermissionSheetVisible] = useState(false);
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

  /** The Mushaf's own guide, at step 1 (/mushaf?guide=…): nothing about it is saved or reset. */
  const openMushafGuide = () => router.navigate({ pathname: '/mushaf', params: { guide: String(Date.now()) } });
  /** The Memorization Mode Guide in the Mushaf (/mushaf?memorizationGuide=…): it changes no setting and records nothing. */
  const openMemorizationGuide = () => router.navigate({ pathname: '/mushaf', params: { memorizationGuide: String(Date.now()) } });

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

  // The OS prompt is shown only from here, after a tap, with an explanation first — never on launch.
  // Once the OS will no longer ask (denied for good), the same tap opens the device settings instead.
  const canAskPermission = notifications.permission.status === 'undetermined'
    || (notifications.permission.status === 'denied' && notifications.permission.canAskAgain);
  const onPermissionPress = () => {
    if (canAskPermission) setIsPermissionSheetVisible(true);
    else notifications.openSystemSettings();
  };
  const changeReminder = (kind: NotificationKind, change: ReminderChange) => {
    notifications.update(kind, change);
    // Turning a reminder ON is the natural moment to ask, if the OS has never been asked.
    if (change.enabled === true && notifications.permission.status === 'undetermined') setIsPermissionSheetVisible(true);
  };
  const reminderRow = (kind: NotificationKind, title: string) => (
    <NotificationReminderRow
      testID={`settings-reminder-${kind}`}
      title={title}
      frequencies={reminderFrequencies(kind)}
      preference={notifications.preferences[kind]}
      state={notifications.states[kind]}
      permission={notifications.permission}
      locale={locale}
      messages={messages}
      direction={direction}
      isRtl={isRtl}
      uses24HourClock={uses24HourClock}
      onChange={(change) => changeReminder(kind, change)}
      onPermissionPress={onPermissionPress}
    />
  );

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
  const quranModeLabel = (id: string) => messages.settings[QURAN_READING_MODES.find((m) => m.id === id)?.labelKey ?? 'quranTranslationNone'];
  const appearanceModeLabel: Record<AppearanceMode, string> = {
    system: messages.appearance.system,
    light: messages.appearance.light,
    dark: messages.appearance.dark,
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, column]}
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

        {/* 1. App */}
        <SettingsSection testID="settings-section-app" title={messages.settings.appSection} direction={direction}>
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
        </SettingsSection>

        {/* 2. Emotions */}
        <SettingsSection testID="settings-section-emotions" title={messages.settings.emotionsSection} direction={direction}>
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

          {/* Show Translation: the stored, synced translation preference (quranTranslationPreference.ts). OFF: no translation and no Show translation button on the ayah screen; ON + On Demand: hidden, with the button; ON + Always: shown, hideable per ayah. The Share sheet still starts from this choice. */}
          <TranslationSettingRow
            on={isShowTranslationOn(translationPreference)}
            mode={translationModeOf(translationPreference)}
            messages={messages}
            direction={direction}
            isRtl={isRtl}
            onToggle={setShowTranslation}
            onModeChange={setTranslationMode}
          />

          {reminderRow('emotionCheckIn', messages.notifications.emotionCheckInTitle)}
        </SettingsSection>

        {/* 3. Quran */}
        <SettingsSection testID="settings-section-quran" title={messages.settings.quranSection} direction={direction}>
          {/* Favorite Reciter (audio/favoriteReciterPreference.ts): the 17 reciters, each with how much it can play ayah by ayah; a device setting, applied at once. */}
          <SettingsAccordion
            title={messages.audio.favoriteTitle}
            summary={favoriteReciter ? reciterName(favoriteReciter, isRtl) : undefined}
            expanded={openSection === 'reciter'}
            onToggle={() => toggleSection('reciter')}
            direction={direction}
            isRtl={isRtl}
            // Offline listening: the compact download icon beside the dropdown (downloads stay off while unlicensed, audio/reciters.ts).
            accessory={<ReciterDownloadControl reciterId={favoriteReciterId} messages={messages} isRtl={isRtl} direction={direction} />}>
            <Text style={[styles.optionHint, styles.accordionNote, direction]}>{messages.audio.favoriteDescription}</Text>
            <ReciterList
              testIDPrefix="settings-reciter"
              selectedId={favoriteReciterId}
              onSelect={(id) => choose(() => setFavoriteReciterId(id))}
              copy={messages.audio}
              rtl={isRtl}
              tone={{ text: colors.textPrimary, muted: colors.textSecondary, accent: colors.accent, selected: colors.accentSoft, divider: colors.divider }}
            />
          </SettingsAccordion>

          <SettingsAccordion
            title={messages.settings.quranTranslationSection}
            summary={quranModeLabel(quranMode)}
            expanded={openSection === 'quran'}
            onToggle={() => toggleSection('quran')}
            direction={direction}
            isRtl={isRtl}>
            {/* Only the modes that exist (localization/quranLanguage.ts): today None, the Arabic Mushaf without a translation. */}
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

          {/* Keep Screen Awake: a local switch (mushaf/keepAwakePreference.ts), applied at once; the Mushaf reads it. */}
          <View style={[styles.switchCard, isRtl && styles.optionRowRtl]}>
            <View style={styles.optionTextWrap}>
              <Text style={[styles.optionLabel, direction]}>{messages.settings.keepAwakeTitle}</Text>
              <Text style={[styles.optionHint, direction]}>{messages.settings.keepAwakeDescription}</Text>
            </View>
            <Switch
              testID="settings-keep-awake"
              accessibilityRole="switch"
              accessibilityLabel={messages.settings.keepAwakeTitle}
              accessibilityHint={messages.settings.keepAwakeDescription}
              accessibilityState={{ checked: keepAwake }}
              value={keepAwake}
              onValueChange={setKeepAwake}
              trackColor={{ false: colors.border, true: colors.accentFill }}
              ios_backgroundColor={colors.border}
              thumbColor={colors.onAccentFill}
            />
          </View>

          {reminderRow('wird', messages.notifications.wirdReminderTitle)}
          {reminderRow('randomAyah', messages.notifications.randomAyahTitle)}

          {/* Word Meanings: a local switch (mushaf/wordMeaningsVisibilityPreference.ts), applied at once; OFF hides the Mushaf's المعاني button. Only where the feature exists (wordMeanings/config.ts, bundledDataset.ts). */}
          {WORD_MEANINGS_ENABLED && isWordMeaningsBundled() && (
            <View style={[styles.switchCard, isRtl && styles.optionRowRtl]}>
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionLabel, direction]}>{messages.settings.wordMeaningsVisibleTitle}</Text>
              </View>
              <Switch
                testID="settings-word-meanings"
                accessibilityRole="switch"
                accessibilityLabel={messages.settings.wordMeaningsVisibleTitle}
                accessibilityState={{ checked: wordMeaningsVisible }}
                value={wordMeaningsVisible}
                onValueChange={setWordMeaningsVisible}
                trackColor={{ false: colors.border, true: colors.accentFill }}
                ios_backgroundColor={colors.border}
                thumbColor={colors.onAccentFill}
              />
            </View>
          )}

          {/* Memorization Mode: a local switch (memorization/memorizationModePreference.ts, OFF by default), applied at once; it shows or hides the Mushaf's Eye beside the page number (OFF also leaves Memorization Mode). Only where the feature exists (memorization/config.ts). */}
          {isMemorizationModeAvailable() && (
            <View style={[styles.switchCard, isRtl && styles.optionRowRtl]}>
              <View style={styles.optionTextWrap}>
                <Text style={[styles.optionLabel, direction]}>{memorizationCopy.settingTitle}</Text>
              </View>
              <Switch
                testID="settings-memorization-mode"
                accessibilityRole="switch"
                accessibilityLabel={memorizationCopy.settingTitle}
                accessibilityState={{ checked: memorizationVisible }}
                value={memorizationVisible}
                onValueChange={setMemorizationVisible}
                trackColor={{ false: colors.border, true: colors.accentFill }}
                ios_backgroundColor={colors.border}
                thumbColor={colors.onAccentFill}
              />
            </View>
          )}

          {/* The offline Mushaf (shared device content, the same signed in or not): one compact row with its actual status; tapping it downloads when a download is needed. */}
          <OfflineMushafSettingsRow messages={messages} locale={locale} direction={direction} isRtl={isRtl} />

          {/* Mushaf Guide: the Mushaf's own six-step guide (components/MushafGuide.tsx), opened there at step 1; nothing is saved or reset. The title alone, with the Mushaf toolbar's own Help (?) icon, always shown here (the toolbar's hides once the guide is finished). Where Memorization Mode exists, a choice first: that guide or the Memorization Mode Guide. */}
          <Pressable
            testID="settings-mushaf-guide"
            accessibilityRole="button"
            accessibilityLabel={messages.settings.mushafGuideTitle}
            onPress={() => (isMemorizationModeAvailable() ? setIsGuideChooserVisible(true) : openMushafGuide())}
            style={({ pressed }) => [styles.switchCard, isRtl && styles.optionRowRtl, pressed && styles.pressed]}>
            <CircleHelp size={18} color={colors.icon} strokeWidth={2} />
            <View style={styles.optionTextWrap}>
              <Text style={[styles.optionLabel, direction]}>{messages.settings.mushafGuideTitle}</Text>
            </View>
          </Pressable>
        </SettingsSection>

        {/* 4. Support */}
        <SettingsSection testID="settings-section-support" title={messages.settings.supportSection} direction={direction}>
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
        </SettingsSection>

        {/* 5. Account: its own heading and card (components/AccountSection.tsx). */}
        <AccountSection locale={locale} messages={messages} direction={direction} isRtl={isRtl} />
      </ScrollView>
      <ReportIssueSheet visible={isReportVisible} onClose={() => setIsReportVisible(false)} variant="settings" />
      {isMemorizationModeAvailable() && (
        <MushafGuideChooser
          visible={isGuideChooserVisible}
          onNormalGuide={() => { setIsGuideChooserVisible(false); openMushafGuide(); }}
          onMemorizationGuide={() => { setIsGuideChooserVisible(false); openMemorizationGuide(); }}
          onClose={() => setIsGuideChooserVisible(false)}
        />
      )}
      <ConfirmSheet
        visible={isPermissionSheetVisible}
        testID="settings-notification-permission"
        title={messages.notifications.permissionSheetTitle}
        body={messages.notifications.permissionSheetBody}
        note={messages.notifications.permissionSheetPrivacy}
        confirmLabel={messages.notifications.permissionSheetConfirm}
        cancelLabel={messages.notifications.permissionSheetCancel}
        onConfirm={() => {
          setIsPermissionSheetVisible(false);
          void notifications.requestPermission();
        }}
        onCancel={() => setIsPermissionSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

/** One of the five sections: its heading (the Account section's style) and its cards. */
function SettingsSection({ testID, title, direction, children }: { testID: string; title: string; direction: Direction; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View testID={testID} style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionLabel, direction]}>{title}</Text>
      {children}
    </View>
  );
}

type OptionRowProps = {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  direction: Direction;
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
  direction: Direction;
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
  headerText: pageHeaderText(colors).block,
  title: pageHeaderText(colors).title,
  subtitle: pageHeaderText(colors).subtitle,
  section: {
    gap: spacing.sm,
  },
  /** The same heading as AccountSection's ("Account"), so all five sections read alike. */
  sectionLabel: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
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
  /** The same card as a SettingsAccordion (components/SettingsAccordion.tsx), its header row holding a switch. */
  switchCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.soft,
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
  accordionNote: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.78,
  },
});
