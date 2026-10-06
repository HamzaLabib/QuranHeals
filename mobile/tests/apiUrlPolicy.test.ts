import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { assertApiUrlForBuild, checkHostedApiUrl, resolveApiUrlPolicy } from '../app.config';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8');

// What the EAS build worker sees for each profile (eas.json `env` + EAS_BUILD).
const worker = (profile: string, url?: string) => ({
  EAS_BUILD: 'true',
  EAS_BUILD_PROFILE: profile,
  QURAN_HEALS_API_URL_POLICY: profile === 'development' ? 'local' : 'hosted',
  ...(url === undefined ? {} : { EXPO_PUBLIC_API_URL: url }),
});

describe('production build API URL guard (EAS build worker)', () => {
  it('1. accepts a public https URL', () => {
    expect(() => assertApiUrlForBuild(worker('production', 'https://api.example.com'))).not.toThrow();
  });

  it('2. rejects a missing URL, naming the variable', () => {
    expect(() => assertApiUrlForBuild(worker('production'))).toThrow(/EXPO_PUBLIC_API_URL is not set/);
    expect(() => assertApiUrlForBuild(worker('production', '   '))).toThrow(/EXPO_PUBLIC_API_URL is not set/);
  });

  it('3. rejects http://localhost:4000', () => {
    expect(() => assertApiUrlForBuild(worker('production', 'http://localhost:4000'))).toThrow(/EXPO_PUBLIC_API_URL must use https/);
  });

  it('4. rejects http://127.0.0.1:4000', () => {
    expect(() => assertApiUrlForBuild(worker('production', 'http://127.0.0.1:4000'))).toThrow(/EXPO_PUBLIC_API_URL must use https/);
  });

  it('5. rejects LAN http addresses', () => {
    for (const url of ['http://192.168.1.20:4000', 'http://10.0.0.5:4000', 'http://172.16.4.2:4000', 'http://10.0.2.2:4000']) {
      expect(() => assertApiUrlForBuild(worker('production', url)), url).toThrow(/EXPO_PUBLIC_API_URL/);
    }
  });

  it('6. rejects an insecure http public domain', () => {
    expect(() => assertApiUrlForBuild(worker('production', 'http://api.example.com'))).toThrow(/must use https/);
  });

  it('7. development builds keep the local backend (no URL, or http://localhost:4000)', () => {
    expect(() => assertApiUrlForBuild(worker('development'))).not.toThrow();
    expect(() => assertApiUrlForBuild(worker('development', 'http://localhost:4000'))).not.toThrow();
    expect(() => assertApiUrlForBuild({})).not.toThrow(); // plain `expo start`
  });

  it('applies the same rule to preview builds', () => {
    expect(() => assertApiUrlForBuild(worker('preview'))).toThrow(/profile "preview"/);
    expect(() => assertApiUrlForBuild(worker('preview', 'https://api.example.com'))).not.toThrow();
  });

  it('never blocks local config evaluation, which runs before EAS downloads the environment', () => {
    expect(() => assertApiUrlForBuild({ QURAN_HEALS_API_URL_POLICY: 'hosted' })).not.toThrow();
    expect(() => assertApiUrlForBuild({ QURAN_HEALS_API_URL_POLICY: 'hosted', EXPO_PUBLIC_API_URL: 'http://192.168.1.20:4000' })).not.toThrow();
  });
});

describe('checkHostedApiUrl', () => {
  it('accepts public https URLs and strips a trailing slash', () => {
    expect(checkHostedApiUrl('https://api.example.com/')).toEqual({ ok: true, url: 'https://api.example.com' });
    expect(checkHostedApiUrl(' https://quran-heals.example.org ')).toEqual({ ok: true, url: 'https://quran-heals.example.org' });
  });

  it.each([
    'https://localhost',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://0.0.0.0',
    'https://192.168.0.10',
    'https://169.254.1.1',
    'https://100.64.0.1',
    'https://[::1]',
    'https://[fd12::1]',
    'https://[fe80::1]',
    'https://my-mac.local',
  ])('rejects local/private host %s even over https', (url) => {
    expect(checkHostedApiUrl(url)).toMatchObject({ ok: false, reason: expect.stringMatching(/local or private-network host/) });
  });

  it.each(['ftp://api.example.com', 'api.example.com', 'not a url'])('rejects %s', (url) => {
    expect(checkHostedApiUrl(url).ok).toBe(false);
  });

  it('rejects credentials, query strings and fragments', () => {
    for (const url of ['https://user:pass@api.example.com', 'https://api.example.com?x=1', 'https://api.example.com#x']) {
      expect(checkHostedApiUrl(url), url).toMatchObject({ ok: false, reason: expect.stringMatching(/plain base URL/) });
    }
  });
});

describe('resolveApiUrlPolicy', () => {
  it('uses the explicit eas.json value, else falls back to the EAS profile name', () => {
    expect(resolveApiUrlPolicy({ QURAN_HEALS_API_URL_POLICY: 'local', EAS_BUILD_PROFILE: 'production' })).toBe('local');
    expect(resolveApiUrlPolicy({ EAS_BUILD_PROFILE: 'production' })).toBe('hosted');
    expect(resolveApiUrlPolicy({ EAS_BUILD_PROFILE: 'preview' })).toBe('hosted');
    expect(resolveApiUrlPolicy({ EAS_BUILD_PROFILE: 'development' })).toBe('local');
    expect(resolveApiUrlPolicy({})).toBe('local');
  });

  it('rejects an unknown policy value instead of guessing', () => {
    expect(() => resolveApiUrlPolicy({ QURAN_HEALS_API_URL_POLICY: 'prod' })).toThrow(/must be "hosted" or "local"/);
  });
});

describe('eas.json profiles', () => {
  const eas = JSON.parse(read('eas.json'));

  it('uses EAS-managed (remote) app versions', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('defines development, preview and production with separate environments and update channels', () => {
    const { development, preview, production } = eas.build;
    expect(development).toMatchObject({ developmentClient: true, distribution: 'internal', environment: 'development', channel: 'development' });
    expect(preview).toMatchObject({ distribution: 'internal', environment: 'preview', channel: 'preview' });
    expect(production).toMatchObject({ distribution: 'store', environment: 'production', channel: 'production', autoIncrement: true });
    expect(production.android).toMatchObject({ buildType: 'app-bundle' });
  });

  it('marks preview and production as hosted builds and development as local', () => {
    expect(eas.build.development.env.QURAN_HEALS_API_URL_POLICY).toBe('local');
    expect(eas.build.preview.env.QURAN_HEALS_API_URL_POLICY).toBe('hosted');
    expect(eas.build.production.env.QURAN_HEALS_API_URL_POLICY).toBe('hosted');
  });

  it('never commits an API URL or other EXPO_PUBLIC values into a profile', () => {
    for (const profile of Object.values<{ env?: Record<string, string> }>(eas.build)) {
      expect(Object.keys(profile.env ?? {}).filter((key) => key.startsWith('EXPO_PUBLIC_'))).toEqual([]);
    }
  });
});

describe('app config', () => {
  const app = JSON.parse(read('app.json')).expo;

  it('lets EAS own build numbers (no local buildNumber/versionCode) and keeps fingerprint runtime versions', () => {
    expect(app.ios.buildNumber).toBeUndefined();
    expect(app.android.versionCode).toBeUndefined();
    expect(app.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('never hard-codes a hosted backend URL in source', () => {
    for (const file of ['app.config.ts', 'src/services/apiBase.ts']) {
      expect(read(file)).not.toMatch(/onrender\.com|https:\/\/[a-z0-9-]+\.[a-z]/i);
    }
  });
});

describe('runtime defense in services/apiBase.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses EXPO_PUBLIC_API_URL when it is set', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.com/');
    vi.resetModules();
    const { apiBaseUrl } = await import('@/services/apiBase');
    expect(apiBaseUrl).toBe('https://api.example.com');
  });

  it('a release bundle (__DEV__ false) without the URL fails loudly instead of using localhost', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    vi.resetModules();
    await expect(import('@/services/apiBase')).rejects.toThrow(/EXPO_PUBLIC_API_URL was not set/);
  });

  it('keeps the localhost fallback for development bundles only', () => {
    const source = read('src/services/apiBase.ts');
    expect(source).toMatch(/if \(!configuredApiUrl && !__DEV__\)/);
    expect(source).toMatch(/'http:\/\/10\.0\.2\.2:4000' : 'http:\/\/localhost:4000'/);
  });
});
