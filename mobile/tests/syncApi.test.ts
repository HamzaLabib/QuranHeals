import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const refreshAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock('@/auth/tokenManager', () => ({ refreshAccessToken }));

const { getCloudFavorites, replaceCloudSyncKey, SyncApiError } = await import('@/sync/syncApi');

afterEach(() => {
  vi.unstubAllGlobals();
  refreshAccessToken.mockReset();
});

function mockFetchSequence(responses: Response[]) {
  const calls: { url: string; token: string | null }[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, token: headers?.Authorization?.replace('Bearer ', '') ?? null });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    }),
  );
  return calls;
}

describe('authedRequest 401 handling (via getCloudFavorites)', () => {
  it('on a 401, refreshes once and retries the original request with the new token', async () => {
    refreshAccessToken.mockResolvedValue('fresh-token');
    const calls = mockFetchSequence([
      new Response('', { status: 401 }),
      new Response(JSON.stringify({ success: true, data: [{ verseKey: '1:1', createdAt: '', updatedAt: '' }] }), { status: 200 }),
    ]);

    const result = await getCloudFavorites('stale-token');

    expect(result).toEqual([{ verseKey: '1:1', createdAt: '', updatedAt: '' }]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].token).toBe('stale-token');
    expect(calls[1].token).toBe('fresh-token');
  });

  it('surfaces the original 401 as a SyncApiError when refresh is not possible (offline/revoked)', async () => {
    refreshAccessToken.mockResolvedValue(null);
    mockFetchSequence([new Response(JSON.stringify({ success: false, message: 'Session is invalid or has expired. Please sign in again.' }), { status: 401 })]);

    await expect(getCloudFavorites('stale-token')).rejects.toBeInstanceOf(SyncApiError);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('never retries a second time even if the refreshed token also 401s (no retry loop)', async () => {
    refreshAccessToken.mockResolvedValue('still-bad-token');
    const calls = mockFetchSequence([new Response('', { status: 401 }), new Response('', { status: 401 })]);

    await expect(getCloudFavorites('stale-token')).rejects.toBeInstanceOf(SyncApiError);
    expect(calls).toHaveLength(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh at all on a non-401 failure', async () => {
    mockFetchSequence([new Response(JSON.stringify({ success: false, message: 'Server error.' }), { status: 500 })]);

    await expect(getCloudFavorites('token')).rejects.toBeInstanceOf(SyncApiError);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

it('password replacement sends only the expected/replacement encrypted wrappers and preserves token refresh', async () => {
  const expected = { wrappedKey: 'old', nonce: 'nonce', salt: 'salt', encryptionVersion: 1, kdfIterations: 210000 };
  const replacement = { ...expected, wrappedKey: 'new', encryptionVersion: 2 };
  refreshAccessToken.mockResolvedValue('fresh-token');
  const calls = mockFetchSequence([
    new Response('', { status: 401 }),
    new Response(JSON.stringify({ success: true, data: replacement }), { status: 200 }),
  ]);
  expect(await replaceCloudSyncKey('old-token', expected, replacement)).toEqual(replacement);
  expect(calls.map(call => call.token)).toEqual(['old-token', 'fresh-token']);
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    expect(url).toContain('/api/sync/key');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ expected, replacement });
  }
});
