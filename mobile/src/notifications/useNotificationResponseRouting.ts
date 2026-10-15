import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useState } from 'react';

import { openMushafFor } from '@/mushaf/continueWird';
import { loadReadingStops } from '@/mushaf/readingStops';

import type { NotificationsApi } from './api';
import { platformNotificationsApi } from './platformApi';
import { asyncStorageHandledTapStore, createNotificationResponseHandler } from './responseRouting';

/**
 * The one listener for reminder taps (responseRouting.ts), in the root
 * layout. It starts only once `ready` (the saved language and appearance have
 * loaded) and the root navigator exists, so a tap that launched the app is
 * never lost to an unmounted router: that launch tap is then read once
 * (getLastResponse) and cleared, and later taps arrive through the listener,
 * whether the app was in the foreground or the background. The same tap
 * reported both ways navigates once. The Quran itself is read only by the
 * destination screen (the ayah screen loads and verifies its verse), so
 * nothing here waits for the Quran database.
 */
export function useNotificationResponseRouting(ready: boolean, api: NotificationsApi = platformNotificationsApi): void {
  const navigationReady = !!useRootNavigationState()?.key;
  const [handle] = useState(() =>
    createNotificationResponseHandler({
      loadStops: () => loadReadingStops(),
      openMushafFor,
      // أورادي وختماتي is a tab: navigate (switch to it); the ayah and emotion screens open above the tabs.
      navigate: (route) => (route === '/my-reading' ? router.navigate(route) : router.push(route)),
      handledStore: asyncStorageHandledTapStore,
    }),
  );

  const active = ready && navigationReady && api.supported;
  useEffect(() => {
    if (!active) return undefined;
    const subscription = api.addResponseListener((event) => {
      void handle(event);
    });
    const launch = api.getLastResponse();
    if (launch) {
      void handle(launch);
      api.clearLastResponse();
    }
    return () => subscription.remove();
  }, [active, api, handle]);
}
