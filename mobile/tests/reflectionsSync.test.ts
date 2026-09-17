import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));

const localReflections = vi.hoisted(() => ({
  items: [] as { verseKey: string; text: string; createdAt: number; updatedAt: number }[],
}));
const localTombstones = vi.hoisted(() => ({
  items: [] as { verseKey: string; deletedAt: number }[],
}));
const synced: string[] = [];
const downloaded: { verseKey: string; text: string }[] = [];
const tombstonesDownloaded: { verseKey: string; deletedAt: number }[] = [];

vi.mock('@/storage/ayahReflections', () => ({
  getAllReflections: vi.fn(async () => localReflections.items),
  getAllTombstones: vi.fn(async () => localTombstones.items),
  markReflectionSyncState: vi.fn(async (verseKey: string) => {
    synced.push(verseKey);
  }),
  putReflectionFromSync: vi.fn(async (reflection: { verseKey: string; text: string }) => {
    downloaded.push(reflection);
  }),
  putTombstoneFromSync: vi.fn(async (tombstone: { verseKey: string; deletedAt: number }) => {
    tombstonesDownloaded.push(tombstone);
  }),
}));

const { syncReflections } = await import('@/sync/reflectionsSync');
const { generateMasterKey } = await import('@/crypto/reflectionEncryption');
const { getRandomBytes } = await import('@/crypto/randomBytes');

afterEach(() => {
  vi.unstubAllGlobals();
  localReflections.items = [];
  localTombstones.items = [];
  synced.length = 0;
  downloaded.length = 0;
  tombstonesDownloaded.length = 0;
});

function mockFetch(handler: (init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(handler(init)), { status: 200 })));
}

describe('syncReflections', () => {
  it('encrypts and uploads a local reflection that is newer than the cloud, then marks it synced', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [{ verseKey: '2:255', text: 'my private thought', createdAt: 1000, updatedAt: 1000 }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ verseKey: '2:255' }], conflicts: [] } };
      }
      return { success: true, data: [] }; // GET: cloud is empty
    });

    await syncReflections('token', masterKey);

    expect(uploadedBody).toMatchObject({
      reflections: [{ verseKey: '2:255' }],
    });
    const uploaded = (uploadedBody as { reflections: { ciphertext: string; nonce: string }[] }).reflections[0];
    expect(uploaded.ciphertext).not.toContain('my private thought');
    expect(synced).toContain('2:255');
  });

  it('downloads and decrypts a cloud reflection newer than the local copy', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const encrypted = encryptReflectionText('from another device', masterKey, getRandomBytes);

    localReflections.items = [];
    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return {
        success: true,
        data: [
          {
            verseKey: '94:6',
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            encryptionVersion: encrypted.encryptionVersion,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({ verseKey: '94:6', text: 'from another device' });
  });

  it('a local reflection newer than the cloud is not overwritten by a download of the stale cloud version', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [{ verseKey: '2:255', text: 'newest local', createdAt: 1000, updatedAt: 5000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [{ verseKey: '2:255' }], conflicts: [] } };
      return {
        success: true,
        data: [{ verseKey: '2:255', ciphertext: 'x', nonce: 'y', encryptionVersion: 1, createdAt: '', updatedAt: new Date(1000).toISOString() }],
      };
    });

    await syncReflections('token', masterKey);

    expect(downloaded).toHaveLength(0);
  });

  it('one record failing to decrypt does not abort syncing the rest', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const goodEncrypted = encryptReflectionText('good', masterKey, getRandomBytes);

    localReflections.items = [];
    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return {
        success: true,
        data: [
          { verseKey: '1:1', ciphertext: 'corrupted-not-valid-base64!!', nonce: 'also-bad', encryptionVersion: 1, createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z' },
          {
            verseKey: '94:6',
            ciphertext: goodEncrypted.ciphertext,
            nonce: goodEncrypted.nonce,
            encryptionVersion: goodEncrypted.encryptionVersion,
            createdAt: '',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
    });

    await expect(syncReflections('token', masterKey)).resolves.toBeUndefined();
    expect(downloaded.map((d) => d.verseKey)).toEqual(['94:6']);
  });

  it('never sends plaintext in the network request body', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [{ verseKey: '2:255', text: 'a secret only I should read', createdAt: 1000, updatedAt: 1000 }];

    let sentBody = '';
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        sentBody = String(init.body);
        return { success: true, data: { saved: [{ verseKey: '2:255' }], conflicts: [] } };
      }
      return { success: true, data: [] };
    });

    await syncReflections('token', masterKey);
    expect(sentBody).not.toContain('a secret only I should read');
  });
});

describe('syncReflections: deletion tombstones', () => {
  it('uploads a local tombstone as a plain deletion marker (no ciphertext/nonce/plaintext), then marks it synced', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localTombstones.items = [{ verseKey: '2:255', deletedAt: 1000 }];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return {
          success: true,
          data: { saved: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(1000).toISOString() }], conflicts: [] },
        };
      }
      return { success: true, data: [] };
    });

    await syncReflections('token', masterKey);

    const uploaded = (uploadedBody as { reflections: Record<string, unknown>[] }).reflections;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ type: 'tombstone', verseKey: '2:255' });
    expect(uploaded[0]).not.toHaveProperty('ciphertext');
    expect(uploaded[0]).not.toHaveProperty('nonce');
    expect(uploaded[0]).not.toHaveProperty('text');
    expect(synced).toContain('2:255');
  });

  it('a cloud tombstone newer than any local copy removes the local active reflection (via putTombstoneFromSync, never decrypted as active)', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [];
    localTombstones.items = [];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return { success: true, data: [{ type: 'tombstone', verseKey: '94:6', deletedAt: '2026-01-05T00:00:00.000Z' }] };
    });

    await syncReflections('token', masterKey);

    expect(tombstonesDownloaded).toEqual([{ verseKey: '94:6', deletedAt: new Date('2026-01-05T00:00:00.000Z').getTime() }]);
    expect(downloaded).toHaveLength(0);
  });

  it('a stale cloud active record cannot resurrect a reflection this device already deleted (local tombstone is newer)', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const stale = encryptReflectionText('stale content from before deletion', masterKey, getRandomBytes);

    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: 5000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') {
        return {
          success: true,
          data: { saved: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(5000).toISOString() }], conflicts: [] },
        };
      }
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '2:255',
            ciphertext: stale.ciphertext,
            nonce: stale.nonce,
            encryptionVersion: stale.encryptionVersion,
            createdAt: new Date(1000).toISOString(),
            updatedAt: new Date(1000).toISOString(),
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    expect(downloaded).toHaveLength(0);
    expect(synced).toContain('2:255'); // the local tombstone was (re-)uploaded, confirming the deletion
  });

  it('a genuinely newer cloud active record supersedes an older local tombstone, applying the recreation locally', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const recreated = encryptReflectionText('recreated after being deleted', masterKey, getRandomBytes);

    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: 1000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '2:255',
            ciphertext: recreated.ciphertext,
            nonce: recreated.nonce,
            encryptionVersion: recreated.encryptionVersion,
            createdAt: new Date(9000).toISOString(),
            updatedAt: new Date(9000).toISOString(),
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({ verseKey: '2:255', text: 'recreated after being deleted' });
  });

  it('a local active reflection newer than a stale cloud tombstone is uploaded, never blocked by the stale deletion', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [{ verseKey: '2:255', text: 'recreated locally', createdAt: 9000, updatedAt: 9000 }];
    localTombstones.items = [];

    let uploadedBody: unknown = null;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        uploadedBody = JSON.parse(String(init.body));
        return { success: true, data: { saved: [{ type: 'active', verseKey: '2:255' }], conflicts: [] } };
      }
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(1000).toISOString() }] };
    });

    await syncReflections('token', masterKey);

    const uploaded = (uploadedBody as { reflections: Record<string, unknown>[] }).reflections;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ type: 'active', verseKey: '2:255' });
    expect(synced).toContain('2:255');
  });

  it('an exact-timestamp tie with the cloud never re-uploads or re-downloads (deterministic, no repeated work)', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const encrypted = encryptReflectionText('same edit already synced', masterKey, getRandomBytes);
    const tiedAt = new Date(2000).toISOString();

    localReflections.items = [{ verseKey: '2:255', text: 'same edit already synced', createdAt: 2000, updatedAt: 2000 }];

    let putCalls = 0;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        putCalls += 1;
        return { success: true, data: { saved: [], conflicts: [] } };
      }
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '2:255',
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            encryptionVersion: encrypted.encryptionVersion,
            createdAt: tiedAt,
            updatedAt: tiedAt,
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    expect(putCalls).toBe(0);
    expect(downloaded).toHaveLength(0);
  });

  it('a tombstone in the same batch as a record that fails to decrypt is still applied', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    localReflections.items = [];
    localTombstones.items = [];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '1:1',
            ciphertext: 'corrupted-not-valid-base64!!',
            nonce: 'also-bad',
            encryptionVersion: 1,
            createdAt: '',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          { type: 'tombstone', verseKey: '94:6', deletedAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
    });

    await expect(syncReflections('token', masterKey)).resolves.toBeUndefined();
    expect(tombstonesDownloaded.map((t) => t.verseKey)).toEqual(['94:6']);
    expect(downloaded).toHaveLength(0);
  });

  it('a deletion tombstone propagates from one device to another through the shared cloud', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    let cloudState: Record<string, unknown>[] = [];

    // Device A already has this reflection synced as active; the user
    // deletes it, creating a local tombstone that now needs uploading.
    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: 5000 }];
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { reflections: Record<string, unknown>[] };
        cloudState = body.reflections;
        return { success: true, data: { saved: cloudState, conflicts: [] } };
      }
      return { success: true, data: cloudState };
    });

    await syncReflections('token-device-a', masterKey);
    expect(cloudState).toEqual([{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(5000).toISOString() }]);

    // Device B still thinks the reflection is active (hasn't heard about
    // the deletion yet) and has never synced before.
    localReflections.items = [{ verseKey: '2:255', text: "device B's stale copy", createdAt: 1000, updatedAt: 1000 }];
    localTombstones.items = [];
    downloaded.length = 0;
    tombstonesDownloaded.length = 0;

    await syncReflections('token-device-b', masterKey);

    // Device B never re-uploads its stale active copy (the cloud's
    // tombstone is newer) and instead learns about the deletion.
    expect(downloaded).toHaveLength(0);
    expect(tombstonesDownloaded).toEqual([{ verseKey: '2:255', deletedAt: 5000 }]);
  });

  it('local tombstone vs. cloud active at the exact same timestamp: the tombstone wins (kept locally, never overwritten by the download)', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const tiedAt = 4000;
    const encrypted = encryptReflectionText('should lose to the tombstone', masterKey, getRandomBytes);

    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: tiedAt }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [{ type: 'tombstone', verseKey: '2:255' }], conflicts: [] } };
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '2:255',
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            encryptionVersion: encrypted.encryptionVersion,
            createdAt: new Date(tiedAt).toISOString(),
            updatedAt: new Date(tiedAt).toISOString(),
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    // The tied cloud active record is never applied locally.
    expect(downloaded).toHaveLength(0);
  });

  it('local active vs. cloud tombstone at the exact same timestamp: the tombstone wins (applied locally, removing the active reflection)', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const tiedAt = 4000;

    localReflections.items = [{ verseKey: '2:255', text: 'should lose to the tombstone', createdAt: tiedAt, updatedAt: tiedAt }];
    localTombstones.items = [];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(tiedAt).toISOString() }] };
    });

    await syncReflections('token', masterKey);

    // The tied cloud tombstone is applied, overriding the local active copy.
    expect(tombstonesDownloaded).toEqual([{ verseKey: '2:255', deletedAt: tiedAt }]);
  });

  it('repeating sync after an equal-timestamp resolution performs no unnecessary re-upload', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const tiedAt = 4000;

    // This device already resolved the tie in the tombstone's favor last
    // sync — both sides now agree it's a tombstone at the same instant.
    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: tiedAt }];

    let putCalls = 0;
    mockFetch((init) => {
      if (init?.method === 'PUT') {
        putCalls += 1;
        return { success: true, data: { saved: [], conflicts: [] } };
      }
      return { success: true, data: [{ type: 'tombstone', verseKey: '2:255', deletedAt: new Date(tiedAt).toISOString() }] };
    });

    await syncReflections('token', masterKey);

    expect(putCalls).toBe(0);
    expect(tombstonesDownloaded).toHaveLength(0);
  });

  it('a newer active reflection still supersedes an older tombstone even when other verseKeys are tied', async () => {
    const masterKey = generateMasterKey(getRandomBytes);
    const { encryptReflectionText } = await import('@/crypto/reflectionEncryption');
    const recreated = encryptReflectionText('genuinely recreated later', masterKey, getRandomBytes);

    localReflections.items = [];
    localTombstones.items = [{ verseKey: '2:255', deletedAt: 1000 }];

    mockFetch((init) => {
      if (init?.method === 'PUT') return { success: true, data: { saved: [], conflicts: [] } };
      return {
        success: true,
        data: [
          {
            type: 'active',
            verseKey: '2:255',
            ciphertext: recreated.ciphertext,
            nonce: recreated.nonce,
            encryptionVersion: recreated.encryptionVersion,
            createdAt: new Date(9000).toISOString(),
            updatedAt: new Date(9000).toISOString(), // strictly newer than the tombstone's deletedAt=1000
          },
        ],
      };
    });

    await syncReflections('token', masterKey);

    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({ verseKey: '2:255', text: 'genuinely recreated later' });
  });
});
