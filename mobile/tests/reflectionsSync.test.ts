import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));

const localReflections = vi.hoisted(() => ({
  items: [] as { verseKey: string; text: string; createdAt: number; updatedAt: number }[],
}));
const synced: string[] = [];
const downloaded: { verseKey: string; text: string }[] = [];

vi.mock('@/storage/ayahReflections', () => ({
  getAllReflections: vi.fn(async () => localReflections.items),
  markReflectionSyncState: vi.fn(async (verseKey: string) => {
    synced.push(verseKey);
  }),
  putReflectionFromSync: vi.fn(async (reflection: { verseKey: string; text: string }) => {
    downloaded.push(reflection);
  }),
}));

const { syncReflections } = await import('@/sync/reflectionsSync');
const { generateMasterKey } = await import('@/crypto/reflectionEncryption');
const { getRandomBytes } = await import('@/crypto/randomBytes');

afterEach(() => {
  vi.unstubAllGlobals();
  localReflections.items = [];
  synced.length = 0;
  downloaded.length = 0;
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
