import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import { classifyVisitor, parseAyahLinkParams, readAppLinksConfig, type AppLinksConfig } from '../../src/appLinks/appLinks';
import type { QuranRepository } from '../../src/services/QuranRepository';

/** Smart ayah links: OS verification files, reference validation and store redirects. */

const unusedRepository = {} as QuranRepository;
const FINGERPRINT = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0').toUpperCase()).join(':');
const APP_STORE = 'https://apps.apple.com/app/quran-heals/id1234567890';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.quranheals.app';
const configured: AppLinksConfig = { appleTeamId: 'ABCDE12345', androidSha256Fingerprints: [FINGERPRINT], appStoreUrl: APP_STORE, playStoreUrl: PLAY_STORE };
const appWith = (appLinks: AppLinksConfig) => createApp({ repository: unusedRepository, appLinks, databaseHealthCheck: async () => true });

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  tiktokIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_37.0.0 BytedanceWebview/d8a21c6',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

describe('verification files', () => {
  it('serves the Apple App Site Association as JSON at the exact path, for /ayah/*/* only', async () => {
    const response = await request(appWith(configured)).get('/.well-known/apple-app-site-association').expect(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(response.text)).toEqual({
      applinks: { details: [{ appIDs: ['ABCDE12345.com.quranheals.app'], components: [{ '/': '/ayah/*/*', comment: expect.any(String) }] }] },
    });
  });

  it('serves Digital Asset Links as JSON for com.quranheals.app with the configured fingerprints', async () => {
    const response = await request(appWith(configured)).get('/.well-known/assetlinks.json').expect(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(response.text)).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.quranheals.app', sha256_cert_fingerprints: [FINGERPRINT] },
    }]);
  });

  it('404s (never an invented identifier) until each is configured', async () => {
    const app = appWith({ androidSha256Fingerprints: [] });
    await request(app).get('/.well-known/apple-app-site-association').expect(404);
    await request(app).get('/.well-known/assetlinks.json').expect(404);
  });

  it('never redirects the verification files', async () => {
    for (const path of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
      const response = await request(appWith(configured)).get(path);
      expect(response.status).toBe(200);
      expect(response.headers.location).toBeUndefined();
    }
  });
});

describe('configuration', () => {
  it('accepts valid identifiers and store URLs', () => {
    const { config, problems } = readAppLinksConfig({
      APPLE_TEAM_ID: 'ABCDE12345',
      ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FINGERPRINT.toLowerCase()}, ${FINGERPRINT}`,
      APP_STORE_URL: APP_STORE,
      PLAY_STORE_URL: PLAY_STORE,
    });
    expect(problems).toEqual([]);
    expect(config).toEqual({ appleTeamId: 'ABCDE12345', androidSha256Fingerprints: [FINGERPRINT], appStoreUrl: APP_STORE, playStoreUrl: PLAY_STORE });
  });

  it('drops malformed values and names the variable, never the value', () => {
    const { config, problems } = readAppLinksConfig({
      APPLE_TEAM_ID: 'short',
      ANDROID_APP_LINK_SHA256_FINGERPRINTS: 'AA:BB',
      APP_STORE_URL: 'https://evil.example/app',
      PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=com.other.app',
    });
    expect(config).toEqual({ androidSha256Fingerprints: [] });
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).not.toMatch(/short|AA:BB|evil|com\.other/);
  });

  it('with nothing set, nothing is enabled', () => {
    expect(readAppLinksConfig({})).toEqual({ config: { androidSha256Fingerprints: [] }, problems: [] });
  });
});

describe('ayah references', () => {
  it('accepts every real ayah and nothing else', () => {
    expect(parseAyahLinkParams('1', '1')).toBe('1:1');
    expect(parseAyahLinkParams('94', '5')).toBe('94:5');
    expect(parseAyahLinkParams('2', '286')).toBe('2:286');
    expect(parseAyahLinkParams('114', '6')).toBe('114:6');
    for (const [surah, ayah] of [['1', '8'], ['94', '9'], ['115', '1'], ['0', '1'], ['2', '0'], ['02', '5'], ['2', '05'], ['2', '5.0'], ['-1', '1'], ['abc', '1'], ['1e2', '1'], ['', '1']]) {
      expect(parseAyahLinkParams(surah, ayah), `${surah}:${ayah}`).toBeNull();
    }
    expect(parseAyahLinkParams(undefined, '1')).toBeNull();
  });

  it('an invalid link is a plain 404, without a redirect', async () => {
    for (const path of ['/ayah/94/9', '/ayah/115/1', '/ayah/0/1', '/ayah/02/5', '/ayah/abc/1']) {
      const response = await request(appWith(configured)).get(path).set('User-Agent', UA.iphoneSafari);
      expect(response.status, path).toBe(404);
      expect(response.headers.location).toBeUndefined();
    }
  });
});

describe('store redirects (app not installed)', () => {
  it('iPhone browsers go to the App Store; Android browsers to Google Play', async () => {
    const ios = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.iphoneSafari).expect(302);
    expect(ios.headers.location).toBe(APP_STORE);
    const android = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.androidChrome).expect(302);
    expect(android.headers.location).toBe(PLAY_STORE);
  });

  it('ignores query strings such as fbclid and never echoes them', async () => {
    const response = await request(appWith(configured)).get('/ayah/94/5?fbclid=secret-tracker&igshid=abc').set('User-Agent', UA.iphoneSafari).expect(302);
    expect(response.headers.location).toBe(APP_STORE);
  });

  it('before the store listings exist, shows the open-in-app page instead of inventing a store URL', async () => {
    const response = await request(appWith({ ...configured, appStoreUrl: undefined, playStoreUrl: undefined }))
      .get('/ayah/94/5').set('User-Agent', UA.iphoneSafari).expect(200);
    expect(response.text).toContain('href="quranheals://ayah/94/5"');
    expect(response.text).not.toMatch(/apps\.apple\.com|play\.google\.com/);
  });
});

describe('in-app browsers and other visitors', () => {
  it('Instagram, Facebook and TikTok in-app browsers get "Open in Quran Heals" plus the store, not a blind redirect', async () => {
    const instagram = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.instagramIos).expect(200);
    expect(instagram.text).toContain('href="quranheals://ayah/94/5"');
    expect(instagram.text).toContain(`href="${APP_STORE}"`);
    expect(instagram.text).not.toContain('play.google.com');

    const facebook = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.facebookAndroid).expect(200);
    expect(facebook.text).toContain('intent://ayah/94/5#Intent;scheme=quranheals;package=com.quranheals.app;');
    expect(facebook.text).toContain(`S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)}`);

    const tiktok = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.tiktokIos).expect(200);
    expect(tiktok.text).toContain('href="quranheals://ayah/94/5"');
  });

  it('desktop visitors see the store links only', async () => {
    const response = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.desktop).expect(200);
    expect(response.text).toContain(APP_STORE);
    expect(response.text).toContain(PLAY_STORE);
    expect(response.text).not.toContain('quranheals://');
  });

  it('the page never shows the ayah, runs no script, and is never cached or indexed', async () => {
    const response = await request(appWith(configured)).get('/ayah/94/5').set('User-Agent', UA.instagramIos).expect(200);
    expect(response.text).not.toMatch(/<script|إِنَّ مَعَ|hardship/i);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.vary).toMatch(/User-Agent/);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['content-security-policy']).toMatch(/script-src 'self'/);
  });

  it('classifies platforms from the User-Agent', () => {
    expect(classifyVisitor(UA.iphoneSafari)).toBe('ios');
    expect(classifyVisitor(UA.androidChrome)).toBe('android');
    expect(classifyVisitor(UA.instagramIos)).toBe('in-app-ios');
    expect(classifyVisitor(UA.facebookAndroid)).toBe('in-app-android');
    expect(classifyVisitor(UA.tiktokIos)).toBe('in-app-ios');
    expect(classifyVisitor(UA.desktop)).toBe('other');
    expect(classifyVisitor(undefined)).toBe('other');
  });
});

describe('the API is unaffected', () => {
  it('/api routes and unknown paths behave as before', async () => {
    await request(appWith(configured)).get('/api/health').expect(200);
    const missing = await request(appWith(configured)).get('/ayah').expect(404);
    expect(missing.body).toMatchObject({ success: false });
  });
});
