import type { LocationSource } from './locationSourceTypes';

/**
 * Web (and the Node test environment): no device location and no compass. The Qibla screen then offers the city
 * list and shows the bearing only. iOS and Android use locationSource.native.ts (Metro picks it over this file).
 */
export const locationSource: LocationSource = {
  platform: 'web',
  headingSupported: false,
  getPermission: async () => ({ status: 'denied', canAskAgain: false }),
  requestPermission: async () => ({ status: 'denied', canAskAgain: false }),
  servicesEnabled: async () => false,
  getLastKnownFix: async () => null,
  getCurrentFix: async () => null,
  watchHeading: async () => {
    throw new Error('Heading is not available on this platform.');
  },
};
