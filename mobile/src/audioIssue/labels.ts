import type { AppLocale } from '@/localization/locales';
import type { AudioIssueProblem } from '@/services/issueReportApi';

import type { AudioIssuePlayback } from './context';

/**
 * Audio Issue's interface text, kept with the feature. English follows the approved terminology (Audio, Playback,
 * Reciter; never "recitation"). Egyptian Arabic (an Emotions Language only) reads the Arabic.
 */
export type AudioIssueLabels = {
  /** The category, and the ayah screen's entry. */
  title: string;
  /** The ayah screen's entry, spoken. */
  actionHint: string;
  description: string;
  problemTitle: string;
  problemRequired: string;
  problems: Record<AudioIssueProblem, string>;
  /** Above the attached details. */
  detailsTitle: string;
  surah: string;
  ayah: string;
  reciter: string;
  recording: string;
  playback: string;
  playbackPhases: Record<AudioIssuePlayback, string>;
  noRecording: string;
  /** The form's button: to the review (nothing is sent yet). */
  review: string;
  reviewTitle: string;
  reviewNote: string;
  descriptionLabel: string;
  email: string;
  noEmail: string;
  edit: string;
  send: string;
};

const EN: AudioIssueLabels = {
  title: 'Audio Issue',
  actionHint: "Report a problem with this ayah's audio",
  description: 'Tell us what happened with the audio. The details below are attached so we can find the recording.',
  problemTitle: 'What went wrong?',
  problemRequired: 'Please choose what went wrong.',
  problems: {
    not_playing: 'Audio not playing',
    wrong_reciter: 'Wrong reciter or recording',
    missing_ayah: 'Missing ayah audio',
    timing_highlight: 'Incorrect ayah timing or highlighting',
    stopped: 'Audio stopped unexpectedly',
    other: 'Other audio problem',
  },
  detailsTitle: 'Included with this report',
  surah: 'Surah',
  ayah: 'Ayah',
  reciter: 'Reciter',
  recording: 'Recording',
  playback: 'Playback',
  playbackPhases: {
    'not-played': 'Not playing',
    idle: 'Not playing',
    loading: 'Loading',
    playing: 'Playing',
    paused: 'Paused',
    error: 'Stopped with an error',
    ended: 'Finished',
  },
  noRecording: 'No recording available',
  review: 'Review Report',
  reviewTitle: 'Review Your Report',
  reviewNote: 'Please check the details below, then send the report.',
  descriptionLabel: 'Description',
  email: 'Email for follow-up',
  noEmail: 'Not provided',
  edit: 'Edit',
  send: 'Send Report',
};

const AR: AudioIssueLabels = {
  title: 'مشكلة في الصوت',
  actionHint: 'الإبلاغ عن مشكلة في صوت هذه الآية',
  description: 'أخبرنا بما حدث في الصوت. تُرفق التفاصيل أدناه لنتعرّف على التسجيل.',
  problemTitle: 'ما المشكلة؟',
  problemRequired: 'يُرجى اختيار المشكلة.',
  problems: {
    not_playing: 'الصوت لا يعمل',
    wrong_reciter: 'القارئ أو التسجيل غير صحيح',
    missing_ayah: 'صوت آية مفقود',
    timing_highlight: 'توقيت الآية أو تظليلها غير صحيح',
    stopped: 'توقف الصوت فجأة',
    other: 'مشكلة أخرى في الصوت',
  },
  detailsTitle: 'يُرفق مع هذا البلاغ',
  surah: 'السورة',
  ayah: 'الآية',
  reciter: 'القارئ',
  recording: 'التسجيل',
  playback: 'التشغيل',
  playbackPhases: {
    'not-played': 'لا يعمل الآن',
    idle: 'لا يعمل الآن',
    loading: 'جارٍ التحميل',
    playing: 'قيد التشغيل',
    paused: 'متوقف مؤقتًا',
    error: 'توقف بسبب خطأ',
    ended: 'انتهى',
  },
  noRecording: 'لا يتوفر تسجيل',
  review: 'مراجعة البلاغ',
  reviewTitle: 'راجع بلاغك',
  reviewNote: 'يُرجى التحقق من التفاصيل أدناه، ثم إرسال البلاغ.',
  descriptionLabel: 'الوصف',
  email: 'البريد الإلكتروني للمتابعة',
  noEmail: 'لم يُذكر',
  edit: 'تعديل',
  send: 'إرسال البلاغ',
};

export function audioIssueLabels(locale: AppLocale): AudioIssueLabels {
  return locale === 'en' ? EN : AR;
}
