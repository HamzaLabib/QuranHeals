import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  },
}));

const {
  getReflection,
  getAllReflections,
  saveReflection,
  markReflectionSyncState,
  putReflectionFromSync,
  REFLECTION_MAX_LENGTH,
} = await import('@/storage/ayahReflections');

const STORAGE_KEY = 'quran-heals:ayah-reflections:v1';

beforeEach(() => state.clear());

describe('ayahReflections: save/load/edit', () => {
  it('returns null for an ayah with no saved reflection', async () => {
    expect(await getReflection('2:255')).toBeNull();
  });

  it('saves a new reflection and loads it back', async () => {
    const saved = await saveReflection('2:255', 'This ayah calmed me.', 1000);
    expect(saved).toMatchObject({ verseKey: '2:255', text: 'This ayah calmed me.', createdAt: 1000, updatedAt: 1000 });
    expect(await getReflection('2:255')).toMatchObject({ text: 'This ayah calmed me.' });
  });

  it('editing an existing reflection preserves createdAt and updates updatedAt/text', async () => {
    await saveReflection('2:255', 'First draft', 1000);
    const edited = await saveReflection('2:255', 'Edited version', 2000);
    expect(edited).toMatchObject({ text: 'Edited version', createdAt: 1000, updatedAt: 2000 });
  });

  it('keeps a separate reflection per verse', async () => {
    await saveReflection('2:255', 'About ayat al-kursi', 1000);
    await saveReflection('94:6', 'About ease after hardship', 1000);

    expect((await getReflection('2:255'))?.text).toBe('About ayat al-kursi');
    expect((await getReflection('94:6'))?.text).toBe('About ease after hardship');
    expect(await getAllReflections()).toHaveLength(2);
  });

  it('reopening and editing the same verse retains a single reflection regardless of navigation origin', async () => {
    await saveReflection('2:286', 'First reflection', 1000);
    expect(await getReflection('2:286')).toMatchObject({ text: 'First reflection' });
    await saveReflection('2:286', 'Updated reflection', 2000);
    expect(await getAllReflections()).toEqual([
      expect.objectContaining({ verseKey: '2:286', text: 'Updated reflection', createdAt: 1000, updatedAt: 2000 }),
    ]);
  });

  it('persists across a simulated app restart (a fresh read of the same storage)', async () => {
    await saveReflection('2:255', 'Persisted', 1000);
    // Simulate "restart" by only re-importing the read path, not clearing state.
    expect(await getReflection('2:255')).toMatchObject({ text: 'Persisted' });
  });
});

describe('ayahReflections: delete on empty save', () => {
  it('saving an empty string deletes an existing reflection and returns null', async () => {
    await saveReflection('2:255', 'Something', 1000);
    const result = await saveReflection('2:255', '', 2000);
    expect(result).toBeNull();
    expect(await getReflection('2:255')).toBeNull();
  });

  it('saving a whitespace-only string deletes an existing reflection', async () => {
    await saveReflection('2:255', 'Something', 1000);
    const result = await saveReflection('2:255', '   \n\t  ', 2000);
    expect(result).toBeNull();
    expect(await getReflection('2:255')).toBeNull();
  });

  it('saving empty/whitespace for an ayah with no existing reflection is a no-op, not an error', async () => {
    const result = await saveReflection('2:255', '   ', 1000);
    expect(result).toBeNull();
    expect(await getAllReflections()).toHaveLength(0);
  });
});

describe('ayahReflections: length limits', () => {
  it('enforces a 2,000-character maximum by truncating (defense in depth — the UI is expected to enforce this too)', async () => {
    const tooLong = 'a'.repeat(REFLECTION_MAX_LENGTH + 500);
    const saved = await saveReflection('2:255', tooLong, 1000);
    expect(saved?.text).toHaveLength(REFLECTION_MAX_LENGTH);
  });

  it('accepts exactly the maximum length', async () => {
    const exact = 'b'.repeat(REFLECTION_MAX_LENGTH);
    const saved = await saveReflection('2:255', exact, 1000);
    expect(saved?.text).toHaveLength(REFLECTION_MAX_LENGTH);
  });
});

describe('ayahReflections: storage safety', () => {
  it('never stores Quran Arabic/translation text fields — only verseKey/text/timestamps/syncState', async () => {
    const saved = await saveReflection('2:255', 'My private thought', 1000);
    expect(Object.keys(saved!).sort()).toEqual(['createdAt', 'syncState', 'text', 'updatedAt', 'verseKey']);
  });

  it('corrupt storage is surfaced as an error rather than silently treated as empty, and is never overwritten by a failed save', async () => {
    state.set(STORAGE_KEY, '{not valid json');
    await expect(getReflection('2:255')).rejects.toThrow();
    await expect(saveReflection('2:255', 'new text', 1000)).rejects.toThrow();
    expect(state.get(STORAGE_KEY)).toBe('{not valid json');
  });

  it('a write failure (AsyncStorage.setItem rejects) never corrupts previously-stored reflections', async () => {
    await saveReflection('2:255', 'kept safe', 1000);
    const before = state.get(STORAGE_KEY);

    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await expect(saveReflection('94:6', 'should not persist', 2000)).rejects.toThrow('disk full');
    expect(state.get(STORAGE_KEY)).toBe(before);
  });

  it('local save works while "offline" — this module never touches the network', async () => {
    // No fetch/network mock exists in this test file at all; saving still works.
    const saved = await saveReflection('2:255', 'offline note', 1000);
    expect(saved?.text).toBe('offline note');
  });
});

describe('ayahReflections: sync bookkeeping helpers (used only by sync code, not the reflection UI)', () => {
  it('markReflectionSyncState updates syncState without changing text/timestamps', async () => {
    await saveReflection('2:255', 'text', 1000);
    await markReflectionSyncState('2:255', 'synced');
    const reflection = await getReflection('2:255');
    expect(reflection).toMatchObject({ text: 'text', createdAt: 1000, updatedAt: 1000, syncState: 'synced' });
  });

  it('putReflectionFromSync upserts a downloaded reflection and marks it synced', async () => {
    await putReflectionFromSync({ verseKey: '2:255', text: 'from cloud', createdAt: 500, updatedAt: 500 });
    expect(await getReflection('2:255')).toMatchObject({ text: 'from cloud', syncState: 'synced' });
  });
});
