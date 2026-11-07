import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocationSource } from '@/qibla/locationSourceTypes';

/**
 * useQiblaCompass: the heading stream runs only while the screen is focused AND the app is active, and is always
 * removed on blur, background, inactive (iOS Control Centre / lock) and unmount.
 */

// expo-router's useFocusEffect, driven by the test: focus() runs the screen's effect, blur() its cleanup.
const focus = vi.hoisted(() => ({ effect: null as null | (() => void | (() => void)), cleanup: null as null | (() => void) }));
vi.mock('expo-router', async () => {
  const react = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      react.useEffect(() => {
        focus.effect = effect;
        return () => {
          focus.cleanup?.();
          focus.cleanup = null;
          focus.effect = null;
        };
      }, [effect]);
    },
  };
});

const appState = vi.hoisted(() => ({ current: 'active' as string, listeners: new Set<(s: string) => void>() }));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.current;
    },
    addEventListener: (_type: string, listener: (s: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) },
  Platform: { OS: 'ios' },
}));

const { useQiblaCompass, isAppActive } = await import('@/qibla/useQiblaCompass');

const calls = { watch: 0, remove: 0, getPermission: 0 };
const source: LocationSource = {
  platform: 'ios',
  headingSupported: true,
  getPermission: async () => {
    calls.getPermission += 1;
    return { status: 'granted', canAskAgain: true };
  },
  requestPermission: async () => ({ status: 'granted', canAskAgain: true }),
  servicesEnabled: async () => true,
  getLastKnownFix: async () => ({ coordinates: { latitude: 30.0444, longitude: 31.2357 }, accuracyMeters: 20 }),
  getCurrentFix: async () => null,
  watchHeading: async () => {
    calls.watch += 1;
    return { remove: () => void (calls.remove += 1) };
  },
};

let root: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useQiblaCompass> | undefined;
function Probe() {
  const compass = useQiblaCompass(source);
  useEffect(() => {
    latest = compass;
  });
  return null;
}

const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
});
const doFocus = () => act(async () => {
  const cleanup = focus.effect?.();
  focus.cleanup = typeof cleanup === 'function' ? cleanup : null;
});
const doBlur = () => act(async () => {
  focus.cleanup?.();
  focus.cleanup = null;
});
const setAppState = (state: string) => act(async () => {
  appState.current = state;
  for (const listener of appState.listeners) listener(state);
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.watch = 0;
  calls.remove = 0;
  calls.getPermission = 0;
  appState.current = 'active';
  latest = undefined;
  await act(async () => {
    root = create(createElement(Probe));
  });
  await settle();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('useQiblaCompass lifecycle', () => {
  it('mounted but not focused: nothing is checked or watched', () => {
    expect(calls).toEqual({ watch: 0, remove: 0, getPermission: 0 });
    expect(latest?.snapshot?.active).toBe(false);
  });

  it('focus starts it; blur removes the stream', async () => {
    await doFocus();
    await settle();
    expect(calls.getPermission).toBe(1);
    expect(calls.watch).toBe(1);
    expect(latest?.snapshot?.active).toBe(true);
    await doBlur();
    await settle();
    expect(calls.remove).toBe(1);
    expect(latest?.snapshot?.active).toBe(false);
  });

  it('background and inactive (iOS Control Centre, lock) remove the stream; active restarts it', async () => {
    await doFocus();
    await settle();
    await setAppState('background');
    await settle();
    expect(calls.remove).toBe(1);
    await setAppState('active');
    await settle();
    expect(calls.watch).toBe(2);
    await setAppState('inactive');
    await settle();
    expect(calls.remove).toBe(2);
  });

  it('coming back to the app while the screen is NOT focused does not start it', async () => {
    await setAppState('background');
    await setAppState('active');
    await settle();
    expect(calls.watch).toBe(0);
  });

  it('unmount removes the stream and stops the AppState listener', async () => {
    await doFocus();
    await settle();
    await act(async () => root!.unmount());
    root = undefined;
    expect(calls.remove).toBe(1);
    expect(appState.listeners.size).toBe(0);
  });

  it('isAppActive: active (and Android\'s initial "unknown") only', () => {
    expect(isAppActive('active')).toBe(true);
    expect(isAppActive('unknown' as never)).toBe(true);
    expect(isAppActive('background')).toBe(false);
    expect(isAppActive('inactive')).toBe(false);
  });
});
