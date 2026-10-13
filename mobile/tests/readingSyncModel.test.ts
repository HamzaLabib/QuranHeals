import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const {
  activeContent, mergeActive, mergeWird, parseContent, sameContent, wirdContent, wirdFromContent,
} = await import('@/sync/readingSyncModel');
type WirdContent = import('@/sync/readingSyncModel').WirdContent;

/** أورادي وختماتي sync: the deterministic rules for two versions of one record (sync/readingSyncModel.ts). */

function w(overrides: Partial<Omit<WirdContent, 'cycle'>> & { cycle?: Partial<WirdContent['cycle']> } = {}): WirdContent {
  const { cycle, ...rest } = overrides;
  return {
    v: 1, kind: 'wird', id: 'stop-1', name: 'Fajr', nameUpdatedAt: '2026-10-01T00:00:00.000Z', page: 100, savedAt: '2026-10-01T00:00:00.000Z',
    cycle: { id: 'c1', startedAt: '2026-09-01T00:00:00.000Z', lastSavedPage: 100, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: true, seq: 0, undoneCycleId: null, ...cycle },
    ...rest,
  };
}
const save = (page: number, savedAt: string, cycle: Partial<WirdContent['cycle']> = {}) => ({ page, savedAt, cycle: { lastSavedPage: page, ...cycle } });

describe('mergeWird', () => {
  const base = w();

  it('only one side changed: that side, for the name and for the position independently', () => {
    const renamedHere = w({ name: 'Dawn', nameUpdatedAt: '2026-10-02T00:00:00.000Z' });
    const movedThere = w(save(200, '2026-10-02T00:00:00.000Z'));
    expect(mergeWird(renamedHere, movedThere, base)).toMatchObject({ name: 'Dawn', page: 200 });
    expect(mergeWird(movedThere, renamedHere, base)).toMatchObject({ name: 'Dawn', page: 200 });
  });

  it('both renamed: the later rename; an exact tie keeps the account`s', () => {
    const early = w({ name: 'Morning', nameUpdatedAt: '2026-10-02T08:00:00.000Z' });
    const late = w({ name: 'Dawn', nameUpdatedAt: '2026-10-02T09:00:00.000Z' });
    expect(mergeWird(early, late, base).name).toBe('Dawn');
    expect(mergeWird(late, early, base).name).toBe('Dawn');
    const tie = w({ name: 'Other', nameUpdatedAt: '2026-10-02T09:00:00.000Z' });
    expect(mergeWird(tie, late, base).name).toBe('Dawn');
  });

  it('both saved in the same cycle: the later save wins — even when it is the lower page', () => {
    const higherEarlier = w(save(450, '2026-10-02T08:00:00.000Z'));
    const lowerLater = w(save(300, '2026-10-02T09:00:00.000Z'));
    expect(mergeWird(higherEarlier, lowerLater, base).page).toBe(300);
    expect(mergeWird(lowerLater, higherEarlier, base).page).toBe(300);
  });

  it('a newer generation (a confirmation) wins over saves in the finished cycle, whatever their time', () => {
    const confirmed = w({ ...save(1, '2026-10-02T08:00:00.000Z'), cycle: { id: 'c2', seq: 1, lastSavedPage: 1, startedByKhatmaId: 'khatma-c1', savedSinceStart: false } });
    const staleSave = w(save(590, '2030-01-01T00:00:00.000Z'));
    for (const merged of [mergeWird(staleSave, confirmed, base), mergeWird(confirmed, staleSave, base)]) {
      expect(merged).toMatchObject({ page: 1, cycle: { id: 'c2', seq: 1 } });
    }
  });

  it('an undo never erases progress saved in the cycle it removes', () => {
    const afterConfirm = w({ ...save(1, '2026-10-02T00:00:00.000Z'), cycle: { id: 'c2', seq: 1, lastSavedPage: 1, savedSinceStart: false } });
    const progress = w({ ...save(50, '2026-10-03T00:00:00.000Z'), cycle: { id: 'c2', seq: 1, lastSavedPage: 50, savedSinceStart: true } });
    const undo = w({ ...save(604, '2026-10-02T00:00:00.000Z'), cycle: { id: 'c1', seq: 2, lastSavedPage: 604, reachedEndAt: '2026-10-02T00:00:00.000Z', undoneCycleId: 'c2' } });
    for (const merged of [mergeWird(progress, undo, afterConfirm), mergeWird(undo, progress, afterConfirm)]) {
      expect(merged).toMatchObject({ page: 50, cycle: { id: 'c2', seq: 3, undoneCycleId: null } });
    }
    // Without progress there, the undo stands.
    expect(mergeWird(w({ name: 'Renamed', nameUpdatedAt: '2026-10-05T00:00:00.000Z', ...save(1, '2026-10-02T00:00:00.000Z'), cycle: { id: 'c2', seq: 1, lastSavedPage: 1, savedSinceStart: false } }), undo, afterConfirm))
      .toMatchObject({ name: 'Renamed', page: 604, cycle: { id: 'c1', seq: 2 } });
  });

  it('both confirmed the same Khatma (same generation, different new cycles): the same choice on both devices', () => {
    const a = w({ ...save(1, '2026-10-02T00:00:00.000Z'), cycle: { id: 'c2-a', seq: 1, lastSavedPage: 1, savedSinceStart: false } });
    const b = w({ ...save(1, '2026-10-02T00:00:01.000Z'), cycle: { id: 'c2-b', seq: 1, lastSavedPage: 1, savedSinceStart: false } });
    expect(mergeWird(a, b, base).cycle.id).toBe(mergeWird(b, a, base).cycle.id);
    const withProgress = w({ ...save(30, '2026-10-01T00:00:00.000Z'), cycle: { id: 'c2-b', seq: 1, lastSavedPage: 30, savedSinceStart: true } });
    expect(mergeWird(a, withProgress, base)).toMatchObject({ page: 30, cycle: { id: 'c2-b' } });
    expect(mergeWird(withProgress, a, base)).toMatchObject({ page: 30, cycle: { id: 'c2-b' } });
  });

  it('a downloaded cycle always agrees with its page, so it is never read as a new save to page 604', () => {
    const { stop, cycle } = wirdFromContent(w({ page: 604, cycle: { lastSavedPage: 12, reachedEndAt: null } }));
    expect(cycle.lastSavedPage).toBe(stop.page);
    expect(cycle.reachedEndAt).toBeNull();
    expect(sameContent(wirdContent(stop, cycle), w({ page: 604, cycle: { lastSavedPage: 604 } }))).toBe(true);
  });
});

describe('mergeActive', () => {
  it('the more recent choice; an unchanged side yields to the other', () => {
    const base = activeContent('a', '2026-10-01T00:00:00.000Z');
    const here = activeContent('b', '2026-10-02T00:00:00.000Z');
    const there = activeContent('c', '2026-10-03T00:00:00.000Z');
    expect(mergeActive(here, there, base).stopId).toBe('c');
    expect(mergeActive(there, here, base).stopId).toBe('c');
    expect(mergeActive(base, here, base).stopId).toBe('b');
    expect(mergeActive(here, base, base).stopId).toBe('b');
  });
});

describe('downloaded content is checked before it is ever applied', () => {
  it('accepts a valid record, bound to its kind and id', () => {
    const content = w();
    expect(parseContent('wird', 'stop-1', JSON.parse(JSON.stringify(content)))).toEqual(content);
    // Another record's content, or another kind: rejected.
    expect(parseContent('wird', 'stop-2', content)).toBeNull();
    expect(parseContent('khatma', 'stop-1', content)).toBeNull();
  });

  it('rejects malformed content: a page outside 1–604, an over-long name, a non-integer generation, a newer format', () => {
    for (const bad of [w({ page: 605 }), w({ page: 0 }), w({ name: 'x'.repeat(41) }), w({ cycle: { seq: 1.5 } }), w({ savedAt: 'yesterday' }), { ...w(), v: 2 }]) {
      expect(parseContent('wird', 'stop-1', bad)).toBeNull();
    }
    expect(parseContent('active', 'active', { v: 1, kind: 'active', id: 'active', stopId: '../x', changedAt: null })).toBeNull();
    expect(parseContent('wird', 'stop-1', undefined)).toBeNull();
  });
});
