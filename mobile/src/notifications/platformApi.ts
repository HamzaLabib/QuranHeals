import type { NotificationsApi } from './api';

/**
 * Web (and the Node test environment): local reminders are not offered.
 * Settings shows the rows with an "available in the iPhone and Android app"
 * note; nothing is scheduled and no permission is asked. Native builds use
 * platformApi.native.ts.
 */
export const platformNotificationsApi: NotificationsApi = {
  supported: false,
  getPermission: async () => ({ status: 'unsupported', canAskAgain: false }),
  requestPermission: async () => ({ status: 'unsupported', canAskAgain: false }),
  ensureChannels: async () => undefined,
  getPending: async () => [],
  schedule: async () => undefined,
  cancel: async () => undefined,
  getLastResponse: () => null,
  clearLastResponse: () => undefined,
  addResponseListener: () => ({ remove: () => undefined }),
  setForegroundPresentation: () => undefined,
  openSystemSettings: async () => undefined,
};
