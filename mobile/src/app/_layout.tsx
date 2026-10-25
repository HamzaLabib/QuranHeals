import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { AuthProvider } from '@/auth/useAuth';
import { setAudioLocale } from '@/audio/index';
import { FavoriteReciterProvider } from '@/audio/useFavoriteReciter';
import { navigationColorsFor, paletteFor, statusBarStyleFor } from '@/constants/theme';
import { useDeviceOrientationPolicy } from '@/layout/useDeviceOrientationPolicy';
import { isRtlLocale } from '@/localization/locales';
import { AppLocaleProvider, useAppLocale } from '@/localization/useAppLocale';
import { EmotionsLanguageProvider } from '@/localization/useEmotionsLanguage';
import { MUSHAF_SCREEN_OPTIONS } from '@/mushaf/screenOptions';
import { QuranFontSizePreferenceProvider } from '@/localization/useQuranFontSizePreference';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
import { KeepAwakePreferenceProvider } from '@/mushaf/useKeepAwakePreference';
import { WordMeaningsVisibilityProvider } from '@/mushaf/useWordMeaningsVisibility';
import { MemorizationModeSettingProvider } from '@/memorization/useMemorizationModeSetting';
import { useNotificationResponseRouting } from '@/notifications/useNotificationResponseRouting';
import { NotificationsProvider } from '@/notifications/useNotifications';
import { AppearancePreferenceProvider, useAppearancePreference } from '@/theme/useAppearancePreference';
import { useThemeName } from '@/theme/useTheme';
import { devLog } from '@/utils/devLog';

// Required once at app startup so the OAuth redirect (Google sign-in via
// expo-auth-session) correctly closes the in-app browser and returns
// control to the app — see docs/auth-setup.md.
WebBrowser.maybeCompleteAuthSession();

// Keep the native splash (app.json → expo-splash-screen plugin) up until the
// saved Appearance and language preferences have loaded, so the first screen
// never shows in the default Light/English and then flips. Calling this
// stops Expo Router from auto-hiding on navigation ready; hideSplash() below
// is the only place it is hidden.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
// fade is iOS-only; Android always fades, for `duration` ms.
SplashScreen.setOptions({ duration: 300, fade: true });

/**
 * Upper bound, not a delay: both preference loads are local storage reads
 * that resolve (falling back to defaults) even when storage fails, so this
 * only fires if storage hangs — the app then shows on its defaults rather
 * than staying on the splash.
 */
const SPLASH_MAX_WAIT_MS = 3000;

/** After the first screen shows: when the offline Mushaf controller starts (its status check, then any download). */
const MUSHAF_AUTO_START_DELAY_MS = 3000;

let splashHidden = false;
function hideSplash(reason: string) {
  if (splashHidden) return;
  splashHidden = true;
  devLog('app', 'splash hidden', { reason });
  SplashScreen.hideAsync().catch(() => undefined);
}

devLog('app', 'startup');

// An ayah link opened on a cold start lands on /ayah/<surah>/<ayah> with Home
// beneath it, so the screen's back button returns to Home. Normal launches
// already start at Home.
export const unstable_settings = { initialRouteName: '(tabs)' };

const navigationThemes = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, ...navigationColorsFor('light') } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, ...navigationColorsFor('dark') } },
};

export default function RootLayout() {
  return (
    <AppearancePreferenceProvider>
      <AppLocaleProvider>
        <EmotionsLanguageProvider>
          <QuranTranslationPreferenceProvider>
            <QuranFontSizePreferenceProvider>
              <KeepAwakePreferenceProvider>
                <WordMeaningsVisibilityProvider>
                  <MemorizationModeSettingProvider>
                    <FavoriteReciterProvider>
                      <NotificationsProvider>
                        <AuthProvider>
                          <ThemedRoot />
                        </AuthProvider>
                      </NotificationsProvider>
                    </FavoriteReciterProvider>
                  </MemorizationModeSettingProvider>
                </WordMeaningsVisibilityProvider>
              </KeepAwakePreferenceProvider>
            </QuranFontSizePreferenceProvider>
          </QuranTranslationPreferenceProvider>
        </EmotionsLanguageProvider>
      </AppLocaleProvider>
    </AppearancePreferenceProvider>
  );
}

/**
 * Split out from RootLayout so useThemeName() runs INSIDE
 * AppearancePreferenceProvider (it reads the saved Appearance preference —
 * see useAppearancePreference.tsx) rather than above it, where the
 * provider's value wouldn't be reachable yet.
 */
function ThemedRoot() {
  // Follows the device appearance (app.json userInterfaceStyle: "automatic")
  // unless the user saved Light or Dark in Settings (appearancePreference.ts).
  // Re-renders live when either the device appearance or the saved
  // preference changes.
  const theme = useThemeName();
  const background = paletteFor(theme).background;
  // Phones portrait, tablets any orientation (Android, at runtime; iOS is static): layout/orientationPolicy.ts.
  useDeviceOrientationPolicy();

  useEffect(() => {
    // Native root view behind every screen/modal (and Android's transparent
    // edge-to-edge system bars): keep it on the theme background so
    // navigation and sheet transitions never flash white in dark mode.
    SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  // Auth/session restore is deliberately not awaited: it can hit the network
  // and the home screen doesn't depend on it.
  const { isReady: isAppearanceReady } = useAppearancePreference();
  const { isReady: isLocaleReady, locale } = useAppLocale();
  // The lock screen's "now playing" text follows the App Language (audio/index.ts).
  useEffect(() => {
    setAudioLocale(isRtlLocale(locale));
  }, [locale]);
  const startupReady = isAppearanceReady && isLocaleReady;
  // Reminder taps (notifications/): after startup, once the root navigator exists — including the tap that launched the app.
  useNotificationResponseRouting(startupReady);

  useEffect(() => {
    // Offline Mushaf (Quran Foundation Content Sync, relayed by our backend):
    // the one start of the automatic download controller
    // (mushaf/offline/autoDownload.ts). Complete: the daily update check, as
    // before. Missing or partial: it prepares the Mushaf (Wi-Fi, or with
    // permission on mobile data) without blocking any screen. Deferred a
    // little so it never competes with the first screen; offline or failed
    // attempts change nothing, and an installed copy stays readable.
    if (!startupReady) return;
    const timer = setTimeout(() => {
      void import('@/mushaf/offline/autoDownloadService').then(({ mushafAutoDownload }) => mushafAutoDownload().start()).catch(() => undefined);
    }, MUSHAF_AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [startupReady]);

  useEffect(() => {
    // Developer tool: the sync-password work-factor benchmark (crypto/kdfBenchmark.ts), development builds with
    // EXPO_PUBLIC_KDF_BENCHMARK=1 only. Written as `if (__DEV__ && …) { import() }` so Metro folds it away and a release
    // bundle does not even contain the module.
    if (__DEV__ && startupReady && process.env.EXPO_PUBLIC_KDF_BENCHMARK === '1') {
      void import('@/crypto/kdfBenchmark').then(({ runKdfBenchmarkIfRequested }) => runKdfBenchmarkIfRequested()).catch(() => undefined);
    }
  }, [startupReady]);

  useEffect(() => {
    // Published human-verified ayah timing (audio/verifiedCatalog.ts, Phase 4.8.3): the stored copy at once, then a
    // refresh, and on every return to the foreground. Off (nothing requested) unless EXPO_PUBLIC_AUDIO_REGISTRY_URL is set.
    if (!startupReady) return;
    const timer = setTimeout(() => {
      void import('@/audio/verifiedCatalog').then(({ startVerifiedTiming }) => startVerifiedTiming()).catch(() => undefined);
    }, MUSHAF_AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [startupReady]);

  useEffect(() => {
    if (startupReady) {
      hideSplash('ready');
      return;
    }
    const timeout = setTimeout(() => hideSplash('timeout'), SPLASH_MAX_WAIT_MS);
    return () => clearTimeout(timeout);
  }, [startupReady]);

  return (
    <ThemeProvider value={navigationThemes[theme]}>
      <StatusBar style={statusBarStyleFor(theme)} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: background,
          },
        }}>
        {/* The four tabs (Home, Mushaf, Favorites, Reflections). The Mushaf reader lives here, so the stack's swipe-back stays off for it. */}
        <Stack.Screen name="(tabs)" options={MUSHAF_SCREEN_OPTIONS} />
      </Stack>
    </ThemeProvider>
  );
}
