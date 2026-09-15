import { router } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { APP_LOCALES, APP_LOCALE_DISPLAY_NAMES, getDirectionStyle } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';

const TRANSLATION_DISPLAY_MODES: readonly TranslationDisplayMode[] = ['always', 'on-demand', 'off'];

export default function SettingsScreen() {
  const { locale, setLocale, messages } = useAppLocale();
  const { preference, setDisplayMode } = useQuranTranslationPreference();
  const direction = getDirectionStyle(locale);

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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <ArrowLeft size={22} color={colors.ink} />
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
          <Text style={[styles.note, direction]}>{messages.settings.quranArabicNote}</Text>
        </View>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.optionRow, selected && styles.optionRowSelected, pressed && styles.pressed]}>
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
