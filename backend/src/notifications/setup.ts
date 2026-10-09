import type { IssueReportEmailConfig } from '../config/issueReportEmailConfig';
import type { IssueReportNotificationStore } from '../services/IssueReportNotificationStore';
import { MongooseIssueReportNotificationStore } from '../services/MongooseIssueReportNotificationStore';
import { LogEmailProvider, ResendEmailProvider, type EmailProvider } from './emailProvider';
import { IssueReportNotifier } from './issueReportNotifier';

export function createEmailProvider(config: Exclude<IssueReportEmailConfig, { mode: 'off' }>): EmailProvider {
  return config.mode === 'resend' ? new ResendEmailProvider(config.apiKey) : new LogEmailProvider();
}

/** The notifier for this configuration, or null when issue-report email is off (no job is queued and nothing runs). */
export function createIssueReportNotifier(
  config: IssueReportEmailConfig,
  deps: { store?: IssueReportNotificationStore; provider?: EmailProvider; reportFailure?: (error: Error) => void } = {},
): IssueReportNotifier | null {
  if (config.mode === 'off') return null;
  return new IssueReportNotifier({
    store: deps.store ?? new MongooseIssueReportNotificationStore(),
    provider: deps.provider ?? createEmailProvider(config),
    from: config.from,
    to: config.to,
    reportFailure: deps.reportFailure,
  });
}
