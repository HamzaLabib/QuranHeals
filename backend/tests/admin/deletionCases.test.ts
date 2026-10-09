import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { CODE_TTL_MS, DeletionCaseStore, MAX_ATTEMPTS, generateVerificationCode, type DeletionCase } from '../../src/admin/deletionCases';
import { FileLockError } from '../../src/admin/localFiles';
import { PreservationHoldStore } from '../../src/retention/preservationHolds';
import { DAY_MS } from '../../src/retention/retentionPolicy';
import { ALICE_APPLE_ID, ALICE_EMAIL, ALICE_ID, RELAY_EMAIL, tempDir } from './adminFakes';

const T0 = Date.parse('2026-10-08T12:00:00.000Z');
const ALICE = { userId: ALICE_ID, provider: 'google' as const, email: ALICE_EMAIL };
const APPLE = { userId: ALICE_APPLE_ID, provider: 'apple' as const, email: RELAY_EMAIL };

let dir: string;
let path: string;
let cases: DeletionCaseStore;

beforeEach(() => {
  dir = tempDir();
  path = join(dir, 'cases.json');
  cases = new DeletionCaseStore(path);
});

const create = (caseId: string, account: typeof ALICE | typeof APPLE = ALICE, at = T0) => cases.create({ caseId, ...account }, at);

describe('code generation and storage', () => {
  it('generates unambiguous 12-symbol codes from the CSPRNG, never the same twice', () => {
    const codes = new Set(Array.from({ length: 500 }, generateVerificationCode));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/);
  });

  it('stores neither the code nor the email in readable form', () => {
    const code = create('DEL-20261008-01');
    const file = readFileSync(path, 'utf8');
    expect(file).not.toContain(code);
    expect(file).not.toContain(code.replace(/-/g, ''));
    expect(file.toLowerCase()).not.toContain(ALICE_EMAIL.toLowerCase());
  });

  it('refuses a duplicate or malformed case ID', () => {
    create('DEL-20261008-01');
    expect(() => create('DEL-20261008-01')).toThrow(/already exists/);
    expect(() => create('case-1')).toThrow(/DEL-YYYYMMDD-NN/);
  });
});

describe('15-minute expiry', () => {
  it('is valid until one millisecond before 15 minutes, and expired at exactly 15 minutes', () => {
    expect(CODE_TTL_MS).toBe(15 * 60 * 1000);
    const codeA = create('DEL-20261008-01');
    expect(cases.verify('DEL-20261008-01', codeA, T0 + CODE_TTL_MS - 1).status).toBe('verified');
    const codeB = create('DEL-20261008-02', APPLE);
    expect(() => cases.verify('DEL-20261008-02', codeB, T0 + CODE_TTL_MS)).toThrow(/expired/);
    expect(cases.get('DEL-20261008-02')!.status).toBe('pending');
  });

  it('a stored expiry can never extend a code beyond 15 minutes from issue', () => {
    const code = create('DEL-20261008-01');
    const file = JSON.parse(readFileSync(path, 'utf8'));
    file.cases['DEL-20261008-01'].expiresAt = new Date(T0 + 14 * DAY_MS).toISOString();
    writeFileSync(path, JSON.stringify(file));
    expect(() => cases.verify('DEL-20261008-01', code, T0 + CODE_TTL_MS + 1)).toThrow(/expired/);
  });
});

describe('single use, lockout and supersession', () => {
  it('accepts the code once, ignoring case, spaces and hyphens, then refuses reuse', () => {
    const code = create('DEL-20261008-01');
    expect(cases.verify('DEL-20261008-01', ` ${code.replace(/-/g, ' ').toLowerCase()} `, T0 + 1000).status).toBe('verified');
    expect(() => cases.verify('DEL-20261008-01', code, T0 + 2000)).toThrow(/already used/);
  });

  it(`locks after ${MAX_ATTEMPTS} wrong codes, even if the right code comes next`, () => {
    const code = create('DEL-20261008-01');
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(() => cases.verify('DEL-20261008-01', 'AAAA-AAAA-AAAA', T0 + i)).toThrow(/attempts left/);
    expect(() => cases.verify('DEL-20261008-01', 'AAAA-AAAA-AAAA', T0 + 10)).toThrow(/now locked/);
    expect(() => cases.verify('DEL-20261008-01', code, T0 + 11)).toThrow(/locked/);
    expect(cases.get('DEL-20261008-01')).toMatchObject({ status: 'locked', attempts: MAX_ATTEMPTS });
  });

  it('a new code for the same account invalidates every earlier pending code; other accounts are unaffected', () => {
    const first = create('DEL-20261008-01');
    const other = create('DEL-20261008-02', APPLE);
    const second = create('DEL-20261008-03', ALICE, T0 + 60_000);
    expect(() => cases.verify('DEL-20261008-01', first, T0 + 61_000)).toThrow(/newer code/);
    expect(cases.get('DEL-20261008-01')!.status).toBe('superseded');
    expect(cases.verify('DEL-20261008-02', other, T0 + 61_000).status).toBe('verified');
    expect(cases.verify('DEL-20261008-03', second, T0 + 61_000).status).toBe('verified');
  });

  it('a code from one case never verifies another case', () => {
    const codeA = create('DEL-20261008-01');
    create('DEL-20261008-02', APPLE);
    expect(() => cases.verify('DEL-20261008-02', codeA, T0 + 1000)).toThrow(/Wrong code/);
  });
});

describe('binding to the exact account', () => {
  it('records the user id and provider, and matches only the stored email', () => {
    create('DEL-20261008-01');
    const entry = cases.get('DEL-20261008-01')!;
    expect(entry).toMatchObject({ userId: ALICE_ID, provider: 'google' });
    expect(cases.matchesEmail(entry, `  ${ALICE_EMAIL.toUpperCase()} `)).toBe(true);
    expect(cases.matchesEmail(entry, 'someone.else@example.invalid')).toBe(false);
  });

  it('only a verified, not-yet-completed case authorizes; completion is final', () => {
    const code = create('DEL-20261008-01');
    expect(() => cases.assertAuthorizes('DEL-20261008-01')).toThrow(/pending/);
    cases.verify('DEL-20261008-01', code, T0 + 1000);
    expect(cases.assertAuthorizes('DEL-20261008-01').status).toBe('verified');
    cases.markCompleted('DEL-20261008-01', T0 + 2000);
    expect(() => cases.assertAuthorizes('DEL-20261008-01')).toThrow(/already completed/);
  });
});

describe('concurrency and replay', () => {
  it('a second process cannot verify while the store is locked', async () => {
    const code = create('DEL-20261008-01');
    const otherProcess = new DeletionCaseStore(path);
    let inside!: () => void;
    const holding = new Promise<void>((r) => { inside = r; });
    let release!: () => void;
    const done = cases.exclusive(async () => { inside(); await new Promise<void>((r) => { release = r; }); });
    await holding;
    expect(() => otherProcess.verify('DEL-20261008-01', code, T0 + 1000)).toThrow(FileLockError);
    release();
    await done;
    expect(otherProcess.verify('DEL-20261008-01', code, T0 + 1000).status).toBe('verified');
  });

  it('two sequential verifications with the right code: exactly one succeeds', () => {
    const code = create('DEL-20261008-01');
    const a = new DeletionCaseStore(path);
    const b = new DeletionCaseStore(path);
    const results = [a, b].map((store) => { try { store.verify('DEL-20261008-01', code, T0 + 1000); return 'ok'; } catch { return 'refused'; } });
    expect(results.sort()).toEqual(['ok', 'refused']);
  });

  it('a leftover lock file is never silently removed', () => {
    create('DEL-20261008-01');
    writeFileSync(`${path}.lock`, 'crashed run');
    expect(() => cases.get('DEL-20261008-01')).toThrow(/delete the \.lock file/);
  });
});

describe('case retention (prune)', () => {
  function seed(): void {
    // pending, active (unexpired)
    create('DEL-20261008-01', ALICE, T0);
    // completed at T0
    const codeB = create('DEL-20261008-02', APPLE, T0);
    cases.verify('DEL-20261008-02', codeB, T0 + 1000);
    cases.markCompleted('DEL-20261008-02', T0);
  }
  const expiry = T0 + CODE_TTL_MS;

  it('never removes an active, unexpired case', () => {
    seed();
    const report = cases.prune(new Date(T0 + 60_000), { apply: true });
    expect(report.removed).toBe(0);
    expect(cases.get('DEL-20261008-01')).not.toBeNull();
  });

  it('expired cases are kept until exactly 30 days after the code expired', () => {
    create('DEL-20261008-01', ALICE, T0);
    expect(cases.prune(new Date(expiry + 30 * DAY_MS - 1), { apply: true }).removed).toBe(0);
    const report = cases.prune(new Date(expiry + 30 * DAY_MS), { apply: true });
    expect(report.eligible['expired-or-locked']).toBe(1);
    expect(report.removed).toBe(1);
    expect(cases.get('DEL-20261008-01')).toBeNull();
  });

  it('locked and superseded cases follow the same 30-days-after-expiry rule', () => {
    create('DEL-20261008-01', ALICE, T0);
    create('DEL-20261008-02', ALICE, T0); // supersedes 01
    for (let i = 0; i < MAX_ATTEMPTS; i++) { try { cases.verify('DEL-20261008-02', 'AAAA-AAAA-AAAA', T0 + i); } catch { /* wrong code */ } }
    expect(cases.get('DEL-20261008-02')!.status).toBe('locked');
    const report = cases.prune(new Date(expiry + 30 * DAY_MS), { apply: false });
    expect(report.eligible).toMatchObject({ superseded: 1, 'expired-or-locked': 1 });
  });

  it('completed cases are kept until exactly 60 days after completion', () => {
    seed();
    expect(cases.prune(new Date(T0 + 60 * DAY_MS - 1), { apply: false }).eligible.completed).toBe(0);
    const report = cases.prune(new Date(T0 + 60 * DAY_MS), { apply: true });
    expect(report.eligible.completed).toBe(1);
    expect(cases.get('DEL-20261008-02')).toBeNull();
  });

  it('a dry run changes nothing', () => {
    seed();
    const before = readFileSync(path, 'utf8');
    const report = cases.prune(new Date(T0 + 365 * DAY_MS), { apply: false });
    expect(DeletionCaseStore.eligibleCount(report)).toBe(2);
    expect(report.removed).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('repeated runs are safe', () => {
    seed();
    const at = new Date(T0 + 365 * DAY_MS);
    expect(cases.prune(at, { apply: true }).removed).toBe(2);
    expect(cases.prune(at, { apply: true }).removed).toBe(0);
  });

  it('refuses to apply when the eligible count changed after confirmation', () => {
    seed();
    expect(() => cases.prune(new Date(T0 + 365 * DAY_MS), { apply: true, expectedCount: 1 })).toThrow(/changed/);
    expect(cases.get('DEL-20261008-02')).not.toBeNull();
  });

  it('keeps a case under an active preservation hold, then prunes it once the hold expires', () => {
    seed();
    const holds = new PreservationHoldStore(join(dir, 'holds.json'));
    const at = new Date(T0 + 90 * DAY_MS);
    holds.place({ kind: 'deletion-case', ref: 'DEL-20261008-02', reason: 'dispute', reviewBy: new Date(at.getTime() + 10 * DAY_MS) }, at);
    const held = cases.prune(at, { apply: true, holds });
    expect(held.held).toBe(1);
    expect(cases.get('DEL-20261008-02')).not.toBeNull();
    expect(cases.prune(new Date(at.getTime() + 10 * DAY_MS), { apply: true, holds }).removed).toBe(1);
  });

  it('never removes a case it cannot date', () => {
    create('DEL-20261008-01', ALICE, T0);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { cases: Record<string, DeletionCase> };
    file.cases['DEL-20261008-01'].expiresAt = 'not a date';
    writeFileSync(path, JSON.stringify({ formatVersion: 1, ...file }));
    const report = cases.prune(new Date(T0 + 1000 * DAY_MS), { apply: true });
    expect(report).toMatchObject({ undatable: 1, removed: 0 });
  });
});
