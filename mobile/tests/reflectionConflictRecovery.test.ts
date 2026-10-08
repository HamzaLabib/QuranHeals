import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D5: concurrent edits never silently lose reflection text. Two simulated
 * devices (separate local storage) sync against a fake backend that applies
 * the real repository's rules (per-verseKey last-write-wins; exact tie →
 * tombstone wins, or both active versions preserved as conflictVersions).
 * Everything the server sees is ciphertext; decryption happens on devices.
 */

const env = vi.hoisted(() => ({
  storage: new Map<string, string>(), failPut: false, failGet: false, putDelay: 0,
  getCount: 0,
  /** Runs inside the fake network call, i.e. while a sync is in flight. */
  beforeGet: null as null | ((count: number) => Promise<void>),
  beforePut: null as null | (() => Promise<void>),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => env.storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
} }));
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
vi.mock('@/services/quran', () => ({ getVerseByKey: vi.fn(async () => { throw new Error('no local Quran database in tests'); }) }));

const { syncReflections } = await import('@/sync/reflectionsSync');
const { generateMasterKey, encryptReflectionText } = await import('@/crypto/reflectionEncryption');
const { getRandomBytes } = await import('@/crypto/randomBytes');
const reflections = await import('@/storage/ayahReflections');
const conflicts = await import('@/storage/reflectionConflicts');
const owner = await import('@/storage/localDataOwner');
const { loadReflectionListItems } = await import('@/hooks/useReflections');

type CloudRecord =
  | { type: 'active'; verseKey: string; ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string; updatedAt: string; conflictVersions: { ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }[] }
  | { type: 'tombstone'; verseKey: string; deletedAt: string };

/** Mirrors backend MongooseSyncRepository.putReflections / listReflectionConflicts. */
class FakeServer {
  records = new Map<string, CloudRecord>();
  private ts = (r: { type?: string; deletedAt?: string; updatedAt?: string }) => new Date(r.type === 'tombstone' ? r.deletedAt! : r.updatedAt!).getTime();
  private dto(r: CloudRecord) {
    if (r.type === 'tombstone') return { type: 'tombstone', verseKey: r.verseKey, deletedAt: r.deletedAt };
    const { conflictVersions: _c, ...rest } = r;
    return rest;
  }
  list() { return [...this.records.values()].map((r) => this.dto(r)); }
  conflicts() {
    return [...this.records.values()]
      .filter((r): r is Extract<CloudRecord, { type: 'active' }> => r.type === 'active' && r.conflictVersions.length > 0)
      .map((r) => ({ verseKey: r.verseKey, conflictVersions: r.conflictVersions }));
  }
  put(incoming: (CloudRecord & { keyFingerprint?: string })[]) {
    const saved = [];
    for (const raw of incoming) {
      const { keyFingerprint: _k, ...record } = raw as CloudRecord & { keyFingerprint?: string };
      const existing = this.records.get(record.verseKey);
      const next: CloudRecord = record.type === 'tombstone' ? record : { ...record, type: 'active', conflictVersions: existing?.type === 'active' ? existing.conflictVersions : [] };
      if (!existing || this.ts(record) > this.ts(existing)) {
        this.records.set(record.verseKey, next);
      } else if (this.ts(record) === this.ts(existing)) {
        if (record.type === 'tombstone' && existing.type === 'active') this.records.set(record.verseKey, record);
        else if (record.type === 'active' && existing.type === 'active' && (record.ciphertext !== existing.ciphertext || record.nonce !== existing.nonce)) {
          existing.conflictVersions.push({ ciphertext: record.ciphertext, nonce: record.nonce, encryptionVersion: record.encryptionVersion, createdAt: new Date().toISOString() });
        }
      }
      saved.push(this.dto(this.records.get(record.verseKey)!));
    }
    return { saved, conflicts: [] };
  }
}

let server: FakeServer;
const devices: Record<string, Map<string, string>> = {};
const USER = 'user-1';
const VERSE = '2:286';

function useDevice(name: string) {
  devices[name] ??= new Map();
  env.storage = devices[name];
}

beforeEach(() => {
  server = new FakeServer();
  for (const key of Object.keys(devices)) delete devices[key];
  Object.assign(env, { failPut: false, failGet: false, putDelay: 0, getCount: 0, beforeGet: null, beforePut: null });
  owner.resetLocalDataOwnerForTests();
  owner.setLocalDataOwnerState({ activeUserId: USER, keptSeparate: [], resolved: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
    if (url.endsWith('/api/sync/reflections/conflicts')) return json(server.conflicts());
    if (init?.method === 'PUT') {
      if (env.beforePut) await env.beforePut();
      if (env.failPut) throw new TypeError('Network request failed');
      if (env.putDelay) await new Promise((r) => setTimeout(r, env.putDelay));
      return json(server.put(JSON.parse(String(init.body)).reflections));
    }
    if (env.failGet) throw new TypeError('Network request failed');
    env.getCount += 1;
    const snapshot = server.list();
    if (env.beforeGet) await env.beforeGet(env.getCount);
    return json(snapshot);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const masterKey = generateMasterKey(getRandomBytes);
const sync = (device: string, key = masterKey) => {
  useDevice(device);
  return syncReflections('token', key, USER);
};
const save = (device: string, text: string, at: number) => {
  useDevice(device);
  return reflections.saveReflection(VERSE, text, at);
};
const current = async (device: string) => {
  useDevice(device);
  return (await reflections.getReflection(VERSE))?.text ?? null;
};
const kept = async (device: string) => {
  useDevice(device);
  return conflicts.getConflictVersionsFor(VERSE);
};
/** v1 created on A at t=1000 and synced to both devices. */
async function sharedStart() {
  await save('A', 'original', 1000);
  await sync('A');
  await sync('B');
  expect(await current('B')).toBe('original');
}

describe('sequential edits stay plain last-write-wins', () => {
  it('an edit made after seeing the other device\'s version replaces it with nothing to review', async () => {
    await sharedStart();
    await save('B', 'edited on B', 2000);
    await sync('B');
    await sync('A');
    expect(await current('A')).toBe('edited on B');
    expect(await kept('A')).toEqual([]);
    expect(await kept('B')).toEqual([]);
  });
});

describe('two devices edit the same reflection', () => {
  it('the later edit wins everywhere and the earlier device keeps its own text to review', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A');

    expect(await current('A')).toBe('B edit');
    expect(await kept('A')).toEqual([expect.objectContaining({ text: 'A offline edit', origin: 'this-device', versionUpdatedAt: 3000 })]);
    // The server never saw the plaintext of either version.
    expect(JSON.stringify(server.list())).not.toMatch(/edit/);
  });

  it('when the older edit reached the server first, the device replacing it keeps it', async () => {
    await sharedStart();
    await save('A', 'A edit', 3000);
    await sync('A');
    await save('B', 'B newer edit', 4000);
    await sync('B');
    await sync('A');

    expect(await current('A')).toBe('B newer edit');
    expect(await current('B')).toBe('B newer edit');
    expect(await kept('B')).toEqual([expect.objectContaining({ text: 'A edit', origin: 'other-device', versionUpdatedAt: 3000 })]);
  });

  it('an exact-timestamp tie converges on one current text and keeps the other', async () => {
    await sharedStart();
    await save('A', 'A tie', 5000);
    await save('B', 'B tie', 5000);
    await sync('B');
    await sync('A');

    expect(await current('A')).toBe('B tie');
    expect(await kept('A')).toEqual([expect.objectContaining({ text: 'A tie', origin: 'this-device' })]);
  });

  it('identical text on both devices is not a conflict', async () => {
    await sharedStart();
    await save('A', 'same words', 3000);
    await save('B', 'same words', 4000);
    await sync('B');
    await sync('A');
    expect(await kept('A')).toEqual([]);
    expect(await kept('B')).toEqual([]);
  });
});

describe('one device edits while another deletes', () => {
  it('a newer deletion elsewhere still deletes, but the unsynced edit is kept to restore', async () => {
    await sharedStart();
    await save('A', 'A edit before deletion arrived', 3000);
    await save('B', '', 4000); // delete
    await sync('B');
    await sync('A');

    expect(await current('A')).toBeNull();
    expect(await kept('A')).toEqual([expect.objectContaining({ text: 'A edit before deletion arrived', origin: 'this-device', supersededByDeletion: true })]);
  });

  it('deleting without having seen another device\'s edit keeps that edit\'s text', async () => {
    await sharedStart();
    await save('A', 'A edit', 3000);
    await sync('A');
    await save('B', '', 4000); // B deletes, still based on 'original'
    await sync('B');

    expect(await current('B')).toBeNull();
    expect(await kept('B')).toEqual([expect.objectContaining({ text: 'A edit', origin: 'other-device' })]);
    expect(server.records.get(VERSE)?.type).toBe('tombstone'); // tombstone semantics unchanged
  });

  it('an edit made after the deletion recreates the reflection, as before', async () => {
    await sharedStart();
    await save('B', '', 2000);
    await sync('B');
    await sync('A');
    await save('A', 'written again', 3000);
    await sync('A');
    await sync('B');
    expect(await current('B')).toBe('written again');
    expect(await kept('B')).toEqual([]);
  });
});

describe('interruptions and restarts', () => {
  it('a failed upload loses nothing: the kept text is already stored, and retrying adds no duplicate', async () => {
    await sharedStart();
    await save('A', 'A edit', 3000);
    await sync('A');
    await save('B', 'B newer edit', 4000);
    env.failPut = true;
    await expect(sync('B')).rejects.toThrow();
    expect(await current('B')).toBe('B newer edit');
    expect(await kept('B')).toHaveLength(1);

    env.failPut = false;
    await sync('B');
    expect(await kept('B')).toHaveLength(1);
    expect(await current('B')).toBe('B newer edit');
  });

  it('a failed download changes nothing locally', async () => {
    await sharedStart();
    await save('A', 'A edit', 3000);
    env.failGet = true;
    await expect(sync('A')).rejects.toThrow();
    expect(await current('A')).toBe('A edit');
    expect(await kept('A')).toEqual([]);
  });

  it('kept versions survive an app restart', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A');

    owner.resetLocalDataOwnerForTests();
    owner.setLocalDataOwnerState({ activeUserId: USER, keptSeparate: [], resolved: true });
    expect((await kept('A')).map((version) => version.text)).toEqual(['A offline edit']);
  });

  it('two syncs running at once keep the text exactly once', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    useDevice('A');
    await Promise.all([syncReflections('token', masterKey, USER), syncReflections('token', masterKey, USER)]);
    expect((await kept('A')).map((version) => version.text)).toEqual(['A offline edit']);
  });
});

describe('server-preserved versions', () => {
  function preserve(text: string, nonceFor?: (n: string) => void) {
    const encrypted = encryptReflectionText(text, masterKey, getRandomBytes);
    nonceFor?.(encrypted.nonce);
    const record = server.records.get(VERSE);
    if (record?.type !== 'active') throw new Error('expected an active record');
    record.conflictVersions.push({ ...encrypted, createdAt: '2026-01-01T00:00:00.000Z' });
  }

  it('are fetched and decrypted on the device, once, however often the server reports them', async () => {
    await sharedStart();
    preserve('version only the server kept');
    await sync('A');
    await sync('A');
    expect(await kept('A')).toEqual([expect.objectContaining({ text: 'version only the server kept', origin: 'server' })]);
  });

  it('once handled, are not offered again on this device', async () => {
    await sharedStart();
    preserve('handled version');
    await sync('A');
    const [version] = await kept('A');
    await conflicts.resolveConflictVersions([version.id]);
    await sync('A');
    expect(await kept('A')).toEqual([]);
  });

  it('skip versions that cannot be decrypted without failing the sync', async () => {
    await sharedStart();
    const record = server.records.get(VERSE);
    if (record?.type !== 'active') throw new Error('expected an active record');
    record.conflictVersions.push({ ciphertext: 'bm90LXJlYWw=', nonce: 'bm9uY2U=', encryptionVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    await expect(sync('A')).resolves.toBeUndefined();
    expect(await kept('A')).toEqual([]);
  });
});

describe('wrong key / decryption failure', () => {
  it('a device holding the wrong key never replaces or duplicates its local text', async () => {
    await sharedStart();
    await save('A', 'A unsynced', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A', generateMasterKey(getRandomBytes));
    expect(await current('A')).toBe('A unsynced');
    expect(await kept('A')).toEqual([]);
  });
});

describe('account isolation', () => {
  it('kept versions belong to the account they were synced for, never another account or the guest', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A');
    useDevice('A');

    owner.setLocalDataOwnerState({ activeUserId: 'user-2', keptSeparate: [], resolved: true });
    expect(await conflicts.getConflictVersions()).toEqual([]);
    owner.setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
    expect(await conflicts.getConflictVersions()).toEqual([]);
    owner.setLocalDataOwnerState({ activeUserId: USER, keptSeparate: [], resolved: true });
    expect(await conflicts.getConflictVersions()).toHaveLength(1);
  });

  it('a sync for one account writes kept versions only to that account even if the active account changes meanwhile', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    useDevice('A');
    const running = syncReflections('token', masterKey, USER);
    owner.setLocalDataOwnerState({ activeUserId: 'user-2', keptSeparate: [], resolved: true });
    await running;
    expect(await conflicts.getConflictVersions()).toEqual([]);
    expect(await conflicts.getConflictVersions(USER)).toHaveLength(1);
  });

  it('account deletion clears the deleted account\'s kept versions', async () => {
    const source = readFileSync(resolve(__dirname, '../src/auth/useAuth.tsx'), 'utf-8');
    expect(source).toMatch(/await clearAllConflictVersions\(deletedUserId\)/);
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A');
    useDevice('A');
    await conflicts.clearAllConflictVersions(USER);
    expect(await conflicts.getConflictVersions(USER)).toEqual([]);
  });
});

describe('recovery interface', () => {
  it('My Reflections marks reflections with other versions and lists ones that survive only as a kept version', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', '', 4000);
    await sync('B');
    await sync('A');
    useDevice('A');
    expect(await loadReflectionListItems(USER)).toEqual([
      expect.objectContaining({ recoveredOnly: true, otherVersionCount: 1, reflection: expect.objectContaining({ verseKey: VERSE, text: 'A offline edit' }) }),
    ]);

    await save('A', 'written again', 5000);
    expect(await loadReflectionListItems(USER)).toEqual([
      expect.objectContaining({ recoveredOnly: false, otherVersionCount: 1, reflection: expect.objectContaining({ text: 'written again' }) }),
    ]);
  });

  it('the editor offers use / keep both / copy / discard, writes only on Save, and never truncates when combining', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/ReflectionSheet.tsx'), 'utf-8');
    expect(source).toMatch(/getConflictVersionsFor\(verseKey\)/);
    expect(source).toMatch(/messages\.reflection\.useOtherVersion/);
    expect(source).toMatch(/messages\.reflection\.addOtherVersion/);
    expect(source).toMatch(/messages\.reflection\.copyOtherVersion/);
    expect(source).toMatch(/messages\.reflection\.discardOtherVersion/);
    // Use/add only change the text box; versions are resolved after a successful save.
    const saved = source.indexOf('const saved = await saveReflection(verseKey, text);');
    const resolved = source.indexOf('await resolveConflictVersions(handled)');
    expect(saved).toBeGreaterThan(-1);
    expect(resolved).toBeGreaterThan(saved);
    expect(source.slice(saved, resolved)).not.toMatch(/catch/);
    expect(source).toMatch(/const canAdd = combined\.length <= REFLECTION_MAX_LENGTH;/);
    // Discarding asks first.
    expect(source).toMatch(/Alert\.alert\(messages\.reflection\.discardOtherVersionTitle/);
    // RTL: the action row mirrors like the sheet's other actions.
    expect(source).toMatch(/styles\.otherVersionActions, isRtl && styles\.actionsRtl/);
  });
});

describe('edits made while a sync is running', () => {
  it('a reflection saved during the download phase is never overwritten by the downloaded version', async () => {
    await sharedStart();
    await save('B', 'B edit', 4000);
    await sync('B');
    // A uploads something else, so it re-reads the cloud before downloading.
    useDevice('A');
    await reflections.saveReflection('1:1', 'another ayah', 4500);
    env.getCount = 0;
    env.beforeGet = async (count) => {
      if (count === 2) await reflections.saveReflection(VERSE, 'typed during sync', 5000);
    };
    await sync('A');
    env.beforeGet = null;

    expect(await current('A')).toBe('typed during sync');
    useDevice('A');
    expect((await reflections.getReflection(VERSE))?.syncState).toBe('pending');

    // The next sync treats it as concurrent with B's edit: A's newer text
    // wins, and B's text is kept rather than lost.
    await sync('A');
    expect(await current('A')).toBe('typed during sync');
    expect(await kept('A')).toEqual([expect.objectContaining({ text: 'B edit', origin: 'other-device' })]);
    await sync('B');
    expect(await current('B')).toBe('typed during sync');
  });

  it('an edit made while its previous version is uploading is not marked synced, and uploads next time', async () => {
    await sharedStart();
    await save('A', 'first edit', 2000);
    env.getCount = 0;
    env.beforePut = async () => {
      env.beforePut = null;
      await reflections.saveReflection(VERSE, 'second edit', 3000);
    };
    await sync('A');
    useDevice('A');
    expect(await reflections.getReflection(VERSE)).toEqual(expect.objectContaining({ text: 'second edit', syncState: 'pending' }));

    await sync('A');
    await sync('B');
    expect(await current('B')).toBe('second edit');
    expect(await kept('A')).toEqual([]);
  });

  it('a reflection deleted during the download phase stays deleted', async () => {
    await sharedStart();
    await save('B', 'B edit', 4000);
    await sync('B');
    useDevice('A');
    await reflections.saveReflection('1:1', 'another ayah', 4500);
    env.getCount = 0;
    env.beforeGet = async (count) => {
      if (count === 2) await reflections.saveReflection(VERSE, '', 5000);
    };
    await sync('A');
    env.beforeGet = null;
    expect(await current('A')).toBeNull();
  });
});

describe('sign-out during a sync', () => {
  it('kept versions and downloads land in the syncing account, never the guest partition shown after sign-out', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    useDevice('A');
    env.getCount = 0;
    env.beforeGet = async (count) => {
      if (count === 1) owner.setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
    };
    await syncReflections('token', masterKey, USER);
    env.beforeGet = null;
    expect(await conflicts.getConflictVersions()).toEqual([]);
    expect(await reflections.getReflection(VERSE)).toBeNull(); // guest partition untouched
    expect((await reflections.getReflection(VERSE, USER))?.text).toBe('B edit');
    expect((await conflicts.getConflictVersions(USER)).map((version) => version.text)).toEqual(['A offline edit']);
  });
});

describe('multiple versions for one reflection', () => {
  it('keeps each distinct losing text from successive conflicts', async () => {
    await sharedStart();
    await save('A', 'A first', 3000);
    await save('B', 'B first', 4000);
    await sync('B');
    await sync('A'); // A keeps 'A first'
    await save('A', 'A second', 6000);
    await save('B', 'B second', 7000);
    await sync('B');
    await sync('A'); // A keeps 'A second'
    expect((await kept('A')).map((version) => version.text).sort()).toEqual(['A first', 'A second']);
    expect(await current('A')).toBe('B second');
  });
});

describe('deleting a reflection that has kept versions', () => {
  it('keeps the versions until they are explicitly handled', async () => {
    await sharedStart();
    await save('A', 'A offline edit', 3000);
    await save('B', 'B edit', 4000);
    await sync('B');
    await sync('A');
    await save('A', '', 5000); // user deletes the current reflection
    await sync('A');
    expect(await current('A')).toBeNull();
    expect((await kept('A')).map((version) => version.text)).toEqual(['A offline edit']);
    useDevice('A');
    expect(await loadReflectionListItems(USER)).toEqual([expect.objectContaining({ recoveredOnly: true })]);
  });
});
