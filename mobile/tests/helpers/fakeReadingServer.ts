import type { CloudReadingRecord, ReadingChange, ReadingChangeResult } from '@/sync/syncApi';

/**
 * A stand-in for the backend's أورادي وختماتي sync (backend/src/services/readingSync.ts,
 * which has its own tests, including on a real MongoDB): account-based, the same rules —
 * compare-and-swap updates, permanent deletion markers, one confirmed Khatma
 * per cycle, a change feed numbered per account, and a `syncId` that changes
 * when the stored records are replaced. Accounts are told apart only by the
 * bearer token, as on the server.
 */
type Account = { seq: number; syncId: string; records: Map<string, CloudReadingRecord> };

export class FakeReadingServer {
  readonly accounts = new Map<string, Account>();
  /** Every request, for assertions: [account, method, kinds/ids]. */
  readonly log: { account: string; method: 'GET' | 'POST'; changes?: ReadingChange[] }[] = [];
  /** Set to make the next push apply on the server but lose its response (a dropped connection). */
  loseNextPushResponse = false;
  private syncIds = 0;

  constructor(private readonly accountForToken: (token: string) => string | null) {}

  private account(name: string): Account {
    let account = this.accounts.get(name);
    if (!account) {
      account = { seq: 0, syncId: `sync-${++this.syncIds}`, records: new Map() };
      this.accounts.set(name, account);
    }
    return account;
  }

  /** What the account holds: active records by kind. */
  active(name: string, kind: CloudReadingRecord['kind']) {
    return [...(this.accounts.get(name)?.records.values() ?? [])].filter((r) => r.kind === kind && !r.deleted);
  }

  record(name: string, kind: string, id: string) {
    return this.accounts.get(name)?.records.get(`${kind}:${id}`);
  }

  /** The account's stored records replaced (e.g. restored from a backup): content gone, deletion markers kept, new syncId. */
  replaceStoredRecords(name: string) {
    const account = this.account(name);
    for (const [key, record] of account.records) if (!record.deleted) account.records.delete(key);
    account.syncId = `sync-${++this.syncIds}`;
  }

  /** The fetch implementation for /api/sync/reading. */
  handle = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const name = this.accountForToken(String((init.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', ''));
    if (!name) return json(401, { success: false, message: 'Sign in required.' });
    const method = (init.method ?? 'GET') as 'GET' | 'POST';
    const account = this.account(name);
    if (method === 'GET') {
      this.log.push({ account: name, method });
      const params = new URL(url).searchParams;
      const since = Number(params.get('since') ?? 0);
      const limit = Number(params.get('limit') ?? 200);
      const changed = [...account.records.values()].filter((r) => r.changeSeq > since).sort((a, b) => a.changeSeq - b.changeSeq);
      const page = changed.slice(0, limit).map((r) => structuredClone(r));
      const existed = account.seq > 0 || account.records.size > 0;
      return json(200, { success: true, data: { syncId: existed ? account.syncId : null, records: page, nextSince: page.at(-1)?.changeSeq ?? since, hasMore: changed.length > limit } });
    }
    const { changes } = JSON.parse(String(init.body)) as { changes: ReadingChange[] };
    this.log.push({ account: name, method, changes });
    const results: ReadingChangeResult[] = changes.map((change) => this.apply(account, change));
    if (this.loseNextPushResponse) {
      this.loseNextPushResponse = false;
      throw new TypeError('Network request failed');
    }
    return json(200, { success: true, data: { syncId: account.syncId, results } });
  };

  private apply(account: Account, change: ReadingChange): ReadingChangeResult {
    const key = `${change.kind}:${change.recordId}`;
    const existing = account.records.get(key);
    const result = (status: ReadingChangeResult['status'], record?: CloudReadingRecord): ReadingChangeResult =>
      ({ kind: change.kind, recordId: change.recordId, status, ...(record ? { record: structuredClone(record) } : {}) });
    const write = (fields: Partial<CloudReadingRecord>) => {
      account.seq += 1;
      const saved: CloudReadingRecord = { kind: change.kind, recordId: change.recordId, revision: (existing?.revision ?? 0) + 1, changeSeq: account.seq, deleted: false, ...fields };
      account.records.set(key, saved);
      return result('applied', saved);
    };
    if (change.action === 'delete') return existing?.deleted ? result('applied', existing) : write({ deleted: true });
    if (existing?.deleted) return result('deleted', existing);
    if (change.kind === 'khatma') {
      if (existing) return result('applied', existing);
      const sameCycle = [...account.records.values()].find((r) => r.kind === 'khatma' && !r.deleted && (r.data as { cycleId?: string } | undefined)?.cycleId === change.data.cycleId);
      if (sameCycle) return result('duplicate', sameCycle);
      return write({ data: structuredClone(change.data) });
    }
    if (existing && change.baseRevision !== existing.revision) return result('conflict', existing);
    return write({ data: structuredClone(change.data) });
  }
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
