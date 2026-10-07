import { Platform } from 'react-native';

import { devLog } from '@/utils/devLog';

// Local development only: the backend on port 4000 (10.0.2.2 is the host
// machine as seen from the Android emulator).
const fallbackApiUrl = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

// Inlined into the bundle at build time by Expo.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

// Defense in depth behind app.config.ts, which already refuses hosted
// (preview/production) builds without a valid https URL: a release bundle
// must never silently talk to a developer's machine.
if (!configuredApiUrl && !__DEV__) {
  throw new Error(
    'EXPO_PUBLIC_API_URL was not set when this release bundle was built. Set it in the EAS environment for the build profile (see docs/release-builds.md).',
  );
}

/** Shared by services/api.ts (Quran/emotions) and the auth/sync clients — one backend, one base URL rule. */
export const apiBaseUrl = (configuredApiUrl || fallbackApiUrl).replace(/\/$/, '');

// Visible at every dev startup so a stale/unreachable EXPO_PUBLIC_API_URL
// (e.g. a LAN IP that changed) is obvious immediately instead of surfacing
// only as "emotions/ayahs won't load" with no clue why.
devLog('apiBase', 'resolved API base URL', { apiBaseUrl, source: configuredApiUrl ? 'EXPO_PUBLIC_API_URL' : 'fallback' });
