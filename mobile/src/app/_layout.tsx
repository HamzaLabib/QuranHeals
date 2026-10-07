import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { AuthProvider } from '@/auth/useAuth';
import { navigationColorsFor, paletteFor, statusBarStyleFor } from '@/constants/theme';
import { AppLocaleProvider } from '@/localization/useAppLocale';
import { QuranFontSizePreferenceProvider } from '@/localization/useQuranFontSizePreference';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
import { AppearancePreferenceProvider } from '@/theme/useAppearancePreference';
import { useThemeName } from '@/theme/useTheme';
import { devLog } from '@/utils/devLog';

// Required once at app startup so the OAuth redirect (Google sign-in via
// expo-auth-session) correctly closes the in-app browser and returns
// control to the app — see docs/auth-setup.md.
WebBrowser.maybeCompleteAuthSession();

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
