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
import { useThemeName } from '@/theme/useTheme';

// Required once at app startup so the OAuth redirect (Google sign-in via
// expo-auth-session) correctly closes the in-app browser and returns
// control to the app — see docs/auth-setup.md.
WebBrowser.maybeCompleteAuthSession();

const navigationThemes = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, ...navigationColorsFor('light') } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, ...navigationColorsFor('dark') } },
};

export default function RootLayout() {
  // Follows the device appearance (app.json userInterfaceStyle: "automatic")
  // and re-renders when it changes while the app is open.
  const theme = useThemeName();
  const background = paletteFor(theme).background;

  useEffect(() => {
    // Native root view behind every screen/modal (and Android's transparent
    // edge-to-edge system bars): keep it on the theme background so
    // navigation and sheet transitions never flash white in dark mode.
    SystemUI.setBackgroundColorAsync(background).catch(() => undefined);
  }, [background]);

  return (
    <AppLocaleProvider>
      <QuranTranslationPreferenceProvider>
        <QuranFontSizePreferenceProvider>
          <AuthProvider>
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
          </AuthProvider>
        </QuranFontSizePreferenceProvider>
      </QuranTranslationPreferenceProvider>
    </AppLocaleProvider>
  );
}
