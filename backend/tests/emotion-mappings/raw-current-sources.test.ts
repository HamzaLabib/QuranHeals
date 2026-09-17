import { describe, expect, it } from 'vitest';
import { consolidate, loadHistoricalSources, validateHistoricalReconstruction, type SourceRow } from '../../src/scripts/consolidateCurrentMappings';
import { authorizeRemoval, parseRemovalArgs, planRemoval } from '../../src/scripts/deactivateEmotionMapping';

const source = (overrides: Partial<SourceRow> = {}): SourceRow => ({ verseKey: '2:222', emotionKey: 'seeking_guidance',
  sourceTypes: ['overlap'], sourceFiles: ['test/overlaps.json'], sourceBatches: ['1'], ...overrides });
describe('Raw-source current architecture', () => {
  it('matches every historical identity before later batches and updates', () => {
    expect(validateHistoricalReconstruction()).toEqual({ totalPairs: 1845, missing: [], extra: [] });
    expect(() => validateHistoricalReconstruction([])).toThrow('diverged');
  });
  it('does not use the historical preview as row provenance', () => {
    expect(loadHistoricalSources().every(row => row.sourceFiles.every(file => !file.includes('preview')))).toBe(true);
  });
  it('finds the 25 historical overlap collisions plus direct/supplemental/MVP collisions', () => {
    const sources = loadHistoricalSources();
    const groups = new Map<string, number>();
    sources.filter(row => row.sourceTypes.includes('overlap')).forEach(row => {
      const key = `${row.verseKey}|${row.emotionKey}`; groups.set(key, (groups.get(key) ?? 0) + 1);
    });
    expect([...groups.values()].filter(count => count > 1)).toHaveLength(25);
    expect(consolidate(sources, [], { corrections: [] }).duplicateAuditRows.filter(row => row.occurrences > 1).length).toBeGreaterThan(25);
  });
  it('aggregates three occurrences once, preserves source emotions, and resolves direct KEEP', () => {
    const result = consolidate([source({ sourceEmotionKeys: ['sad'] }), source(), source({ decision: 'keep', sourceTypes: ['direct_keep'] })], [], { corrections: [] });
    expect(result.rows).toHaveLength(1);
    expect(result.duplicateAuditRows).toHaveLength(1);
    expect(result.duplicateAuditRows[0]).toMatchObject({ occurrences: 3, sourceEmotionKeys: ['sad'], resolution: 'superseded_by_direct_keep', collapsedToOneRow: true, finalRowIncluded: true });
  });
  it.each(['reject', 'hold'] as const)('blocks raw overlaps and direct KEEP with %s', decision => {
    const result = consolidate([source(), source({ decision: 'keep' }), source({ decision })], [], { corrections: [] });
    expect(result.rows).toHaveLength(0);
    expect(result.duplicateAuditRows[0]).toMatchObject({ occurrences: 3, resolution: `blocked_by_${decision}`, finalRowIncluded: false });
  });
  it('applies editorial blocks last without blocking other emotions on the same ayah', () => {
    const result = consolidate([source(), source({ emotionKey: 'sad' })], [], { corrections: [{ id: 'test', recordedOn: '2026-09-17', type: 'reject', verseKey: '2:222', emotionKey: 'seeking_guidance', reason: 'test' }] });
    expect(result.rows.map(row => row.emotionKey)).toEqual(['sad']);
    expect(result.duplicateAuditRows[0].finalRowIncluded).toBe(false);
  });
  it('excluded and unapproved later overlaps do not grant approval', () => {
    expect(consolidate([source({ excluded: true }), source({ eligible: false })], [], { corrections: [] }).rows).toEqual([]);
  });
});
describe('Exact-pair removal safeguards (offline)', () => {
  const target = { verseKey: '2:222', emotionKey: 'seeking_guidance' };
  const doc = { verseReferenceKey: target.verseKey, emotionKey: target.emotionKey, status: 'approved' };
  it('requires exact explicit confirmation and backup for writes', () => {
    expect(parseRemovalArgs(['--verse', target.verseKey, '--emotion', target.emotionKey]).apply).toBe(false);
    expect(() => parseRemovalArgs(['--verse', target.verseKey, '--emotion', target.emotionKey, '--apply'])).toThrow();
    expect(parseRemovalArgs(['--verse', target.verseKey, '--emotion', target.emotionKey, '--apply', '--confirm', 'deactivate:2:222:seeking_guidance', '--backup', 'backup.json']).apply).toBe(true);
    expect(() => parseRemovalArgs(['--all'])).toThrow();
  });
  it('requires raw approval authority to block the exact target', () => {
    expect(() => authorizeRemoval(target)).not.toThrow();
    expect(() => authorizeRemoval({ verseKey: '1:1', emotionKey: 'faith_shaken' })).toThrow();
  });
  it('is idempotent for missing or rejected pairs', () => {
    expect(planRemoval(target, [doc])).toMatchObject({ before: 'approved', after: 'rejected', changed: true });
    expect(planRemoval(target, [])).toMatchObject({ changed: false });
    expect(planRemoval(target, [{ ...doc, status: 'rejected' }])).toMatchObject({ changed: false });
  });
  it('refuses unrelated or duplicate identities', () => {
    expect(() => planRemoval(target, [{ ...doc, emotionKey: 'sad' }])).toThrow('Unrelated');
    expect(() => planRemoval(target, [doc, doc])).toThrow('Duplicate');
  });
});
