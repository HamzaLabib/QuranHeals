import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { AuthProvider } from '@/auth/useAuth';
import { navigationColorsFor, paletteFor, statusBarStyleFor } from '@/constants/theme';
import { AppLocaleProvider, useAppLocale } from '@/localization/useAppLocale';
import { QuranFontSizePreferenceProvider } from '@/localization/useQuranFontSizePreference';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
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

let splashHidden = false;
function hideSplash(reason: string) {
  if (splashHidden) return;
  splashHidden = true;
  devLog('app', 'splash hidden', { reason });
  SplashScreen.hideAsync().catch(() => undefined);
}

devLog('app', 'startup');

const navigationThemes = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, ...navigationColorsFor('light') } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, ...navigationColorsFor('dark') } },
};

export default function RootLayout() {
  return (
    <AppearancePreferenceProvider>
      <AppLocaleProvider>
        <QuranTranslationPreferenceProvider>
          <QuranFontSizePreferenceProvider>
            <AuthProvider>
              <ThemedRoot />
            </AuthProvider>
          </QuranFontSizePreferenceProvider>
        </QuranTranslationPreferenceProvider>
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
  // Defaults to Light (see appearancePreference.ts) until the user picks an
  // Appearance option in Settings; only follows the device appearance
  // (app.json userInterfaceStyle: "automatic") once System is explicitly
  // selected. Re-renders live when either the device appearance or the
  // saved preference changes.
  const theme = useThemeName();
  const background = paletteFor(theme).background;

  useEffect(() => {
    // Native root view behind every screen/modal (and Android's transparent
    // edge-to-edge system bars): keep it on the theme background so
    // navigation and sheet transitions never flash white in dark mode.
    SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  // Auth/session restore is deliberately not awaited: it can hit the network
  // and the home screen doesn't depend on it.
  const { isReady: isAppearanceReady } = useAppearancePreference();
  const { isReady: isLocaleReady } = useAppLocale();
  const startupReady = isAppearanceReady && isLocaleReady;

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
        }}
      />
    </ThemeProvider>
  );
}
