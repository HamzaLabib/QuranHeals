import { createElement, useSyncExternalStore } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Keep Screen Awake: the stored setting (mushaf/keepAwakePreference.ts, its provider) and the reader's lifecycle
 * (mushaf/useMushafKeepAwake.ts) over a fake expo-keep-awake that tracks which tags are held. Unit tests only: they
 * prove when the app asks the OS to keep the screen awake and when it releases it, not a device's actual auto-lock.
 */
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  failStorage: false,
  focused: true,
  focusListeners: new Set<() => void>(),
  appState: 'active' as string,
  appStateListeners: new Set<(next: string) => void>(),
  held: new Set<string>(),
  activations: [] as string[],
  deactivations: [] as string[],
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => { if (state.failStorage) throw new Error('unavailable'); return state.storage.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (state.failStorage) throw new Error('unavailable'); state.storage.set(key, value); },
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return state.appState; },
    addEventListener: (_event: string, listener: (next: string) => void) => {
      state.appStateListeners.add(listener);
      return { remove: () => { state.appStateListeners.delete(listener); } };
    },
  },
}));
vi.mock('expo-router', () => ({
  // Like React Navigation's: re-renders the screen when its focus changes.
  useIsFocused: () => useSyncExternalStore(
    (onChange) => { state.focusListeners.add(onChange); return () => { state.focusListeners.delete(onChange); }; },
    () => state.focused,
  ),
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: async (tag: string) => { state.activations.push(tag); state.held.add(tag); },
  deactivateKeepAwake: async (tag: string) => { state.deactivations.push(tag); state.held.delete(tag); },
}));

import { DEFAULT_KEEP_AWAKE, KEEP_AWAKE_STORAGE_KEY, loadKeepAwake, parseKeepAwake, saveKeepAwake } from '@/mushaf/keepAwakePreference';
import { KeepAwakePreferenceProvider, useKeepAwakePreference, type KeepAwakePreferenceContextValue } from '@/mushaf/useKeepAwakePreference';
import { MUSHAF_KEEP_AWAKE_TAG, shouldKeepMushafAwake, useMushafKeepAwake } from '@/mushaf/useMushafKeepAwake';

let root: ReactTestRenderer | undefined;
let preference: KeepAwakePreferenceContextValue;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

/** A stand-in for the Mushaf screen: only the keep-awake hook (the screen calls it once, at its top). */
function Reader() {
  useMushafKeepAwake();
  return null;
}
/** Settings' side: reads and sets the shared preference. */
function SettingsProbe() {
  preference = useKeepAwakePreference();
  return null;
}
async function mount({ reader = true } = {}) {
  await act(async () => {
    root = create(createElement(KeepAwakePreferenceProvider, null, createElement(SettingsProbe), reader ? createElement(Reader) : null));
  });
  await flush();
}
async function showReader(show: boolean) {
  await act(async () => {
    root!.update(createElement(KeepAwakePreferenceProvider, null, createElement(SettingsProbe), show ? createElement(Reader) : null));
  });
  await flush();
}
async function setFocused(focused: boolean) {
  await act(async () => { state.focused = focused; state.focusListeners.forEach((listener) => listener()); });
  await flush();
}
async function setAppState(next: string) {
  await act(async () => { state.appState = next; state.appStateListeners.forEach((listener) => listener(next)); });
  await flush();
}
async function setEnabled(enabled: boolean) {
  await act(async () => preference.setEnabled(enabled));
  await flush();
}
const holding = () => state.held.has(MUSHAF_KEEP_AWAKE_TAG);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
  state.failStorage = false;
  state.focused = true;
  state.focusListeners.clear();
  state.appState = 'active';
  state.appStateListeners.clear();
  state.held.clear();
  state.activations = [];
  state.deactivations = [];
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('the Keep Screen Awake setting (stored on the device)', () => {
  it('1. is ON when nothing was ever saved', async () => {
    expect(DEFAULT_KEEP_AWAKE).toBe(true);
    expect(await loadKeepAwake()).toBe(true);
    await mount({ reader: false });
    expect(preference).toMatchObject({ enabled: true, isReady: true });
    // Loading never writes: an unchosen setting stays unchosen.
    expect(state.storage.has(KEEP_AWAKE_STORAGE_KEY)).toBe(false);
  });

  it('2–3. OFF and ON are each saved at once, under its own local key only', async () => {
    await mount({ reader: false });
    await setEnabled(false);
    expect(preference.enabled).toBe(false);
    expect(state.storage.get(KEEP_AWAKE_STORAGE_KEY)).toBe('false');
    await setEnabled(true);
    expect(preference.enabled).toBe(true);
    expect(state.storage.get(KEEP_AWAKE_STORAGE_KEY)).toBe('true');
    expect([...state.storage.keys()]).toEqual([KEEP_AWAKE_STORAGE_KEY]);
  });

  it('4. a saved OFF is restored after a restart, and is never overwritten by the default', async () => {
    await saveKeepAwake(false);
    await mount({ reader: false });
    expect(preference).toMatchObject({ enabled: false, isReady: true });
    expect(state.storage.get(KEEP_AWAKE_STORAGE_KEY)).toBe('false');
    await act(async () => root!.unmount());
    root = undefined;
    await mount({ reader: false }); // another launch
    expect(preference.enabled).toBe(false);
  });

  it('5. anything invalid stored, or an unreadable store, means the default (ON) without throwing', async () => {
    for (const raw of ['', 'TRUE', '1', '0', 'yes', '"false"', '{"enabled":false}', 'null', 'undefined']) expect(parseKeepAwake(raw)).toBe(true);
    expect(parseKeepAwake(null)).toBe(true);
    state.storage.set(KEEP_AWAKE_STORAGE_KEY, 'garbage');
    expect(await loadKeepAwake()).toBe(true);
    state.failStorage = true;
    expect(await loadKeepAwake()).toBe(true);
    await expect(saveKeepAwake(false)).resolves.toBeUndefined();
  });
});

describe('the reader keeps the screen awake only while ON, focused and in the foreground', () => {
  it('the three conditions', () => {
    expect(shouldKeepMushafAwake(true, true, 'active')).toBe(true);
    expect(shouldKeepMushafAwake(false, true, 'active')).toBe(false);
    expect(shouldKeepMushafAwake(true, false, 'active')).toBe(false);
    for (const appState of ['background', 'inactive', 'unknown', 'extension', null] as const) expect(shouldKeepMushafAwake(true, true, appState as never)).toBe(false);
  });

  it('6. focused + foreground + ON: activated once, with the reader\'s own tag', async () => {
    await mount();
    expect(state.activations).toEqual([MUSHAF_KEEP_AWAKE_TAG]);
    expect(holding()).toBe(true);
  });

  it('7. focused + foreground + OFF (saved): never activated', async () => {
    await saveKeepAwake(false);
    await mount();
    expect(holding()).toBe(false);
    // Not even for a moment before the saved choice loads.
    expect(state.activations).toEqual([]);
  });

  it('8–9. another tab or route (the reader loses focus): released; 11. back to the reader: held again', async () => {
    await mount();
    await setFocused(false); // Home, Favorites, Reflections, or a route pushed over the reader
    expect(holding()).toBe(false);
    expect(state.deactivations).toEqual([MUSHAF_KEEP_AWAKE_TAG]);
    await setFocused(true);
    expect(holding()).toBe(true);
    expect(state.activations).toEqual([MUSHAF_KEEP_AWAKE_TAG, MUSHAF_KEEP_AWAKE_TAG]);
  });

  it('10. background (and iOS\'s inactive): released; 11. foreground again: held', async () => {
    await mount();
    await setAppState('inactive');
    expect(holding()).toBe(false);
    await setAppState('background');
    expect(holding()).toBe(false);
    expect(state.deactivations).toEqual([MUSHAF_KEEP_AWAKE_TAG]); // released once, not per state change
    await setAppState('active');
    expect(holding()).toBe(true);
  });

  it('12. turning the setting OFF releases it at once; 13. ON again re-acquires it (reader focused, app active)', async () => {
    await mount();
    await setEnabled(false);
    expect(holding()).toBe(false);
    await setEnabled(true);
    expect(holding()).toBe(true);
  });

  it('13. ON while the reader is not focused, or the app is in the background: nothing until both hold', async () => {
    await saveKeepAwake(false);
    await mount();
    await setFocused(false);
    await setEnabled(true);
    expect(holding()).toBe(false);
    await setAppState('background');
    await setFocused(true);
    expect(holding()).toBe(false);
    await setAppState('active');
    expect(holding()).toBe(true);
  });

  it('14. unmounting the reader releases its tag and removes its AppState listener', async () => {
    await mount();
    expect(state.appStateListeners.size).toBe(1);
    await showReader(false);
    expect(holding()).toBe(false);
    expect(state.deactivations).toEqual([MUSHAF_KEEP_AWAKE_TAG]);
    expect(state.appStateListeners.size).toBe(0);
  });

  it('15. repeated navigation never leaves a stale or duplicate hold: activations and releases always pair up', async () => {
    await mount();
    for (let i = 0; i < 10; i++) {
      await setFocused(false);
      await setFocused(true);
      await setAppState('background');
      await setAppState('active');
      await setEnabled(false);
      await setEnabled(true);
    }
    // Re-renders with nothing changed do not re-activate.
    await act(async () => preference.setEnabled(true));
    await flush();
    expect(state.activations.length).toBe(31);
    expect(state.deactivations.length).toBe(30);
    expect(new Set([...state.activations, ...state.deactivations])).toEqual(new Set([MUSHAF_KEEP_AWAKE_TAG]));
    await showReader(false);
    expect(holding()).toBe(false);
    expect(state.activations.length).toBe(state.deactivations.length);
    expect(state.appStateListeners.size).toBe(0);
  });
});
