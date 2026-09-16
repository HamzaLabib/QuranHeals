import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const localFavorites = vi.hoisted(() => ({ items: [] as { id: string; verseKey: string }[] }));
const addedRemotely: string[] = [];

vi.mock('@/storage/favorites', () => ({
  getFavorites: vi.fn(async () => localFavorites.items),
  addFavorite: vi.fn(async (ayah: { verseKey: string }) => {
    localFavorites.items.push({ id: ayah.verseKey, verseKey: ayah.verseKey });
  }),
}));

vi.mock('@/services/quranReference', () => ({
  resolveVerseKey: (record: { verseKey: string }) => record.verseKey,
}));

vi.mock('@/services/api', () => ({
  getAyah: vi.fn(async (verseKey: string) => ({ id: verseKey, verseKey })),
}));

const { syncFavorites, propagateFavoriteRemoval } = await import('@/sync/favoritesSync');
const { addFavorite } = await import('@/storage/favorites');
const { getAyah } = await import('@/services/api');

afterEach(() => {
  vi.unstubAllGlobals();
  localFavorites.items = [];
  addedRemotely.length = 0;
  vi.mocked(addFavorite).mockClear();
  vi.mocked(getAyah).mockClear();
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
}

describe('syncFavorites', () => {
  it('uploads local favorites (union-add) and downloads cloud-only favorites into local storage', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1' }];

    mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
      }
      // GET cloud favorites — includes one the device doesn't have locally.
      return new Response(
        JSON.stringify({ success: true, data: [{ verseKey: '1:1', createdAt: '', updatedAt: '' }, { verseKey: '2:2', createdAt: '', updatedAt: '' }] }),
        { status: 200 },
      );
    });

    await syncFavorites('token');

    expect(getAyah).toHaveBeenCalledWith('2:2');
    expect(addFavorite).toHaveBeenCalledWith({ id: '2:2', verseKey: '2:2' });
  });

  it('never removes a local favorite the cloud does not have', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1' }];
    mockFetch((_url, init) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }); // cloud is empty
    });

    await syncFavorites('token');

    expect(localFavorites.items).toEqual([{ id: '1:1', verseKey: '1:1' }]);
  });

  it('one unresolved cloud favorite does not abort syncing the rest', async () => {
    localFavorites.items = [];
    mockFetch((_url, init) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
      return new Response(
        JSON.stringify({ success: true, data: [{ verseKey: 'bad', createdAt: '', updatedAt: '' }, { verseKey: '2:2', createdAt: '', updatedAt: '' }] }),
        { status: 200 },
      );
    });
    vi.mocked(getAyah).mockImplementation(async (verseKey: string) => {
      if (verseKey === 'bad') throw new Error('not found');
      return { id: verseKey, verseKey } as unknown as Awaited<ReturnType<typeof getAyah>>;
    });

    await expect(syncFavorites('token')).resolves.toBeUndefined();
    expect(addFavorite).toHaveBeenCalledWith({ id: '2:2', verseKey: '2:2' });
  });
});

describe('propagateFavoriteRemoval', () => {
  it('sends an explicit DELETE for the removed verseKey', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await propagateFavoriteRemoval('token', '3:3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('3%3A3');
  });
});
