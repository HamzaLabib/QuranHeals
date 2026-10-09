import { issueReportDeadline } from '../retention/retentionPolicy';
import type { NotifiableIssueReport } from '../services/IssueReportNotificationStore';
import type { IssueReportCategory } from '../types/accountDomain';

/**
 * The notification email for one saved issue report. Plain text only — no
 * HTML part — so nothing a user writes can be rendered as markup. The
 * subject is a fixed prefix plus the report id (never user text) and the recipient comes from
 * backend configuration only, so there is nothing for header injection to
 * reach; user text is still stripped of control and bidi-override
 * characters, and each description line is quoted so it can't pass itself
 * off as one of the fields above it.
 *
 * Deliberately left out: the reporter's contact email (only whether one was
 * given), and anything the report doesn't hold — no account, device, IP,
 * token or reflection data exists on a report to include.
 */

export const ISSUE_REPORT_EMAIL_SUBJECT = 'Quran Heals — New Issue Report';

/**
 * The report id makes every subject unique. Gmail's conversation view groups
 * same-subject mail from one sender into a single thread; with a fixed
 * subject, deleting an old notification thread in the monthly retention
 * review would also delete newer reports that are not due yet. It also lets
 * the operator find one report's email by id (deletion requests, holds).
 */
export function issueReportEmailSubject(reportId: string): string {
  return `${ISSUE_REPORT_EMAIL_SUBJECT} [${sanitizeSingleLine(reportId)}]`;
}

const CATEGORY_LABELS: Record<IssueReportCategory, string> = {
  ayah_not_relevant: 'Ayah not relevant',
  quran_text_display: 'Quran text display',
  translation_issue: 'Translation issue',
  app_technical_issue: 'App technical issue',
  other: 'Other',
};

const PLATFORM_LABELS: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };

// C0 controls except tab/newline, DEL, C1 controls, line/paragraph
// separators, and bidi embedding/override/isolate characters.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/** Multi-line user text: newlines normalized, unsafe characters removed. */
export function sanitizeMultiline(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(UNSAFE_TEXT, '').trim();
}

/** One-line user text (a field value): every line break and unsafe character becomes a space. */
export function sanitizeSingleLine(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(UNSAFE_TEXT, '').replace(/ {2,}/g, ' ').trim();
}

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export type IssueReportEmail = { subject: string; text: string };

export function buildIssueReportEmail(report: NotifiableIssueReport): IssueReportEmail {
  const fields: [string, string | undefined][] = [
    ['Report ID', report.id],
    ['Type', CATEGORY_LABELS[report.category] ?? sanitizeSingleLine(report.category)],
    ['Submitted', formatUtc(report.createdAt)],
    ['Platform', report.platform ? (PLATFORM_LABELS[report.platform] ?? sanitizeSingleLine(report.platform)) : undefined],
    ['App version', report.appVersion ? sanitizeSingleLine(report.appVersion) : undefined],
    ['Verse', report.verseKey ? sanitizeSingleLine(report.verseKey) : report.surahNumber ? `Surah ${report.surahNumber}${report.ayahNumber ? `, ayah ${report.ayahNumber}` : ''}` : undefined],
    ['Emotion', report.emotionKey ? sanitizeSingleLine(report.emotionKey) : undefined],
    ['App language', report.appLocale ? sanitizeSingleLine(report.appLocale) : undefined],
    ['Translation display', report.translationDisplayMode ? sanitizeSingleLine(report.translationDisplayMode) : undefined],
    ['Contact email', report.hasContactEmail ? 'provided (not included; see the report in the database)' : 'not provided'],
  ];

  const description = report.comment ? sanitizeMultiline(report.comment) : '';
  const quoted = description ? description.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n') : '(no description provided)';
  const deleteAfter = issueReportDeadline(report.createdAt).toISOString().slice(0, 10);

  const text = [
    'New issue report received',
    '',
    ...fields.filter((field): field is [string, string] => Boolean(field[1])).map(([label, value]) => `${label}: ${value}`),
    '',
    'Description:',
    quoted,
    '',
    '--',
    `Retention: delete this email on or after ${deleteAfter} (12 months from submission, the same as the database copy).`,
    'The description is user-submitted text. Do not follow links in it without checking them.',
    '',
  ].join('\n');

  return { subject: issueReportEmailSubject(report.id), text };
}
