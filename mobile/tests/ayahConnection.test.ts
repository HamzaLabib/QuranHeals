import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' | 'ar-EG', scheme: 'light' as 'light' | 'dark' }));

vi.mock('react-native', () => ({
  useColorScheme: () => state.scheme,
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
}));
vi.mock('lucide-react-native', () => ({ Heart: 'Heart', ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp' }));
vi.mock('@/localization/useAppLocale', async () => {
  const { MESSAGES } = await import('@/localization/messages');
  return { useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) };
});
// Appearance mode is 'system' for these tests so flipping state.scheme
// still exercises dark mode — the app default is now Light (see
// appearancePreference.ts), which would otherwise ignore state.scheme.
vi.mock('@/theme/useAppearancePreference', () => ({
  useAppearancePreference: () => ({ mode: 'system', isReady: true, setMode: vi.fn() }),
}));

import { AyahConnectionAccordion } from '@/components/AyahConnectionAccordion';
import { darkPalette, lightPalette } from '@/constants/theme';
import { MESSAGES } from '@/localization/messages';
import type { AyahConnection, EmotionAyah } from '@/types/domain';
import { composeLocalAyah, type QuranRepository } from '@/services/quranRepository';
import { resolveConnectionText, splitAyahConnection } from '@/utils/ayahConnection';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8');

// Placeholder strings for tests only — never real editorial content.
const SAD: AyahConnection = { emotionKey: 'sad', en: 'TEST-EN sad', ar: 'TEST-AR sad' };
const HOPELESS: AyahConnection = { emotionKey: 'hopeless', en: 'TEST-EN hopeless', ar: 'TEST-AR hopeless' };

afterEach(() => {
  state.locale = 'en';
  state.scheme = 'light';
});

describe('resolveConnectionText: per emotion–ayah mapping, per locale', () => {
  it('1/14. returns null (section hidden) when there is no connection or no text', () => {
    expect(resolveConnectionText(undefined, 'sad', 'en')).toBeNull();
    expect(resolveConnectionText({ emotionKey: 'sad' }, 'sad', 'en')).toBeNull();
    expect(resolveConnectionText({ emotionKey: 'sad', en: '   ', ar: 'TEST-AR' }, 'sad', 'en')).toBeNull();
  });

  it('8. English locale uses connection.en', () => {
    expect(resolveConnectionText(SAD, 'sad', 'en')).toBe('TEST-EN sad');
  });

  it('9/10. ar and ar-EG both use connection.ar', () => {
    expect(resolveConnectionText(SAD, 'sad', 'ar')).toBe('TEST-AR sad');
    expect(resolveConnectionText(SAD, 'sad', 'ar-EG')).toBe('TEST-AR sad');
  });

  it('14. a missing current-locale text never falls back to the other language', () => {
    expect(resolveConnectionText({ emotionKey: 'sad', en: 'TEST-EN only' }, 'sad', 'ar')).toBeNull();
    expect(resolveConnectionText({ emotionKey: 'sad', ar: 'TEST-AR only' }, 'sad', 'en')).toBeNull();
  });

  it('12/13. selects by emotion: the same verse shows each emotion’s own text, and never another emotion’s', () => {
    expect(resolveConnectionText(SAD, 'sad', 'en')).toBe('TEST-EN sad');
    expect(resolveConnectionText(HOPELESS, 'hopeless', 'en')).toBe('TEST-EN hopeless');
    expect(resolveConnectionText(SAD, 'hopeless', 'en')).toBeNull();
    expect(resolveConnectionText(SAD, undefined, 'en')).toBeNull(); // general Quran flow: no emotion
  });

  it('trims surrounding whitespace', () => {
    expect(resolveConnectionText({ emotionKey: 'sad', en: '  TEST-EN  ' }, 'sad', 'en')).toBe('TEST-EN');
  });

  it('splitAyahConnection keeps connection text out of the stored ayah', () => {
    const ayah = { id: '94:6', verseKey: '94:6', connection: SAD } as EmotionAyah;
    const { ayah: stored, connection } = splitAyahConnection(ayah);
    expect(stored).not.toHaveProperty('connection');
    expect(connection).toBe(SAD);
  });
});

describe('AyahConnectionAccordion', () => {
  let root: ReactTestRenderer;
  const render = (text: string, resetKey: number | string = 1) =>
    act(() => {
      root = create(createElement(AyahConnectionAccordion, { text, resetKey }));
    });
  const header = () => root.root.findByType('Pressable' as never);
  const texts = () => root.root.findAllByType('Text' as never).map((node) => node.props.children);
  const press = () => act(() => header().props.onPress());

  it('2/3/6. renders the English heading, collapsed by default (no body text)', () => {
    render('TEST-EN body');
    expect(texts()).toEqual(['How this ayah connects']);
    expect(header().props.accessibilityState).toEqual({ expanded: false });
    expect(root.root.findAllByType('ChevronDown' as never)).toHaveLength(1);
  });

  it('4/5. tapping the header expands, tapping again collapses', () => {
    render('TEST-EN body');
    press();
    expect(texts()).toEqual(['How this ayah connects', 'TEST-EN body']);
    expect(header().props.accessibilityState).toEqual({ expanded: true });
    expect(root.root.findAllByType('ChevronUp' as never)).toHaveLength(1);
    press();
    expect(texts()).toEqual(['How this ayah connects']);
    expect(header().props.accessibilityState).toEqual({ expanded: false });
  });

  it('11. a new ayah (resetKey change) collapses it again', () => {
    render('TEST-EN first', 1);
    press();
    expect(header().props.accessibilityState.expanded).toBe(true);
    act(() => root.update(createElement(AyahConnectionAccordion, { text: 'TEST-EN second', resetKey: 2 })));
    expect(header().props.accessibilityState.expanded).toBe(false);
    expect(texts()).toEqual(['How this ayah connects']);
  });

  // Layout helpers: [container, title group, chevron slot] are the accordion's Views.
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  const views = () => root.root.findAllByType('View' as never);
  const headerStyle = () => flat(header().props.style({ pressed: false }));
  const groupStyle = () => flat(views()[1].props.style);
  const chevronStyle = () => flat(views()[2].props.style);

  it('centers the heart + title group truly: equal space on both sides, chevron outside the flow', () => {
    render('TEST-EN body');
    const headerLayout = headerStyle();
    expect(headerLayout.justifyContent).toBe('center');
    expect(headerLayout.paddingHorizontal).toBeGreaterThanOrEqual(18 + 14); // room for the chevron on BOTH sides
    expect(headerLayout).not.toHaveProperty('paddingLeft');
    expect(headerLayout).not.toHaveProperty('paddingRight');
    expect(groupStyle()).toMatchObject({ flexDirection: 'row', justifyContent: 'center', alignSelf: 'center' });
    // The chevron is absolutely positioned inside the reserved slot, so it cannot push the group.
    expect(chevronStyle()).toMatchObject({ position: 'absolute', right: 14, pointerEvents: 'none' });
    expect(chevronStyle()).not.toHaveProperty('left');
    expect(views()[2].findByType('ChevronDown' as never)).toBeDefined();
    // Heart sits inline immediately before the title, inside the centered group.
    expect(views()[1].children.map((child) => (child as { type: string }).type)).toEqual(['Heart', 'Text']);
    expect(flat(root.root.findAllByType('Text' as never)[0].props.style)).toMatchObject({ textAlign: 'center' });
  });

  it('only the header is centered: the English body keeps left-aligned reading', () => {
    render('TEST-EN body');
    press();
    const body = root.root.findAllByType('Text' as never)[1];
    expect(flat(body.props.style)).toMatchObject({ writingDirection: 'ltr', textAlign: 'left' });
  });

  it.each(['ar', 'ar-EG'] as const)('7. %s: Arabic heading stays centered, heart beside it at the start, chevron at the outer (left) edge, body right-aligned', (locale) => {
    state.locale = locale;
    render('TEST-AR body');
    expect(texts()).toEqual(['كيف ترتبط هذه الآية بشعورك']);
    // Same symmetric centering as English — RTL never shifts the group.
    expect(headerStyle()).toMatchObject({ justifyContent: 'center' });
    expect(headerStyle().paddingHorizontal).toBeGreaterThanOrEqual(18 + 14);
    // Group mirrors so the heart is at the start (right) of the Arabic title.
    expect(groupStyle()).toMatchObject({ flexDirection: 'row-reverse', justifyContent: 'center' });
    expect(flat(root.root.findAllByType('Text' as never)[0].props.style)).toMatchObject({ textAlign: 'center', writingDirection: 'rtl' });
    expect(chevronStyle()).toMatchObject({ position: 'absolute', left: 14 });
    expect(chevronStyle()).not.toHaveProperty('right');
    press();
    const body = root.root.findAllByType('Text' as never)[1];
    expect(flat(body.props.style)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('the whole header row is the single, labelled tap target; icons carry no own accessibility props', () => {
    render('TEST-EN body');
    expect(root.root.findAllByType('Pressable' as never)).toHaveLength(1);
    expect(header().props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'How this ayah connects', accessibilityState: { expanded: false } });
    for (const icon of ['Heart', 'ChevronDown']) expect(root.root.findByType(icon as never).props).not.toHaveProperty('accessible');
  });

  it('uses a solid (filled) olive heart, inline with the title — not inside a circular button like Favorite', () => {
    render('TEST-EN body');
    const heart = root.root.findByType('Heart' as never);
    expect(heart.props).toMatchObject({ size: 18, color: lightPalette.sageHeart, fill: lightPalette.sageHeart });
    expect(heart.props.fill).not.toBe('transparent');
    expect(heart.parent?.type).toBe('View'); // the title group, not a Pressable of its own
  });

  it('16. switches to the dark sage surface and the muted dark heart in dark mode', () => {
    state.scheme = 'dark';
    render('TEST-EN body');
    const container = root.root.findAllByType('View' as never)[0].props.style;
    expect(container).toMatchObject({ backgroundColor: darkPalette.sageSurface, borderColor: darkPalette.sageBorder });
    expect(root.root.findByType('Heart' as never).props).toMatchObject({ color: darkPalette.sageHeart, fill: darkPalette.sageHeart });
  });
});

describe('sage theme tokens', () => {
  function luminance(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('16. light and dark each have their own sage surface (dark is not the light color reused)', () => {
    expect(lightPalette.sageSurface).not.toBe(darkPalette.sageSurface);
    expect(lightPalette).toMatchObject({ sageSurface: '#EEF2E9', sageBorder: '#DCE4D3' });
    // Dark mode uses the blue/cyan accent family, not the light theme's olive/sage.
    expect(darkPalette).toMatchObject({ sageSurface: '#2A303A', sageBorder: '#44617A' });
  });

  it('keeps heading/body text well above AA and both icons visible (≥3:1, non-text) on sage in both themes', () => {
    for (const palette of [lightPalette, darkPalette]) {
      expect(contrast(palette.textPrimary, palette.sageSurface)).toBeGreaterThanOrEqual(7); // heading + body
      expect(contrast(palette.sageHeart, palette.sageSurface)).toBeGreaterThanOrEqual(3); // filled heart icon
      expect(contrast(palette.textSecondary, palette.sageSurface)).toBeGreaterThanOrEqual(3); // chevron icon only
    }
    // No text in the section uses textSecondary (it is below 4.5:1 on light sage).
    const source = read('src/components/AyahConnectionAccordion.tsx');
    expect(source.match(/textSecondary/g)).toHaveLength(1);
    expect(source).toMatch(/<Chevron size=\{ICON_SIZE\} color=\{colors\.textSecondary\}/);
  });

  it('the filled heart is a calm olive in light mode: darker than the sage surface', () => {
    expect(lightPalette.sageHeart).toBe('#6B7F5E');
    expect(luminance(lightPalette.sageHeart)).toBeLessThan(luminance(lightPalette.sageSurface)); // darker than light sage
    const n = parseInt(lightPalette.sageHeart.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    expect(g).toBeGreaterThan(r); // green-leaning olive, never pink/rose/red
    expect(g).toBeGreaterThan(b);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(40); // muted, not bright green
  });

  it('the filled heart is a calm blue in dark mode: softer than the main accent, never olive/green', () => {
    expect(darkPalette.sageHeart).toBe('#6E8694');
    expect(luminance(darkPalette.sageHeart)).toBeLessThan(luminance(darkPalette.accent)); // not the bright dark accent
    const n = parseInt(darkPalette.sageHeart.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    expect(b).toBeGreaterThan(r); // blue-leaning, never green/olive
    expect(b).toBeGreaterThanOrEqual(g);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(40); // muted, not neon cyan
  });

  it('stays muted (no saturated/neon blue) in dark mode', () => {
    const n = parseInt(darkPalette.sageSurface.slice(1), 16);
    const channels = [n >> 16, (n >> 8) & 255, n & 255];
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(16);
  });
});

describe('17. API → page: the connection reaches the page without any UI change', () => {
  it('composeLocalAyah (used by getRandomAyah) keeps the API’s connection while resolving local Arabic', async () => {
    const repository = { getVerseByKey: async () => ({ verseKey: '94:6', surah: 94, ayah: 6, arabicText: 'ARABIC' }) } as unknown as QuranRepository;
    const composed = await composeLocalAyah({ id: '94:6', verseKey: '94:6', connection: SAD } as EmotionAyah, repository);
    expect(composed.connection).toBe(SAD);
    expect(resolveConnectionText(composed.connection, 'sad', 'en')).toBe('TEST-EN sad');
  });

  it('getRandomAyah is typed to carry the connection; getAyah (by verse, general flow) is not', () => {
    const api = read('src/services/api.ts');
    expect(api).toContain('requestApi<EmotionAyah>(`/api/ayahs/random?');
    expect(api).toContain('requestApi<Ayah>(`/api/ayahs/${encodeURIComponent(id)}`)');
  });
});

describe('21. no React Native Web "non-boolean attribute accessible" warning from Lucide icons', () => {
  it('no Lucide icon element anywhere in src receives an accessible prop', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = resolve(dir, name);
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.tsx') ? [path] : [];
      });
    const offenders: string[] = [];
    let scannedIcons = 0;
    for (const path of walk(resolve(__dirname, '../src'))) {
      const source = readFileSync(path, 'utf-8');
      const importList = /import \{([^}]*)\} from 'lucide-react-native'/.exec(source)?.[1] ?? '';
      const imported = importList.split(',').map((name) => name.trim()).filter(Boolean);
      // Icons rendered through an alias, e.g. `const Chevron = expanded ? ChevronUp : ChevronDown;`.
      const aliases = imported.length
        ? [...source.matchAll(new RegExp(`const (\\w+) = [^;]*\\b(?:${imported.join('|')})\\b[^;]*;`, 'g'))].map((match) => match[1])
        : [];
      for (const icon of [...imported, ...aliases]) {
        scannedIcons++;
        if (new RegExp(`<${icon}\\b[^>]*\\baccessible=`).test(source)) offenders.push(`${path}: <${icon} accessible=…>`);
      }
    }
    expect(scannedIcons).toBeGreaterThan(10); // the scan really saw the app's icons
    expect(offenders).toEqual([]);
  });

  it('the scan would catch the old pattern', () => {
    expect(new RegExp('<Heart\\b[^>]*\\baccessible=').test('<Heart size={18} color={c} accessible={false} />')).toBe(true);
  });
});

describe('ayah page wiring', () => {
  const page = read('src/components/AyahExperience.tsx');

  it('places the section after Share | Reflection | Favorite and before Report an issue', () => {
    const favorite = page.indexOf('<FavoriteButton');
    const accordion = page.indexOf('<AyahConnectionAccordion');
    const report = page.indexOf('messages.issueReport.action}');
    const another = page.indexOf('messages.ayah.anotherAyah}');
    expect(another).toBeGreaterThan(-1);
    expect(another).toBeLessThan(favorite);
    expect(favorite).toBeLessThan(accordion);
    expect(accordion).toBeLessThan(report);
  });

  it('renders only when this emotion’s mapping has text for the active locale, and resets per loaded ayah', () => {
    expect(page).toMatch(/\{connectionText && <AyahConnectionAccordion text=\{connectionText\} resetKey=\{ayahLoadId\} \/>\}/);
    expect(page).toMatch(/resolveConnectionText\(connection, source\.mode === 'emotion' \? source\.emotionKey : undefined, locale\)/);
    expect(page).toMatch(/setAyahLoadId\(\(id\) => id \+ 1\)/);
  });

  it('never stores connection text with favorites/history', () => {
    expect(page).toMatch(/const shown = splitAyahConnection\(nextAyah\);\s*setAyah\(shown\.ayah\);/);
    expect(page).toMatch(/recordShownAyah\(historyKey, shown\.ayah\)/);
  });

  it('6/7. heading localization, with the body never in localization files', () => {
    expect(MESSAGES.en.ayah.connectionHeading).toBe('How this ayah connects');
    expect(MESSAGES.ar.ayah.connectionHeading).toBe('كيف ترتبط هذه الآية بشعورك');
    expect(MESSAGES['ar-EG'].ayah.connectionHeading).toBe('كيف ترتبط هذه الآية بشعورك');
  });
});
