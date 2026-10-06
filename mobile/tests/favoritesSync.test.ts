import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const localFavorites = vi.hoisted(() => ({ items: [] as { id: string; verseKey: string; savedAt: string }[] }));
const localTombstones = vi.hoisted(() => ({ items: [] as { verseKey: string; deleted: true; deletedAt: number }[] }));
const downloaded: { verseKey: string }[] = [];
const tombstonesDownloaded: { verseKey: string; deletedAt: number }[] = [];

vi.mock('@/storage/favorites', () => ({
  getFavorites: vi.fn(async () => localFavorites.items),
  getAllFavoriteTombstones: vi.fn(async () => localTombstones.items),
  putFavoriteFromSync: vi.fn(async (favorite: { verseKey: string }) => {
    downloaded.push(favorite);
  }),
  putFavoriteTombstoneFromSync: vi.fn(async (tombstone: { verseKey: string; deletedAt: number }) => {
    tombstonesDownloaded.push(tombstone);
  }),
}));

vi.mock('@/services/quranReference', () => ({
  resolveVerseKey: (record: { verseKey: string }) => record.verseKey,
}));

vi.mock('@/services/api', () => ({
  getAyah: vi.fn(async (verseKey: string) => ({ id: verseKey, verseKey })),
}));

const { syncFavorites, propagateFavoriteRemoval } = await import('@/sync/favoritesSync');
const { getAyah } = await import('@/services/api');
const { putFavoriteFromSync, putFavoriteTombstoneFromSync } = await import('@/storage/favorites');

afterEach(() => {
  vi.unstubAllGlobals();
  localFavorites.items = [];
  localTombstones.items = [];
  downloaded.length = 0;
  tombstonesDownloaded.length = 0;
  vi.mocked(getAyah).mockClear();
  vi.mocked(putFavoriteFromSync).mockClear();
  vi.mocked(putFavoriteTombstoneFromSync).mockClear();
});

function mockFetch(handler: (init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(handler(init)), { status: 200 })));
}

describe('syncFavorites', () => {
  it('uploads a local favorite that is newer than (or absent from) the cloud', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(1000).toISOString() }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ type: 'active', verseKey: '1:1' }] } };
      }
      return { success: true, data: [] }; // GET: cloud is empty
    });

    await syncFavorites('token', 'user-1');

    expect(uploadedBody).toMatchObject({
      favorites: [{ type: 'active', verseKey: '1:1', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() }],
    });
  });

  it('downloads a cloud-only favorite into local storage', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(1000).toISOString() }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
      return {
        success: true,
        data: [
          { type: 'active', verseKey: '1:1', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() },
          { type: 'active', verseKey: '2:2', createdAt: new Date(2000).toISOString(), updatedAt: new Date(2000).toISOString() },
        ],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(getAyah).toHaveBeenCalledWith('2:2');
    expect(downloaded).toEqual([{ id: '2:2', verseKey: '2:2', savedAt: new Date(2000).toISOString() }]);
  });

  it('one unresolved cloud favorite does not abort syncing the rest', async () => {
    localFavorites.items = [];
    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
      return {
        success: true,
        data: [
          { type: 'active', verseKey: 'bad', createdAt: '', updatedAt: new Date(1000).toISOString() },
          { type: 'active', verseKey: '2:2', createdAt: '', updatedAt: new Date(1000).toISOString() },
        ],
      };
    });
    vi.mocked(getAyah).mockImplementation(async (verseKey: string) => {
      if (verseKey === 'bad') throw new Error('not found');
      return { id: verseKey, verseKey } as unknown as Awaited<ReturnType<typeof getAyah>>;
    });

    await expect(syncFavorites('token', 'user-1')).resolves.toBeUndefined();
    expect(downloaded).toEqual([{ id: '2:2', verseKey: '2:2', savedAt: new Date(1000).toISOString() }]);
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

describe('syncFavorites: deletion tombstones', () => {
  it('Test A — uploads a local tombstone as a plain deletion marker, not re-adding it', async () => {
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '2:255', deleted: true, deletedAt: 5000 }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(5000).toISOString() }] } };
      }
      return { success: true, data: [] };
    });

    await syncFavorites('token', 'user-1');

    const uploaded = (uploadedBody as { favorites: Record<string, unknown>[] }).favorites;
    expect(uploaded).toEqual([{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(5000).toISOString() }]);
    expect(downloaded).toHaveLength(0);
  });

  it('Test B — a deletion made entirely offline (never attempted, not just failed) is still carried by the first sync after reconnecting', async () => {
    // "Offline" is indistinguishable from this function's point of view —
    // it only ever sees the current local tombstone and the current cloud
    // state, never whether (or how many times) an earlier network attempt
    // was made. The cloud still holds the pre-deletion active record.
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '5:5', deleted: true, deletedAt: 3000 }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '5:5', deletedAt: new Date(3000).toISOString() }] } };
      }
      return {
        success: true,
        data: [{ type: 'active', verseKey: '5:5', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() }],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(uploadedBody).toMatchObject({ favorites: [{ type: 'tombstone', verseKey: '5:5' }] });
    expect(downloaded).toHaveLength(0); // never resurrected locally either
  });

  it('Test C — a cloud tombstone newer than any local copy removes the local active favorite (propagation to a second device)', async () => {
    localFavorites.items = [];
    localTombstones.items = [];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
      return { success: true, data: [{ type: 'tombstone', verseKey: '94:6', deletedAt: '2026-01-05T00:00:00.000Z' }] };
    });

    await syncFavorites('token', 'user-1');

    expect(tombstonesDownloaded).toEqual([{ verseKey: '94:6', deletedAt: new Date('2026-01-05T00:00:00.000Z').getTime() }]);
    expect(downloaded).toHaveLength(0);
  });

  it('Test C (literal two-device run) — a deletion uploaded by one sync call is picked up by a later, independent sync call sharing the same cloud', async () => {
    let cloudState: { type: string; verseKey: string; createdAt?: string; updatedAt?: string; deletedAt?: string }[] = [
      { type: 'active', verseKey: '6:6', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() },
    ];
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { favorites: typeof cloudState };
        for (const incoming of body.favorites) {
          cloudState = [...cloudState.filter((r) => r.verseKey !== incoming.verseKey), incoming];
        }
        return { success: true, data: { saved: cloudState } };
      }
      return { success: true, data: cloudState };
    });

    // Device A: already has it favorited, now deletes it.
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '6:6', deleted: true, deletedAt: 5000 }];
    await syncFavorites('device-a-token', 'user-1');
    expect(cloudState).toEqual([{ type: 'tombstone', verseKey: '6:6', deletedAt: new Date(5000).toISOString() }]);

    // Device B: still thinks it's favorited (hasn't heard about the deletion), syncs independently afterwards.
    localFavorites.items = [{ id: '6:6', verseKey: '6:6', savedAt: new Date(1000).toISOString() }];
    localTombstones.items = [];
    downloaded.length = 0;
    tombstonesDownloaded.length = 0;

    await syncFavorites('device-b-token', 'user-1');

    expect(downloaded).toHaveLength(0); // never re-uploads its stale copy
    expect(tombstonesDownloaded).toEqual([{ verseKey: '6:6', deletedAt: 5000 }]);
  });

  it('Test D — a stale cloud active record cannot resurrect a favorite this device already deleted (local tombstone is newer)', async () => {
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '2:255', deleted: true, deletedAt: 5000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') {
        return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(5000).toISOString() }] } };
      }
      return {
        success: true,
        data: [{ type: 'active', verseKey: '2:255', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() }],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(downloaded).toHaveLength(0);
  });

  it('Test D (reverse) — a genuinely newer cloud active record supersedes an older local tombstone, applying the recreation locally', async () => {
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '2:255', deleted: true, deletedAt: 1000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
      return {
        success: true,
        data: [{ type: 'active', verseKey: '2:255', createdAt: new Date(9000).toISOString(), updatedAt: new Date(9000).toISOString() }],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(downloaded).toEqual([{ id: '2:255', verseKey: '2:255', savedAt: new Date(9000).toISOString() }]);
  });

  it('Test E — a local active favorite older than a cloud tombstone is overridden, and never re-uploaded', async () => {
    localFavorites.items = [{ id: '2:255', verseKey: '2:255', savedAt: new Date(1000).toISOString() }];
    localTombstones.items = [];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [] } };
      }
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(9000).toISOString() }] };
    });

    await syncFavorites('token', 'user-1');

    expect(uploadedBody).toBeNull(); // the stale local active was never uploaded
    expect(tombstonesDownloaded).toEqual([{ verseKey: '2:255', deletedAt: new Date(9000).toISOString() }].map((t) => ({ ...t, deletedAt: new Date(t.deletedAt).getTime() })));
  });

  it('Test F — local tombstone vs. cloud active at the exact same timestamp: the tombstone wins (never overwritten by the download)', async () => {
    const tiedAt = 4000;
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '2:255', deleted: true, deletedAt: tiedAt }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '2:255' }] } };
      return {
        success: true,
        data: [{ type: 'active', verseKey: '2:255', createdAt: new Date(tiedAt).toISOString(), updatedAt: new Date(tiedAt).toISOString() }],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(downloaded).toHaveLength(0);
  });

  it('Test F (reverse) — local active vs. cloud tombstone at the exact same timestamp: the tombstone wins (applied locally)', async () => {
    const tiedAt = 4000;
    localFavorites.items = [{ id: '2:255', verseKey: '2:255', savedAt: new Date(tiedAt).toISOString() }];
    localTombstones.items = [];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(tiedAt).toISOString() }] };
    });

    await syncFavorites('token', 'user-1');

    expect(tombstonesDownloaded).toEqual([{ verseKey: '2:255', deletedAt: tiedAt }]);
  });

  it('Test G — a failed immediate delete is still carried by the next full sync (the local tombstone is the source of truth, not the immediate attempt)', async () => {
    // Simulates: the user deleted this favorite, the best-effort immediate
    // DELETE never reached the server (offline/timeout), so the cloud still
    // shows the old active record — the full sync must still converge on
    // deleted using the durable local tombstone, regardless of what the
    // earlier fire-and-forget attempt did.
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '7:7', deleted: true, deletedAt: 9000 }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '7:7', deletedAt: new Date(9000).toISOString() }] } };
      }
      return {
        success: true,
        data: [{ type: 'active', verseKey: '7:7', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() }],
      };
    });

    await syncFavorites('token', 'user-1');

    expect(uploadedBody).toMatchObject({ favorites: [{ type: 'tombstone', verseKey: '7:7' }] });
    expect(downloaded).toHaveLength(0);
  });

  it('Test K — repeating sync after an equal-timestamp resolution performs no unnecessary re-upload (idempotent)', async () => {
    const tiedAt = 4000;
    localFavorites.items = [];
    localTombstones.items = [{ verseKey: '2:255', deleted: true, deletedAt: tiedAt }];

    let putCalls = 0;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        putCalls += 1;
        return { success: true, data: { saved: [] } };
      }
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(tiedAt).toISOString() }] };
    });

    await syncFavorites('token', 'user-1');

    expect(putCalls).toBe(0);
    expect(tombstonesDownloaded).toHaveLength(0);
  });
});
