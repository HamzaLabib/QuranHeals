import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDirectionStyle, type AppLocale } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * Account-age self-declaration (16+) before Apple/Google sign-in. Uses the
 * real AgeConfirmationPanel and the real auth/ageConfirmation.ts storage;
 * only the providers, the auth context and AsyncStorage are faked.
 */
const state = vi.hoisted(() => ({
  status: 'guest' as 'loading' | 'guest' | 'signed-in',
  calls: [] as string[],
  /** The age declaration each backend sign-in call received (undefined = none sent). */
  declarations: [] as unknown[],
  /** When true, the faked Google prompt "returns" an ID token, as a real completed prompt does. */
  googleReturnsToken: false,
  lastError: null as string | null,
}));
const storage = vi.hoisted(() => ({ map: new Map<string, string>(), fail: false }));

vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('lucide-react-native', () => ({ Check: () => null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (storage.fail) throw new Error('storage unavailable');
      return storage.map.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (storage.fail) throw new Error('storage unavailable');
      storage.map.set(key, value);
    },
  },
}));
vi.mock('@/theme/useAppearancePreference', () => ({ useAppearancePreference: () => ({ mode: 'light' }) }));
vi.mock('@/auth/appleAuth', () => ({
  AppleSignInCancelledError: class extends Error {},
  isAppleSignInSupportedPlatform: () => true,
  requestAppleCredential: async () => {
    state.calls.push('apple-provider');
    return { identityToken: 't', authorizationCode: 'c' };
  },
}));
vi.mock('@/auth/googleAuth', async () => {
  const { useState } = await import('react');
  return {
    extractGoogleIdToken: (response: { idToken?: string } | null) => response?.idToken ?? null,
    isGoogleAuthConfigured: () => true,
    useGoogleAuthRequest: () => {
      const [response, setResponse] = useState<{ idToken: string } | null>(null);
      return [{}, response, async () => {
        state.calls.push('google-provider');
        if (state.googleReturnsToken) setResponse({ idToken: 'google-id-token' });
      }];
    },
  };
});
vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({
    status: state.status,
    lastError: state.lastError,
    signInWithGoogleIdToken: async (_idToken: string, declaration?: unknown) => {
      state.calls.push('google-backend');
      state.declarations.push(declaration);
    },
    signInWithAppleIdToken: async (_idToken: string, _code?: string | null, declaration?: unknown) => {
      state.calls.push('apple-backend');
      state.declarations.push(declaration);
    },
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
vi.mock('@/components/AppleIcon', () => ({ AppleIcon: () => null }));
vi.mock('@/components/GoogleIcon', () => ({ GoogleIcon: () => null }));

import { AGE_CONFIRMATION_POLICY_VERSION, hasConfirmedAccountAge, saveAccountAgeConfirmation } from '@/auth/ageConfirmation';
import { AccountSection } from '@/components/AccountSection';

const STORAGE_KEY = 'quran-heals:account-age-confirmation:v1';
const en = MESSAGES.en;
let root: ReactTestRenderer | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.status = 'guest';
  state.calls = [];
  state.declarations = [];
  state.googleReturnsToken = false;
  state.lastError = null;
  storage.map.clear();
  storage.fail = false;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

async function renderAccount(locale: AppLocale = 'en') {
  await act(async () => {
    root = create(createElement(AccountSection, { locale, messages: MESSAGES[locale], direction: getDirectionStyle(locale), isRtl: locale !== 'en' }));
  });
}
const pressables = () => root!.root.findAll((node: ReactTestInstance) => node.type === ('Pressable' as never));
const byLabel = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const texts = () => root!.root.findAll((node) => node.type === ('Text' as never)).map((node) => node.props.children);
const press = async (label: string) => {
  const target = byLabel(label);
  if (!target) throw new Error(`no pressable "${label}"`);
  await act(async () => { await target.props.onPress(); });
};
const panelShown = () => texts().includes(en.ageConfirmation.title);

describe('sign-in is gated until the account-age confirmation', () => {
  it('Apple: pressing sign-in shows the confirmation and starts nothing', async () => {
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(panelShown()).toBe(true);
    expect(state.calls).toEqual([]);
    expect(byLabel(en.account.signInWithApple)).toBeUndefined();
  });

  it('Google: pressing sign-in shows the confirmation and starts nothing', async () => {
    await renderAccount();
    await press(en.account.signInWithGoogle);
    expect(panelShown()).toBe(true);
    expect(state.calls).toEqual([]);
  });

  it('Continue stays disabled until the checkbox is ticked, and a press while disabled does nothing', async () => {
    await renderAccount();
    await press(en.account.signInWithApple);
    const cont = () => byLabel(en.ageConfirmation.continueButton)!;
    expect(cont().props.disabled).toBe(true);
    expect(cont().props.accessibilityState).toEqual({ disabled: true });
    await act(async () => { cont().props.onPress(); });
    expect(state.calls).toEqual([]);
    await press(en.ageConfirmation.checkbox);
    expect(byLabel(en.ageConfirmation.checkbox)!.props.accessibilityState).toEqual({ checked: true });
    expect(cont().props.disabled).toBe(false);
  });

  it('Continue after ticking starts exactly the provider that was chosen, and persists the confirmation', async () => {
    await renderAccount();
    await press(en.account.signInWithApple);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    expect(state.calls).toEqual(['apple-provider', 'apple-backend']);
    expect(panelShown()).toBe(false);
    expect(await hasConfirmedAccountAge()).toBe(true);
  });

  it('Google after confirmation starts the Google prompt', async () => {
    await renderAccount();
    await press(en.account.signInWithGoogle);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    expect(state.calls).toEqual(['google-provider']);
  });

  it('Cancel starts no authentication and stores nothing; the buttons come back', async () => {
    await renderAccount();
    await press(en.account.signInWithGoogle);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.cancel);
    expect(state.calls).toEqual([]);
    expect(panelShown()).toBe(false);
    expect(byLabel(en.account.signInWithGoogle)).toBeTruthy();
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
  });

  it('an already-confirmed device is not asked again: sign-in starts directly', async () => {
    await saveAccountAgeConfirmation();
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(panelShown()).toBe(false);
    expect(state.calls).toEqual(['apple-provider', 'apple-backend']);
  });

  it('after confirming once, a later sign-in in the same session is not prompted again', async () => {
    await renderAccount();
    await press(en.account.signInWithGoogle);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    await press(en.account.signInWithApple);
    expect(state.calls).toEqual(['google-provider', 'apple-provider', 'apple-backend']);
  });

  it('a confirmation for an older policy version asks again', async () => {
    storage.map.set(STORAGE_KEY, JSON.stringify({ policyVersion: AGE_CONFIRMATION_POLICY_VERSION - 1, confirmedAt: '2026-01-01T00:00:00.000Z' }));
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(panelShown()).toBe(true);
    expect(state.calls).toEqual([]);
  });

  it('if storage fails, the device counts as not confirmed (asked), and confirming still works this session', async () => {
    storage.fail = true;
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(panelShown()).toBe(true);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    expect(state.calls).toEqual(['apple-provider', 'apple-backend']);
  });
});

describe('the declaration sent to the backend', () => {
  const DECLARATION = { policyVersion: AGE_CONFIRMATION_POLICY_VERSION };

  it('Apple: sent only after the user confirmed, with the current policy version', async () => {
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(state.declarations).toEqual([]);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    expect(state.declarations).toEqual([DECLARATION]);
  });

  it('Google: sent with the ID token from a prompt started after confirming', async () => {
    state.googleReturnsToken = true;
    await renderAccount();
    await press(en.account.signInWithGoogle);
    expect(state.calls).toEqual([]);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.continueButton);
    expect(state.calls).toEqual(['google-provider', 'google-backend']);
    expect(state.declarations).toEqual([DECLARATION]);
  });

  it('an already-confirmed device sends it without asking again (one confirmation, not two)', async () => {
    await saveAccountAgeConfirmation();
    await renderAccount();
    await press(en.account.signInWithApple);
    expect(panelShown()).toBe(false);
    expect(state.declarations).toEqual([DECLARATION]);
  });

  it('Cancel sends nothing at all', async () => {
    await renderAccount();
    await press(en.account.signInWithApple);
    await press(en.ageConfirmation.checkbox);
    await press(en.ageConfirmation.cancel);
    expect(state.declarations).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('a backend refusal is shown as an error; the panel does not reopen and nothing retries', async () => {
    state.lastError = 'To create a Quran Heals account, please update the app to the latest version and confirm that you meet the minimum age requirement.';
    await renderAccount();
    expect(texts()).toContain(state.lastError);
    expect(panelShown()).toBe(false);
    expect(state.calls).toEqual([]);
    expect(byLabel(en.account.signInWithApple)).toBeTruthy();
  });
});

describe('existing accounts and other features are not affected', () => {
  it('a signed-in user stays signed in: no confirmation, no sign-out, Danger Zone available', async () => {
    state.status = 'signed-in';
    await renderAccount();
    expect(panelShown()).toBe(false);
    expect(texts()).toContain(en.account.signedIn);
    expect(byLabel(en.account.deleteAccountAction)).toBeTruthy();
    expect(state.calls).toEqual([]);
  });

  it('while the session is being restored, nothing is gated or shown', async () => {
    state.status = 'loading';
    await renderAccount();
    expect(panelShown()).toBe(false);
    expect(texts()).toContain(en.account.checkingSession);
  });

  it('only AccountSection imports the gate: auth restoration/refresh, re-authentication, sync, favorites, reflections and guest screens do not', () => {
    const src = resolve(__dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(src);
    const relative = (file: string) => file.slice(src.length + 1).replace(/\\/g, '/');
    const source = (file: string) => readFileSync(file, 'utf8');
    // Runtime (value) imports: only AccountSection can show the gate or attach a declaration.
    const importers = files.filter((file) => /import \{[^}]*\} from '(@\/auth|\.)\/ageConfirmation'/.test(source(file))).map(relative);
    expect(importers).toEqual(['components/AccountSection.tsx']);
    // authApi/useAuth only pass the declaration type through; they never read the stored confirmation.
    const typeOnly = files.filter((file) => /import type \{[^}]*\} from '(@\/auth|\.)\/ageConfirmation'/.test(source(file))).map(relative);
    expect(typeOnly.sort()).toEqual(['auth/authApi.ts', 'auth/useAuth.tsx']);
  });
});

describe('storage holds no age or date of birth', () => {
  it('stores only the policy version and the confirmation time', async () => {
    await saveAccountAgeConfirmation(new Date('2026-10-09T12:00:00.000Z'));
    expect(JSON.parse(storage.map.get(STORAGE_KEY)!)).toEqual({ policyVersion: AGE_CONFIRMATION_POLICY_VERSION, confirmedAt: '2026-10-09T12:00:00.000Z' });
  });

  it('a corrupted record means not confirmed, never a crash', async () => {
    storage.map.set(STORAGE_KEY, '{not json');
    expect(await hasConfirmedAccountAge()).toBe(false);
    storage.map.set(STORAGE_KEY, JSON.stringify({ policyVersion: AGE_CONFIRMATION_POLICY_VERSION }));
    expect(await hasConfirmedAccountAge()).toBe(false);
  });
});

describe('approved wording', () => {
  it('English is exact', () => {
    expect(MESSAGES.en.ageConfirmation).toEqual({
      title: 'Before you continue',
      description: 'To create a Quran Heals account, you must be at least 16 years old and meet the minimum age required in your country.',
      checkbox: 'I confirm that I meet the minimum age requirement.',
      continueButton: 'Continue',
      cancel: 'Cancel',
    });
  });

  it('Arabic (ar and ar-EG) is exactly the approved text', () => {
    const approved = {
      title: 'قبل المتابعة',
      description: 'لإنشاء حساب في قرآن يشفي، يجب ألا يقل عمرك عن ١٦ عامًا، مع مراعاة الحد الأدنى للسن في بلدك.',
      checkbox: 'أؤكد أن عمري يسمح لي بإنشاء حساب.',
      continueButton: 'متابعة',
      cancel: 'إلغاء',
    };
    expect(MESSAGES.ar.ageConfirmation).toEqual(approved);
    expect(MESSAGES['ar-EG'].ageConfirmation).toEqual(approved);
  });

  it('the Arabic panel renders the approved strings', async () => {
    await renderAccount('ar');
    await press(MESSAGES.ar.account.signInWithApple);
    expect(texts()).toEqual(expect.arrayContaining([MESSAGES.ar.ageConfirmation.title, MESSAGES.ar.ageConfirmation.description, MESSAGES.ar.ageConfirmation.checkbox]));
  });
});
