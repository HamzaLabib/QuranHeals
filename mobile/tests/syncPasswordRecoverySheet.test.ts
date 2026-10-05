import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * Forgotten sync password — the unlock sheet's recovery UI (rendered with
 * mocked React Native host components, like syncPasswordSheets.test.ts).
 */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  // Stands in for the fresh Apple/Google sign-in (auth/reauthentication.ts).
  authenticate: vi.fn(),
  hookProvider: undefined as string | null | undefined,
}));
vi.mock('@/auth/reauthentication', () => {
  class ReauthenticationUnavailableError extends Error {}
  class ReauthenticationFailedError extends Error {}
  return {
    ReauthenticationUnavailableError,
    ReauthenticationFailedError,
    useFreshProviderCredential: (provider: string | null) => {
      state.hookProvider = provider;
      return state.authenticate;
    },
  };
});
vi.mock('react-native', () => ({
  Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
  ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';

const en = MESSAGES.en;
let root: ReactTestRenderer;
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const text = () => JSON.stringify(root.toJSON());
async function press(label: string) {
  await act(async () => { await button(label)!.props.onPress(); });
}

function handlers() {
  return {
    onSubmit: vi.fn(),
    onSignOut: vi.fn(),
    onResetComplete: vi.fn(),
    deleteAccount: vi.fn(async () => {}),
    onAccountDeleted: vi.fn(),
    accountProvider: 'google' as 'apple' | 'google' | null,
  };
}

const FRESH_CREDENTIAL = { provider: 'google', idToken: 'fresh-google-id-token' };

async function renderUnlock(reset = vi.fn(async () => {}), props = handlers()) {
  const request = { mode: 'unlock' as const, verify: vi.fn(async () => false), reset };
  await act(async () => { root = create(createElement(SyncPassphraseSheet, { request, ...props })); });
  return { reset, props };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.authenticate.mockReset().mockResolvedValue(FRESH_CREDENTIAL);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('Forgot Password? on the unlock step', () => {
  it('is offered on the unlock step, never on first-time setup', async () => {
    await renderUnlock();
    expect(button(en.syncPassphrase.forgotPassword)).toBeDefined();
    await act(async () => root.unmount());

    await act(async () => {
      root = create(createElement(SyncPassphraseSheet, { request: { mode: 'create' }, ...handlers() }));
    });
    expect(button(en.syncPassphrase.forgotPassword)).toBeUndefined();
  });

  it('shows the full, explicit consequences before anything is reset', async () => {
    const { reset } = await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);

    for (const line of ['resetTitle', 'resetUnrecoverable', 'resetCloudLoss', 'resetLocalKept', 'resetUnaffected'] as const) {
      expect(text()).toContain(en.syncPassphrase[line]);
    }
    expect(reset).not.toHaveBeenCalled(); // opening the explanation never resets anything
  });

  it('Back returns to the password step without resetting', async () => {
    const { reset, props } = await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.resetBack);

    expect(button(en.syncPassphrase.continueLabel)).toBeDefined();
    expect(reset).not.toHaveBeenCalled();
    expect(props.onResetComplete).not.toHaveBeenCalled();
  });

  it('the explicit confirmation verifies identity, runs the reset with that credential, then hands over to creating a new password', async () => {
    const { reset, props } = await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.resetConfirm);

    expect(state.authenticate).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(FRESH_CREDENTIAL);
    expect(props.onResetComplete).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('a failed reset shows an error, stays on the confirmation, and never reports completion', async () => {
    const { props } = await renderUnlock(vi.fn(async () => { throw new Error('offline'); }));
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.resetConfirm);

    expect(text()).toContain(en.syncPassphrase.resetError);
    expect(props.onResetComplete).not.toHaveBeenCalled();
    expect(button(en.syncPassphrase.resetConfirm)).toBeDefined();
  });

  it('the sheet still cannot be dismissed from the recovery step', async () => {
    await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);
    const modal = root.root.findByType('Modal' as never);
    modal.props.onRequestClose();
    expect(text()).toContain(en.syncPassphrase.resetTitle);
  });
});

describe('Test I — sign out stays reachable without the password', () => {
  it('Sign out is on the unlock step', async () => {
    const { props } = await renderUnlock();
    await press(en.account.signOut);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('Test H — account deletion is reachable from the forgotten-password step', () => {
  it('opens the same typed-confirmation deletion, and completes it', async () => {
    const { props } = await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.deleteAccountInstead);

    // The standard deletion sheet: final button disabled until the exact word is typed.
    expect(button(en.deleteAccount.deleteButton)!.props.disabled).toBe(true);
    const field = root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === en.deleteAccount.placeholder)!;
    await act(async () => field.props.onChangeText(en.deleteAccount.confirmationWord));
    expect(button(en.deleteAccount.deleteButton)!.props.disabled).toBe(false);
    await press(en.deleteAccount.deleteButton);

    expect(props.deleteAccount).toHaveBeenCalledTimes(1);
    expect(props.onAccountDeleted).toHaveBeenCalledTimes(1);
  });

  it('closing the deletion sheet returns to the recovery step, deleting nothing', async () => {
    const { props } = await renderUnlock();
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.deleteAccountInstead);
    await press(en.deleteAccount.cancel);

    expect(text()).toContain(en.syncPassphrase.resetTitle);
    expect(props.deleteAccount).not.toHaveBeenCalled();
  });
});

describe('localization', () => {
  it('Arabic and Egyptian Arabic render the recovery copy, identically (security flow)', async () => {
    for (const locale of ['ar', 'ar-EG'] as const) {
      state.locale = locale;
      await renderUnlock();
      await press(MESSAGES[locale].syncPassphrase.forgotPassword);
      expect(text()).toContain(MESSAGES[locale].syncPassphrase.resetCloudLoss);
      await act(async () => root.unmount());
    }
    const keys = ['forgotPassword', 'resetTitle', 'resetUnrecoverable', 'resetCloudLoss', 'resetLocalKept', 'resetUnaffected',
      'resetConfirm', 'resetBack', 'resetError', 'resetting', 'deleteAccountInstead'] as const;
    for (const key of keys) {
      expect(MESSAGES['ar-EG'].syncPassphrase[key]).toBe(MESSAGES.ar.syncPassphrase[key]);
      expect(MESSAGES.ar.syncPassphrase[key]).not.toBe(MESSAGES.en.syncPassphrase[key]);
    }
  });
});

describe('fresh Apple/Google re-authentication before the reset', () => {
  async function confirm() {
    await press(en.syncPassphrase.forgotPassword);
    await press(en.syncPassphrase.resetConfirm);
  }

  it.each(['apple', 'google'] as const)('uses the signed-in account\'s own provider (%s) and says so', async (provider) => {
    const props = { ...handlers(), accountProvider: provider };
    await renderUnlock(vi.fn(async () => {}), props);
    await press(en.syncPassphrase.forgotPassword);

    expect(state.hookProvider).toBe(provider);
    expect(text()).toContain(provider === 'apple' ? en.syncPassphrase.reauthNoticeApple : en.syncPassphrase.reauthNoticeGoogle);
  });

  it('a dismissed Apple/Google sign-in resets nothing, says so, and allows a retry', async () => {
    state.authenticate.mockResolvedValueOnce(null);
    const { reset, props } = await renderUnlock();
    await confirm();

    expect(reset).not.toHaveBeenCalled();
    expect(props.onResetComplete).not.toHaveBeenCalled();
    expect(text()).toContain(en.syncPassphrase.reauthCancelled);
    expect(button(en.syncPassphrase.resetBack)).toBeDefined();
    expect(button(en.syncPassphrase.deleteAccountInstead)).toBeDefined();

    await press(en.syncPassphrase.resetConfirm); // retry succeeds
    expect(reset).toHaveBeenCalledWith(FRESH_CREDENTIAL);
    expect(props.onResetComplete).toHaveBeenCalledTimes(1);
  });

  it('a backend refusal (identity does not match the account) resets nothing and shows only a generic message', async () => {
    const { SyncApiError } = await import('@/sync/syncApi');
    const { reset, props } = await renderUnlock(vi.fn(async () => {
      throw new SyncApiError('Identity verification failed.', 403);
    }));
    await confirm();

    expect(props.onResetComplete).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(text()).toContain(en.syncPassphrase.reauthFailed);
  });

  it('a failed provider sign-in never exposes the provider\'s own error text', async () => {
    const { ReauthenticationFailedError } = await import('@/auth/reauthentication');
    state.authenticate.mockRejectedValueOnce(new ReauthenticationFailedError('invalid_grant: secret provider detail'));
    const { reset } = await renderUnlock();
    await confirm();

    expect(reset).not.toHaveBeenCalled();
    expect(text()).toContain(en.syncPassphrase.reauthFailed);
    expect(text()).not.toContain('secret provider detail');
  });

  it('when re-authentication is unavailable on this device, nothing is reset and sign out / deletion stay reachable', async () => {
    const { ReauthenticationUnavailableError } = await import('@/auth/reauthentication');
    state.authenticate.mockRejectedValueOnce(new ReauthenticationUnavailableError('Google not configured'));
    const { reset, props } = await renderUnlock();
    await confirm();

    expect(reset).not.toHaveBeenCalled();
    expect(text()).toContain(en.syncPassphrase.reauthUnavailable);
    expect(button(en.syncPassphrase.deleteAccountInstead)).toBeDefined();
    await press(en.syncPassphrase.resetBack);
    await press(en.account.signOut);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
});
