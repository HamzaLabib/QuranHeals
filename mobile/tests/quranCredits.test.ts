import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
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
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }), Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUpRight: 'ArrowUpRight', Settings: 'Settings' }));
vi.mock('expo-router', async () => {
  const { createElement: h } = await import('react');
  return { router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => state.canGoBack }, Link: ({ href, children }: { href: string; children: unknown }) => h('Link', { href }, children as never) };
});
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
    expect(shown).toMatch(/MP3Quran/);
    for (const key of ['tanzilWork', 'quranFoundationWork', 'kingFahdWork', 'amiriWork', 'mp3quranWork'] as const) expect(texts()).toContain(copy[key]);
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
      'https://www.mp3quran.net/',
      'https://www.mp3quran.net/eng/privacy',
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

describe('the Settings shortcut in the header (components/SettingsHeaderButton.tsx)', () => {
  /** The header row: the nearest host View holding the gear. */
  const header = () => {
    let node = root.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'header-settings')[0].parent!;
    while (String(node.type) !== 'View') node = node.parent!;
    return node;
  };
  /** A node's host children (composite wrappers looked through). */
  const hostChildren = (node: ReactTestInstance): ReactTestInstance[] => (node.children as ReactTestInstance[]).flatMap((c) => (typeof c === 'string' ? [] : typeof c.type === 'string' ? [c] : hostChildren(c)));
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: Back, the title, then the gear, which links to /settings; the row mirrors in Arabic`, async () => {
      state.locale = locale;
      await act(async () => { root = create(createElement(CreditsScreen)); });
      const gears = root.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'header-settings');
      expect(gears).toHaveLength(1);
      expect(gears[0].parent!.type).toBe('Link');
      expect(gears[0].parent!.props.href).toBe('/settings');
      expect(gears[0].props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: MESSAGES[locale].settings.openSettings });
      const row = header();
      const kids = hostChildren(row);
      expect(kids.map((k) => String(k.type))).toEqual(['Pressable', 'Text', 'Link']);
      expect(kids[0].props.accessibilityLabel).toBe(MESSAGES[locale].ayah.goBack);
      const rowStyle = Object.assign({}, ...[row.props.style].flat().filter(Boolean)) as { flexDirection?: string };
      expect(rowStyle.flexDirection).toBe(locale === 'ar' ? 'row-reverse' : 'row');
      // The title takes the remaining width, so the gear sits at the far end, opposite Back.
      expect(Object.assign({}, ...[kids[1].props.style].flat().filter(Boolean)).flex).toBe(1);
      // The gear matches the Back button beside it: the same 48-pt round button.
      const look = (n: ReactTestInstance) => Object.assign({}, ...[typeof n.props.style === 'function' ? n.props.style({ pressed: false }) : n.props.style].flat(3).filter(Boolean));
      expect(look(gears[0])).toEqual(look(kids[0]));
      expect(look(gears[0])).toMatchObject({ width: 48, height: 48 });
    });
  }
});
