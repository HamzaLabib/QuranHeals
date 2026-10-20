import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios } }));

import { darkPalette, lightPalette, pageHeaderText, typography } from '@/constants/theme';

/**
 * Page headers: every full-screen page title and its subtitle use the shared pageHeaderText values approved on
 * Saved Ayahs and My Reflections. Long titles («My Recitations & Khatmas», «How are you feeling now?») wrap at the
 * same size beside the header buttons; none is shrunk to one line.
 */
const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8').split(String.fromCharCode(13)).join('');

/** Each page header: its file, the header's title / subtitle / text-block style names, and its title's JSX. */
const HEADERS = [
  { file: 'src/app/favorites.tsx', block: 'headerText', title: 'title', subtitle: 'subtitle' },
  { file: 'src/app/(tabs)/reflections.tsx', block: 'headerText', title: 'title', subtitle: 'subtitle' },
  { file: 'src/app/(tabs)/emotions.tsx', block: 'titleBlock', title: 'title', subtitle: 'subtitle' },
  { file: 'src/app/(tabs)/my-reading.tsx', block: 'titleBlock', title: 'title', subtitle: 'subtitle' },
  { file: 'src/app/settings.tsx', block: 'headerText', title: 'title', subtitle: 'subtitle' },
  { file: 'src/components/AyahExperience.tsx', block: 'headerText', title: 'emotion', subtitle: 'kicker' },
  { file: 'src/app/credits.tsx', block: null, title: 'title', subtitle: null },
  { file: 'src/app/khatm-dua.tsx', block: 'headerText', title: 'title', subtitle: null },
] as const;

const styleOf = (code: string, name: string) => {
  const start = code.search(new RegExp(`\\n  ${name}: `));
  expect(start, name).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  // A block style (its first line ends with "{") ends at its closing "  },"; any other style is its one line.
  const firstLine = rest.slice(0, rest.indexOf('\n'));
  return firstLine.endsWith('{') ? rest.slice(0, rest.indexOf('\n  },') + 5) : firstLine;
};

describe('page header typography', () => {
  it('the shared values are the approved Saved Ayahs / My Reflections ones, in both appearances', () => {
    for (const palette of [lightPalette, darkPalette]) {
      const header = pageHeaderText(palette);
      expect(header.title).toEqual({ color: palette.textPrimary, fontSize: 25, fontWeight: '700', letterSpacing: 0 });
      expect(header.subtitle).toEqual({ color: palette.textSecondary, fontSize: typography.caption, lineHeight: 18 });
      expect(header.block).toEqual({ flex: 1, gap: 2 });
    }
  });

  it.each(HEADERS)('$file: title, subtitle and text block use the shared values, with no size of their own', ({ file, block, title, subtitle }) => {
    const code = source(file);
    expect(styleOf(code, title)).toContain('pageHeaderText(colors).title');
    expect(styleOf(code, title)).not.toMatch(/fontSize|fontWeight/);
    if (subtitle) expect(styleOf(code, subtitle)).toBe(`  ${subtitle}: pageHeaderText(colors).subtitle,`);
    if (block) expect(styleOf(code, block)).toBe(`  ${block}: pageHeaderText(colors).block,`);
  });

  it.each(HEADERS)('$file: the title wraps naturally (no one-line limit, no shrink-to-fit, font scaling on)', ({ file, title }) => {
    const code = source(file);
    const tags = code.match(new RegExp(`<Text[^>]*styles\\.${title}\\b[^>]*>`, 'g')) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).not.toMatch(/numberOfLines|adjustsFontSizeToFit|allowFontScaling|maxFontSizeMultiplier/);
  });

  it('Home keeps its own header: the app name at 29, the emotions question at 30 / 700 (was 34), both wrapping freely', () => {
    const home = source('src/app/(tabs)/index.tsx');
    expect(typography.title).toBe(30);
    expect(styleOf(home, 'wordmark')).toMatch(/fontSize: 29,\s*fontWeight: '700',/);
    expect(styleOf(home, 'title')).toMatch(/fontSize: typography\.title,\s*fontWeight: '700',\s*letterSpacing: 0,[\s\S]*lineHeight: 36,/);
    for (const name of ['wordmark', 'title']) {
      const tags = home.match(new RegExp(`<Text[^>]*styles\\.${name}\\b[^>]*>`, 'g')) ?? [];
      expect(tags, name).toHaveLength(1);
      expect(tags[0]).not.toMatch(/numberOfLines|adjustsFontSizeToFit/);
    }
  });

  it('the Khatm Du`a title keeps its taller line for the vowel marks, centred', () => {
    const title = styleOf(source('src/app/khatm-dua.tsx'), 'title');
    expect(title).toContain('...pageHeaderText(colors).title');
    expect(title).toContain('lineHeight: 44');
  });
});
