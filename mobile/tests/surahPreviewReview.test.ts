import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The Surah Preview scholarly review tools (tools/surah-preview/review/), on SYNTHETIC records and temporary logs only:
// these tests never touch the real review log, and no decision here is anyone's scholarly decision.
const { invalidDecision, openStore, topicsSha } = await import('../../tools/surah-preview/review/store.mjs');
const { selectionProposal, splitProposal } = await import('../../tools/surah-preview/review/proposals.mjs');
const { buildReviewedContent } = await import('../../tools/surah-preview/review/apply.mjs');

const dirs: string[] = [];
const tempStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-review-'));
  dirs.push(dir);
  return openStore(dir);
};
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const record = (surah: number, current: string[] | null, proposal: { items: string[] } | null = null) => ({
  surah,
  current,
  currentSha: topicsSha(current),
  proposal,
  references: { sources: [{ id: 'src-a', title: 'Source A', publisher: 'P', url: 'https://example.org', retrieved: 'v1' }] },
});
const records = Array.from({ length: 114 }, (_, i) => record(i + 1, [`بند ${i + 1}`, 'بند آخر'], i === 3 ? { items: ['مختار'] } : null));
const base = (r: ReturnType<typeof record>) => ({ reviewer: 'Reviewer', surah: r.surah, reviewedSha: r.currentSha });

describe('Surah Preview review: decisions are checked before they are recorded', () => {
  it('needs a reviewer name, a known Surah and action, and the topics as reviewed', () => {
    const r = records[0];
    expect(invalidDecision({ ...base(r), reviewer: ' ', action: 'skip' }, r)).toMatch(/reviewer/);
    expect(invalidDecision({ ...base(r), surah: 115, action: 'skip' }, r)).toMatch(/Surah/);
    expect(invalidDecision({ ...base(r), action: 'approve' }, r)).toMatch(/decision/);
    expect(invalidDecision({ ...base(r), reviewedSha: topicsSha(['other']), action: 'skip' }, r)).toMatch(/changed/);
    expect(invalidDecision({ ...base(r), action: 'skip' }, r)).toBeNull();
  });

  it('accept carries exactly the current topics or the proposal; edit needs lines of text; reject carries none', () => {
    const r = records[3];
    expect(invalidDecision({ ...base(r), action: 'accept', basis: 'current', items: r.current }, r)).toBeNull();
    expect(invalidDecision({ ...base(r), action: 'accept', basis: 'current', items: ['changed'] }, r)).toMatch(/differs/);
    expect(invalidDecision({ ...base(r), action: 'accept', basis: 'proposal', items: ['مختار'] }, r)).toBeNull();
    expect(invalidDecision({ ...base(records[0]), action: 'accept', basis: 'proposal', items: ['x'] }, records[0])).toMatch(/no proposal/);
    expect(invalidDecision({ ...base(r), action: 'accept', items: r.current }, r)).toMatch(/basis/);
    expect(invalidDecision({ ...base(r), action: 'edit', items: [] }, r)).toMatch(/one to forty/);
    expect(invalidDecision({ ...base(r), action: 'edit', items: ['أ', 'ب'] }, r)).toBeNull();
    expect(invalidDecision({ ...base(r), action: 'reject', items: ['x'] }, r)).toMatch(/no text/);
  });
});

describe('Surah Preview review: the log is append-only and tamper-evident', () => {
  it('chains each entry to the one before and numbers them', () => {
    const store = tempStore();
    const a = store.append({ ...base(records[0]), action: 'skip' }, new Date('2026-01-01T00:00:00Z'));
    const b = store.append({ ...base(records[1]), action: 'accept', basis: 'current', items: records[1].current }, new Date('2026-01-01T00:01:00Z'));
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(b.prev).toBe(a.hash);
    expect(store.entries()).toHaveLength(2);
    expect(store.latest().get(2).action).toBe('accept');
  });

  it('an edited line breaks the chain: nothing more is read or accepted', () => {
    const store = tempStore();
    store.append({ ...base(records[0]), action: 'accept', basis: 'current', items: records[0].current });
    store.append({ ...base(records[1]), action: 'skip' });
    writeFileSync(store.file, readFileSync(store.file, 'utf8').replace('"reviewer":"Reviewer"', '"reviewer":"Someone else"'));
    expect(() => store.entries()).toThrow(/broken at line 1/);
    expect(() => store.append({ ...base(records[2]), action: 'skip' })).toThrow(/broken/);
  });

  it('a removed line is detected too', () => {
    const store = tempStore();
    store.append({ ...base(records[0]), action: 'skip' });
    store.append({ ...base(records[1]), action: 'skip' });
    writeFileSync(store.file, `${readFileSync(store.file, 'utf8').split('\n')[1]}\n`);
    expect(() => store.entries()).toThrow(/broken/);
  });
});

describe('Surah Preview review: only recorded human decisions become reviewed content', () => {
  it('no decisions → nothing approved', () => {
    const { document } = buildReviewedContent({ store: tempStore(), records });
    expect(document.surahs).toEqual({});
  });

  it('accept / edit → approved with the reviewer and decision; reject → rejected without text; skip keeps the earlier decision', () => {
    const store = tempStore();
    store.append({ ...base(records[0]), action: 'accept', basis: 'current', items: records[0].current });
    store.append({ ...base(records[1]), action: 'edit', items: ['معدّل'] });
    store.append({ ...base(records[2]), action: 'reject' });
    store.append({ ...base(records[0]), action: 'skip' });
    const { document, stale } = buildReviewedContent({ store, records });
    expect(stale).toEqual([]);
    expect(document.surahs['1'].themesAr).toMatchObject({ status: 'approved', items: records[0].current, sources: ['src-a'], review: { reviewer: 'Reviewer', decision: 1, basis: 'current' } });
    expect(document.surahs['2'].themesAr).toMatchObject({ status: 'approved', items: ['معدّل'], review: { decision: 2, basis: 'edited' } });
    expect(document.surahs['3'].themesAr.status).toBe('rejected');
    expect(document.surahs['3'].themesAr.items).toBeUndefined();
    expect(document.sources.map((s: { id: string }) => s.id)).toEqual(['src-a']);
  });

  it('a decision on topics that have since changed in the source is not applied', () => {
    const store = tempStore();
    store.append({ ...base(records[0]), action: 'accept', basis: 'current', items: records[0].current });
    const changed = records.map((r, i) => (i === 0 ? record(1, ['نص جديد']) : r));
    const { document, stale } = buildReviewedContent({ store, records: changed });
    expect(stale).toEqual([1]);
    expect(document.surahs['1']).toBeUndefined();
  });
});

describe('Surah Preview review: proposals select or split by rule, never reword', () => {
  const items = Array.from({ length: 13 }, (_, i) => ({ text: `عنوان ${i + 1}`, range: [i * 10 + 1, i * 10 + 1 + (i % 4) * 3] as [number, number] }));

  it('a long list: the headings covering most ayahs, in source order, verbatim; the rest listed as omitted', () => {
    const p = selectionProposal(items)!;
    expect(p.status).toBe('pending-review');
    expect(p.items).toHaveLength(4);
    expect([...p.items, ...p.omitted].sort()).toEqual(items.map((i) => i.text).sort());
    expect(p.items).toEqual(items.filter((i) => p.items.includes(i.text)).map((i) => i.text));
    expect(selectionProposal(items.slice(0, 10))).toBeNull();
  });

  it('a one-sentence list splits at its own «، و» joints; a one-word part stays with the phrase before it', () => {
    const p = splitProposal(['بيان الأول، والثاني في كذا، وذكر الثالث، والرابع.'])!;
    expect(p.items).toEqual(['بيان الأول', 'الثاني في كذا', 'ذكر الثالث، والرابع']);
    expect(splitProposal(['بيان الأول، وذكر الثاني في كذا، وذكر الثالث هنا.'])!.items).toEqual(['بيان الأول', 'ذكر الثاني في كذا', 'ذكر الثالث هنا']);
    expect(splitProposal(['جملة واحدة.'])).toBeNull();
  });
});

describe('Surah Preview review: all 114 records (with the generated dataset present)', () => {
  const dataset = join(__dirname, '../assets/surah-preview/surah-preview.json');
  it.skipIf(!existsSync(dataset))('loads 114 records, each bound to its source-derived topics', async () => {
    const { loadRecords } = await import('../../tools/surah-preview/review/data.mjs');
    const { records: all } = loadRecords();
    expect(all).toHaveLength(114);
    expect(all.map((r: { surah: number }) => r.surah)).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    for (const r of all) expect(r.currentSha).toBe(topicsSha(r.current));
  });

  it.skipIf(!existsSync(dataset))('owner approval covers all 114 Arabic entries as worded, apart from scholarly review', async () => {
    const { loadRecords } = await import('../../tools/surah-preview/review/data.mjs');
    const { records: all } = loadRecords();
    expect(all.filter((r: { ownerApproval: { purpose: boolean; topics: boolean } | null }) => r.ownerApproval?.purpose && r.ownerApproval.topics)).toHaveLength(114);
    // Owner approval is not a scholarly decision: the topics stay pending review.
    expect(all.every((r: { inAppStatus: string }) => r.inAppStatus === 'pending-review')).toBe(true);
  });
});
