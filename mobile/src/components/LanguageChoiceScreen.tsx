import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_LOGO } from '@/constants/appLogo';
import { lightPalette, radii, shadows, spacing, typography } from '@/constants/theme';
import { APP_LOCALE_DISPLAY_NAMES, type AppLanguage } from '@/localization/locales';
import { computeQuranLineHeight } from '@/localization/quranFontSizePreference';

/** From Yusuf 12:100, as approved for this screen: shown in Arabic whichever language is chosen. */
export const LANGUAGE_CHOICE_VERSE = 'إِنَّ رَبِّي لَطِيفٌ لِّمَا يَشَاءُ';
export const LANGUAGE_CHOICE_VERSE_REFERENCE = 'يوسف: ١٠٠';

/** Arabic first, then English. */
const CHOICES: readonly AppLanguage[] = ['ar', 'en'];

const VERSE_FONT_SIZE = 28;

/**
 * The first-launch language choice: shown over the app (root _layout.tsx) only while no App Language is saved
 * (useAppLocale's hasSavedLocale). A tap saves the choice and the app beneath is already in that language and
 * direction — every screen lays itself out from the locale, so nothing restarts.
 *
 * Always the light palette: it follows the native splash, which is cream in both appearances (app.json), and the
 * dark green logo is not legible on the dark background.
 */
export function LanguageChoiceScreen({ onChoose }: { onChoose: (language: AppLanguage) => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View testID="language-choice" style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl, paddingTop: insets.top + spacing.xl },
        ]}
        bounces={false}>
        <Image
          source={APP_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Quran Heals"
        />
        <View style={styles.verseBlock}>
          <Text testID="language-choice-verse" style={styles.verse} accessibilityLanguage="ar">
            {LANGUAGE_CHOICE_VERSE}
          </Text>
          <Text style={styles.reference} accessibilityLanguage="ar">
            {LANGUAGE_CHOICE_VERSE_REFERENCE}
          </Text>
        </View>
        <View style={styles.buttons}>
          {CHOICES.map((language) => (
            <Pressable
              key={language}
              testID={`language-choice-${language}`}
              accessibilityRole="button"
              accessibilityLanguage={language}
              onPress={() => onChoose(language)}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>{APP_LOCALE_DISPLAY_NAMES[language]}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const colors = lightPalette;

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    alignItems: 'center',
    flexGrow: 1,
    gap: spacing.xxl,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  logo: {
    height: 132,
    width: 132,
  },
  verseBlock: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  verse: {
    color: colors.accent,
    fontSize: VERSE_FONT_SIZE,
    fontWeight: '600',
    letterSpacing: 0,
    // Room above and below each line for the marks; the text wraps rather than shrinking or clipping.
    lineHeight: computeQuranLineHeight(VERSE_FONT_SIZE),
    maxWidth: 420,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  reference: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 24,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  buttons: {
    gap: spacing.md,
    maxWidth: 360,
    width: '100%',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.soft,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
