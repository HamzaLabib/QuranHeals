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
  useColorScheme: () => 'light',
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

/**
 * Phase B5: a failed LOCAL save must never be mistaken for success — the
 * sheet stays open, the typed text is never cleared, and a clear error is
 * shown. These are locale-independent behaviors (the guard/data-safety
 * logic), so they run once against 'en' rather than under describe.each.
 */
describe('ReflectionSheet: save failure handling (Phase B5)', () => {
  beforeEach(() => { state.locale = 'en'; });

  function findSaveButton() {
    return root.root.findAllByType('Pressable' as never).find(node => node.props.accessibilityLabel === MESSAGES.en.reflection.save)!;
  }

  it('Test B — editing an existing reflection persists the new text', async () => {
    state.getReflection.mockResolvedValueOnce({ text: 'Original text' });
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('Edited text'));

    await act(async () => { await findSaveButton().props.onPress(); });

    expect(state.saveReflection).toHaveBeenCalledExactlyOnceWith('2:286', 'Edited text');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Test C/D — a failed local save (read or write failure inside saveReflection) keeps the sheet open, keeps the typed text, and shows a clear error', async () => {
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('My unsaved reflection'));
    state.saveReflection.mockRejectedValueOnce(new Error('AsyncStorage is unavailable'));

    await act(async () => { await findSaveButton().props.onPress(); });

    expect(onClose).not.toHaveBeenCalled();
    expect(root.root.findByType('TextInput' as never).props.value).toBe('My unsaved reflection');
    const texts = root.root.findAllByType('Text' as never).map(node => node.props.children);
    expect(texts).toContain(MESSAGES.en.reflection.saveError);
    // Never the raw storage error, a stack trace, or a storage key/internal detail.
    expect(texts.join(' ')).not.toContain('AsyncStorage');
  });

  it('Test E — retrying after a failure succeeds, and saveReflection is only ever called once per tap (no duplicate from the failed attempt)', async () => {
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('Retry me'));
    state.saveReflection.mockRejectedValueOnce(new Error('transient failure'));

    await act(async () => { await findSaveButton().props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { await findSaveButton().props.onPress(); });

    expect(state.saveReflection).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Test F — an existing reflection is left untouched in storage while a failed edit keeps the unsaved edited text visible', async () => {
    state.getReflection.mockResolvedValueOnce({ text: 'Previously saved version' });
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('New unsaved edit'));
    state.saveReflection.mockRejectedValueOnce(new Error('write failed'));

    await act(async () => { await findSaveButton().props.onPress(); });

    expect(onClose).not.toHaveBeenCalled();
    // The sheet shows the new (unsaved) text, never reverted to the old saved value.
    expect(root.root.findByType('TextInput' as never).props.value).toBe('New unsaved edit');
    // saveReflection was called with the new text, attempting to persist it
    // (and, per ayahReflections.ts's own guarantee, a failed write never
    // touches whatever was previously stored) — never with the old text.
    expect(state.saveReflection).toHaveBeenCalledExactlyOnceWith('2:286', 'New unsaved edit');
  });

  it('Test G — a second tap while a save is already in flight triggers no second storage write', async () => {
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('Only once please'));
    let resolveSave!: () => void;
    state.saveReflection.mockImplementationOnce(() => new Promise<null>(resolve => { resolveSave = () => resolve(null); }));

    // Each tap gets its own act() so React actually re-renders with
    // isSaving=true between them — exactly like two separate physical
    // taps (never perfectly synchronous), which is what the save()
    // guard is designed to catch. The button is also visually `disabled`
    // by then, but this calls onPress directly to prove the guard inside
    // save() itself — not just the disabled prop — is what stops it.
    let firstPress!: Promise<void>;
    await act(async () => { firstPress = findSaveButton().props.onPress(); });
    await act(async () => { findSaveButton().props.onPress(); });

    expect(state.saveReflection).toHaveBeenCalledTimes(1);
    await act(async () => { resolveSave(); await firstPress; });
    expect(onClose).toHaveBeenCalledOnce();
    expect(state.saveReflection).toHaveBeenCalledTimes(1);
  });

  it('Test H — a save succeeds locally even though this component never touches the sync/cloud layer at all', async () => {
    // No @/sync/* mock exists anywhere in this file — saveReflection
    // resolving is the entire, sufficient contract for a successful save.
    const onClose = await renderSheet();
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('Local only'));

    await act(async () => { await findSaveButton().props.onPress(); });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
