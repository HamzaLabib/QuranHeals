import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AdminAccount, AdminAccountStore, RecordCounts } from '../../src/admin/adminAccountDeletion';
import type { TerminalIO } from '../../src/admin/prompt';
import type { AuthProvider } from '../../src/types/accountDomain';

export const ALICE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const ALICE_APPLE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
export const BOB_ID = 'cccccccccccccccccccccccc';
export const ALICE_EMAIL = 'Alice.Synthetic@example.invalid';
export const RELAY_EMAIL = 'x7k2abc9qz@privaterelay.appleid.com';

type Records = Omit<RecordCounts, 'User' | 'tombstones'> & { favoriteTombstones: number; reflectionTombstones: number };

const fullRecords = (): Records => ({
  Session: 2, UserFavorite: 3, UserPreference: 1, UserReflection: 4, UserSyncKey: 1, AppleCredential: 0,
  favoriteTombstones: 1, reflectionTombstones: 1,
});

/** Synthetic accounts only. Mirrors MongooseAdminAccountStore's contract in memory. */
export class InMemoryAdminStore implements AdminAccountStore {
  readonly accounts = new Map<string, AdminAccount>();
  readonly records = new Map<string, Records>();
  readonly issueReports: { email?: string }[] = [];

  add(account: AdminAccount, records: Partial<Records> = {}): void {
    this.accounts.set(account.userId, account);
    this.records.set(account.userId, { ...fullRecords(), ...records });
  }

  async findAccountsByEmail(email: string, provider?: AuthProvider): Promise<AdminAccount[]> {
    return [...this.accounts.values()].filter((a) => a.email?.toLowerCase() === email && (!provider || a.provider === provider));
  }

  async findAccountById(userId: string): Promise<AdminAccount | null> {
    return this.accounts.get(userId) ?? null;
  }

  async countRecords(userId: string): Promise<RecordCounts> {
    const r = this.records.get(userId);
    const exists = this.accounts.has(userId) ? 1 : 0;
    return {
      User: exists,
      Session: r?.Session ?? 0,
      UserFavorite: r?.UserFavorite ?? 0,
      UserPreference: r?.UserPreference ?? 0,
      UserReflection: r?.UserReflection ?? 0,
      UserSyncKey: r?.UserSyncKey ?? 0,
      AppleCredential: r?.AppleCredential ?? 0,
      tombstones: { UserFavorite: r?.favoriteTombstones ?? 0, UserReflection: r?.reflectionTombstones ?? 0 },
    };
  }

  async countIssueReportsByEmail(email: string): Promise<number> {
    return this.issueReports.filter((r) => r.email === email).length;
  }

  async deleteIssueReportsByEmail(email: string): Promise<number> {
    const before = this.issueReports.length;
    for (let i = this.issueReports.length - 1; i >= 0; i--) if (this.issueReports[i].email === email) this.issueReports.splice(i, 1);
    return before - this.issueReports.length;
  }
}

/**
 * Stands in for MongooseAccountDeletionService: all-or-nothing, like its
 * transaction. `fail` simulates a database error (nothing is removed);
 * `leaveBehind` simulates a bug that leaves records (to exercise verify).
 */
export class FakeDeletionService {
  readonly calls: string[] = [];
  fail = false;
  leaveBehind = false;

  constructor(private readonly store: InMemoryAdminStore) {}

  async deleteAccount(userId: string): Promise<void> {
    this.calls.push(userId);
    if (this.fail) throw new Error('MongoServerError: Transaction aborted (synthetic) mongodb+srv://user:pw@cluster.example.net');
    if (this.leaveBehind) {
      this.store.records.get(userId)!.Session = 1;
      this.store.accounts.delete(userId);
      return;
    }
    this.store.accounts.delete(userId);
    this.store.records.delete(userId);
  }
}

/** A fresh directory outside the repository for case stores and audit logs. */
export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'qh-admin-delete-'));
}

/**
 * A scripted terminal: each `resume()` (one per prompt) delivers the next
 * scripted keystrokes. `written` captures everything echoed or printed.
 */
export class FakeTerminal {
  written = '';
  readonly rawModes: boolean[] = [];
  readonly input: TerminalIO['input'];
  readonly output: TerminalIO['output'];

  constructor(keystrokes: string[], options: { tty?: boolean; outputTty?: boolean } = {}) {
    const tty = options.tty ?? true;
    const emitter = new EventEmitter();
    const queue = [...keystrokes];
    this.input = Object.assign(emitter, {
      isTTY: tty,
      setRawMode: tty ? (mode: boolean) => { this.rawModes.push(mode); } : undefined,
      resume: () => {
        const next = queue.shift();
        if (next !== undefined) setImmediate(() => emitter.emit('data', Buffer.from(next, 'utf8')));
        else setImmediate(() => emitter.emit('end'));
      },
      pause: () => undefined,
    }) as unknown as TerminalIO['input'];
    this.output = { isTTY: options.outputTty ?? tty, write: (text: string) => { this.written += text; return true; } };
  }

  get io(): TerminalIO {
    return { input: this.input, output: this.output };
  }
}

/** One typed line, ended with Enter. */
export const typed = (text: string) => `${text}\r`;
