/**
 * Issue-report email notification settings, validated once at startup
 * (server.ts). Like config/authConfig.ts, problems name variables only —
 * never a value or key — and an enabled-but-incomplete configuration stops
 * startup instead of silently queuing email that can never be sent.
 *
 * The recipient is backend configuration only (default
 * quranheals.support@gmail.com); no request can choose it.
 */

export const DEFAULT_ISSUE_REPORT_EMAIL_TO = 'quranheals.support@gmail.com';

export type IssueReportEmailConfigInput = {
  ISSUE_REPORT_EMAIL: 'off' | 'log' | 'resend';
  RESEND_API_KEY?: string;
  ISSUE_REPORT_EMAIL_FROM?: string;
  ISSUE_REPORT_EMAIL_TO?: string;
};

export type IssueReportEmailConfig =
  | { mode: 'off' }
  | { mode: 'log'; from: string; to: string }
  | { mode: 'resend'; apiKey: string; from: string; to: string };

export class IssueReportEmailConfigError extends Error {}

const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// A sender is `address` or `Display Name <address>`; the name may not contain quotes, angle brackets or commas.
const SENDER = /^(?:[^"<>,\u0000-\u001F\u007F]{1,64} )?<([^<>\s]+)>$|^([^<>\s]+)$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

function isValidSender(value: string): boolean {
  if (CONTROL.test(value)) return false;
  const match = SENDER.exec(value);
  const address = match?.[1] ?? match?.[2];
  return Boolean(address && ADDRESS.test(address));
}

export function findIssueReportEmailConfigProblems(input: IssueReportEmailConfigInput, options: { production: boolean }): string[] {
  if (input.ISSUE_REPORT_EMAIL === 'off') return [];
  const problems: string[] = [];
  if (input.ISSUE_REPORT_EMAIL === 'log' && options.production) {
    problems.push('ISSUE_REPORT_EMAIL=log is for development only; use resend (or off) in production.');
  }
  if (input.ISSUE_REPORT_EMAIL === 'resend' && !input.RESEND_API_KEY?.trim()) {
    problems.push('ISSUE_REPORT_EMAIL=resend requires RESEND_API_KEY.');
  }
  const from = input.ISSUE_REPORT_EMAIL_FROM?.trim();
  if (!from) problems.push(`ISSUE_REPORT_EMAIL=${input.ISSUE_REPORT_EMAIL} requires ISSUE_REPORT_EMAIL_FROM.`);
  else if (!isValidSender(from)) problems.push('ISSUE_REPORT_EMAIL_FROM must be "address" or "Name <address>" on one line.');
  const to = input.ISSUE_REPORT_EMAIL_TO?.trim();
  if (to && (CONTROL.test(to) || !ADDRESS.test(to))) problems.push('ISSUE_REPORT_EMAIL_TO must be a single email address.');
  return problems;
}

export function resolveIssueReportEmailConfig(input: IssueReportEmailConfigInput, options: { production: boolean }): IssueReportEmailConfig {
  const problems = findIssueReportEmailConfigProblems(input, options);
  if (problems.length > 0) throw new IssueReportEmailConfigError(`Issue-report email is misconfigured: ${problems.join(' ')}`);
  if (input.ISSUE_REPORT_EMAIL === 'off') return { mode: 'off' };
  const from = input.ISSUE_REPORT_EMAIL_FROM!.trim();
  const to = input.ISSUE_REPORT_EMAIL_TO?.trim() || DEFAULT_ISSUE_REPORT_EMAIL_TO;
  if (input.ISSUE_REPORT_EMAIL === 'log') return { mode: 'log', from, to };
  return { mode: 'resend', apiKey: input.RESEND_API_KEY!.trim(), from, to };
}
