import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * Quran sources and credits: a short line at the bottom of Home and the
 * /credits page it links to. Tanzil asks that its name be shown with a link
 * to tanzil.net; Quran Foundation, for its fonts and layout, a credit "in a
 * reasonably accessible place in the Application or its associated credits";
 * the King Fahd Complex holds the QCF V1 fonts' and the artwork's copyright.
 */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  canGoBack: true,
  openURL: vi.fn(),
}));
vi.mock('react-native', () => ({
  Linking: { openURL: state.openURL },
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUpRight: 'ArrowUpRight' }));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => state.canGoBack } }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

const { default: CreditsScreen } = await import('@/app/credits');
const { QURAN_SOURCES } = await import('@/constants/quranSources');
const { router } = await import('expo-router');

let root: ReactTestRenderer;
const texts = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
const links = () => root.root.findAllByType('Pressable' as never).filter((node) => node.props.accessibilityRole === 'link');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.canGoBack = true;
  state.openURL.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('Quran Sources & Credits page', () => {
  it('credits Quran text, layout, artwork and the licensed running-head font separately', async () => {
    await act(async () => { root = create(createElement(CreditsScreen)); });
    const shown = texts().join('\n');
    const copy = MESSAGES.en.credits;
    expect(texts()).toContain('Quran Sources & Credits');
    expect(shown).toMatch(/Tanzil Project/);
    expect(shown).toMatch(/Uthmani 1\.1/);
    expect(shown).toMatch(/Creative Commons Attribution 3\.0/);
    expect(shown).toMatch(/Quran Foundation/);
    expect(shown).toMatch(/QPC V1/);
    expect(shown).toMatch(/King Fahd Glorious Qur’an Printing Complex/);
    expect(shown).toMatch(/typography and artwork/);
    expect(shown).toMatch(/Amiri Project Authors/);
    expect(shown).toMatch(/SIL Open Font License 1\.1/);
    for (const key of ['tanzilWork', 'quranFoundationWork', 'kingFahdWork', 'amiriWork'] as const) expect(texts()).toContain(copy[key]);
  });

  it('links to the official sites and terms, as accessible links that open in the browser', async () => {
    await act(async () => { root = create(createElement(CreditsScreen)); });
    const urls = QURAN_SOURCES.flatMap((source) => source.links.map((link) => link.url));
    expect(urls).toEqual([
      'https://tanzil.net/',
      'https://tanzil.net/docs/text_license',
      'https://quran.foundation/',
      'https://api-docs.quran.foundation/legal/developer-terms/',
      'https://qurancomplex.gov.sa/',
      'https://github.com/aliftype/amiri',
      'https://openfontlicense.org/',
    ]);
    expect(links()).toHaveLength(urls.length);
    for (const link of links()) {
      expect(link.props.accessibilityLabel).toMatch(/: /); // "Tanzil Project: Licence"
      expect(link.props.accessibilityHint).toBe(MESSAGES.en.settings.opensInBrowser);
    }
    await act(async () => links()[0].props.onPress());
    expect(state.openURL).toHaveBeenCalledWith('https://tanzil.net/');
  });

  it('ships the exact Amiri font copyright and SIL OFL notice with the app assets', () => {
    const shipped = readFileSync(resolve(__dirname, '../assets/licenses/OFL-Amiri.txt'), 'utf8');
    const upstream = readFileSync(resolve(__dirname, '../node_modules/@expo-google-fonts/amiri/LICENSE_FONT'), 'utf8');
    expect(shipped).toBe(upstream);
    expect(shipped).toContain('Copyright 2010-2022 The Amiri Project Authors');
    expect(shipped).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('Back returns to the previous screen, or Home when opened directly', async () => {
    await act(async () => { root = create(createElement(CreditsScreen)); });
    const back = root.root.findAllByType('Pressable' as never).find((node) => node.props.accessibilityLabel === MESSAGES.en.ayah.goBack)!;
    await act(async () => back.props.onPress());
    expect(router.back).toHaveBeenCalled();
    state.canGoBack = false;
    await act(async () => back.props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  for (const locale of ['ar', 'ar-EG'] as const) {
    it(`${locale}: in Arabic, right to left, with the owners' names as they publish them`, async () => {
      state.locale = locale;
      await act(async () => { root = create(createElement(CreditsScreen)); });
      expect(texts()).toContain('مصادر القرآن وحقوق النشر');
      expect(texts().join('\n')).toMatch(/مجمع الملك فهد لطباعة المصحف الشريف/);
      expect(texts().join('\n')).toMatch(/Quran Foundation/);
      expect(links().every((link) => /[؀-ۿ]/.test(link.props.accessibilityLabel))).toBe(true);
    });
  }
});

describe('Home footer', () => {
  const home = readFileSync(resolve(__dirname, '../src/app/(tabs)/index.tsx'), 'utf-8').split(String.fromCharCode(13)).join('');

  it('every language has the short credit and the link text', () => {
    for (const locale of APP_LOCALES) {
      const { sourcesCredit, sourcesLink } = MESSAGES[locale].home;
      for (const name of ['Tanzil|تنزيل', 'Quran Foundation', 'King Fahd|مجمع الملك فهد']) expect(sourcesCredit, `${locale} ${name}`).toMatch(new RegExp(name));
      expect(sourcesLink.length).toBeGreaterThan(0);
    }
    expect(MESSAGES.en.home.sourcesLink).toBe('Quran Sources & Credits');
    expect(MESSAGES.ar.home.sourcesLink).toBe('مصادر القرآن وحقوق النشر');
    expect(MESSAGES['ar-EG'].home.sourcesLink).toBe('مصادر القرآن وحقوق النشر');
  });

  it('is the last thing on Home, under "A Message from the Quran" (the disclaimer moved to /emotions), and links to /credits as an accessible link', () => {
    const general = home.indexOf("router.push('/ayah/general')");
    const footer = home.indexOf('testID="home-sources"');
    const scrollEnd = home.indexOf('</ScrollView>');
    expect(general).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(general);
    expect(scrollEnd).toBeGreaterThan(footer);
    const block = home.slice(footer, scrollEnd);
    expect(block).toMatch(/<Link href="\/credits" asChild>/);
    expect(block).toMatch(/accessibilityRole="link"/);
    expect(block).toMatch(/accessibilityLabel=\{messages\.home\.sourcesLink\}/);
    // Subtle and themed: muted palette colours, small type.
    expect(home).toMatch(/sourcesCredit: \{\n    color: colors\.textMuted,\n    fontSize: typography\.small,/);
  });

  it('the Mushaf reader no longer prints the credit under the page', () => {
    const reader = readFileSync(resolve(__dirname, '../src/app/(tabs)/mushaf.tsx'), 'utf-8');
    expect(reader).not.toMatch(/qpcCredit|artworkCredit|styles\.credit/);
  });
});
