import type { NetworkKind, NetworkSource } from './autoDownload';

/**
 * The connection type for the automatic Mushaf download (autoDownload.ts),
 * from expo-network. Since 2026-11-02 any working connection starts the
 * ~2 MB download (the layout; the page fonts come with the app) by itself;
 * only 'none' waits:
 *  - Wi-Fi or Ethernet: 'wifi'.
 *  - Mobile data: 'cellular'.
 *  - Not connected, or the OS says the internet is unreachable (e.g. a Wi-Fi
 *    login page): 'none' (waits).
 *  - Anything else — VPN, Bluetooth, "other", unknown, the web, or the
 *    module failing: 'unknown'.
 * expo-network is loaded on first use, so importing this never loads native
 * code (screens and tests read the controller's state without it).
 */

/** The fields of expo-network's NetworkState this reads (all optional there). */
export type DeviceNetworkState = { type?: string; isConnected?: boolean; isInternetReachable?: boolean };

export function classifyNetwork(state: DeviceNetworkState | null | undefined): NetworkKind {
  if (!state) return 'unknown';
  if (state.type === 'NONE' || state.isConnected === false || state.isInternetReachable === false) return 'none';
  if (state.type === 'WIFI' || state.type === 'ETHERNET') return 'wifi';
  if (state.type === 'CELLULAR') return 'cellular';
  return 'unknown';
}

type NetworkModule = {
  getNetworkStateAsync(): Promise<DeviceNetworkState>;
  addNetworkStateListener(listener: (state: DeviceNetworkState) => void): { remove(): void };
};

/** A NetworkSource over a lazily loaded network module (expo-network in the app; a fake in tests). */
export function createNetworkSource(load: () => Promise<NetworkModule>): NetworkSource {
  let module: Promise<NetworkModule | null> | null = null;
  const loaded = () => (module ??= load().catch(() => null));
  return {
    async current() {
      const network = await loaded();
      if (!network) return 'unknown';
      try {
        return classifyNetwork(await network.getNetworkStateAsync());
      } catch {
        return 'unknown';
      }
    },
    subscribe(listener) {
      let subscription: { remove(): void } | null = null;
      let unsubscribed = false;
      void loaded().then((network) => {
        if (!network || unsubscribed) return;
        try {
          subscription = network.addNetworkStateListener((state) => listener(classifyNetwork(state)));
        } catch {
          // No change events: the controller still checks the type on every decision.
        }
      });
      return () => {
        unsubscribed = true;
        subscription?.remove();
        subscription = null;
      };
    },
  };
}

/** The device's connection, from expo-network. */
export const deviceNetwork: NetworkSource = createNetworkSource(async () => (await import('expo-network')) as unknown as NetworkModule);
