import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * Text fields take the unselected option rows' surface (2026-10-14), shown on the reference screen, Report an Issue:
 * the description and email fields have the same background as the category rows that are not selected, in Light
 * and Dark; the selected row keeps its sage highlight; the fields keep their border, size, placeholders, alignment
 * and validation.
 */

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', dark: false, submit: vi.fn() }));
vi.mock('react-native', () => ({
  useColorScheme: () => (state.dark ? 'dark' : 'light'),
  Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('lucide-react-native', () => ({ Check: 'Check' }));
vi.mock('@/theme/useTheme', async () => {
  const { darkPalette, lightPalette } = await import('@/constants/theme');
  const palette = () => (state.dark ? darkPalette : lightPalette);
  return { usePalette: palette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(palette()), useThemeName: () => (state.dark ? 'dark' : 'light') };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: 'off', translationId: 'en.pickthall.gutenberg16955' } }),
}));
vi.mock('@/services/issueReportApi', () => ({ submitIssueReport: state.submit }));

const { ReportIssueSheet } = await import('@/components/ReportIssueSheet');
const { darkPalette, lightPalette } = await import('@/constants/theme');

let root: ReactTestRenderer;
const copy = () => MESSAGES[state.locale].issueReport;
const style = (node: ReactTestInstance) => Object.assign({}, ...[typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style].flat(3).filter(Boolean)) as Record<string, unknown>;
const field = (label: string) => root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === label)!;
const row = (label: string) => root.root.findAllByType('Pressable' as never).find((node) => node.props.accessibilityLabel === label)!;
/** What a row shows: its own background, else the nearest one behind it (its list's). */
const rowSurface = (label: string) => {
  let node: ReactTestInstance | null = row(label);
  while (node) {
    const background = typeof node.type === 'string' ? style(node).backgroundColor : undefined;
    if (background) return background;
    node = node.parent;
  }
  return undefined;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.dark = false;
  state.submit.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

async function render() {
  await act(async () => { root = create(createElement(ReportIssueSheet, { visible: true, onClose: vi.fn(), context: { verseKey: '2:255', surahNumber: 2, ayahNumber: 255 } })); });
}

describe('Report an Issue: the fields share the unselected rows` surface', () => {
  for (const dark of [false, true]) {
    for (const locale of ['en', 'ar'] as const) {
      it(`${dark ? 'Dark' : 'Light'}, ${locale}: description and email on the unselected rows' surface, with their border; the selected row stays sage`, async () => {
        state.dark = dark;
        state.locale = locale;
        const palette = dark ? darkPalette : lightPalette;
        await render();
        const unselected = rowSurface(copy().categoryOther);
        expect(unselected).toBe(palette.inputBackground);
        for (const label of [copy().commentLabel, copy().emailLabel]) {
          const s = style(field(label));
          expect(s.backgroundColor, label).toBe(unselected);
          expect(s.backgroundColor, label).toBe(dark ? '#171E27' : '#F7F2EA');
          // Unchanged: border, corners, size, text and placeholder colours.
          expect(s, label).toMatchObject({ borderColor: palette.fieldBorder, borderWidth: 1, color: palette.textPrimary });
          expect(field(label).props.placeholderTextColor, label).toBe(palette.placeholder);
          expect(s.textAlign, label).toBe(locale === 'ar' ? 'right' : 'left');
        }
        // Choosing a category: its row turns sage; the others and the fields keep the neutral surface.
        await act(async () => row(copy().categoryTranslationIssue).props.onPress());
        expect(style(row(copy().categoryTranslationIssue)).backgroundColor).toBe(palette.accentSoft);
        expect(rowSurface(copy().categoryOther)).toBe(palette.inputBackground);
        expect(style(field(copy().commentLabel)).backgroundColor).toBe(palette.inputBackground);
      });
    }
  }

  it('typing, the keyboard settings and validation are unchanged: no description is refused with its message; then it sends what was typed', async () => {
    await render();
    const submit = () => row(copy().submit);
    const shown = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
    await act(async () => row(copy().categoryOther).props.onPress());
    await act(async () => { await submit().props.onPress(); });
    expect(state.submit).not.toHaveBeenCalled();
    expect(shown()).toContain(copy().commentRequired);
    await act(async () => field(copy().commentLabel).props.onChangeText('Something is wrong.'));
    expect(field(copy().emailLabel).props).toMatchObject({ keyboardType: 'email-address', autoCapitalize: 'none' });
    await act(async () => { await submit().props.onPress(); });
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ comment: 'Something is wrong.' }));
  });
});
