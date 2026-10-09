import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { auditEntryDeadline, isDue, parseTimestamp } from '../retention/retentionPolicy';
import { NO_HOLDS, type HoldChecker } from '../retention/preservationHolds';
import type { AuthProvider } from '../types/accountDomain';
import { assertOutsideRepository, FileLock, writeFileAtomic } from './localFiles';

/**
 * Minimal audit trail for admin deletions: one JSON line per action, kept
 * outside the repository for AUDIT_RETENTION_YEARS (3 years). Deliberately
 * has no field for an email, name, token, verification code, IP, device or
 * any content — only the case, the internal user id (meaningless once the
 * account is gone), the provider, outcomes and counts, and for the
 * issue-report retention cleanup a run id and report ids (never a comment
 * or an email). Fields are an
 * allowlist, so a future caller can never add a sensitive one by accident.
 *
 * Retention cleanup (`prune`) is the only operation that rewrites the file,
 * and it never does so silently: dry run by default, it keeps every line it
 * cannot parse or date and every entry of a held case, and it appends an
 * `audit-prune` entry recording how many entries it removed.
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
  | 'issue-reports-deleted'
  | 'cases-pruned'
  | 'audit-entries-pruned'
  | 'issue-reports-purged'
  | 'issue-reports-checked'
  | 'issue-reports-purge-started'
  | 'failed:issue-report-purge';

export type AuditAction = 'delete-account' | 'delete-issue-reports' | 'prune-cases' | 'audit-prune' | 'issue-report-retention';

export type AuditEntry = {
  case?: string;
  at: string;
  environment?: string;
  database?: string;
  action: AuditAction;
  result: AuditResult;
  userId?: string;
  provider?: AuthProvider;
  appleRevocation?: AppleRevocationOutcome;
  deleted?: Record<string, number>;
  /** Issue-report retention: one id per cleanup run, linking its started and finished entries. */
  run?: string;
  /** Issue-report retention: ids of the reports a run is about to delete (started) or could not delete (failed). Never content. */
  reportIds?: string[];
};

const ALLOWED_KEYS: readonly (keyof AuditEntry)[] = ['case', 'at', 'environment', 'database', 'action', 'result', 'userId', 'provider', 'appleRevocation', 'deleted', 'run', 'reportIds'];

export type AuditPruneReport = {
  mode: 'dry-run' | 'apply';
  total: number;
  eligible: number;
  held: number;
  retained: number;
  /** Lines that are not valid JSON or have no valid `at`: always kept. */
  undatable: number;
  removed: number;
  sha256Before: string;
  sha256After?: string;
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export class DeletionAuditLog {
  private readonly lock: FileLock;

  constructor(private readonly path: string, repositoryRoot?: string) {
    assertOutsideRepository(path, 'audit log', repositoryRoot);
    this.lock = new FileLock(path);
  }

  append(entry: AuditEntry): void {
    const safe = Object.fromEntries(ALLOWED_KEYS.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]));
    this.lock.run(() => appendFileSync(this.path, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 }));
  }

  /** Proves, before anything destructive, that the log is unlocked and writable (appends nothing). */
  preflight(): void {
    this.lock.run(() => appendFileSync(this.path, '', { encoding: 'utf8', mode: 0o600 }));
  }

  private rawText(): string {
    return existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';
  }

  entries(): AuditEntry[] {
    return this.rawText()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /** Every account this log records as deleted — re-check these after restoring any backup. */
  deletedUserIds(): { userId: string; case: string }[] {
    const seen = new Map<string, string>();
    for (const entry of this.entries()) {
      if ((entry.result === 'deleted' || entry.result === 'deleted-again') && entry.userId && entry.case) seen.set(entry.userId, entry.case);
    }
    return [...seen].map(([userId, caseId]) => ({ userId, case: caseId }));
  }

  /**
   * Removes entries whose 3-year retention has ended (now >= at + 3 years).
   * Keeps undatable lines and every entry of a case under an active hold.
   * The file is re-read and compared under the lock immediately before the
   * atomic rewrite, so a concurrent append is never lost.
   */
  prune(now: Date, options: { apply: boolean; holds?: HoldChecker; expectedCount?: number }): AuditPruneReport {
    const holds = options.holds ?? NO_HOLDS;
    return this.lock.run(() => {
      const before = this.rawText();
      const lines = before.split('\n').filter((line) => line.trim());
      const report: AuditPruneReport = {
        mode: options.apply ? 'apply' : 'dry-run',
        total: lines.length,
        eligible: 0,
        held: 0,
        retained: 0,
        undatable: 0,
        removed: 0,
        sha256Before: sha256(before),
      };

      const kept: string[] = [];
      for (const line of lines) {
        let entry: AuditEntry | null = null;
        try { entry = JSON.parse(line) as AuditEntry; } catch { entry = null; }
        const at = entry ? parseTimestamp(entry.at) : null;
        if (!entry || !at) {
          report.undatable++;
          kept.push(line);
        } else if (!isDue(auditEntryDeadline(at), now)) {
          report.retained++;
          kept.push(line);
        } else if (entry.case && holds.isHeld('deletion-case', entry.case, now)) {
          report.held++;
          kept.push(line);
        } else {
          report.eligible++;
        }
      }

      if (options.apply && options.expectedCount !== undefined && report.eligible !== options.expectedCount) {
        throw new Error(`The number of eligible audit entries changed (${report.eligible}, confirmed ${options.expectedCount}). Nothing was removed; run the dry run again.`);
      }
      if (options.apply && report.eligible > 0) {
        if (this.rawText() !== before) throw new Error('The audit log changed during pruning; nothing was removed. Retry.');
        const marker: AuditEntry = { at: now.toISOString(), action: 'audit-prune', result: 'audit-entries-pruned', deleted: { AuditEntry: report.eligible } };
        const next = `${[...kept, JSON.stringify(marker)].join('\n')}\n`;
        writeFileAtomic(this.path, next);
        report.removed = report.eligible;
        report.sha256After = sha256(next);
      }
      return report;
    });
  }
}
