import { describe, expect, it, vi } from 'vitest';

import { classifyNetwork, createNetworkSource, type DeviceNetworkState } from '@/mushaf/offline/network';
import type { OfflineStatus } from '@/mushaf/offline/offlineMushaf';

/**
 * The connection type the automatic Mushaf download uses
 * (mushaf/offline/network.ts, from expo-network): only Wi-Fi or Ethernet
 * starts the download without asking; mobile data asks; anything that can't
 * be named is treated conservatively, like mobile data.
 */

describe('classifyNetwork', () => {
  it('Wi-Fi and Ethernet start by themselves; mobile data asks', () => {
    expect(classifyNetwork({ type: 'WIFI', isConnected: true, isInternetReachable: true })).toBe('wifi');
    expect(classifyNetwork({ type: 'ETHERNET', isConnected: true })).toBe('wifi');
    expect(classifyNetwork({ type: 'CELLULAR', isConnected: true, isInternetReachable: true })).toBe('cellular');
  });

  it('no connection, or the internet explicitly unreachable (a Wi-Fi login page): waits', () => {
    expect(classifyNetwork({ type: 'NONE', isConnected: false })).toBe('none');
    expect(classifyNetwork({ type: 'WIFI', isConnected: false })).toBe('none');
    expect(classifyNetwork({ type: 'WIFI', isConnected: true, isInternetReachable: false })).toBe('none');
    // Reachability not yet known (undefined) is not taken as offline.
    expect(classifyNetwork({ type: 'WIFI', isConnected: true })).toBe('wifi');
  });

  it('VPN, Bluetooth, WiMAX, other, unknown, the web`s answer, missing fields or no state: unknown (asks, like mobile data)', () => {
    for (const type of ['VPN', 'BLUETOOTH', 'WIMAX', 'OTHER', 'UNKNOWN', undefined]) {
      expect(classifyNetwork({ type, isConnected: true, isInternetReachable: true })).toBe('unknown');
    }
    expect(classifyNetwork({})).toBe('unknown');
    expect(classifyNetwork(null)).toBe('unknown');
  });
});

describe('createNetworkSource', () => {
  function fakeModule(initial: DeviceNetworkState) {
    const m = {
      state: initial,
      listeners: new Set<(state: DeviceNetworkState) => void>(),
      loads: 0,
      getNetworkStateAsync: vi.fn(async () => m.state),
      addNetworkStateListener: (listener: (state: DeviceNetworkState) => void) => {
        m.listeners.add(listener);
        return { remove: () => m.listeners.delete(listener) };
      },
      emit(state: DeviceNetworkState) { m.state = state; for (const l of m.listeners) l(state); },
    };
    return m;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('reads the current type and reports changes, classified; the module loads once', async () => {
    const m = fakeModule({ type: 'CELLULAR', isConnected: true });
    const load = vi.fn(async () => m);
    const source = createNetworkSource(load);
    expect(await source.current()).toBe('cellular');
    const seen: string[] = [];
    const unsubscribe = source.subscribe((kind) => seen.push(kind));
    await tick();
    m.emit({ type: 'WIFI', isConnected: true });
    m.emit({ type: 'NONE', isConnected: false });
    expect(seen).toEqual(['wifi', 'none']);
    unsubscribe();
    expect(m.listeners.size).toBe(0);
    m.emit({ type: 'WIFI', isConnected: true });
    expect(seen).toEqual(['wifi', 'none']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing before the module has loaded never leaves a listener behind', async () => {
    const m = fakeModule({ type: 'WIFI', isConnected: true });
    const source = createNetworkSource(async () => m);
    const unsubscribe = source.subscribe(() => undefined);
    unsubscribe();
    await tick();
    expect(m.listeners.size).toBe(0);
  });

  it('a module that fails to load or to answer: unknown (asks first), never a crash', async () => {
    const broken = createNetworkSource(async () => { throw new Error('no native module'); });
    expect(await broken.current()).toBe('unknown');
    expect(() => broken.subscribe(() => undefined)()).not.toThrow();
    const m = fakeModule({ type: 'WIFI' });
    m.getNetworkStateAsync.mockRejectedValueOnce(new Error('failed'));
    expect(await createNetworkSource(async () => m).current()).toBe('unknown');
  });
});

describe('with the download controller (autoDownload.ts)', () => {
  async function run(initial: DeviceNetworkState) {
    const { createMushafAutoDownload, DEFAULT_AUTO_PREFS } = await import('@/mushaf/offline/autoDownload');
    const m = { listeners: new Set<(s: DeviceNetworkState) => void>(), state: initial };
    const engine = { installed: false, downloads: 0 };
    const phases: string[] = [];
    const controller = createMushafAutoDownload({
      engine: {
        status: async () => ({ installed: engine.installed, stagedChunks: 0, complete: engine.installed }) as OfflineStatus,
        download: async () => { engine.downloads += 1; engine.installed = true; return {}; },
        remove: async () => undefined,
        checkForUpdate: async () => 'up-to-date',
      },
      network: createNetworkSource(async () => ({
        getNetworkStateAsync: async () => m.state,
        addNetworkStateListener: (l) => { m.listeners.add(l); return { remove: () => m.listeners.delete(l) }; },
      })),
      appActivity: { subscribe: () => () => undefined },
      prefs: { load: async () => ({ ...DEFAULT_AUTO_PREFS }), save: async () => undefined },
      enabled: true,
    });
    controller.subscribe((s) => phases.push(s.phase));
    await controller.start();
    await controller.whenIdle();
    const emit = async (state: DeviceNetworkState) => {
      m.state = state;
      for (const l of m.listeners) l(state);
      await new Promise((resolve) => setImmediate(resolve));
      await controller.whenIdle();
    };
    return { controller, engine, phases, emit };
  }

  it('on Wi-Fi the Mushaf downloads without the question ever appearing', async () => {
    const { controller, engine, phases } = await run({ type: 'WIFI', isConnected: true, isInternetReachable: true });
    expect(engine.downloads).toBe(1);
    expect(phases).not.toContain('needs-consent');
    expect(controller.getState().phase).toBe('ready');
    await controller.dispose();
  });

  it('on a VPN (type not knowable) it asks; on a Wi-Fi login page it waits, then starts once the internet is reachable', async () => {
    const vpn = await run({ type: 'VPN', isConnected: true, isInternetReachable: true });
    expect(vpn.controller.getState()).toMatchObject({ phase: 'needs-consent', network: 'unknown' });
    expect(vpn.engine.downloads).toBe(0);
    await vpn.controller.dispose();

    const portal = await run({ type: 'WIFI', isConnected: true, isInternetReachable: false });
    expect(portal.controller.getState().phase).toBe('waiting-network');
    await portal.emit({ type: 'WIFI', isConnected: true, isInternetReachable: true });
    expect(portal.engine.downloads).toBe(1);
    expect(portal.phases).not.toContain('needs-consent');
    await portal.controller.dispose();
  });
});
