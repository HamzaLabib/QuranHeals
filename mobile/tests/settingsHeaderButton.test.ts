import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * The Settings shortcut in screens' top headers (components/SettingsHeaderButton.tsx, 2026-10-14): Home's gear,
 * shared. On every standard screen header and the Khatma completion screen; never on the Mushaf reader, Settings
 * itself, دعاء ختم القرآن, or any sheet, modal or panel. Each screen's rendering in English and Arabic is checked in its own suite
 * (quranCredits.test.ts renders the header row; myReadingScreen, ayahLinkNavigation and homeTabsKhatma render the rest).
 */

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, Pressable: 'Pressable' }));
vi.mock('lucide-react-native', () => ({ Settings: 'Settings' }));
vi.mock('expo-router', async () => {
  const { createElement: h } = await import('react');
  return { Link: ({ href, asChild, children }: { href: string; asChild?: boolean; children: unknown }) => h('Link', { href, asChild }, children as never) };
});
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

const { SettingsHeaderButton } = await import('@/components/SettingsHeaderButton');
const { lightPalette } = await import('@/constants/theme');

let root: ReactTestRenderer;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
});
afterEach(async () => {
  await act(async () => root?.unmount());
});

describe('the shared Settings header button', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: a labelled button linking to the existing /settings screen, with the gear icon in the theme's icon colour`, async () => {
      state.locale = locale;
      const style = { width: 48, height: 48 };
      await act(async () => { root = create(createElement(SettingsHeaderButton, { style, pressedStyle: { opacity: 0.75 } })); });
      const link = root.root.findByType('Link' as never);
      expect(link.props).toMatchObject({ href: '/settings', asChild: true });
      const button = root.root.findByProps({ testID: 'header-settings' });
      expect(button.props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: MESSAGES[locale].settings.openSettings });
      expect(root.root.findByType('Settings' as never).props).toMatchObject({ size: 20, color: lightPalette.icon, strokeWidth: 2 });
      // The host screen's own button style, and its pressed feedback only while pressed.
      expect(button.props.style({ pressed: false })).toEqual([style, false]);
      expect(button.props.style({ pressed: true })).toEqual([style, { opacity: 0.75 }]);
    });
  }
});

const root_ = resolve(__dirname, '..');
const source = (path: string) => readFileSync(resolve(root_, path), 'utf8').split(String.fromCharCode(13)).join('');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
});

describe('where the shortcut appears', () => {
  const WITH = [
    'src/app/(tabs)/index.tsx', // Home
    'src/app/favorites.tsx',
    'src/app/(tabs)/reflections.tsx',
    'src/app/emotions.tsx', // All Emotions
    'src/components/AyahExperience.tsx', // every ayah screen: emotion, general Quran, /ayah/<surah>/<ayah>
    'src/app/(tabs)/my-reading.tsx', // أورادي وختماتي: Wirds and Khatma history
    'src/app/credits.tsx',
    'src/app/khatma-complete.tsx', // تقبل الله ختمتك: the gear alone (the screen has no Back button)
  ];

  it('exactly the screens with a standard header: once each, as the header row`s last item (after Back or the actions)', () => {
    const using = files(resolve(root_, 'src')).filter((path) => source(relative(root_, path)).includes('<SettingsHeaderButton'))
      .map((path) => relative(root_, path).split('\\').join('/')).sort();
    expect(using).toEqual([...WITH].sort());
    for (const path of WITH) {
      const text = source(path);
      expect(text.match(/<SettingsHeaderButton /g), path).toHaveLength(1);
      // In the screen's own header row, with the screen's own icon-button and pressed styles (matching its Back button).
      expect(text, path).toMatch(/<SettingsHeaderButton style=\{styles\.iconButton\} pressedStyle=\{styles\.pressed\} \/>/);
    }
  });

  it('the ayah screens all use the one ayah screen, so they all have it', () => {
    for (const path of ['src/app/ayah/[emotion].tsx', 'src/app/ayah/general.tsx', 'src/app/ayah/[surah]/[ayah].tsx']) {
      expect(source(path), path).toMatch(/<AyahExperience /);
    }
  });

  it('never on the Mushaf reader, Settings itself or دعاء ختم القرآن, nor any sheet, modal or panel', () => {
    for (const path of ['src/app/(tabs)/mushaf.tsx', 'src/app/settings.tsx', 'src/app/khatm-dua.tsx']) {
      expect(source(path), path).not.toMatch(/SettingsHeaderButton|href="\/settings"|'\/settings'/);
    }
    const sheets = files(resolve(root_, 'src/components')).map((path) => relative(root_, path).split('\\').join('/'))
      .filter((path) => /Sheet|Panel|Modal|Mushaf|Selector|Accordion/.test(path));
    expect(sheets.length).toBeGreaterThan(5);
    for (const path of sheets) expect(source(path), path).not.toMatch(/SettingsHeaderButton/);
  });

  it('one Settings route: nothing else links to /settings but the shared button', () => {
    const linking = files(resolve(root_, 'src')).filter((path) => /href="\/settings"|['"]\/settings['"]/.test(source(relative(root_, path))))
      .map((path) => relative(root_, path).split('\\').join('/'));
    expect(linking).toEqual(['src/components/SettingsHeaderButton.tsx']);
  });

  it('the bottom tabs are still the four', () => {
    expect(source('src/app/(tabs)/_layout.tsx').match(/<Tabs\.Screen name="/g)).toHaveLength(4);
  });
});
