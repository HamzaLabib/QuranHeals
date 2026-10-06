import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExpoConfig } from 'expo/config';

import { assertGoogleClientIdsForBuild, withGoogleRedirectScheme } from '../app.config';
import { googleClientIdForPlatform, readGoogleClientIds } from '@/auth/googleConfig';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8');

// Obviously fake, correctly shaped public client IDs.
const IOS = '111111111111-iosclientabc.apps.googleusercontent.com';
const ANDROID = '111111111111-androidclientabc.apps.googleusercontent.com';
const WEB = '111111111111-webclientabc.apps.googleusercontent.com';

afterEach(() => vi.unstubAllEnvs());

describe('Google client IDs per platform', () => {
  it('reads the three platform variables, treating blank as unset', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', ` ${IOS} `);
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', '');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', WEB);
    expect(readGoogleClientIds()).toEqual({ ios: IOS, android: undefined, web: WEB });
  });

  it('only counts the current platform’s own client ID', () => {
    const onlyAndroid = { android: ANDROID };
    expect(googleClientIdForPlatform('ios', onlyAndroid)).toBeUndefined(); // iPhone build: Google hidden, not broken
    expect(googleClientIdForPlatform('android', onlyAndroid)).toBe(ANDROID);
    expect(googleClientIdForPlatform('web', { ios: IOS, android: ANDROID })).toBeUndefined();
    expect(googleClientIdForPlatform('ios', { ios: IOS, android: ANDROID, web: WEB })).toBe(IOS);
  });

  it('isGoogleAuthConfigured uses the platform-aware lookup, and the generic EXPO_PUBLIC_GOOGLE_CLIENT_ID is never read', () => {
    const source = read('src/auth/googleAuth.ts');
    expect(source).toMatch(/googleClientIdForPlatform\(Platform\.OS, readGoogleClientIds\(\)\)/);
    for (const file of ['src/auth/googleAuth.ts', 'src/auth/googleConfig.ts', '.env.example', 'app.config.ts']) {
      expect(read(file), file).not.toMatch(/EXPO_PUBLIC_GOOGLE_CLIENT_ID\b/);
    }
  });

  it('never commits a real Google client ID into source or config', () => {
    for (const file of ['src/auth/googleAuth.ts', 'src/auth/googleConfig.ts', 'app.json', 'app.config.ts', 'eas.json', '.env.example']) {
      expect(read(file), file).not.toMatch(/\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/);
    }
  });
});

describe('build-time Google client ID check (EAS worker)', () => {
  const worker = (ids: Record<string, string>) => ({ EAS_BUILD: 'true', ...ids });

  it('accepts well-formed IDs and unset IDs', () => {
    expect(() => assertGoogleClientIdsForBuild(worker({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS, EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: ANDROID }))).not.toThrow();
    expect(() => assertGoogleClientIdsForBuild(worker({}))).not.toThrow();
  });

  it('rejects a malformed ID, naming the variable but not echoing the value', () => {
    let message = '';
    try {
      assertGoogleClientIdsForBuild(worker({ EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'GOCSPX-looks-like-a-secret' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is not a Google OAuth client ID/);
    expect(message).not.toContain('GOCSPX');
  });

  it('never blocks local config evaluation', () => {
    expect(() => assertGoogleClientIdsForBuild({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'whatever' })).not.toThrow();
  });
});

describe('Google sign-in redirect scheme', () => {
  const base = { name: 'Quran Heals', slug: 'quran-heals', scheme: 'quranheals' } as ExpoConfig;

  it('registers the Android package as a URL scheme (expo-auth-session redirects to <applicationId>:/oauthredirect)', () => {
    const config = withGoogleRedirectScheme({ ...base, android: { package: 'com.quranheals.app' } });
    expect(config.android?.scheme).toEqual(['com.quranheals.app']);
    expect(config.scheme).toBe('quranheals'); // deep links unchanged
  });

  it('keeps existing Android schemes and never duplicates the package', () => {
    expect(withGoogleRedirectScheme({ ...base, android: { package: 'com.quranheals.app', scheme: 'extra' } }).android?.scheme).toEqual(['extra', 'com.quranheals.app']);
    const already = { ...base, android: { package: 'com.quranheals.app', scheme: ['com.quranheals.app'] } };
    expect(withGoogleRedirectScheme(already)).toBe(already);
  });

  it('matches the installed expo-auth-session redirect and the real app.json identifiers', () => {
    const google = read('node_modules/expo-auth-session/build/providers/Google.js');
    expect(google).toMatch(/native: `\$\{Application\.applicationId\}:\/oauthredirect`/);
    const app = JSON.parse(read('app.json')).expo;
    expect(app.android.package).toBe('com.quranheals.app');
    expect(app.ios.bundleIdentifier).toBe('com.quranheals.app'); // iOS registers this scheme itself
  });
});

describe('account deletion request', () => {
  it('waits longer than the backend’s bounded Apple calls before giving up', () => {
    const source = read('src/sync/syncApi.ts');
    const timeout = Number(source.match(/export const ACCOUNT_DELETION_TIMEOUT_MS = ([\d_]+);/)?.[1].replace(/_/g, ''));
    expect(timeout).toBeGreaterThanOrEqual(2 * 10_000 + 5_000); // two 10s Apple calls + database work
    expect(source).toMatch(/'\/api\/account',[\s\S]*?ACCOUNT_DELETION_TIMEOUT_MS,\s*\)/);
    // Every other request keeps the default 8s.
    expect(source.match(/ACCOUNT_DELETION_TIMEOUT_MS/g)).toHaveLength(2);
  });
});
