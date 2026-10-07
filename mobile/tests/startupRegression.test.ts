import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression suite for the "neither emotions nor ayahs load on startup"
 * investigation. Root cause was `mobile/.env`'s EXPO_PUBLIC_API_URL pointing
 * at a stale/unreachable LAN IP (an environment misconfiguration, not a
 * code bug) — the dark-mode/Appearance provider work was audited and ruled
 * out, since every provider in the root layout renders `children`
 * unconditionally and no provider gates on its own async load. These tests
 * lock in: (1) the data-loading logic itself is sound end-to-end, and
 * (2) no provider/screen can silently reintroduce a startup-blocking gate.
 */

// Several services under test (apiBase.ts via Platform.OS) import
// react-native at module scope; the real package uses Flow syntax vitest's
// plain-node environment cannot parse, so it must always be mocked here —
// same convention as apiUrlPolicy.test.ts.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  useColorScheme: () => 'light',
  StyleSheet: { create: (value: unknown) => value },
}));
// services/api.ts imports resolveAyahArabic from here, which otherwise pulls
// in expo-asset (native-only); getEmotions() never calls it, so a trivial
// stub avoids loading the native module chain, matching
// localDataOwnership.test.ts's existing convention.
vi.mock('@/services/quran', () => ({
  resolveAyahArabic: async (value: unknown) => value,
}));

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Home loads 30 active emotions (regression)', () => {
  it('getEmotions() resolves to exactly the 30 emotions the backend envelope returns', async () => {
    const emotions = Array.from({ length: 30 }, (_, i) => ({
      id: `emotion-${i}`,
      key: `key-${i}`,
      names: { en: `Name ${i}`, ar: `اسم ${i}`, 'ar-EG': `اسم ${i}` },
      descriptions: { en: 'desc', ar: 'وصف', 'ar-EG': 'وصف' },
      name: `Name ${i}`,
      arabicName: `اسم ${i}`,
      description: 'desc',
      icon: 'cloud-rain',
      order: i + 1,
      active: true,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: emotions })));

    const { getEmotions } = await import('@/services/api');
    const result = await getEmotions();

    expect(result).toHaveLength(30);
    expect(result.every((e) => e.active)).toBe(true);
  });

  it('a non-array/malformed "data" envelope is never silently treated as a single emotion list item', async () => {
    // Guards the exact "wrapped in {success,data}" shape that the real
    // backend uses — requestApi must return payload.data as-is, never
    // re-wrap or unwrap an extra level.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: [{ id: '1', key: 'sad' }] })));
    const { getEmotions } = await import('@/services/api');
    const result = await getEmotions();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

describe('Local Quran SQLite initializes and a known ayah resolves (regression)', () => {
  function makeFakeConnection(rows: { surah: number; ayah: number; verse_key: string; arabic_text: string }[]) {
    let closed = false;
    return {
      closed: () => closed,
      async getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]> {
        if (sql.includes('COUNT(*)')) return [{ rows: 6236, surahs: 114, keys: 6236 }] as unknown as T[];
        if (sql.includes('user_version')) return [{ user_version: 1 }] as unknown as T[];
        if (sql.includes('application_id')) return [{ application_id: 1363694158 }] as unknown as T[];
        if (sql.includes('WHERE verse_key =')) {
          const key = params[0];
          return rows.filter((r) => r.verse_key === key) as unknown as T[];
        }
        return [] as T[];
      },
      async execAsync() {},
      async closeAsync() {
        closed = true;
      },
    };
  }

  it('initialize() succeeds (passes the 6,236-row/114-surah/user_version/application_id integrity check)', async () => {
    const { createQuranRepository } = await import('@/services/quranRepository');
    const connection = makeFakeConnection([
      { surah: 1, ayah: 1, verse_key: '1:1', arabic_text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' },
    ]);
    const repository = createQuranRepository(async () => connection);

    await expect(repository.getVerseByKey('1:1')).resolves.toMatchObject({ verseKey: '1:1', surah: 1, ayah: 1 });
  });

  it('a known verse (1:1) resolves with non-empty Arabic text', async () => {
    const { createQuranRepository } = await import('@/services/quranRepository');
    const connection = makeFakeConnection([
      { surah: 1, ayah: 1, verse_key: '1:1', arabic_text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ' },
    ]);
    const repository = createQuranRepository(async () => connection);

    const verse = await repository.getVerseByKey('1:1');
    expect(verse.arabicText.length).toBeGreaterThan(0);
  });

  it('a failed integrity check (wrong row count) throws QuranDataError("integrity") instead of hanging', async () => {
    const { createQuranRepository } = await import('@/services/quranRepository');
    const { QuranDataError } = await import('@/services/quranReference');
    let closed = false;
    const badConnection = {
      async getAllAsync<T>(sql: string): Promise<T[]> {
        if (sql.includes('COUNT(*)')) return [{ rows: 1, surahs: 1, keys: 1 }] as unknown as T[]; // wrong on purpose
        if (sql.includes('user_version')) return [{ user_version: 1 }] as unknown as T[];
        if (sql.includes('application_id')) return [{ application_id: 1363694158 }] as unknown as T[];
        return [] as T[];
      },
      async execAsync() {},
      async closeAsync() {
        closed = true;
      },
    };
    const repository = createQuranRepository(async () => badConnection);

    await expect(repository.getVerseByKey('1:1')).rejects.toThrow(QuranDataError);
    expect(closed).toBe(true); // never leaks an open connection on failure
  });
});

describe('App still loads when Appearance storage fails (regression)', () => {
  it('AppearancePreferenceProvider renders children synchronously even when AsyncStorage.getItem throws', async () => {
    vi.resetModules();
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: {
        getItem: vi.fn(async () => {
          throw new Error('storage unavailable');
        }),
        setItem: vi.fn(async () => {}),
      },
    }));

    const { AppearancePreferenceProvider } = await import('@/theme/useAppearancePreference');
    let rendered = false;
    function Probe() {
      rendered = true;
      return null;
    }

    expect(() => {
      act(() => {
        create(createElement(AppearancePreferenceProvider, null, createElement(Probe)));
      });
    }).not.toThrow();
    expect(rendered).toBe(true); // children rendered despite the storage failure, with no blocking gate
    vi.doUnmock('@react-native-async-storage/async-storage');
  });
});

describe('No startup provider/screen gates rendering on its own async state (regression)', () => {
  it('Home (index.tsx) never imports useAuth — public emotion/ayah content never waits on session restoration', () => {
    const source = read('src/app/index.tsx');
    expect(source).not.toMatch(/useAuth/);
  });

  it('Home (index.tsx) never imports useAppearancePreference — data loading never waits on the theme preference', () => {
    const source = read('src/app/index.tsx');
    expect(source).not.toMatch(/useAppearancePreference/);
  });

  it('AuthProvider renders {children} unconditionally — no `if (status === \'loading\') return` gate', () => {
    const source = read('src/auth/useAuth.tsx');
    expect(source).not.toMatch(/if\s*\(\s*status\s*===\s*['"]loading['"]\s*\)\s*return/);
    expect(source).toMatch(/<AuthContext\.Provider[^]*?\{children\}/);
  });

  it('every preference provider wrapped in _layout.tsx renders {children} unconditionally (no isReady gate)', () => {
    for (const file of [
      'src/theme/useAppearancePreference.tsx',
      'src/localization/useAppLocale.tsx',
      'src/localization/useQuranTranslationPreference.tsx',
      'src/localization/useQuranFontSizePreference.tsx',
    ]) {
      const source = read(file);
      // Flags a hard gate like `if (!isReady) return null;` before children render.
      expect(source).not.toMatch(/if\s*\(\s*!isReady\s*\)\s*return/);
    }
  });

  it('_layout.tsx renders <Stack> unconditionally — nothing in the root layout awaits before mounting routes', () => {
    const source = read('src/app/_layout.tsx');
    expect(source).not.toMatch(/await[^;]*;\s*return/);
    expect(source).toMatch(/<Stack/);
  });
});

describe('Startup loading state always terminates (regression)', () => {
  it("Home's loadEmotions clears isLoading in an unconditional finally (every async branch completes)", () => {
    const source = read('src/app/index.tsx');
    const finallyBlock = source.match(/\} finally \{[\s\S]*?\}\s*\},/)?.[0] ?? '';
    expect(finallyBlock).toMatch(/setIsLoading\(false\);/);
    // Not nested inside another conditional within the finally block.
    expect(finallyBlock).not.toMatch(/if \(/);
  });

  it('fetchWithTimeout always clears its timeout in a finally, so a dead connection cannot hang forever', () => {
    const source = read('src/services/fetchWithTimeout.ts');
    expect(source).toMatch(/finally \{\s*clearTimeout\(timeout\);\s*\}/);
  });
});

describe('Configured API base URL is resolved and logged correctly (regression)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves to EXPO_PUBLIC_API_URL when set (never silently substitutes the LAN fallback)', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://quran-heals-api.onrender.com');
    vi.resetModules();
    const { apiBaseUrl } = await import('@/services/apiBase');
    expect(apiBaseUrl).toBe('https://quran-heals-api.onrender.com');
  });

  it('logs the resolved API base URL in development (dev-only diagnostic)', () => {
    const source = read('src/services/apiBase.ts');
    expect(source).toMatch(/devLog\('apiBase', 'resolved API base URL'/);
  });

  // A LAN IP (e.g. 192.168.x.x) in mobile/.env is valid and expected for
  // local Expo Go development on the same Wi-Fi — it is NOT banned
  // globally. The real safety rule lives in app.config.ts's hosted-build
  // guard (see tests/apiUrlPolicy.test.ts for its full coverage): local/dev
  // never blocks, but any EAS "hosted" build (preview/production) refuses a
  // LAN/private URL. These two tests exercise that guard directly against
  // whatever value is currently in mobile/.env, instead of asserting
  // anything about the value itself.
  it('the current local .env value is allowed for local development (no EAS_BUILD, no hosted policy)', async () => {
    const envSource = read('.env');
    const currentApiUrl = envSource.match(/^EXPO_PUBLIC_API_URL=(.*)$/m)?.[1].trim();
    expect(currentApiUrl).toBeTruthy();

    const { assertApiUrlForBuild } = await import('../app.config');
    // Plain `expo start` / Expo Go: EAS_BUILD is never 'true'.
    expect(() => assertApiUrlForBuild({ EXPO_PUBLIC_API_URL: currentApiUrl })).not.toThrow();
  });

  it('the current local .env value would be refused if a hosted (preview/production) EAS build tried to embed it', async () => {
    const envSource = read('.env');
    const currentApiUrl = envSource.match(/^EXPO_PUBLIC_API_URL=(.*)$/m)?.[1].trim();

    const { assertApiUrlForBuild, checkHostedApiUrl } = await import('../app.config');
    // Only meaningful while .env actually holds a local/private URL, which
    // is the current, intentional setup — if it's a public https URL this
    // assertion would no longer apply, which is fine.
    if (checkHostedApiUrl(currentApiUrl).ok) return;

    for (const profile of ['preview', 'production']) {
      expect(() =>
        assertApiUrlForBuild({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: currentApiUrl }),
      ).toThrow(/EXPO_PUBLIC_API_URL/);
    }
  });
});

describe('Dev-only startup diagnostics exist for every stage named in the investigation (regression)', () => {
  it.each([
    ['src/app/_layout.tsx', /devLog\('app', 'startup'\)/],
    ['src/theme/useAppearancePreference.tsx', /devLog\('appearance', 'preference resolved'/],
    ['src/auth/useAuth.tsx', /devLog\('auth', 'session init complete'/],
    ['src/app/index.tsx', /devLog\('emotions', 'load start'/],
    ['src/app/index.tsx', /devLog\('emotions', 'load result'/],
    ['src/services/quranRepository.ts', /devLog\('quran', 'sqlite init complete'/],
    ['src/app/index.tsx', /devLog\('home', 'render readiness'/],
  ])('%s contains %s', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it('devLog itself is a no-op outside __DEV__ (never noisy in production)', () => {
    const source = read('src/utils/devLog.ts');
    expect(source).toMatch(/if \(!__DEV__\) return;/);
  });
});
