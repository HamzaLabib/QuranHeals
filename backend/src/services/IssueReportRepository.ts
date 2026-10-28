import type { IssueReportInput } from '../types/accountDto';

export interface IssueReportRepository {
  /** Persists exactly the validated fields on IssueReportInput — never a reflection field, even if present on the raw request body. See Part I §38/§40. */
  create(input: IssueReportInput): Promise<{ id: string }>;
  /** Reports stored since `since` (any type). Optional: without it the daily cap (ISSUE_REPORTS_DAILY_CAP) isn't applied. */
  countSince?(since: Date): Promise<number>;
}
