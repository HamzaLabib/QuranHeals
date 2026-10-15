import { createElement, type ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * The app's navigation stack gives the Mushaf reader its swipe-back-off
 * options (mushaf/screenOptions.ts). On iOS 26, react-native-screens makes
 * the system back swipe full-screen by default, and it took the reader's
 * left-to-right page swipe (see tests/mushafScreen.test.ts, "real touch
 * sequences"). This checks the route really gets them.
 */
const passthrough = ({ children }: { children?: ReactNode }) => children;
vi.mock('expo-router', () => {
  const Stack = Object.assign((props: { children?: ReactNode }) => createElement('Stack', props), {
    Screen: (props: object) => createElement('StackScreen', props),
  });
  return { Stack, ThemeProvider: passthrough, DarkTheme: { colors: {} }, DefaultTheme: { colors: {} } };
});
vi.mock('expo-splash-screen', () => ({ preventAutoHideAsync: () => Promise.resolve(), setOptions: () => undefined, hideAsync: () => Promise.resolve() }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-system-ui', () => ({ setBackgroundColorAsync: () => Promise.resolve() }));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: () => undefined }));
vi.mock('@/auth/useAuth', () => ({ AuthProvider: passthrough }));
vi.mock('@/localization/useAppLocale', () => ({ AppLocaleProvider: passthrough, useAppLocale: () => ({ isReady: false }) }));
vi.mock('@/localization/useQuranFontSizePreference', () => ({ QuranFontSizePreferenceProvider: passthrough }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({ QuranTranslationPreferenceProvider: passthrough }));
vi.mock('@/theme/useAppearancePreference', () => ({ AppearancePreferenceProvider: passthrough, useAppearancePreference: () => ({ isReady: false }) }));
vi.mock('@/notifications/useNotifications', () => ({ NotificationsProvider: passthrough }));
vi.mock('@/notifications/useNotificationResponseRouting', () => ({ useNotificationResponseRouting: () => undefined }));
vi.mock('@/theme/useTheme', () => ({ useThemeName: () => 'light' }));
vi.mock('@/constants/theme', () => ({ navigationColorsFor: () => ({}), paletteFor: () => ({ background: '#fff' }), statusBarStyleFor: () => 'dark' }));
vi.mock('@/utils/devLog', () => ({ devLog: () => undefined }));

describe('Mushaf route options', () => {
  it('the stack registers the tabs group holding the Mushaf reader with swipe-back off (edge and full-screen)', async () => {
    const { default: RootLayout } = await import('@/app/_layout');
    const { MUSHAF_SCREEN_OPTIONS } = await import('@/mushaf/screenOptions');
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(createElement(RootLayout)); });
    const screens = root.root.findAll((node) => String(node.type) === 'StackScreen');
    // The reader is the Mushaf tab, inside the (tabs) group (app/(tabs)/_layout.tsx).
    expect(screens.map((node) => node.props.name)).toEqual(['(tabs)']);
    expect(screens[0].props.options).toBe(MUSHAF_SCREEN_OPTIONS);
    expect(MUSHAF_SCREEN_OPTIONS).toEqual({ gestureEnabled: false, fullScreenGestureEnabled: false });
    await act(async () => root.unmount());
  });
});
