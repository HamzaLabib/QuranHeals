import { BookMarked, BookOpen, House, NotebookPen, type LucideIcon } from 'lucide-react-native';
import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, typography, type Palette } from '@/constants/theme';
import { isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

/** The four tabs, in the approved order; the route names are app/(tabs)/<name>.tsx. */
export const APP_TABS = ['index', 'mushaf', 'my-reading', 'reflections'] as const;
type TabName = (typeof APP_TABS)[number];

const ICONS: Record<TabName, LucideIcon> = { index: House, mushaf: BookOpen, 'my-reading': BookMarked, reflections: NotebookPen };

/**
 * The bottom tab bar: Home, Mushaf, Recitations & Khatmas, Reflections
 * (الرئيسية، المصحف، أورادي وختماتي، خواطري). The app's own palette in Light and Dark, and
 * mirrored in Arabic (the app sets direction per component, never
 * I18nManager), so Home is always at the reading start. A screen hides it
 * with `tabBarStyle: { display: 'none' }` (the Mushaf's full-screen mode).
 */
export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const onHeight = useContext(BottomTabBarHeightCallbackContext);
  const focused = state.routes[state.index];
  const hidden = (descriptors[focused.key]?.options.tabBarStyle as { display?: string } | undefined)?.display === 'none';
  if (hidden) return null;
  const labels: Record<TabName, string> = { index: messages.tabs.home, mushaf: messages.tabs.mushaf, 'my-reading': messages.tabs.myReading, reflections: messages.tabs.reflections };

  return (
    <View
      testID="app-tab-bar"
      accessibilityRole="tablist"
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }, isRtlLocale(locale) && styles.rtl]}>
      {APP_TABS.map((name) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return null;
        const isFocused = focused.key === route.key;
        const Icon = ICONS[name];
        const color = isFocused ? colors.accent : colors.textMuted;
        return (
          <Pressable
            key={route.key}
            testID={`tab-${name}`}
            accessibilityRole="tab"
            accessibilityLabel={labels[name]}
            accessibilityState={{ selected: isFocused }}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              // Re-selecting the current tab does nothing: no remount, the screen keeps its state (the Mushaf its page).
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
            <Icon size={22} color={color} strokeWidth={isFocused ? 2.4 : 2} />
            {/* One line on every phone: a long label (Recitations & Khatmas) shrinks a little rather than wrapping or clipping. */}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.label, { color }, isFocused && styles.labelFocused]}>{labels[name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingTop: spacing.xs,
  },
  rtl: {
    flexDirection: 'row-reverse',
  },
  tab: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 2,
    gap: 2,
    justifyContent: 'center',
    minHeight: 48,
  },
  label: {
    fontSize: typography.small,
    fontWeight: '600',
  },
  labelFocused: {
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
});
