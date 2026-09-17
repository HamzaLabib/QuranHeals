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

describe('Account section: Apple/Google brand icons', () => {
  it('renders the solid Apple brand logo (bundled AppleIcon, no new dependency) in white before the label on the dark Apple button', () => {
    expect(accountSectionSource).toMatch(/import \{ AppleIcon \} from '\.\/AppleIcon'/);
    expect(accountSectionSource).not.toMatch(/from 'lucide-react-native'/);
    const appleButtonBlock = accountSectionSource.match(/isAppleSignInSupportedPlatform\(\) && \([\s\S]*?<\/Pressable>/)?.[0] ?? '';
    expect(appleButtonBlock).toMatch(/<AppleIcon size=\{BRAND_ICON_SIZE\} color=\{colors\.surface\}\s*\/>/);
    // Icon appears before the label in source order (icon-then-label group).
    const iconIndex = appleButtonBlock.indexOf('<AppleIcon');
    const labelIndex = appleButtonBlock.indexOf('messages.account.signInWithApple}</Text>');
    expect(iconIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeGreaterThan(iconIndex);
  });

  it('AppleIcon renders a solid brand glyph via react-native-svg (already a dependency), never loaded from a remote URL', () => {
    const appleIconSource = readFileSync(resolve(__dirname, '../src/components/AppleIcon.tsx'), 'utf-8');
    expect(appleIconSource).toMatch(/from 'react-native-svg'/);
    expect(appleIconSource).not.toMatch(/https?:\/\//);
    expect(appleIconSource).not.toMatch(/<Image\b/);
    expect(appleIconSource).toMatch(/fill=\{color\}/);
  });

  it('renders the bundled multicolour GoogleIcon (never a plain "G" glyph or emoji) before the label on a white/bordered Google button', () => {
    expect(accountSectionSource).toMatch(/import \{ GoogleIcon \} from '\.\/GoogleIcon'/);
    const googleButtonBlock = accountSectionSource.match(/isGoogleAuthConfigured\(\) && \([\s\S]*?<\/Pressable>/)?.[0] ?? '';
    expect(googleButtonBlock).toMatch(/<GoogleIcon size=\{BRAND_ICON_SIZE\}\s*\/>/);
    expect(googleButtonBlock).toMatch(/styles\.googleButton/);
    expect(googleButtonBlock).toMatch(/styles\.googleButtonText/);
    expect(googleButtonBlock).not.toMatch(/>\s*G\s*</); // never approximated with a bare "G" character
    const iconIndex = googleButtonBlock.indexOf('<GoogleIcon');
    const labelIndex = googleButtonBlock.indexOf('messages.account.signInWithGoogle}</Text>');
    expect(iconIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeGreaterThan(iconIndex);
  });

  it('the Google button style overrides only background/border/text color — never width, height, or radius', () => {
    const googleButtonStyle = accountSectionSource.match(/googleButton: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(googleButtonStyle).toMatch(/backgroundColor: colors\.surface/);
    expect(googleButtonStyle).toMatch(/borderColor: colors\.border/);
    expect(googleButtonStyle).toMatch(/borderWidth: 1/);
    expect(googleButtonStyle).not.toMatch(/minHeight|borderRadius|width:/);
  });

  it('both provider buttons keep the existing minHeight (>=44 touch target), radius, and press handlers exactly', () => {
    expect(accountSectionSource).toMatch(/button: \{[\s\S]*?minHeight: 48,[\s\S]*?\},/);
    expect(accountSectionSource).toMatch(/onPress=\{\(\) => void onApplePress\(\)\}/);
    expect(accountSectionSource).toMatch(/onPress=\{\(\) => void promptGoogleAsync\(\)\}/);
    expect(accountSectionSource).toMatch(/disabled=\{!googleRequest\}/);
  });

  it('preserves the existing accessibility labels for both provider buttons unchanged', () => {
    expect(accountSectionSource).toMatch(/accessibilityLabel=\{messages\.account\.signInWithApple\}/);
    expect(accountSectionSource).toMatch(/accessibilityLabel=\{messages\.account\.signInWithGoogle\}/);
  });

  it('icon size is within the requested ~20-22px range', () => {
    const match = accountSectionSource.match(/const BRAND_ICON_SIZE = (\d+);/);
    expect(match).not.toBeNull();
    const size = Number(match![1]);
    expect(size).toBeGreaterThanOrEqual(20);
    expect(size).toBeLessThanOrEqual(22);
  });

  it('the button row lays out icon+label horizontally with a 10-12px gap, centered as one group', () => {
    const buttonStyle = accountSectionSource.match(/\n {2}button: \{[\s\S]*?\n {2}\},/)?.[0] ?? '';
    expect(buttonStyle).toMatch(/flexDirection: 'row'/);
    expect(buttonStyle).toMatch(/alignItems: 'center'/);
    expect(buttonStyle).toMatch(/justifyContent: 'center'/);
    expect(buttonStyle).toMatch(/gap: (1[0-2]),/);
  });

  it('buttonRtl still applies to both provider buttons, so brand icon+label order (not the brand mark itself) mirrors with the interface', () => {
    const appleButtonBlock = accountSectionSource.match(/isAppleSignInSupportedPlatform\(\) && \([\s\S]*?<\/Pressable>/)?.[0] ?? '';
    const googleButtonBlock = accountSectionSource.match(/isGoogleAuthConfigured\(\) && \([\s\S]*?<\/Pressable>/)?.[0] ?? '';
    expect(appleButtonBlock).toMatch(/isRtl && styles\.buttonRtl/);
    expect(googleButtonBlock).toMatch(/isRtl && styles\.buttonRtl/);
  });
});

describe('GoogleIcon: bundled official multicolour "G" logomark', () => {
  const googleIconSource = readFileSync(resolve(__dirname, '../src/components/GoogleIcon.tsx'), 'utf-8');

  it('renders via react-native-svg (already an installed dependency), never a remote image URL', () => {
    expect(googleIconSource).toMatch(/from 'react-native-svg'/);
    expect(googleIconSource).not.toMatch(/https?:\/\//);
    expect(googleIconSource).not.toMatch(/<Image\b/);
  });

  it('uses all four official Google brand colours (blue, green, yellow, red)', () => {
    expect(googleIconSource).toMatch(/#4285F4/i);
    expect(googleIconSource).toMatch(/#34A853/i);
    expect(googleIconSource).toMatch(/#FBBC05/i);
    expect(googleIconSource).toMatch(/#EA4335/i);
  });

  it('accepts a configurable size prop defaulting to 20px', () => {
    expect(googleIconSource).toMatch(/size = 20/);
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
