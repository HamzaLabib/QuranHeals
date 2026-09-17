import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { AuthProvider } from '@/auth/useAuth';
import { AppLocaleProvider } from '@/localization/useAppLocale';
import { QuranFontSizePreferenceProvider } from '@/localization/useQuranFontSizePreference';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';

// Required once at app startup so the OAuth redirect (Google sign-in via
// expo-auth-session) correctly closes the in-app browser and returns
// control to the app — see docs/auth-setup.md.
WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AppLocaleProvider>
      <QuranTranslationPreferenceProvider>
        <QuranFontSizePreferenceProvider>
          <AuthProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: {
                    backgroundColor: '#F7F2EA',
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
