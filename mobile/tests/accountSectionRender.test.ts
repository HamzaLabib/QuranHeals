import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDirectionStyle } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * The Account section and Danger Zone are deliberately outside the Settings
 * accordion and unchanged by it: rendered here for both auth states so the
 * redesign is proven not to have altered what each state shows or what the
 * Delete Account button does.
 */
const state = vi.hoisted(() => ({
  status: 'guest' as 'loading' | 'guest' | 'signed-in',
  calls: [] as string[],
}));

vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('@/theme/useAppearancePreference', () => ({ useAppearancePreference: () => ({ mode: 'light' }) }));
vi.mock('@/auth/appleAuth', () => ({
  AppleSignInCancelledError: class extends Error {},
  isAppleSignInSupportedPlatform: () => true,
  requestAppleCredential: async () => ({ identityToken: 't', authorizationCode: 'c' }),
}));
vi.mock('@/auth/googleAuth', () => ({
  extractGoogleIdToken: () => null,
  isGoogleAuthConfigured: () => true,
  useGoogleAuthRequest: () => [{}, null, async () => undefined],
}));
vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({
    status: state.status,
    lastError: null,
    signInWithGoogleIdToken: async () => { state.calls.push('google'); },
    signInWithAppleIdToken: async () => { state.calls.push('apple'); },
    signOut: async () => { state.calls.push('signOut'); },
    deleteAccount: async () => { state.calls.push('deleteAccount'); },
  }),
}));
vi.mock('@/components/DeleteAccountSheet', async () => {
  const { createElement: h } = await import('react');
  return { DeleteAccountSheet: (props: object) => h('DeleteAccountSheet', props) };
});
vi.mock('@/components/ChangeSyncPasswordSheet', async () => {
  const { createElement: h } = await import('react');
  return { ChangeSyncPasswordSheet: (props: object) => h('ChangeSyncPasswordSheet', props) };
});
// The age-confirmation panel (AccountSection's sign-in gate) imports these.
vi.mock('lucide-react-native', () => ({ Check: () => null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined },
}));
vi.mock('@/components/AppleIcon', () => ({ AppleIcon: () => null }));
vi.mock('@/components/GoogleIcon', () => ({ GoogleIcon: () => null }));

import { AccountSection } from '@/components/AccountSection';

const en = MESSAGES.en;
let root: ReactTestRenderer | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.status = 'guest';
  state.calls = [];
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

async function renderAccount() {
  await act(async () => {
    root = create(createElement(AccountSection, { locale: 'en', messages: en, direction: getDirectionStyle('en'), isRtl: false }));
  });
}
const texts = () => root!.root.findAll((node) => node.type === ('Text' as never)).map((node) => node.props.children);
const button = (label: string) =>
  root!.root.findAll((node: ReactTestInstance) => node.type === ('Pressable' as never) && node.props.accessibilityLabel === label)[0];

describe('Account section after the Settings redesign', () => {
  it('signed out: shows the guest status, sync guidance, and Apple/Google sign-in — no Danger Zone', async () => {
    await renderAccount();
    expect(texts()).toEqual(expect.arrayContaining([en.account.sectionTitle, en.account.notSignedIn, en.auth.syncPrompt]));
    expect(button(en.account.signInWithApple)).toBeTruthy();
    expect(button(en.account.signInWithGoogle)).toBeTruthy();
    expect(button(en.account.deleteAccountAction)).toBeUndefined();
    expect(texts()).not.toContain(en.account.dangerZoneTitle);
  });

  it('signed in: shows status, Change Password, and Sign Out, then the Danger Zone', async () => {
    state.status = 'signed-in';
    await renderAccount();
    expect(texts()).toEqual(expect.arrayContaining([en.account.signedIn, en.account.dangerZoneTitle, en.account.deleteAccountActionDescription]));
    expect(button(en.syncPassphrase.changeTitle)).toBeTruthy();
    expect(button(en.account.signInWithApple)).toBeUndefined();
    await act(async () => { button(en.account.signOut).props.onPress(); });
    expect(state.calls).toEqual(['signOut']);
  });

  it('Delete Account still only opens the existing confirmation sheet, which owns the real deleteAccount()', async () => {
    state.status = 'signed-in';
    await renderAccount();
    const sheet = () => root!.root.findByType('DeleteAccountSheet' as never);
    expect(sheet().props.visible).toBe(false);
    await act(async () => { button(en.account.deleteAccountAction).props.onPress(); });
    expect(sheet().props.visible).toBe(true);
    // Nothing is deleted until the sheet's own confirmation flow calls this.
    expect(state.calls).toEqual([]);
    await act(async () => { await sheet().props.deleteAccount(); });
    expect(state.calls).toEqual(['deleteAccount']);
  });
});
