import type { NotificationKind, NotificationPermission, Weekday } from './types';

/**
 * The only notification operations the app uses, as a small interface over
 * expo-notifications (platformApi.native.ts). The scheduler, the response
 * routing and the tests depend on this, never on expo-notifications itself;
 * web (and the Node tests) get platformApi.ts, which supports nothing.
 * Remote push could be added later beside this without touching the
 * scheduling rules: nothing here registers a push token.
 */
export type ReminderTrigger =
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: Weekday; hour: number; minute: number }
  | { type: 'date'; date: Date };

export type ScheduleRequest = {
  identifier: string;
  kind: NotificationKind;
  content: { title: string; subtitle?: string; body: string; data: Record<string, unknown> };
  trigger: ReminderTrigger;
};

export type PendingNotification = { identifier: string; data: Record<string, unknown> };

export type NotificationResponseEvent = {
  /** The scheduled request's identifier. */
  identifier: string;
  /** When the notification was delivered (ms), so two deliveries of one repeating request are told apart. */
  deliveredAt: number;
  data: unknown;
  /** True for a plain tap on the notification (not a dismiss or another action). */
  isDefaultAction: boolean;
};

export type NotificationsApi = {
  supported: boolean;
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  ensureChannels(names: Record<NotificationKind, string>): Promise<void>;
  getPending(): Promise<PendingNotification[]>;
  schedule(request: ScheduleRequest): Promise<void>;
  cancel(identifier: string): Promise<void>;
  /** The tap that launched the app (cold start), if any. */
  getLastResponse(): NotificationResponseEvent | null;
  clearLastResponse(): void;
  addResponseListener(listener: (event: NotificationResponseEvent) => void): { remove(): void };
  /** Foreground presentation: `quiet()` true → listed in Notification Centre, no banner or sound. */
  setForegroundPresentation(quiet: () => boolean): void;
  openSystemSettings(): Promise<void>;
};
