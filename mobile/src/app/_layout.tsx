import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AppLocaleProvider } from '@/localization/useAppLocale';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AppLocaleProvider>
      <QuranTranslationPreferenceProvider>
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
      </QuranTranslationPreferenceProvider>
    </AppLocaleProvider>
  );
}
