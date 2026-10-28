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

// The local Quran database (services/ayahForAction.ts). Unavailable unless a
// test says otherwise, so the backend's ayah is what restores a favorite.
const noLocalDatabase = async (): Promise<never> => {
  throw new Error('No local Quran database in this test.');
};
vi.mock('@/services/ayahForAction', () => ({ localAyah: vi.fn(noLocalDatabase) }));

const { syncFavorites, pushFavoriteChange } = await import('@/sync/favoritesSync');
const { getAyah } = await import('@/services/api');
const { putFavoriteFromSync, putFavoriteTombstoneFromSync } = await import('@/storage/favorites');
const { localAyah } = await import('@/services/ayahForAction');

afterEach(() => {
  vi.unstubAllGlobals();
  localFavorites.items = [];
  localTombstones.items = [];
  downloaded.length = 0;
  tombstonesDownloaded.length = 0;
  vi.mocked(getAyah).mockClear();
  vi.mocked(localAyah).mockReset().mockImplementation(noLocalDatabase);
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

    // Not restorable yet: reported as incomplete (the session retries), never dropped.
    await expect(syncFavorites('token', 'user-1')).resolves.toBe(false);
    expect(downloaded).toEqual([{ id: '2:2', verseKey: '2:2', savedAt: new Date(1000).toISOString() }]);
  });
});

describe('pushFavoriteChange: immediate add / remove / re-add', () => {
  function capturePut(reply?: (sent: Record<string, unknown>) => unknown) {
    const sent: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init!.body)) as { favorites: Record<string, unknown>[] };
      sent.push(...body.favorites);
      return new Response(JSON.stringify({ success: true, data: { saved: [reply ? reply(body.favorites[0]) : body.favorites[0]] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { sent, fetchMock };
  }

  it('an add is uploaded as a timestamped active record (the tombstone-aware shape, never the legacy union add)', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(2000).toISOString() }];
    const { sent, fetchMock } = capturePut();

    await pushFavoriteChange('token', 'user-1', '1:1');

    expect(sent).toEqual([{ type: 'active', verseKey: '1:1', createdAt: new Date(2000).toISOString(), updatedAt: new Date(2000).toISOString() }]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/sync\/favorites$/);
  });

  it('a removal is uploaded as a deletion marker with THIS device`s deletion time (not the server clock)', async () => {
    localTombstones.items = [{ verseKey: '3:3', deleted: true, deletedAt: 5000 }];
    const { sent } = capturePut();

    await pushFavoriteChange('token', 'user-1', '3:3');

    expect(sent).toEqual([{ type: 'tombstone', verseKey: '3:3', deletedAt: new Date(5000).toISOString() }]);
  });

  it('a re-add after a removal sends the newer active record, which replaces the account`s deletion marker', async () => {
    // Locally: removed at 5000, re-added at 9000 (the re-add supersedes the local tombstone: storage/favorites.ts).
    localFavorites.items = [{ id: '3:3', verseKey: '3:3', savedAt: new Date(9000).toISOString() }];
    const { sent } = capturePut();

    await pushFavoriteChange('token', 'user-1', '3:3');

    expect(sent).toEqual([{ type: 'active', verseKey: '3:3', createdAt: new Date(9000).toISOString(), updatedAt: new Date(9000).toISOString() }]);
    expect(putFavoriteTombstoneFromSync).not.toHaveBeenCalled();
  });

  it('the account holds a NEWER removal (another device): it is applied here', async () => {
    localFavorites.items = [{ id: '4:4', verseKey: '4:4', savedAt: new Date(1000).toISOString() }];
    capturePut(() => ({ type: 'tombstone', verseKey: '4:4', deletedAt: new Date(7000).toISOString() }));

    await pushFavoriteChange('token', 'user-1', '4:4');

    expect(tombstonesDownloaded).toEqual([{ verseKey: '4:4', deletedAt: 7000 }]);
  });

  it('the account holds a NEWER re-add (another device) of a favorite removed here: it is restored here', async () => {
    localTombstones.items = [{ verseKey: '5:5', deleted: true, deletedAt: 3000 }];
    capturePut(() => ({ type: 'active', verseKey: '5:5', createdAt: new Date(8000).toISOString(), updatedAt: new Date(8000).toISOString() }));

    await pushFavoriteChange('token', 'user-1', '5:5');

    expect(downloaded).toEqual([{ id: '5:5', verseKey: '5:5', savedAt: new Date(8000).toISOString() }]);
  });

  it('an older account record never overrides the change just made here', async () => {
    localTombstones.items = [{ verseKey: '6:6', deleted: true, deletedAt: 9000 }];
    capturePut(() => ({ type: 'active', verseKey: '6:6', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() }));

    await pushFavoriteChange('token', 'user-1', '6:6');

    expect(downloaded).toEqual([]);
    expect(tombstonesDownloaded).toEqual([]);
  });

  it('a failure (offline) is thrown for the caller to ignore; the local record stays for the next full sync', async () => {
    localFavorites.items = [{ id: '7:7', verseKey: '7:7', savedAt: new Date(1000).toISOString() }];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));

    await expect(pushFavoriteChange('token', 'user-1', '7:7')).rejects.toThrow();
    expect(localFavorites.items).toHaveLength(1);
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

describe('syncFavorites: restoring from the local Quran database', () => {
  const cloudOnly = (verseKey: string, at: number) => mockFetch((init) => {
    if (init?.method === 'PUT') return { success: true, data: { saved: [] } };
    return { success: true, data: [{ type: 'active', verseKey, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() }] };
  });

  it('a cloud favorite is built from the local database — no backend request — and stored with the account`s instant', async () => {
    vi.mocked(localAyah).mockImplementation(async (verseKey: string) => ({ id: verseKey, verseKey, englishTranslation: '' }) as never);
    cloudOnly('2:255', 4000);

    await expect(syncFavorites('token', 'user-1')).resolves.toBe(true);

    expect(localAyah).toHaveBeenCalledWith('2:255');
    expect(getAyah).not.toHaveBeenCalled();
    // Its translation is fetched later, as for a favorite saved offline (storage/favorites.ts).
    expect(downloaded).toEqual([{ id: '2:255', verseKey: '2:255', englishTranslation: '', savedAt: new Date(4000).toISOString() }]);
    // Never written over a change made here meanwhile: only while there is still no entry for it.
    expect(vi.mocked(putFavoriteFromSync).mock.calls[0][2]).toBeNull();
  });

  it('without the local database, the backend`s ayah is used', async () => {
    cloudOnly('2:255', 4000);
    await expect(syncFavorites('token', 'user-1')).resolves.toBe(true);
    expect(getAyah).toHaveBeenCalledWith('2:255');
    expect(downloaded).toEqual([{ id: '2:255', verseKey: '2:255', savedAt: new Date(4000).toISOString() }]);
  });

  it('neither available: nothing is stored, deleted or uploaded for it, the sync reports incomplete, and a later sync restores it', async () => {
    vi.mocked(getAyah).mockImplementation(async () => { throw new Error('offline'); });
    const puts: unknown[] = [];
    mockFetch((init) => {
      if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return { success: true, data: { saved: [] } }; }
      return { success: true, data: [{ type: 'active', verseKey: '2:255', createdAt: new Date(4000).toISOString(), updatedAt: new Date(4000).toISOString() }] };
    });

    await expect(syncFavorites('token', 'user-1')).resolves.toBe(false);

    expect(downloaded).toEqual([]);
    expect(tombstonesDownloaded).toEqual([]);
    expect(puts).toEqual([]);

    // Back online: the account still has it.
    vi.mocked(getAyah).mockImplementation(async (verseKey: string) => ({ id: verseKey, verseKey }) as never);
    await expect(syncFavorites('token', 'user-1')).resolves.toBe(true);
    expect(downloaded).toEqual([{ id: '2:255', verseKey: '2:255', savedAt: new Date(4000).toISOString() }]);
  });

  it('a favorite already saved here keeps its own ayah when the account`s newer instant is applied (no lookup at all)', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(1000).toISOString() }];
    cloudOnly('1:1', 6000);

    await expect(syncFavorites('token', 'user-1')).resolves.toBe(true);

    expect(localAyah).not.toHaveBeenCalled();
    expect(getAyah).not.toHaveBeenCalled();
    expect(downloaded).toEqual([{ id: '1:1', verseKey: '1:1', savedAt: new Date(6000).toISOString() }]);
    expect(vi.mocked(putFavoriteFromSync).mock.calls[0][2]).toBe(1000);
  });
});

describe('a device clock running ahead: the instant the account stored is adopted here', () => {
  const FUTURE = Date.parse('2099-01-01T00:00:00.000Z');
  const SERVER_NOW = Date.parse('2026-10-27T12:00:00.000Z');

  it('full sync: a favorite stored at the server`s time takes that instant here, so the next sync uploads nothing', async () => {
    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(FUTURE).toISOString() }];
    let cloud: Record<string, unknown>[] = [];
    const puts: unknown[] = [];
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        cloud = [{ type: 'active', verseKey: '1:1', createdAt: new Date(SERVER_NOW).toISOString(), updatedAt: new Date(SERVER_NOW).toISOString() }];
        return { success: true, data: { saved: cloud } };
      }
      return { success: true, data: cloud };
    });

    await expect(syncFavorites('token', 'user-1')).resolves.toBe(true);

    expect(puts).toHaveLength(1);
    // Rewritten with its own ayah, and only if it is still the favorite that was sent.
    expect(downloaded).toEqual([{ id: '1:1', verseKey: '1:1', savedAt: new Date(SERVER_NOW).toISOString() }]);
    expect(vi.mocked(putFavoriteFromSync).mock.calls[0][2]).toBe(FUTURE);

    localFavorites.items = [{ id: '1:1', verseKey: '1:1', savedAt: new Date(SERVER_NOW).toISOString() }];
    await syncFavorites('token', 'user-1');
    expect(puts).toHaveLength(1);
  });

  it('full sync: a deletion stored at the server`s time takes that instant here', async () => {
    localTombstones.items = [{ verseKey: '3:3', deleted: true, deletedAt: FUTURE }];
    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '3:3', deletedAt: new Date(SERVER_NOW).toISOString() }] } };
      return { success: true, data: [] };
    });

    await syncFavorites('token', 'user-1');

    expect(vi.mocked(putFavoriteTombstoneFromSync).mock.calls[0]).toEqual([{ verseKey: '3:3', deletedAt: SERVER_NOW }, 'user-1', FUTURE]);
  });

  it('immediate upload: an add stored at the server`s time takes that instant here, keeping its own ayah', async () => {
    localFavorites.items = [{ id: '8:8', verseKey: '8:8', savedAt: new Date(FUTURE).toISOString() }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { saved: [{ type: 'active', verseKey: '8:8', createdAt: new Date(SERVER_NOW).toISOString(), updatedAt: new Date(SERVER_NOW).toISOString() }] },
    }), { status: 200 })));

    await pushFavoriteChange('token', 'user-1', '8:8');

    expect(getAyah).not.toHaveBeenCalled();
    expect(downloaded).toEqual([{ id: '8:8', verseKey: '8:8', savedAt: new Date(SERVER_NOW).toISOString() }]);
    expect(vi.mocked(putFavoriteFromSync).mock.calls[0][2]).toBe(FUTURE);
  });

  it('immediate upload: a removal stored at the server`s time takes that instant here', async () => {
    localTombstones.items = [{ verseKey: '9:9', deleted: true, deletedAt: FUTURE }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { saved: [{ type: 'tombstone', verseKey: '9:9', deletedAt: new Date(SERVER_NOW).toISOString() }] },
    }), { status: 200 })));

    await pushFavoriteChange('token', 'user-1', '9:9');

    expect(tombstonesDownloaded).toEqual([{ verseKey: '9:9', deletedAt: SERVER_NOW }]);
  });
});
