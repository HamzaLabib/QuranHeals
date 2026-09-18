import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';
import { APP_LOCALES, getDirectionStyle } from '@/localization/locales';

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  status: 'guest',
  getReflection: vi.fn(),
  saveReflection: vi.fn(),
}));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('lucide-react-native', () => ({ Trash2: 'Trash2' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }),
}));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ status: state.status }) }));
vi.mock('@/storage/ayahReflections', () => ({
  getReflection: state.getReflection, saveReflection: state.saveReflection, REFLECTION_MAX_LENGTH: 2000,
}));

import { ReflectionSheet } from '@/components/ReflectionSheet';

let root: ReactTestRenderer;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.status = 'guest';
  state.getReflection.mockReset().mockResolvedValue(null);
  state.saveReflection.mockReset().mockResolvedValue(null);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });

async function renderSheet() {
  const onClose = vi.fn();
  await act(async () => {
    root = create(createElement(ReflectionSheet, { visible: true, verseKey: '2:286', onClose }));
  });
  return onClose;
}

describe.each(APP_LOCALES)('reflection sheet: %s', (locale) => {
  beforeEach(() => { state.locale = locale; });

  it('renders title, visible question, distinct placeholder, note, and buttons in order with locale alignment', async () => {
    await renderSheet();
    const copy = MESSAGES[locale].reflection;
    const elements = root.root.findAll(node => node.type === ('Text' as never) || node.type === ('TextInput' as never));
    expect(elements.map(node => node.type === ('TextInput' as never) ? node.props.placeholder : node.props.children))
      .toEqual([copy.title, copy.prompt, copy.placeholder, copy.guestNote, copy.cancel, copy.save]);
    expect(copy.prompt).not.toBe(copy.placeholder);
    for (const node of elements.slice(0, 4)) expect(node.props.style).toContainEqual(getDirectionStyle(locale));
    const input = root.root.findByType('TextInput' as never);
    expect(input.props.multiline).toBe(true);
    expect(input.props.maxLength).toBe(2000);
    if (locale !== 'en') {
      expect(root.root.findAllByType('View' as never).filter(node =>
        Array.isArray(node.props.style) && node.props.style.some((style: { flexDirection?: string }) => style?.flexDirection === 'row-reverse'),
      )).toHaveLength(2);
    }
  });

  it('Save persists through the same storage function before closing', async () => {
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('My reflection'));
    let complete!: () => void;
    state.saveReflection.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    const save = root.root.findAllByType('Pressable' as never).find(node => node.props.accessibilityLabel === MESSAGES[locale].reflection.save)!;
    let pending!: Promise<void>;
    await act(async () => { pending = save.props.onPress(); });
    expect(state.saveReflection).toHaveBeenCalledExactlyOnceWith('2:286', 'My reflection');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { complete(); await pending; });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Cancel closes without saving edits', async () => {
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('Unsaved edit'));
    const cancel = root.root.findAllByType('Pressable' as never).find(node => node.props.accessibilityLabel === MESSAGES[locale].reflection.cancel)!;
    await act(async () => cancel.props.onPress());
    expect(onClose).toHaveBeenCalledOnce();
    expect(state.saveReflection).not.toHaveBeenCalled();
  });

  it('preserves the existing signed-in note and loads saved reflections', async () => {
    state.status = 'signed-in';
    state.getReflection.mockResolvedValueOnce({ text: 'Saved reflection' });
    await renderSheet();
    expect(root.root.findByType('TextInput' as never).props.value).toBe('Saved reflection');
    const texts = root.root.findAllByType('Text' as never).map(node => node.props.children);
    expect(texts).toContain(MESSAGES[locale].reflection.syncedNote);
    expect(texts).not.toContain(MESSAGES[locale].reflection.guestNote);
  });
});
