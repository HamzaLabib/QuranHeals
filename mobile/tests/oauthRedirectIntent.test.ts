import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'android' }));
vi.mock('react-native', () => ({ Platform: platform }));

import { isOAuthRedirect, redirectSystemPath } from '../src/app/+native-intent';

const REDIRECT = 'com.quranheals.app:/oauthredirect?state=abc&code=4%2F0Ab&scope=openid';

afterEach(() => {
  platform.OS = 'android';
});

describe('Google sign-in redirect and Expo Router (src/app/+native-intent.ts)', () => {
  it('Android: keeps the router from opening the redirect as a route ("Unmatched Route")', () => {
    expect(isOAuthRedirect(REDIRECT)).toBe(true);
    expect(isOAuthRedirect('quranheals://oauthredirect?code=x')).toBe(true);
    expect(redirectSystemPath({ path: REDIRECT, initial: false })).toBeNull(); // stay on Settings; WebBrowser completes it
    expect(redirectSystemPath({ path: REDIRECT, initial: true })).toBe('/'); // cold start: nothing left to complete
  });

  it('iOS: every path, the redirect included, passes through unchanged', () => {
    platform.OS = 'ios';
    expect(redirectSystemPath({ path: REDIRECT, initial: false })).toBe(REDIRECT);
    expect(redirectSystemPath({ path: REDIRECT, initial: true })).toBe(REDIRECT);
  });

  it('passes every other link through unchanged', () => {
    for (const path of ['quranheals://mushaf?page=61', 'https://quran-heals-api.onrender.com/ayah/2/255', 'quranheals://oauthredirect-help', 'quranheals://settings/oauthredirect']) {
      expect(isOAuthRedirect(path), path).toBe(false);
      expect(redirectSystemPath({ path, initial: false }), path).toBe(path);
      expect(redirectSystemPath({ path, initial: true }), path).toBe(path);
    }
  });
});
