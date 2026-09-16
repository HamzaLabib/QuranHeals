import type { IssueReportInput } from '../types/accountDto';

export interface IssueReportRepository {
  /** Persists exactly the validated fields on IssueReportInput — never a reflection field, even if present on the raw request body. See Part I §38/§40. */
  create(input: IssueReportInput): Promise<{ id: string }>;
}
