import { BookMarked, House, NotebookPen } from 'lucide-react-native';
import { useContext, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, typography, type Palette } from '@/constants/theme';
import { LAYOUT_TOKENS } from '@/layout/windowClass';
import { usePlayback } from '@/audio/usePlayback';
import { isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

import { AudioMiniControls, showsAudioMiniControls } from './AudioMiniControls';
import { HandsHeartIcon } from './HandsHeartIcon';
import { MushafIcon } from './MushafIcon';
import { MushafDownloadIndicator } from './MushafDownloadIndicator';

/** The five tabs, in the approved order; the route names are app/(tabs)/<name>.tsx. */
export const APP_TABS = ['index', 'emotions', 'mushaf', 'my-reading', 'reflections'] as const;
type TabName = (typeof APP_TABS)[number];

type TabIcon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
/** One-colour icons: lucide's, and the app's own Mushaf icon (MushafIcon); How I Feel draws its own two-colour icon (HandsHeartIcon) below. */
const ICONS: Record<Exclude<TabName, 'emotions'>, TabIcon> = { index: House, mushaf: MushafIcon, 'my-reading': BookMarked, reflections: NotebookPen };

/**
 * The bottom tab bar: Home, How I Feel (the full emotion list), Mushaf, Wirds (أورادي وختماتي), Reflections
 * (الرئيسية، مشاعري، المصحف، أورادي، خواطري). The app's own palette in Light and Dark, and
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
  // The compact audio controls (AudioMiniControls), above the tabs during the Mushaf's listening session. The bar is not
  // drawn on the Mushaf (its own chip is there), so they never show inside it.
  const playback = usePlayback();
  const focused = state.routes[state.index];
  const hidden = (descriptors[focused.key]?.options.tabBarStyle as { display?: string } | undefined)?.display === 'none';
  if (hidden) return null;
  const labels: Record<TabName, string> = { index: messages.tabs.home, emotions: messages.tabs.howIFeel, mushaf: messages.tabs.mushaf, 'my-reading': messages.tabs.myReading, reflections: messages.tabs.reflections };

  const tabs = (
    <View
      testID="app-tab-bar"
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {showsAudioMiniControls(playback) && <AudioMiniControls state={playback} placement="tabBar" />}
      {/*
        The five tabs as one centred group, LAYOUT_TOKENS.tabBarMaxWidth wide at most: on tablets they aren't stretched
        across the window; on phones (narrower than that) this changes nothing. Pure layout, never the window's size in
        JavaScript: measured from the window, a rotation could lay the bar out once with the old size's margins, and
        Android's adjustsFontSizeToFit then left the labels shrunk for good (Android 17 tablet emulator, 2026-10-16).
      */}
      <View testID="app-tab-row" style={[styles.row, isRtlLocale(locale) && styles.rtl]}>
      {APP_TABS.map((name) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return null;
        const isFocused = focused.key === route.key;
        const color = isFocused ? colors.accent : colors.textMuted;
        // How I Feel keeps its approved red heart and olive hands in both states (its label shows which tab is selected).
        const icon = name === 'emotions'
          ? <HandsHeartIcon size={24} heartColor={colors.howIFeelHeart} handsColor={colors.howIFeelHands} strokeWidth={isFocused ? 2.1 : 1.8} />
          : (() => {
              const Icon = ICONS[name];
              return <Icon size={22} color={color} strokeWidth={isFocused ? 2.4 : 2} />;
            })();
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
            {icon}
            {/* One line on every phone, five across: a long label (Reflections, How I Feel) shrinks a little rather than wrapping or clipping. */}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.label, { color }, isFocused && styles.labelFocused]}>{labels[name]}</Text>
          </Pressable>
        );
      })}
      </View>
    </View>
  );

  // The offline Mushaf's quiet download line (MushafDownloadIndicator) sits above the tabs and counts in the bar's height.
  return (
    <View testID="app-tab-bar-area" onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}>
      <MushafDownloadIndicator />
      {tabs}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  row: {
    alignSelf: 'center',
    flexDirection: 'row',
    maxWidth: LAYOUT_TOKENS.tabBarMaxWidth,
    width: '100%',
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
