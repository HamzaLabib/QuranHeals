import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), find: vi.fn(), updateOne: vi.fn(),
  backup: vi.fn(), endSession: vi.fn(), withTransaction: vi.fn() }));
vi.mock('mongoose', () => ({ default: { connect: mock.connect, disconnect: mock.disconnect,
  startSession: async () => ({ withTransaction: mock.withTransaction, endSession: mock.endSession }) } }));
vi.mock('../../src/config/env', () => ({ env: { MONGODB_URI: 'mock-only' } }));
vi.mock('../../src/models/EmotionVerseMapping', () => ({ EmotionVerseMappingModel: { find: mock.find, updateOne: mock.updateOne } }));
vi.mock('../../src/utils/backupFile', () => ({ writeVerifiedJsonBackup: mock.backup }));
import { runRemoval } from '../../src/scripts/deactivateEmotionMapping';
const args = ['--verse', '2:222', '--emotion', 'seeking_guidance'];
const writeArgs = [...args, '--apply', '--confirm', 'deactivate:2:222:seeking_guidance', '--backup', 'mock-backup.json'];
const doc = { _id: 'id', verseReferenceKey: '2:222', emotionKey: 'seeking_guidance', status: 'approved' };
function query(documents: unknown[]) { const q = { session: vi.fn(() => q), lean: vi.fn(async () => documents) }; return q; }
beforeEach(() => {
  vi.resetAllMocks();
  mock.withTransaction.mockImplementation(async (fn: () => Promise<void>) => fn());
  mock.find.mockImplementation(() => query([doc]));
  mock.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});
describe('Deactivation database boundary (mocked; never connects)', () => {
  it('dry-run reads only the exact target and never writes', async () => {
    expect(await runRemoval(args)).toMatchObject({ mode: 'dry-run', changed: false, wouldChange: true });
    expect(mock.find).toHaveBeenCalledExactlyOnceWith({ verseReferenceKey: '2:222', emotionKey: 'seeking_guidance' });
    expect(mock.updateOne).not.toHaveBeenCalled(); expect(mock.backup).not.toHaveBeenCalled();
    expect(mock.disconnect).toHaveBeenCalled();
  });
  it('backs up then changes only the exact identity, document and prior status inside a transaction', async () => {
    mock.find.mockReturnValueOnce(query([doc])).mockReturnValueOnce(query([{ ...doc, status: 'rejected' }]));
    expect(await runRemoval(writeArgs)).toMatchObject({ changed: true, before: 'approved', after: 'rejected' });
    expect(mock.updateOne).toHaveBeenCalledWith({ verseReferenceKey: '2:222', emotionKey: 'seeking_guidance', _id: 'id', status: 'approved' },
      { $set: { status: 'rejected' } }, expect.objectContaining({ session: expect.any(Object), runValidators: true }));
    expect(mock.backup.mock.invocationCallOrder[0]).toBeLessThan(mock.updateOne.mock.invocationCallOrder[0]);
    expect(mock.withTransaction).toHaveBeenCalledOnce(); expect(mock.endSession).toHaveBeenCalled();
  });
  it('backup failure prevents the write', async () => {
    mock.backup.mockImplementation(() => { throw new Error('backup failed'); });
    await expect(runRemoval(writeArgs)).rejects.toThrow('backup failed');
    expect(mock.updateOne).not.toHaveBeenCalled(); expect(mock.endSession).toHaveBeenCalled();
  });
  it('an already rejected pair causes no backup or write', async () => {
    mock.find.mockReturnValue(query([{ ...doc, status: 'rejected' }]));
    expect(await runRemoval(writeArgs)).toMatchObject({ changed: false });
    expect(mock.updateOne).not.toHaveBeenCalled(); expect(mock.backup).not.toHaveBeenCalled();
  });
  it('missing confirmation fails before connection', async () => {
    await expect(runRemoval([...args, '--apply'])).rejects.toThrow(); expect(mock.connect).not.toHaveBeenCalled();
  });
  it('a stale update aborts instead of reporting success', async () => {
    mock.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(runRemoval(writeArgs)).rejects.toThrow(); expect(mock.endSession).toHaveBeenCalled();
  });
});
