import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/** The Report an issue sheet's states: form, sending, failure, success, dismissal (mocked React Native host components). */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  submit: vi.fn(),
}));
vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('lucide-react-native', () => ({ Check: 'Check' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: 'off', translationId: 'en.pickthall.gutenberg16955' } }),
}));
vi.mock('@/services/issueReportApi', () => ({ submitIssueReport: state.submit }));

import { ReportIssueSheet } from '@/components/ReportIssueSheet';

let root: ReactTestRenderer;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const copy = () => MESSAGES[state.locale].issueReport;
const button = (label: string) => root.root.findAllByType('Pressable' as never).find((node) => node.props.accessibilityLabel === label);
const field = (label: string) => root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === label);
const text = () => JSON.stringify(root.toJSON());
const context = { verseKey: '2:255', surahNumber: 2, ayahNumber: 255, emotionKey: 'sad' };

async function render(visible = true) {
  await act(async () => { root = create(createElement(ReportIssueSheet, { visible, onClose, context })); });
}
async function setVisible(visible: boolean) {
  await act(async () => root.update(createElement(ReportIssueSheet, { visible, onClose, context })));
}
async function fillForm() {
  await act(async () => button(copy().categoryTranslationIssue)!.props.onPress());
  await act(async () => field(copy().description)!.props.onChangeText('  The translation is cut off.  '));
  await act(async () => field(copy().emailLabel)!.props.onChangeText('me@example.com'));
}
async function press(label: string) {
  await act(async () => { await button(label)!.props.onPress(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.submit.mockReset().mockResolvedValue(undefined);
  onClose = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('before submission', () => {
  it('shows the categories, description, optional email and Cancel | Submit — no Done', async () => {
    await render();
    for (const label of [copy().categoryAyahNotRelevant, copy().categoryOther, copy().cancel, copy().submit]) expect(button(label)).toBeDefined();
    expect(field(copy().description)).toBeDefined();
    expect(field(copy().emailLabel)).toBeDefined();
    expect(button(copy().done)).toBeUndefined();
    expect(text()).not.toContain(copy().successMessage);
  });

  it('Cancel closes the sheet without sending anything', async () => {
    await render();
    await fillForm();
    await press(copy().cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.submit).not.toHaveBeenCalled();
  });
});

describe('submitting', () => {
  it('sends the report with the existing fields, and Submit is disabled while it is sending', async () => {
    let finish!: () => void;
    state.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    await fillForm();
    await act(async () => { void button(copy().submit)!.props.onPress(); });

    expect(button(copy().submit)!.props.disabled).toBe(true);
    // Not confirmed yet: no success message, the form is still there.
    expect(text()).not.toContain(copy().successMessage);
    expect(field(copy().description)).toBeDefined();
    await act(async () => { void button(copy().submit)!.props.onPress(); }); // a second tap sends nothing more
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'translation_issue', comment: 'The translation is cut off.', email: 'me@example.com',
      verseKey: '2:255', surahNumber: 2, ayahNumber: 255, emotionKey: 'sad', appLocale: 'en', translationDisplayMode: 'off',
    }));

    await act(async () => finish());
    expect(text()).toContain(copy().successMessage);
  });

  it('a failure keeps the form and everything entered, shows the localized error, never the success state, and allows a retry', async () => {
    state.submit.mockRejectedValueOnce(new Error('offline'));
    await render();
    await fillForm();
    await press(copy().submit);

    expect(text()).toContain(copy().failureMessage);
    expect(text()).not.toContain(copy().successMessage);
    expect(button(copy().done)).toBeUndefined();
    expect(field(copy().description)!.props.value).toBe('  The translation is cut off.  ');
    expect(field(copy().emailLabel)!.props.value).toBe('me@example.com');
    expect(button(copy().categoryTranslationIssue)!.props.accessibilityState).toEqual({ selected: true });
    expect(button(copy().submit)!.props.disabled).toBe(false);

    await press(copy().submit);
    expect(state.submit).toHaveBeenCalledTimes(2);
    expect(text()).toContain(copy().successMessage);
    expect(text()).not.toContain(copy().failureMessage);
  });
});

describe('after a successful submission', () => {
  it('shows only the title, the thank-you message and one Done button; Done closes the sheet', async () => {
    await render();
    await fillForm();
    await press(copy().submit);

    expect(text()).toContain(copy().successMessage);
    expect(text()).not.toContain(copy().description);
    expect(field(copy().description)).toBeUndefined();
    expect(field(copy().emailLabel)).toBeUndefined();
    expect(button(copy().categoryTranslationIssue)).toBeUndefined();
    expect(button(copy().cancel)).toBeUndefined();
    expect(button(copy().submit)).toBeUndefined();
    const pressables = root.root.findAllByType('Pressable' as never);
    expect(pressables.map((node) => node.props.accessibilityLabel)).toEqual([copy().done]);

    await press(copy().done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['ar', 'ar-EG'] as const)('%s: the Arabic thank-you message and تم', async (locale) => {
    state.locale = locale;
    await render();
    await press(copy().submit);

    expect(text()).toContain('شكرًا لك. تم استلام بلاغك.');
    expect(button('تم')).toBeDefined();
    const message = root.root.findAllByType('Text' as never).find((node) => node.props.children === 'شكرًا لك. تم استلام بلاغك.')!;
    expect(message.props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('English copy is exactly as specified', () => {
    expect(MESSAGES.en.issueReport.successMessage).toBe('Thank you. Your report has been received.');
    expect(MESSAGES.en.issueReport.done).toBe('Done');
    expect(MESSAGES.ar.issueReport.done).toBe('تم');
    expect(MESSAGES['ar-EG'].issueReport.done).toBe('تم');
  });
});

describe('opening the sheet again', () => {
  it('starts a new, empty report after Done', async () => {
    await render();
    await fillForm();
    await press(copy().submit);
    await press(copy().done);
    await setVisible(false);
    await setVisible(true);

    expect(text()).not.toContain(copy().successMessage);
    expect(field(copy().description)!.props.value).toBe('');
    expect(field(copy().emailLabel)!.props.value).toBe('');
    expect(button(copy().categoryAyahNotRelevant)!.props.accessibilityState).toEqual({ selected: true });
    expect(button(copy().submit)!.props.disabled).toBe(false);
  });

  it('starts a new, empty report after a failure and Cancel', async () => {
    state.submit.mockRejectedValueOnce(new Error('offline'));
    await render();
    await fillForm();
    await press(copy().submit);
    await press(copy().cancel);
    await setVisible(false);
    await setVisible(true);

    expect(text()).not.toContain(copy().failureMessage);
    expect(field(copy().description)!.props.value).toBe('');
    expect(button(copy().categoryAyahNotRelevant)!.props.accessibilityState).toEqual({ selected: true });
  });

  it('a report closed while still sending never marks the next one as sent', async () => {
    let finish!: () => void;
    state.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    await act(async () => { void button(copy().submit)!.props.onPress(); });
    await press(copy().cancel);
    await setVisible(false);
    await setVisible(true);
    await act(async () => finish());

    expect(text()).not.toContain(copy().successMessage);
    expect(button(copy().submit)!.props.disabled).toBe(false);
  });
});
