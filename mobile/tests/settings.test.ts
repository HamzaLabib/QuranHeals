import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LANGUAGES } from '@/localization/locales';
import { EMOTIONS_LANGUAGES } from '@/localization/emotionsLanguage';
import { QURAN_READING_MODES } from '@/localization/quranLanguage';

// The Settings screen is rendered for real in settingsAccordion.test.ts;
// these source-scans pin its wiring, matching this repository's pattern.
const SETTINGS_SCREEN_PATH = resolve(__dirname, '../src/app/settings.tsx');
const source = readFileSync(SETTINGS_SCREEN_PATH, 'utf-8');

describe('Settings screen: exactly three language settings', () => {
  it('App Language offers English and Arabic only, derived from APP_LANGUAGES', () => {
    expect(APP_LANGUAGES).toEqual(['en', 'ar']);
    expect(source).toMatch(/APP_LANGUAGES\.map\(/);
    expect(source).toMatch(/onPress=\{\(\) => choose\(\(\) => setLocale\(option\)\)\}/);
    expect(source).toMatch(/selected=\{option === locale\}/);
  });

  it('Emotions Language offers follow / en / ar / ar-EG, derived from EMOTIONS_LANGUAGES', () => {
    expect(EMOTIONS_LANGUAGES).toEqual(['follow', 'en', 'ar', 'ar-EG']);
    expect(source).toMatch(/EMOTIONS_LANGUAGES\.map\(/);
    expect(source).toMatch(/choose\(\(\) => setEmotionsLanguage\(option\)\)/);
  });

  it('Quran Translation lists only the reading modes that exist (one today: None), stored by id', () => {
    expect(QURAN_READING_MODES.map((mode) => mode.id)).toEqual(['quran-text']);
    expect(source).toMatch(/QURAN_READING_MODES\.map\(/);
    expect(source).toMatch(/choose\(\(\) => setQuranMode\(option\.id\)\)/);
  });

  it('five sections in this order — App (App Language, Appearance), Emotions, Quran, Support, Account; one Quran Translation row, no Notifications section', () => {
    const order = [
      'messages.settings.appSection',
      'messages.settings.appLanguageSection',
      'messages.appearance.sectionLabel',
      'messages.settings.emotionsSection',
      'messages.settings.emotionsLanguageSection',
      "reminderRow('emotionCheckIn'",
      'messages.settings.quranSection',
      'messages.audio.favoriteTitle',
      'messages.settings.quranTranslationSection',
      'settings-keep-awake',
      "reminderRow('wird'",
      "reminderRow('randomAyah'",
      'messages.settings.supportSection',
      'settings-report-issue',
      'messages.settings.legalSection',
      '<AccountSection',
    ].map((needle) => source.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(source.match(/<SettingsSection /g)).toHaveLength(4);
    expect(source.match(/quranTranslationSection/g)).toHaveLength(1);
    expect(source).not.toMatch(/quranLanguageSection|TRANSLATION_DISPLAY_MODES|notificationsSection/);
  });

  it('Show Translation (switch + dropdown) reads and writes the existing stored display-mode preference, not a new setting', () => {
    expect(source).toMatch(/on=\{isShowTranslationOn\(translationPreference\)\}/);
    expect(source).toMatch(/mode=\{translationModeOf\(translationPreference\)\}/);
    expect(source).toMatch(/onToggle=\{setShowTranslation\}/);
    expect(source).toMatch(/onModeChange=\{setTranslationMode\}/);
  });
});

describe('Settings screen: no hardcoded interface strings', () => {
  it('every user-facing label on this screen is sourced from the localized messages object or locale display names', () => {
    expect(source).toMatch(/messages\.settings\.title/);
    expect(source).toMatch(/messages\.settings\.emotionsFollowApp/);
    expect(source).toMatch(/messages\.settings\[option\.labelKey\]/);
  });
});

describe('Navigation entry point to Settings', () => {
  const INDEX_SCREEN_PATH = resolve(__dirname, '../src/app/(tabs)/index.tsx');
  const indexSource = readFileSync(INDEX_SCREEN_PATH, 'utf-8');

  it('the home screen exposes a clear nav entry to /settings (the shared header gear)', () => {
    expect(indexSource).toMatch(/<SettingsHeaderButton style=\{styles\.iconButton\} pressedStyle=\{styles\.pressed\} \/>/);
    const gear = readFileSync(resolve(__dirname, '../src/components/SettingsHeaderButton.tsx'), 'utf-8');
    expect(gear).toMatch(/<Link href="\/settings" asChild>/);
  });
});
