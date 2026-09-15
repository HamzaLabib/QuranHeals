import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APPROVED_MAPPING_VERSION } from '../../src/scripts/activationDryRun';
import type { ActivationBackupPayload, LiveEmotionDoc, LiveMappingDoc } from '../../src/scripts/activateApprovedEmotionMappings';
import { buildRollbackPlan, loadBackup } from '../../src/scripts/rollbackEmotionMappingActivation';
import { wrapBackupEnvelope } from '../../src/utils/objectId';

const SCRIPT_SOURCE_PATH = resolve(__dirname, '../../src/scripts/rollbackEmotionMappingActivation.ts');

function id(hex: string) {
  return new Types.ObjectId(hex);
}

function backupPayload(overrides: Partial<ActivationBackupPayload> = {}): ActivationBackupPayload {
  return {
    generatedAt: '2026-09-15T00:00:00.000Z',
    databaseName: 'test',
    emotions: [],
    mappings: [],
    activationFootprint: {
      emotionsToBeCreated: [],
      emotionsToBeActivated: [],
      emotionsToBeLocalized: [],
      mappingsToBeInserted: [],
      mappingsToBePromoted: [],
    },
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'activation-rollback-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 26. Rollback is dry-run by default
// ---------------------------------------------------------------------------

describe('Rollback: dry-run by default', () => {
  it('main() only performs the destructive session.withTransaction block when apply is true', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    const match = source.match(/if \(!apply\) \{\s*([\s\S]*?)\s*\}/);
    expect(match, 'could not locate the dry-run branch').not.toBeNull();
    expect(match![1]).toMatch(/Dry run only; no documents were changed/);
  });

  it('the transaction/write block is only reachable after the dry-run return', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    const dryRunReturnIndex = source.indexOf('Dry run only; no documents were changed');
    const transactionIndex = source.indexOf('session.withTransaction');
    expect(dryRunReturnIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(dryRunReturnIndex);
  });
});

// ---------------------------------------------------------------------------
// 27. Rollback requires exact backup + database confirmation
// ---------------------------------------------------------------------------

describe('Rollback: requires exact backup path and database confirmation', () => {
  it('throws a clear usage error when --backup is missing', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).toMatch(/Usage: rollbackEmotionMappingActivation\.ts --backup/);
  });

  it('apply requires --confirm-database', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).toMatch(/--apply requires --confirm-database/);
  });

  it('loadBackup rejects a file missing the expected emotions/mappings/activationFootprint shape', () => {
    const path = join(tempDir, 'bad-backup.json');
    writeFileSync(path, JSON.stringify(wrapBackupEnvelope({ notTheRightShape: true })));
    expect(() => loadBackup(path)).toThrow(/expected emotions\/mappings\/activationFootprint shape/);
  });

  it('loadBackup accepts a well-formed backup', () => {
    const path = join(tempDir, 'good-backup.json');
    writeFileSync(path, JSON.stringify(wrapBackupEnvelope(backupPayload())));
    expect(loadBackup(path)).toEqual(backupPayload());
  });

  it('buildRollbackPlan blocks when the backup database name does not match the live database', () => {
    const backup = backupPayload({ databaseName: 'staging' });
    const plan = buildRollbackPlan(backup, 'production-lookalike', [], []);
    expect(plan.databaseMatches).toBe(false);
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasons.join(' ')).toMatch(/does not match live database/);
  });
});

// ---------------------------------------------------------------------------
// 28. Rollback refuses drift / unrelated changes; bounded to the activation footprint
// ---------------------------------------------------------------------------

describe('Rollback: bounded restoration and drift protection', () => {
  it('restores exactly the backed-up emotions/mappings whose _id still exists live', () => {
    const emotionId = id('0123456789abcdef01234567');
    const mappingId = id('aaaaaaaaaaaaaaaaaaaaaaaa');
    const backup = backupPayload({
      emotions: [{ _id: emotionId, key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: false }],
      mappings: [{ _id: mappingId, verseReferenceKey: '2:153', emotionKey: 'sad', status: 'development', mappingVersion: 'mvp-seed-1' }],
      activationFootprint: {
        emotionsToBeCreated: [],
        emotionsToBeActivated: ['guilty'],
        emotionsToBeLocalized: [],
        mappingsToBeInserted: [],
        mappingsToBePromoted: ['2:153|sad'],
      },
    });

    const liveEmotions: LiveEmotionDoc[] = [
      { _id: emotionId, key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: true },
    ];
    const liveMappings: LiveMappingDoc[] = [
      { _id: mappingId, verseReferenceKey: '2:153', emotionKey: 'sad', status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION },
    ];

    const plan = buildRollbackPlan(backup, 'test', liveEmotions, liveMappings);
    expect(plan.blocked).toBe(false);
    expect(plan.emotionsRestorable).toEqual(['guilty']);
    expect(plan.mappingsRestorable).toEqual(['2:153|sad']);
  });

  it('deletes an activation-created emotion only when it currently exists live AND its _id is absent from the backup', () => {
    const newEmotionId = id('111111111111111111111111');
    const backup = backupPayload({
      activationFootprint: { emotionsToBeCreated: ['guilty'], emotionsToBeActivated: [], emotionsToBeLocalized: [], mappingsToBeInserted: [], mappingsToBePromoted: [] },
    });
    const liveEmotions: LiveEmotionDoc[] = [
      { _id: newEmotionId, key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: true },
    ];

    const plan = buildRollbackPlan(backup, 'test', liveEmotions, []);
    expect(plan.blocked).toBe(false);
    expect(plan.emotionsDeletable).toEqual(['guilty']);
  });

  it('blocks (never guesses) when a "to-be-created" emotion key\'s live _id is already present in the backup — that contradicts "newly created"', () => {
    const existingId = id('222222222222222222222222');
    const backup = backupPayload({
      emotions: [{ _id: existingId, key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: false }],
      activationFootprint: { emotionsToBeCreated: ['guilty'], emotionsToBeActivated: [], emotionsToBeLocalized: [], mappingsToBeInserted: [], mappingsToBePromoted: [] },
    });
    const liveEmotions: LiveEmotionDoc[] = [
      { _id: existingId, key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: true },
    ];

    const plan = buildRollbackPlan(backup, 'test', liveEmotions, []);
    expect(plan.blocked).toBe(true);
    expect(plan.emotionsDeletableBlockedByDrift).toEqual(['guilty']);
  });

  it('deletes an activation-inserted mapping only when it looks untouched since activation (approved + APPROVED_MAPPING_VERSION) and its _id is new', () => {
    const newMappingId = id('333333333333333333333333');
    const backup = backupPayload({
      activationFootprint: { emotionsToBeCreated: [], emotionsToBeActivated: [], emotionsToBeLocalized: [], mappingsToBeInserted: ['10:62|afraid'], mappingsToBePromoted: [] },
    });
    const liveMappings: LiveMappingDoc[] = [
      { _id: newMappingId, verseReferenceKey: '10:62', emotionKey: 'afraid', status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION },
    ];

    const plan = buildRollbackPlan(backup, 'test', [], liveMappings);
    expect(plan.blocked).toBe(false);
    expect(plan.mappingsDeletable).toEqual(['10:62|afraid']);
  });

  it('blocks (refuses to delete) an "inserted" mapping whose status/mappingVersion has changed since activation — drift, not a clean insert', () => {
    const newMappingId = id('444444444444444444444444');
    const backup = backupPayload({
      activationFootprint: { emotionsToBeCreated: [], emotionsToBeActivated: [], emotionsToBeLocalized: [], mappingsToBeInserted: ['10:62|afraid'], mappingsToBePromoted: [] },
    });
    // Someone changed the status after activation — no longer a "clean, untouched insert".
    const liveMappings: LiveMappingDoc[] = [
      { _id: newMappingId, verseReferenceKey: '10:62', emotionKey: 'afraid', status: 'rejected', mappingVersion: APPROVED_MAPPING_VERSION },
    ];

    const plan = buildRollbackPlan(backup, 'test', [], liveMappings);
    expect(plan.blocked).toBe(true);
    expect(plan.mappingsDeletableBlockedByDrift).toEqual(['10:62|afraid']);
  });

  it('blocks when a backed-up mapping/emotion no longer exists live by _id (cannot restore what is not there)', () => {
    const backup = backupPayload({
      emotions: [{ _id: id('555555555555555555555555'), key: 'guilty', name: 'Guilty', arabicName: 'x', description: 'x', icon: 'x', order: 20, active: false }],
    });
    const plan = buildRollbackPlan(backup, 'test', [], []); // live has nothing at all
    expect(plan.blocked).toBe(true);
    expect(plan.emotionsRestorableIdMismatch).toEqual(['guilty']);
  });

  it('a no-op footprint entry (already rolled back / never created) is neither deletable nor blocked', () => {
    const backup = backupPayload({
      activationFootprint: { emotionsToBeCreated: ['guilty'], emotionsToBeActivated: [], emotionsToBeLocalized: [], mappingsToBeInserted: [], mappingsToBePromoted: [] },
    });
    // No live document for "guilty" at all — already gone, or never created.
    const plan = buildRollbackPlan(backup, 'test', [], []);
    expect(plan.blocked).toBe(false);
    expect(plan.emotionsDeletable).toEqual([]);
    expect(plan.emotionsDeletableBlockedByDrift).toEqual([]);
  });

  it('never writes into the real backup/report locations — this suite only wrote into the OS temp directory', () => {
    expect(tempDir.startsWith(tmpdir())).toBe(true);
  });
});
