import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  getKey: vi.fn(), verify: vi.fn(), change: vi.fn(),
}));
vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/auth/useAuth', () => ({ getCurrentSessionToken: async () => 'session' }));
vi.mock('@/sync/syncApi', () => ({ getCloudSyncKey: state.getKey }));
vi.mock('@/sync/syncKeyManager', () => ({ verifySyncPassphrase: state.verify, changeSyncPassword: state.change }));

import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';
import { ChangeSyncPasswordSheet } from '@/components/ChangeSyncPasswordSheet';

let root: ReactTestRenderer;
const input = (label: string) => root.root.findAllByType('TextInput' as never).find(node => node.props.accessibilityLabel === label)!;
const button = (label: string) => root.root.findAllByType('Pressable' as never).find(node => node.props.accessibilityLabel === label)!;
async function type(label: string, value: string) { await act(async () => input(label).props.onChangeText(value)); }
async function verifyPending() { await act(async () => { await vi.advanceTimersByTimeAsync(300); }); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  state.locale = 'en';
  state.getKey.mockReset().mockResolvedValue({ wrappedKey: 'ciphertext' });
  state.verify.mockReset().mockImplementation(async (_key, value: string) => value === 'current-password');
  state.change.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.useRealTimers();
});

describe('first-time setup', () => {
  async function setup() {
    const submit = vi.fn();
    await act(async () => { root = create(createElement(SyncPassphraseSheet, { request: { mode: 'create' }, onSubmit: submit, onSignOut: vi.fn() })); });
    return submit;
  }
  it('renders both fields and warning; validates exact confirmation and boundaries', async () => {
    const submit = await setup();
    expect(input('Password')).toBeDefined(); expect(input('Confirm Password')).toBeDefined();
    expect(JSON.stringify(root.toJSON())).toContain(MESSAGES.en.syncPassphrase.createDescription);
    expect(button('Set Password').props.disabled).toBe(true);
    for (const [length, enabled] of [[7, false], [8, true], [32, true], [33, false]] as const) {
      await type('Password', 'a'.repeat(length)); await type('Confirm Password', 'a'.repeat(length));
      expect(button('Set Password').props.disabled).toBe(!enabled);
    }
    await type('Password', '  pass  '); await type('Confirm Password', '  Pass  ');
    expect(button('Set Password').props.disabled).toBe(true);
    await type('Confirm Password', '  pass  ');
    await act(async () => button('Set Password').props.onPress());
    expect(submit).toHaveBeenCalledWith('  pass  ');
  });
  it('toggles each field independently without changing values', async () => {
    await setup();
    await type('Password', 'password'); await type('Confirm Password', 'password');
    await act(async () => button('Show: Password').props.onPress());
    expect(input('Password').props.secureTextEntry).toBe(false);
    expect(input('Confirm Password').props.secureTextEntry).toBe(true);
    await act(async () => button('Show: Confirm Password').props.onPress());
    expect(input('Confirm Password').props.secureTextEntry).toBe(false);
    await act(async () => button('Hide: Password').props.onPress());
    expect(input('Password').props.secureTextEntry).toBe(true);
    expect(input('Password').props.value).toBe('password');
    expect(input('Confirm Password').props.value).toBe('password');
  });
  it('renders Arabic labels and RTL field alignment', async () => {
    state.locale = 'ar'; await setup();
    expect(input('كلمة المرور').props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(input('تأكيد كلمة المرور')).toBeDefined();
    expect(button('إنشاء كلمة المرور').props.disabled).toBe(true);
    expect(JSON.stringify(root.toJSON())).toContain(MESSAGES.ar.syncPassphrase.createDescription);
  });
});

describe('unlock', () => {
  it('enables only verified input, permits legacy lengths, and never displays an incorrect-password error', async () => {
    const verify = vi.fn(async (value: string) => value === 'abcd');
    await act(async () => { root = create(createElement(SyncPassphraseSheet, { request: { mode: 'unlock', verify }, onSubmit: vi.fn(), onSignOut: vi.fn() })); });
    await type('Password', 'wrong-password'); await verifyPending();
    expect(button('Continue').props.disabled).toBe(true);
    expect(JSON.stringify(root.toJSON())).not.toContain('incorrect');
    await type('Password', 'abcd');
    expect(button('Continue').props.disabled).toBe(true);
    await verifyPending();
    expect(button('Continue').props.disabled).toBe(false);
    await act(async () => button('Show: Password').props.onPress());
    expect(input('Password').props.secureTextEntry).toBe(false);
    await type('Password', 'wrong-again');
    expect(button('Continue').props.disabled).toBe(true);
  });
  it('discards late verification after input changes and clears secrets on dismissal', async () => {
    let finish!: (valid: boolean) => void;
    const verify = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const props = { request: { mode: 'unlock' as const, verify }, onSubmit: vi.fn(), onSignOut: vi.fn() };
    await act(async () => { root = create(createElement(SyncPassphraseSheet, props)); });
    await type('Password', 'correct'); await verifyPending();
    await type('Password', 'incorrect');
    await act(async () => finish(true));
    expect(button('Continue').props.disabled).toBe(true);
    await act(async () => root.update(createElement(SyncPassphraseSheet, { ...props, request: null })));
    await act(async () => root.update(createElement(SyncPassphraseSheet, props)));
    expect(input('Password').props.value).toBe('');
    expect(input('Password').props.secureTextEntry).toBe(true);
  });
});

describe('change password', () => {
  async function setup() {
    const close = vi.fn();
    await act(async () => { root = create(createElement(ChangeSyncPasswordSheet, { onClose: close })); });
    return close;
  }
  it('requires all gates, verifies current password, and toggles all three fields independently', async () => {
    const close = await setup();
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) expect(input(label)).toBeDefined();
    await type('Current Password', 'wrong-password'); await verifyPending();
    expect(JSON.stringify(root.toJSON())).toContain(MESSAGES.en.syncPassphrase.incorrectError);
    await type('New Password', 'new-password'); await type('Confirm New Password', 'new-password');
    expect(button('Change Password').props.disabled).toBe(true);
    await type('Current Password', 'current-password'); await verifyPending();
    expect(button('Change Password').props.disabled).toBe(false);
    await type('New Password', 'current-password'); await type('Confirm New Password', 'current-password');
    expect(button('Change Password').props.disabled).toBe(true);
    for (const length of [7, 8, 32, 33]) {
      await type('New Password', 'x'.repeat(length)); await type('Confirm New Password', 'x'.repeat(length));
      expect(button('Change Password').props.disabled).toBe(length === 7 || length === 33);
    }
    await type('New Password', 'new-password'); await type('Confirm New Password', 'mismatch');
    expect(button('Change Password').props.disabled).toBe(true);
    await type('Confirm New Password', 'new-password');
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) {
      const original = input(label).props.value;
      await act(async () => button(`Show: ${label}`).props.onPress());
      expect(input(label).props.secureTextEntry).toBe(false);
      expect(input(label).props.value).toBe(original);
      await act(async () => button(`Hide: ${label}`).props.onPress());
      expect(input(label).props.secureTextEntry).toBe(true);
    }
    await act(async () => button('Change Password').props.onPress());
    expect(state.change).toHaveBeenCalledWith('session', 'current-password', 'new-password');
    expect(close).toHaveBeenCalledOnce();
    expect(input('Current Password').props.value).toBe('');
  });
  it('keeps the sheet open on save failure and requires fresh verification', async () => {
    state.change.mockRejectedValueOnce(new Error('offline'));
    const close = await setup();
    await type('Current Password', 'current-password'); await verifyPending();
    await type('New Password', 'new-password'); await type('Confirm New Password', 'new-password');
    await act(async () => button('Change Password').props.onPress());
    expect(close).not.toHaveBeenCalled();
    expect(button('Change Password').props.disabled).toBe(true);
    expect(JSON.stringify(root.toJSON())).toContain(MESSAGES.en.syncPassphrase.saveError);
  });
  it('offers retry after key loading fails and never enables a change without the cloud key', async () => {
    state.getKey.mockRejectedValueOnce(new Error('offline'));
    await setup();
    await type('Current Password', 'current-password');
    await type('New Password', 'new-password'); await type('Confirm New Password', 'new-password');
    await verifyPending();
    expect(button('Change Password').props.disabled).toBe(true);
    expect(state.verify).not.toHaveBeenCalled();
    expect(JSON.stringify(root.toJSON())).toContain(MESSAGES.en.syncPassphrase.loadError);
    await act(async () => button('Try again').props.onPress());
    await verifyPending();
    expect(button('Change Password').props.disabled).toBe(false);
  });
  it('blocks double submission and dismissal until persistence completes', async () => {
    let finish!: () => void;
    state.change.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = await setup();
    await type('Current Password', 'current-password'); await verifyPending();
    await type('New Password', 'new-password'); await type('Confirm New Password', 'new-password');
    const submit = button('Change Password').props.onPress;
    await act(async () => { submit(); submit(); });
    expect(state.change).toHaveBeenCalledOnce();
    expect(button('Change Password').props.disabled).toBe(true);
    expect(input('Current Password').props.editable).toBe(false);
    await act(async () => button('Cancel').props.onPress());
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(close).toHaveBeenCalledOnce();
  });
});
