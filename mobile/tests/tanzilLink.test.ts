import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openURL: vi.fn(async (_url: string) => {}),
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
}));

// Inspect the real card's element tree and invoke its handlers without a native renderer.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => {},
  useMemo: (compute: () => unknown) => compute(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.default ?? options.web },
  Linking: { openURL: mocks.openURL },
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('lucide-react-native', () => ({ ArrowUpRight: 'ArrowUpRight', Check: 'Check', Copy: 'Copy' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: mocks.locale, messages: MESSAGES[mocks.locale] }),
}));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: 'always' } }),
}));
vi.mock('@/localization/useQuranFontSizePreference', () => ({
  useQuranFontSizePreference: () => ({ preferredSize: 26 }),
}));
vi.mock('@/components/QuranFontSizeControls', () => ({ QuranFontSizeControls: 'QuranFontSizeControls' }));

import { AyahCard } from '@/components/AyahCard';
import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';
import { colors } from '@/constants/theme';
import type { Ayah } from '@/types/domain';
import { formatAyahReference } from '@/utils/ayahReference';
import { buildTanzilAyahUrl } from '@/utils/tanzilLink';

type ElementProps = {
  children?: ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { disabled: boolean };
  disabled?: boolean;
  onPress?: () => void;
  style?: unknown;
  color?: string;
  size?: number;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  const result: ReactElement<ElementProps>[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<ElementProps>(child)) {
      result.push(child, ...elements(child.props.children));
    }
  });
  return result;
}

const ayah: Ayah = {
  id: '39:62',
  referenceKey: '39:62',
  surahNumber: 39,
  ayahNumber: 62,
  surahNameEnglish: 'Az-Zumar',
  surahNameArabic: 'الزمر',
  arabicText: 'اللَّهُ خَالِقُ كُلِّ شَيْءٍ',
  englishTranslation: 'Allah is Creator of all things.',
  emotions: [],
  quranTextSource: 'Tanzil',
  translationSource: 'Pickthall',
};

function cardLink(currentAyah = ayah, compact = false) {
  const tree = AyahCard({ ayah: currentAyah, compact });
  const link = elements(tree).find((element) => element.props.accessibilityRole === 'link');
  expect(link).toBeDefined();
  return { tree, link: link! };
}

beforeEach(() => {
  mocks.openURL.mockReset().mockResolvedValue(undefined);
  mocks.locale = 'en';
});

describe('buildTanzilAyahUrl: exact Tanzil deep link for a given surah/ayah', () => {
  it('Maryam 19:58 produces exactly https://tanzil.net/#19:58', () => {
    expect(buildTanzilAyahUrl(19, 58)).toBe('https://tanzil.net/#19:58');
  });

  it('Yusuf 12:92 produces exactly https://tanzil.net/#12:92', () => {
    expect(buildTanzilAyahUrl(12, 92)).toBe('https://tanzil.net/#12:92');
  });

  it('Al-Baqarah 2:286 produces exactly https://tanzil.net/#2:286', () => {
    expect(buildTanzilAyahUrl(2, 286)).toBe('https://tanzil.net/#2:286');
  });

  it('the first surah/ayah (1:1) and the last surah (114) both resolve correctly', () => {
    expect(buildTanzilAyahUrl(1, 1)).toBe('https://tanzil.net/#1:1');
    expect(buildTanzilAyahUrl(114, 6)).toBe('https://tanzil.net/#114:6');
  });

  it('never converts the surah/ayah numbers to Arabic-Indic digits', () => {
    const url = buildTanzilAyahUrl(19, 58)!;
    expect(url).not.toMatch(/[٠-٩]/);
  });

  describe('invalid input never produces a URL (and never crashes) — no incorrect fallback ayah is ever opened', () => {
    it('surah 0 (below range)', () => expect(buildTanzilAyahUrl(0, 1)).toBeNull());
    it('surah 115 (above range)', () => expect(buildTanzilAyahUrl(115, 1)).toBeNull());
    it('surah -1 (negative)', () => expect(buildTanzilAyahUrl(-1, 1)).toBeNull());
    it('surah 1.5 (non-integer)', () => expect(buildTanzilAyahUrl(1.5, 1)).toBeNull());
    it('ayah 0 (not a positive integer)', () => expect(buildTanzilAyahUrl(2, 0)).toBeNull());
    it('ayah -5 (negative)', () => expect(buildTanzilAyahUrl(2, -5)).toBeNull());
    it('ayah 3.2 (non-integer)', () => expect(buildTanzilAyahUrl(2, 3.2)).toBeNull());
    it('ayah 287 (above the true maximum of 286)', () => expect(buildTanzilAyahUrl(2, 287)).toBeNull());
    it('NaN surah/ayah', () => {
      expect(buildTanzilAyahUrl(NaN, 1)).toBeNull();
      expect(buildTanzilAyahUrl(1, NaN)).toBeNull();
    });
    it('missing values (undefined passed through a loosely-typed caller)', () => {
      expect(buildTanzilAyahUrl(undefined as unknown as number, 1)).toBeNull();
      expect(buildTanzilAyahUrl(1, undefined as unknown as number)).toBeNull();
    });
  });
});

describe('AyahCard reference opens the current ayah in Tanzil', () => {
  it.each([false, true])('the entire reference is pressable, including compact=%s', (compact) => {
    const { link } = cardLink(ayah, compact);
    expect(link.type).toBe('Pressable');
    expect(link.props.disabled).toBe(false);
    const children = elements(link.props.children);
    expect(children.find((child) => child.type === 'Text')?.props.children)
      .toBe(formatAyahReference(39, 62));
    expect(children.find((child) => child.type === 'ArrowUpRight')?.props)
      .toMatchObject({ size: 16, color: colors.olive });
    expect(mocks.openURL).not.toHaveBeenCalled();
    link.props.onPress!();
    expect(mocks.openURL).toHaveBeenCalledExactlyOnceWith('https://tanzil.net/#39:62');
  });

  it('uses the new current ayah when a different card is rendered', () => {
    cardLink().link.props.onPress!();
    cardLink({ ...ayah, id: '19:58', surahNumber: 19, ayahNumber: 58 }).link.props.onPress!();
    expect(mocks.openURL.mock.calls.map(([url]) => url))
      .toEqual(['https://tanzil.net/#39:62', 'https://tanzil.net/#19:58']);
  });

  it.each(APP_LOCALES)('labels the exact ayah with the localized action in %s', (locale) => {
    mocks.locale = locale;
    const { link } = cardLink();
    expect(link.props.accessibilityLabel)
      .toBe(`${MESSAGES[locale].ayah.readInQuran}: ${formatAyahReference(39, 62)}`);
  });

  it('keeps attribution as plain text outside the pressable reference', () => {
    const { tree, link } = cardLink();
    const attribution = elements(tree).find((element) =>
      element.props.children === 'Quran text: Tanzil · Uthmani 1.1');
    expect(attribution?.type).toBe('Text');
    expect(attribution?.props.onPress).toBeUndefined();
    expect(attribution?.props.accessibilityRole).toBeUndefined();
    expect(elements(link)).not.toContain(attribution);
    const referenceGroup = elements(tree).find((element) =>
      Array.isArray(element.props.children) && element.props.children.includes(link));
    expect(referenceGroup?.props.children).toEqual([link, attribution]);
  });

  it('disables invalid references and never opens a fallback URL', () => {
    const { link } = cardLink({ ...ayah, ayahNumber: 999 });
    expect(link.props.disabled).toBe(true);
    expect(link.props.accessibilityState).toEqual({ disabled: true });
    expect(elements(link).some((element) => element.type === 'ArrowUpRight')).toBe(false);
    link.props.onPress!();
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('catches a rejected external link without crashing', async () => {
    mocks.openURL.mockRejectedValueOnce(new Error('No browser available'));
    expect(() => cardLink().link.props.onPress!()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.openURL).toHaveBeenCalledExactlyOnceWith('https://tanzil.net/#39:62');
  });
});

describe('Shared reference link and action hierarchy', () => {
  const experience = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');
  const card = readFileSync(resolve(__dirname, '../src/components/AyahCard.tsx'), 'utf-8');
  const favorites = readFileSync(resolve(__dirname, '../src/app/favorites.tsx'), 'utf-8');

  it('removes the standalone action, styles, and link handler from AyahExperience', () => {
    expect(experience).not.toMatch(/readInQuran|openInTanzil|buildTanzilAyahUrl|ArrowUpRight|\bLinking\b/);
  });

  it('keeps AyahCard, Another Ayah, Share/Reflection/Favorite, then Report Issue', () => {
    const ordered = [
      '<AyahCard ayah={ayah} />',
      'messages.ayah.anotherAyah',
      '<View style={styles.actions}>',
      'accessibilityLabel={messages.ayah.shareAyah}',
      'accessibilityLabel={messages.reflection.writeAction}',
      '<FavoriteButton',
      'accessibilityLabel={messages.issueReport.action}',
    ].map((needle) => experience.indexOf(needle));
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(experience).not.toMatch(/styles\.actions,\s*isRtl/);
    expect(experience).toContain('onPress={() => setIsReflectionVisible(true)}');
    expect(experience).toContain('onToggle={() => toggleFavorite(ayah)}');
    expect(experience).toContain('onPress={() => setIsReportVisible(true)}');
    expect(experience).toContain('onPress={loadAyah}');
  });

  it('Favorites inherits the reference through the same compact card', () => {
    expect(favorites).toContain('<AyahCard ayah={favorite} compact />');
    expect(favorites).toContain('<FavoriteActions favorite={favorite} onRemove={removeFavorite}');
  });

  it('uses the existing URL builder in the shared card', () => {
    expect(card).toContain('buildTanzilAyahUrl(ayah.surahNumber, ayah.ayahNumber)');
  });

  it('keeps the original olive reference styling and attribution spacing with pressed feedback', () => {
    const style = card.match(/referenceLink: \{[\s\S]*?\n {2}\},/)?.[0];
    expect(style).toBeDefined();
    expect(style).not.toMatch(/backgroundColor|border|padding|margin|height/i);
    const referenceRow = card.match(/referenceRow: \{[\s\S]*?\n {2}\},/)?.[0];
    expect(referenceRow).toContain('gap: spacing.xs');
    expect(card).toContain('[styles.referenceLink, pressed && styles.pressed]');
    const reference = card.match(/reference: \{[\s\S]*?\n {2}\},/)?.[0];
    expect(reference).toContain('color: colors.olive');
    expect(colors.olive).toBe('#617256');
  });
});

describe('Localization: "Read in Quran" text comes from the app\'s message system, in all three languages', () => {
  it('English wording is exactly "Read in Quran"', () => {
    expect(MESSAGES.en.ayah.readInQuran).toBe('Read in Quran');
  });

  it('Arabic wording is exactly "اقرأ الآية في المصحف"', () => {
    expect(MESSAGES.ar.ayah.readInQuran).toBe('اقرأ الآية في المصحف');
  });

  it('Egyptian Arabic matches Standard Arabic for this action (consistent with this app\'s existing general-UI convention)', () => {
    expect(MESSAGES['ar-EG'].ayah.readInQuran).toBe(MESSAGES.ar.ayah.readInQuran);
  });

  it('every supported locale defines a non-empty readInQuran string', () => {
    for (const locale of APP_LOCALES) {
      expect(MESSAGES[locale].ayah.readInQuran.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Save and Share are icon-only, with accessibility labels preserved and a ~44x44 touch target', () => {
  const favoriteButtonSource = readFileSync(resolve(__dirname, '../src/components/FavoriteButton.tsx'), 'utf-8');
  const ayahExperienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');

  it('FavoriteButton renders only the Heart icon — no visible "Save"/"Saved" text', () => {
    expect(favoriteButtonSource).toMatch(/<Heart /);
    expect(favoriteButtonSource).not.toMatch(/<Text/);
  });

  it('FavoriteButton keeps its saveLabel/removeLabel accessibility labels and saved/unsaved visual state (fill + colors) exactly as before', () => {
    expect(favoriteButtonSource).toMatch(/accessibilityLabel=\{isSaved \? messages\.favoriteButton\.removeLabel : messages\.favoriteButton\.saveLabel\}/);
    expect(favoriteButtonSource).toMatch(/fill=\{isSaved \? colors\.surface : 'transparent'\}/);
    expect(favoriteButtonSource).toMatch(/isSaved && styles\.saved/);
  });

  it('FavoriteButton keeps a >=44x44 touch target', () => {
    const buttonStyleBlock = favoriteButtonSource.match(/button: \{[\s\S]*?\},/)?.[0] ?? '';
    expect(buttonStyleBlock).toMatch(/height:\s*48/);
    expect(buttonStyleBlock).toMatch(/width:\s*48/);
  });

  it('the bottom-row Share button is icon-only (no visible text) but keeps its shareAyah accessibility label', () => {
    const actionsBlock = ayahExperienceSource.match(/<View style=\{styles\.actions\}>[\s\S]*?\n {12}<\/View>/)?.[0] ?? '';
    const shareButtonBlock = actionsBlock.match(/<Pressable[\s\S]*?accessibilityLabel=\{messages\.ayah\.shareAyah\}[\s\S]*?<\/Pressable>/)?.[0] ?? '';
    expect(shareButtonBlock.length).toBeGreaterThan(0);
    expect(shareButtonBlock).toMatch(/<Share2 /);
    expect(shareButtonBlock).not.toMatch(/<Text/);
  });

  it('the bottom-row Share button keeps a >=44x44 touch target (iconOnlyButton)', () => {
    const iconOnlyButtonStyleBlock = ayahExperienceSource.match(/iconOnlyButton: \{[\s\S]*?\},/)?.[0] ?? '';
    expect(iconOnlyButtonStyleBlock).toMatch(/height:\s*48/);
    expect(iconOnlyButtonStyleBlock).toMatch(/width:\s*48/);
  });

  it('share behavior itself is unchanged — still calls the existing shareAyah handler wired to Share.share', () => {
    expect(ayahExperienceSource).toMatch(/onPress=\{shareAyah\}/);
    expect(ayahExperienceSource).toMatch(/await Share\.share\(/);
  });
});
