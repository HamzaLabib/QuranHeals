import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * D5 recovery UI, rendered: using, combining, copying and discarding kept
 * versions in the reflection editor. Nothing is written until Save, and a
 * version is marked handled only when its text is really in what was saved.
 */

type Version = { id: string; verseKey: string; text: string; origin: 'this-device' | 'other-device' | 'server'; versionUpdatedAt: number; detectedAt: number; supersededByDeletion?: boolean };

const state = vi.hoisted(() => ({
  current: null as { text: string } | null,
  versions: [] as Version[],
  saveReflection: vi.fn(async (_verseKey: string, text: string) => (text.trim() ? { text: text.trim().slice(0, 2000) } : null)),
  resolveConflictVersions: vi.fn(async (_ids: string[]) => undefined),
  setStringAsync: vi.fn(async (_text: string) => true),
  alerts: [] as { buttons: { text: string; onPress?: () => void }[] }[],
}));

vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Alert: { alert: vi.fn((_title: string, _message: string, buttons: { text: string; onPress?: () => void }[]) => { state.alerts.push({ buttons }); }) },
  Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('lucide-react-native', () => ({ Trash2: 'Trash2' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: state.setStringAsync }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', messages: MESSAGES.en }) }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ status: 'signed-in' }) }));
vi.mock('@/storage/ayahReflections', () => ({
  getReflection: async () => state.current,
  saveReflection: state.saveReflection,
  REFLECTION_MAX_LENGTH: 2000,
}));
vi.mock('@/storage/reflectionConflicts', () => ({
  getConflictVersionsFor: async () => state.versions,
  resolveConflictVersions: state.resolveConflictVersions,
}));

import { handledVersionIds, ReflectionSheet } from '@/components/ReflectionSheet';

const copy = MESSAGES.en.reflection;
const version = (id: string, text: string, extra: Partial<Version> = {}): Version => ({ id, verseKey: '2:286', text, origin: 'other-device', versionUpdatedAt: 1, detectedAt: 1, ...extra });

let root: ReactTestRenderer;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.current = { text: 'current text' };
  state.versions = [];
  state.alerts = [];
  state.saveReflection.mockClear();
  state.resolveConflictVersions.mockClear();
  state.setStringAsync.mockClear();
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });

async function render() {
  const onClose = vi.fn();
  await act(async () => { root = create(createElement(ReflectionSheet, { visible: true, verseKey: '2:286', onClose })); });
  return onClose;
}
const buttons = (label: string) => root.root.findAllByType('Pressable' as never).filter((node) => node.props.accessibilityLabel === label);
const press = async (label: string, index = 0) => act(async () => { await buttons(label)[index].props.onPress(); });
const inputValue = () => root.root.findByType('TextInput' as never).props.value as string;
const texts = () => root.root.findAllByType('Text' as never).map((node) => node.props.children);

describe('ReflectionSheet with kept versions', () => {
  it('shows nothing extra when there are no other versions', async () => {
    await render();
    expect(texts()).not.toContain(copy.otherVersionsTitle);
  });

  it('lists every kept version with where it came from', async () => {
    state.versions = [version('a', 'from the other phone'), version('b', 'written here before deletion', { origin: 'this-device', supersededByDeletion: true })];
    await render();
    expect(texts()).toEqual(expect.arrayContaining([copy.otherVersionsTitle, 'from the other phone', copy.otherVersionOtherDevice, 'written here before deletion', copy.otherVersionDeletedElsewhere]));
    expect(buttons(copy.useOtherVersion)).toHaveLength(2);
  });

  it('"Use this version" only changes the text box; Save writes it and marks that version handled', async () => {
    state.versions = [version('a', 'older words')];
    const onClose = await render();
    await press(copy.useOtherVersion);
    expect(inputValue()).toBe('older words');
    expect(state.saveReflection).not.toHaveBeenCalled();
    await press(copy.save);
    expect(state.saveReflection).toHaveBeenCalledWith('2:286', 'older words');
    expect(state.resolveConflictVersions).toHaveBeenCalledWith(['a']);
    expect(onClose).toHaveBeenCalled();
  });

  it('using one version and then another keeps the first to review (regression)', async () => {
    state.versions = [version('a', 'version A'), version('b', 'version B')];
    await render();
    await press(copy.useOtherVersion, 0);
    await press(copy.useOtherVersion, 0); // the remaining button is B's
    expect(inputValue()).toBe('version B');
    await press(copy.save);
    expect(state.resolveConflictVersions).toHaveBeenCalledWith(['b']);
  });

  it('"Add to my text" keeps both texts and resolves the version', async () => {
    state.versions = [version('a', 'other words')];
    await render();
    await press(copy.addOtherVersion);
    expect(inputValue()).toBe('current text\n\nother words');
    await press(copy.save);
    expect(state.saveReflection).toHaveBeenCalledWith('2:286', 'current text\n\nother words');
    expect(state.resolveConflictVersions).toHaveBeenCalledWith(['a']);
  });

  it('never offers to combine when the result would exceed the limit, so nothing is truncated', async () => {
    state.current = { text: 'x'.repeat(1500) };
    state.versions = [version('a', 'y'.repeat(600))];
    await render();
    expect(buttons(copy.addOtherVersion)).toHaveLength(0);
    expect(texts()).toContain(copy.otherVersionTooLong);
    expect(buttons(copy.copyOtherVersion)).toHaveLength(1);
  });

  it('editing the adopted text away before saving leaves the version to review', async () => {
    state.versions = [version('a', 'kept words')];
    await render();
    await press(copy.useOtherVersion);
    await act(async () => root.root.findByType('TextInput' as never).props.onChangeText('something else entirely'));
    await press(copy.save);
    expect(state.resolveConflictVersions).not.toHaveBeenCalled();
  });

  it('Cancel after using a version writes nothing and resolves nothing', async () => {
    state.versions = [version('a', 'older words')];
    await render();
    await press(copy.useOtherVersion);
    await press(copy.cancel);
    expect(state.saveReflection).not.toHaveBeenCalled();
    expect(state.resolveConflictVersions).not.toHaveBeenCalled();
  });

  it('Copy puts the version on the clipboard without changing anything', async () => {
    state.versions = [version('a', 'copy me')];
    await render();
    await press(copy.copyOtherVersion);
    expect(state.setStringAsync).toHaveBeenCalledWith('copy me');
    expect(inputValue()).toBe('current text');
    expect(buttons(copy.copiedOtherVersion)).toHaveLength(1);
  });

  it('Discard asks first; cancelling keeps the version, confirming removes only that one', async () => {
    state.versions = [version('a', 'discard me'), version('b', 'keep me')];
    await render();
    await press(copy.discardOtherVersion, 0);
    expect(state.resolveConflictVersions).not.toHaveBeenCalled();
    const [{ buttons: choices }] = state.alerts;
    expect(choices.map((choice) => choice.text)).toEqual([copy.cancel, copy.discardOtherVersion]);
    await act(async () => { choices[1].onPress?.(); await Promise.resolve(); });
    expect(state.resolveConflictVersions).toHaveBeenCalledWith(['a']);
    expect(texts()).not.toContain('discard me');
    expect(texts()).toContain('keep me');
  });

  it('restores a reflection that only survives as a kept version', async () => {
    state.current = null;
    state.versions = [version('a', 'deleted elsewhere', { origin: 'this-device', supersededByDeletion: true })];
    await render();
    expect(inputValue()).toBe('');
    await press(copy.useOtherVersion);
    await press(copy.save);
    expect(state.saveReflection).toHaveBeenCalledWith('2:286', 'deleted elsewhere');
    expect(state.resolveConflictVersions).toHaveBeenCalledWith(['a']);
  });
});

describe('handledVersionIds', () => {
  it('counts only adopted versions whose text is in the saved reflection', () => {
    const versions = [version('a', 'alpha'), version('b', 'beta'), version('c', 'gamma')];
    expect(handledVersionIds(versions, ['a', 'b'], 'alpha\n\nmore')).toEqual(['a']);
    expect(handledVersionIds(versions, ['c'], 'alpha beta gamma')).toEqual(['c']);
    expect(handledVersionIds(versions, ['a'], '')).toEqual([]);
  });
});
