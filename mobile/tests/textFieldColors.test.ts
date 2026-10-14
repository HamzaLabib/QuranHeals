import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * Every editable text field shares one soft surface (constants/fieldColors.ts): a warm cream in Light, a softly
 * lighter dark surface in Dark — on the app's windows and on the Mushaf's. Only the fields: the windows and the
 * other controls keep their colours.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios } }));
const { darkPalette, lightPalette } = await import('@/constants/theme');
const { MUSHAF_PANEL_COLORS } = await import('@/constants/mushafTheme');
const { FIELD_COLORS } = await import('@/constants/fieldColors');

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const root = resolve(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const source = (path: string) => readFileSync(resolve(root, path), 'utf8').split(String.fromCharCode(13)).join('');
/** A StyleSheet entry `name: { … }` (to its closing brace). */
const styleBlock = (text: string, name: string) => {
  const start = text.search(new RegExp(`\\n  ${name}: \\{`));
  expect(start, name).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf('}', start) + 1);
};

describe('text field colours', () => {
  it('Light: soft warm cream with a quiet beige border; Dark: a softly lighter dark surface — in the app palette and the Mushaf`s alike', () => {
    expect(FIELD_COLORS).toEqual({ light: { background: '#F3EBDD', border: '#E5DCCF' }, dark: { background: '#33363A', border: '#494A47' } });
    expect([lightPalette.fieldBackground, lightPalette.fieldBorder]).toEqual(['#F3EBDD', '#E5DCCF']);
    expect([darkPalette.fieldBackground, darkPalette.fieldBorder]).toEqual(['#33363A', '#494A47']);
    expect(MUSHAF_PANEL_COLORS.light.input).toMatchObject({ backgroundColor: '#F3EBDD', borderColor: '#E5DCCF' });
    expect(MUSHAF_PANEL_COLORS.dark.input).toMatchObject({ backgroundColor: '#33363A', borderColor: '#494A47' });
  });

  it('typed text and placeholders stay readable on them (WCAG AA, 4.5:1)', () => {
    for (const [palette, name] of [[lightPalette, 'light'], [darkPalette, 'dark']] as const) {
      expect(contrast(palette.textPrimary, palette.fieldBackground), `${name} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.placeholder, palette.fieldBackground), `${name} placeholder`).toBeGreaterThanOrEqual(4.5);
    }
    for (const name of ['light', 'dark'] as const) {
      const panel = MUSHAF_PANEL_COLORS[name];
      expect(contrast(panel.input.color, panel.input.backgroundColor), `Mushaf ${name} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(panel.placeholder, panel.input.backgroundColor), `Mushaf ${name} placeholder`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stand apart from the windows and screens around them (never the same colour; a visible step)', () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const around of [palette.background, palette.surface, palette.card, palette.sheetBackground]) {
        expect(palette.fieldBackground).not.toBe(around);
        expect(contrast(palette.fieldBackground, around)).toBeGreaterThanOrEqual(1.05);
      }
    }
    for (const name of ['light', 'dark'] as const) {
      const panel = MUSHAF_PANEL_COLORS[name];
      expect(contrast(panel.input.backgroundColor, panel.sheet.backgroundColor), `Mushaf ${name}`).toBeGreaterThanOrEqual(1.05);
    }
    // Never pure white or black.
    for (const colour of [FIELD_COLORS.light.background, FIELD_COLORS.dark.background]) expect(['#FFFFFF', '#000000']).not.toContain(colour);
  });

  it('every editable text field in the app uses them (a new field elsewhere fails here until it does)', () => {
    const withFields = files(resolve(root, 'src')).filter((path) => /<TextInput\b/.test(readFileSync(path, 'utf8'))).map((path) => relative(root, path).split('\\').join('/')).sort();
    // The field's own style (SyncPasswordField: the row that is the field's visible box), by file.
    const fieldStyles: Record<string, string> = {
      'src/app/(tabs)/my-reading.tsx': 'input',
      'src/components/DeleteAccountSheet.tsx': 'input',
      'src/components/ReflectionSheet.tsx': 'input',
      'src/components/ReportIssueSheet.tsx': 'input',
      'src/components/SyncPasswordField.tsx': 'row',
    };
    const mushafFields = ['src/components/MushafControlPanel.tsx', 'src/components/MushafSearchSheet.tsx'];
    expect(withFields).toEqual([...Object.keys(fieldStyles), ...mushafFields].sort());
    for (const [path, name] of Object.entries(fieldStyles)) {
      const block = styleBlock(source(path), name);
      expect(block, path).toMatch(/backgroundColor: colors\.fieldBackground/);
      expect(block, path).toMatch(/borderColor: colors\.fieldBorder/);
    }
    // The Mushaf's fields: its panel's input colours (the same field colours), on every TextInput there.
    for (const path of mushafFields) {
      const text = source(path);
      const inputs = text.match(/<TextInput[\s\S]*?\/>/g)!;
      for (const input of inputs) expect(input, path).toMatch(/style=\{\[[^\]]*theme\.input/);
    }
    // The Sync Password sheet (and every password field) uses SyncPasswordField.
    expect(source('src/components/SyncPassphraseSheet.tsx')).toMatch(/<SyncPasswordField/);
  });

  it('only the fields changed: windows and other controls keep their colours', () => {
    // The palette's window colours and the other controls' surface, as before.
    expect(lightPalette).toMatchObject({ background: '#F7F2EA', surface: '#FFFDF8', card: '#FFFDF8', sheetBackground: '#FFFDF8', inputBackground: '#F7F2EA', inputBorder: '#E5DED2' });
    expect(darkPalette).toMatchObject({ sheetBackground: '#1E2530', inputBackground: '#171E27', inputBorder: '#4A5A6B' });
    // Segmented choices, option lists and toggle rows are not text fields: still on inputBackground.
    expect(styleBlock(source('src/components/ReportIssueSheet.tsx'), 'optionList')).toMatch(/backgroundColor: colors\.inputBackground/);
    expect(styleBlock(source('src/components/ShareAyahSheet.tsx'), 'segmented')).toMatch(/backgroundColor: colors\.inputBackground/);
    expect(styleBlock(source('src/components/ShareAyahSheet.tsx'), 'toggleRow')).toMatch(/backgroundColor: colors\.inputBackground/);
    // The Mushaf's windows keep theirs.
    expect(MUSHAF_PANEL_COLORS.light.sheet.backgroundColor).toBe('#FBF6E8');
    expect(MUSHAF_PANEL_COLORS.dark.sheet.backgroundColor).toBe('#262C24');
  });
});
