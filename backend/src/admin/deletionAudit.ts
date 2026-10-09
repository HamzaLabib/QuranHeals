import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import type { AuthProvider } from '../types/accountDomain';
import { assertOutsideRepository } from './localFiles';

/**
 * Minimal audit trail for admin deletions: one JSON line per action, kept
 * outside the repository. Deliberately has no field for an email, name,
 * token, verification code, or any content — only the case, the internal
 * user id (meaningless once the account is gone), and counts. It is also
 * the deletion register used after a backup restore (restore-check).
 */
export type AppleRevocationOutcome = 'revoked' | 'no-token-acknowledged' | 'not-applicable';

export type AuditResult =
  | 'deleted'
  | 'deleted-again'
  | 'not-found'
  | 'failed:apple-credential'
  | 'failed:apple-revocation'
  | 'failed:delete'
  | 'failed:verify'
  | 'issue-reports-deleted';

export type AuditEntry = {
  case: string;
  at: string;
  environment: string;
  database: string;
  action: 'delete-account' | 'delete-issue-reports';
  result: AuditResult;
  userId?: string;
  provider?: AuthProvider;
  appleRevocation?: AppleRevocationOutcome;
  deleted?: Record<string, number>;
};

const ALLOWED_KEYS: readonly (keyof AuditEntry)[] = ['case', 'at', 'environment', 'database', 'action', 'result', 'userId', 'provider', 'appleRevocation', 'deleted'];

export class DeletionAuditLog {
  constructor(private readonly path: string, repositoryRoot?: string) {
    assertOutsideRepository(path, 'audit log', repositoryRoot);
  }

  append(entry: AuditEntry): void {
    // Whitelist, so a future caller can never add a sensitive field by accident.
    const safe = Object.fromEntries(ALLOWED_KEYS.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]));
    appendFileSync(this.path, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  entries(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /** Every account this log records as deleted — re-check these after restoring any backup. */
  deletedUserIds(): { userId: string; case: string }[] {
    const seen = new Map<string, string>();
    for (const entry of this.entries()) {
      if ((entry.result === 'deleted' || entry.result === 'deleted-again') && entry.userId) seen.set(entry.userId, entry.case);
    }
    return [...seen].map(([userId, caseId]) => ({ userId, case: caseId }));
  }
}
