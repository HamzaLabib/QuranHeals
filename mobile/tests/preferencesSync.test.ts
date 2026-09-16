import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const { reconcilePreferencesOnSignIn, pushPreferences } = await import('@/sync/preferencesSync');

afterEach(() => vi.unstubAllGlobals());

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('reconcilePreferencesOnSignIn', () => {
  it('uploads the local preference when the account has never stored one', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === undefined) {
        // GET /api/sync/preferences
        return new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: JSON.parse(String(init.body)) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn(
      'token',
      { locale: 'ar', translationDisplayMode: 'on-demand', translationId: 'pickthall' },
      applyLocally,
    );

    expect(applyLocally).not.toHaveBeenCalled();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    const body = JSON.parse(String(putCall![1]!.body));
    expect(body).toMatchObject({ locale: 'ar', translationDisplayMode: 'on-demand', translationId: 'pickthall' });
  });

  it('applies the cloud preference locally when the account already has one', async () => {
    mockFetchOnce({
      success: true,
      data: { locale: 'en', translationDisplayMode: 'off', updatedAt: '2026-01-01T00:00:00.000Z' },
    });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', { locale: 'ar', translationDisplayMode: 'always', translationId: 'x' }, applyLocally);

    expect(applyLocally).toHaveBeenCalledWith({ locale: 'en', translationDisplayMode: 'off', translationId: undefined });
  });
});

describe('pushPreferences', () => {
  it('sends the current local preference as the new account-wide value', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ success: true, data: JSON.parse(String(init!.body)) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushPreferences('token', { locale: 'ar-EG', translationDisplayMode: 'always', translationId: 'x' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(String(init!.body));
    expect(body.locale).toBe('ar-EG');
    expect(typeof body.updatedAt).toBe('string');
  });
});

describe('recent-ayah history is never part of preferences sync', () => {
  it('preferencesSync.ts does not import the recent-ayah history module', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../src/sync/preferencesSync.ts'), 'utf-8');
    expect(source).not.toMatch(/recentAyahHistory|recentAyahs/);
  });
});
