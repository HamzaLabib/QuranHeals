import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import type { NotificationResponseEvent, NotificationsApi, ReminderTrigger } from './api';
import { ANDROID_CHANNEL_IDS } from './content';
import type { NotificationKind, NotificationPermission } from './types';

/**
 * expo-notifications behind the app's NotificationsApi (api.ts). Local
 * notifications only: no push token is requested or registered.
 *
 *  - iOS: alerts and sounds (no badge), asked only from Settings
 *    (useNotifications.tsx), never at launch. Provisional/ephemeral
 *    authorization counts as allowed.
 *  - Android 13+: POST_NOTIFICATIONS, asked the same way; the three channels
 *    exist before the prompt (Android shows it only once a channel exists).
 *    No exact-alarm permission is requested: expo-notifications uses an exact
 *    alarm only where the system already allows one, otherwise an inexact
 *    alarm that Android may delay a little (Doze, battery optimisation).
 *    Lock-screen visibility is left to the user's device settings.
 */
function toPermission(response: Notifications.NotificationPermissionsStatus): NotificationPermission {
  const iosStatus = response.ios?.status;
  const allowed = response.granted
    || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
    || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL;
  const status = allowed ? 'granted' : response.status === 'undetermined' ? 'undetermined' : 'denied';
  return { status, canAskAgain: response.canAskAgain };
}

function toTrigger(kind: NotificationKind, trigger: ReminderTrigger): Notifications.NotificationTriggerInput {
  const channelId = ANDROID_CHANNEL_IDS[kind];
  switch (trigger.type) {
    case 'daily':
      return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: trigger.hour, minute: trigger.minute, channelId };
    case 'weekly':
      return { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: trigger.weekday, hour: trigger.hour, minute: trigger.minute, channelId };
    case 'date':
      return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger.date, channelId };
  }
}

function toEvent(response: Notifications.NotificationResponse): NotificationResponseEvent {
  return {
    identifier: response.notification.request.identifier,
    deliveredAt: response.notification.date,
    data: response.notification.request.content.data,
    isDefaultAction: response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER,
  };
}

export const platformNotificationsApi: NotificationsApi = {
  supported: Platform.OS === 'ios' || Platform.OS === 'android',
  getPermission: async () => toPermission(await Notifications.getPermissionsAsync()),
  requestPermission: async () =>
    toPermission(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })),
  ensureChannels: async (names) => {
    if (Platform.OS !== 'android') return;
    for (const kind of Object.keys(ANDROID_CHANNEL_IDS) as NotificationKind[]) {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_IDS[kind], {
        name: names[kind],
        importance: Notifications.AndroidImportance.DEFAULT,
        showBadge: false,
      });
    }
  },
  getPending: async () =>
    (await Notifications.getAllScheduledNotificationsAsync()).map((request) => ({
      identifier: request.identifier,
      data: (request.content.data ?? {}) as Record<string, unknown>,
    })),
  schedule: async ({ identifier, kind, content, trigger }) => {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: content.title, subtitle: content.subtitle ?? null, body: content.body, data: content.data, sound: 'default' },
      trigger: toTrigger(kind, trigger),
    });
  },
  cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  getLastResponse: () => {
    const response = Notifications.getLastNotificationResponse();
    return response ? toEvent(response) : null;
  },
  clearLastResponse: () => Notifications.clearLastNotificationResponse(),
  addResponseListener: (listener) => Notifications.addNotificationResponseReceivedListener((response) => listener(toEvent(response))),
  setForegroundPresentation: (quiet) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        const silent = quiet();
        return { shouldShowBanner: !silent, shouldShowList: true, shouldPlaySound: !silent, shouldSetBadge: false };
      },
    });
  },
  openSystemSettings: () => Linking.openSettings(),
};
