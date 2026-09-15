import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// settings.tsx is a React Native component (.tsx importing lucide-react-native
// and react-native), which this project's plain-Node vitest environment
// cannot parse/render (see the same constraint documented in
// emotionIcons.test.ts and emotionRouting.test.ts). Its wiring is proven by
// source-scan instead, matching this repository's established pattern.
const SETTINGS_SCREEN_PATH = resolve(__dirname, '../src/app/settings.tsx');
const source = readFileSync(SETTINGS_SCREEN_PATH, 'utf-8');

describe('Settings screen: app language selection', () => {
  it('offers all three approved app locales, derived from APP_LOCALES (never a hardcoded duplicate list)', () => {
    expect(source).toMatch(/APP_LOCALES\.map\(/);
    expect(source).toMatch(/APP_LOCALE_DISPLAY_NAMES\[option\]/);
  });

  it('selecting a language calls setLocale, which (per useAppLocale.tsx) updates and persists the choice immediately', () => {
    expect(source).toMatch(/onPress=\{\(\) => setLocale\(option\)\}/);
  });

  it('marks the currently-active locale as selected for accessibility/visual state', () => {
    expect(source).toMatch(/selected=\{option === locale\}/);
  });
});

describe('Settings screen: Quran translation display-mode selection', () => {
  it('offers exactly the three valid display modes: always, on-demand, off', () => {
    expect(source).toMatch(/TRANSLATION_DISPLAY_MODES[\s\S]*?=\s*\['always', 'on-demand', 'off'\]/);
  });

  it('selecting a mode calls setDisplayMode, which persists via the shared QuranTranslationPreferenceProvider', () => {
    expect(source).toMatch(/onPress=\{\(\) => setDisplayMode\(mode\)\}/);
  });

  it('marks the currently-active display mode as selected', () => {
    expect(source).toMatch(/selected=\{mode === preference\.displayMode\}/);
  });

  it('shows a note that the Arabic Quran is always displayed regardless of this setting, using localized copy', () => {
    expect(source).toMatch(/messages\.settings\.quranArabicNote/);
  });
});

describe('Settings screen: no hardcoded interface strings', () => {
  it('every user-facing label on this screen is sourced from the localized messages object or locale display names', () => {
    expect(source).toMatch(/messages\.settings\.title/);
    expect(source).toMatch(/messages\.settings\.appLanguageSection/);
    expect(source).toMatch(/messages\.settings\.quranTranslationSection/);
  });
});

describe('Navigation entry point to Settings', () => {
  const INDEX_SCREEN_PATH = resolve(__dirname, '../src/app/index.tsx');
  const indexSource = readFileSync(INDEX_SCREEN_PATH, 'utf-8');

  it('the home screen exposes a clear nav entry to /settings', () => {
    expect(indexSource).toMatch(/<Link href="\/settings" asChild>/);
  });
});
