import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useAuth, type FocusSyncScope } from '@/auth/useAuth';

/**
 * Each time this screen gains focus, refreshes the synced data it shows —
 * signed in only, throttled and single-flight (auth/useAuth.tsx's
 * syncOnFocus). The screen's own subscriptions show whatever the sync
 * stores; nothing here waits for it.
 */
export function useSyncOnFocus(scope: FocusSyncScope): void {
  const { syncOnFocus } = useAuth();
  useFocusEffect(
    useCallback(() => {
      syncOnFocus(scope);
    }, [syncOnFocus, scope]),
  );
}
