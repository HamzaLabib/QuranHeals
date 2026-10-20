import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react-native';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { QURAN_SOURCES } from '@/constants/quranSources';
import { pageHeaderText, radii, spacing, typography, type Palette } from '@/constants/theme';
import { useContentColumnStyle } from '@/layout/useWindowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { goBackOrHome } from '@/utils/goBackOrHome';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

/**
 * Quran Sources & Credits (/credits), opened from the line at the bottom of
 * Home: who the Quran text and the Mushaf come from, with their official
 * sites and terms (constants/quranSources.ts).
 */
export default function CreditsScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Tablets: a centred content column (layout/windowClass.ts); phones: unchanged.
  const column = useContentColumnStyle();
  const { locale, messages } = useAppLocale();
  const copy = messages.credits;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, column, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={goBackOrHome}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.icon} />
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.title}</Text>
          <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
        </View>

        <Text style={[styles.intro, direction]}>{copy.intro}</Text>

        {QURAN_SOURCES.map((source) => (
          <View key={source.key} testID={`credit-${source.key}`} style={styles.card}>
            <Text style={[styles.name, direction]}>{source.name(copy)}</Text>
            <Text style={[styles.work, direction]}>{source.work(copy)}</Text>
            <View style={[styles.links, isRtl && styles.headerRtl]}>
              {source.links.map((link) => (
                <Pressable
                  key={link.url}
                  accessibilityRole="link"
                  accessibilityLabel={`${source.name(copy)}: ${copy[link.label]}`}
                  accessibilityHint={messages.settings.opensInBrowser}
                  onPress={() => {
                    Linking.openURL(link.url).catch(() => {
                      // Best-effort external link, like Settings' legal pages.
                    });
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.link, isRtl && styles.headerRtl, pressed && styles.pressed]}>
                  <Text style={styles.linkText}>{copy[link.label]}</Text>
                  <ArrowUpRight size={15} color={colors.accent} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.lg,
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
  // No subtitle here: the title takes the space between the buttons, as the shared header block does.
  title: { ...pageHeaderText(colors).title, flex: 1 },
  intro: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  work: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
  },
  linkText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
