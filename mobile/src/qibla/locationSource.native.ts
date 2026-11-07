import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { LocationFix, LocationPermission, LocationSource } from './locationSourceTypes';

/**
 * iOS and Android: expo-location, foreground only (app.json disables every background, motion and foreground-service
 * option). The only file that imports expo-location. Nothing here logs, stores or sends a coordinate.
 */

function toPermission(response: Location.LocationPermissionResponse): LocationPermission {
  const status = response.status === 'granted' ? 'granted' : response.status === 'denied' ? 'denied' : 'undetermined';
  return { status, canAskAgain: response.canAskAgain };
}

function toFix(location: Location.LocationObject | null): LocationFix | null {
  if (!location) return null;
  const { latitude, longitude, accuracy } = location.coords;
  return {
    coordinates: { latitude, longitude },
    accuracyMeters: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
  };
}

export const locationSource: LocationSource = {
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  headingSupported: true,
  getPermission: async () => toPermission(await Location.getForegroundPermissionsAsync()),
  requestPermission: async () => toPermission(await Location.requestForegroundPermissionsAsync()),
  servicesEnabled: () => Location.hasServicesEnabledAsync(),
  getLastKnownFix: async (maxAge, requiredAccuracy) => toFix(await Location.getLastKnownPositionAsync({ maxAge, requiredAccuracy })),
  // Balanced: city-block accuracy is far more than the Qibla needs, at a fraction of the power of the GPS-only modes.
  getCurrentFix: async () => toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })),
  watchHeading: (onEvent, onError) =>
    Location.watchHeadingAsync(
      (heading) => onEvent({ trueHeading: heading.trueHeading, magHeading: heading.magHeading, accuracy: heading.accuracy }),
      (reason) => onError(typeof reason === 'string' ? reason : 'heading error'),
    ),
};
