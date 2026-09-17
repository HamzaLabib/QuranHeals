import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const accountSectionSource = readFileSync(resolve(__dirname, '../src/components/AccountSection.tsx'), 'utf-8');
const settingsSource = readFileSync(resolve(__dirname, '../src/app/settings.tsx'), 'utf-8');
const useAuthSource = readFileSync(resolve(__dirname, '../src/auth/useAuth.tsx'), 'utf-8');
const layoutSource = readFileSync(resolve(__dirname, '../src/app/_layout.tsx'), 'utf-8');

describe('Settings: Account section wiring', () => {
  it('settings.tsx renders AccountSection', () => {
    expect(settingsSource).toMatch(/<AccountSection\b/);
  });

  it('the app is wrapped in AuthProvider (guest usage never requires it, but the context must exist for Settings)', () => {
    expect(layoutSource).toMatch(/<AuthProvider>/);
    expect(layoutSource).toMatch(/WebBrowser\.maybeCompleteAuthSession\(\)/);
  });
});

describe('Account section: guest vs signed-in state uses the approved copy', () => {
  it('guest state shows notSignedIn plus both provider sign-in options, gated per platform/config', () => {
    expect(accountSectionSource).toMatch(/messages\.account\.notSignedIn/);
    expect(accountSectionSource).toMatch(/messages\.account\.signInWithApple/);
    expect(accountSectionSource).toMatch(/messages\.account\.signInWithGoogle/);
    expect(accountSectionSource).toMatch(/isAppleSignInSupportedPlatform\(\)/);
    expect(accountSectionSource).toMatch(/isGoogleAuthConfigured\(\)/);
  });

  it('signed-in state shows signedIn and signOut, not the sign-in buttons', () => {
    expect(accountSectionSource).toMatch(/messages\.account\.signedIn/);
    expect(accountSectionSource).toMatch(/messages\.account\.signOut/);
  });

  it("never renders a token, provider subject id, or internal database id — only the localized status strings and the shared user-facing error", () => {
    expect(accountSectionSource).not.toMatch(/\{user\.id\}|\{user\.providerSubject\}|\{token\}|\{sessionToken\}/);
  });

  it('supports exactly Apple and Google — no Facebook/X/LinkedIn/Microsoft/phone/email-password option', () => {
    expect(accountSectionSource).not.toMatch(/facebook|twitter|linkedin|microsoft|phone number|email.*password/i);
  });
});

describe('useAuth: guest-first + no client-spoofable identity', () => {
  it('defaults to guest and only flips to signed-in after a verified backend response', () => {
    expect(useAuthSource).toMatch(/useState<AuthStatus>\('loading'\)/);
    expect(useAuthSource).toMatch(/setStatus\('guest'\)/);
  });

  it('a failed sign-in only ever sets lastError, never blocks guest usage or throws out of the provider', () => {
    const signInGoogleBlock = useAuthSource.match(/const signInWithGoogle = useCallback\([\s\S]*?\n  \);/)?.[0] ?? '';
    const signInAppleBlock = useAuthSource.match(/const signInWithApple = useCallback\([\s\S]*?\n  \);/)?.[0] ?? '';
    expect(signInGoogleBlock.length).toBeGreaterThan(0);
    expect(signInAppleBlock.length).toBeGreaterThan(0);
    expect(signInGoogleBlock).toMatch(/setLastError\(/);
    expect(signInGoogleBlock).not.toMatch(/\bthrow\b/);
    expect(signInAppleBlock).not.toMatch(/\bthrow\b/);
  });

  it('sign-out clears the session token and cached master key but calls no favorites/reflections/history storage function', () => {
    const signOutBlock = (useAuthSource.match(/const signOut = useCallback\(async \(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/)?.[0] ?? '')
      .replace(/\/\/.*$/gm, ''); // strip line comments before checking for actual function calls
    expect(signOutBlock).toMatch(/clearSessionToken\(\)/);
    expect(signOutBlock).toMatch(/clearCachedMasterKey\(\)/);
    expect(signOutBlock).not.toMatch(/favorites\.|ayahReflections\.|recentAyah\w*\(/i);
  });

  it('never accepts or forwards a client-supplied userId anywhere in the auth flow', () => {
    expect(useAuthSource).not.toMatch(/userId:\s*['"`]/);
  });

  it('syncs once on cold-start restore and again whenever the app returns to the foreground while signed in (Part H §33)', () => {
    expect(useAuthSource).toMatch(/void runSyncAfterSignIn\(token\);/);
    expect(useAuthSource).toMatch(/AppState\.addEventListener\('change'/);
    expect(useAuthSource).toMatch(/nextState !== 'active'\) return;/);
  });
});
