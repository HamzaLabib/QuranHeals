import { createElement, useEffect } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * The compact audio controls outside the Mushaf (components/AudioMiniControls.tsx): exactly Play / Pause, Follow
 * recitation and Stop, during the Mushaf's listening session, in the tab bar (AppTabBar) and at the bottom of the root
 * stack's other screens (ScreenWithAudioControls). The engine is a stand-in store with the real one's shape: the
 * controls only ever call it.
 */
const engine = vi.hoisted(() => {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  const idle = { phase: 'idle', mode: 'continuous', granularity: 'ayah', position: null, error: null, session: 0 };
  const store = {
    state: { ...idle } as Record<string, unknown>,
    calls: [] as string[],
    set(patch: Record<string, unknown>, silent = false) {
      store.state = { ...store.state, ...patch };
      if (!silent) for (const listener of listeners) listener();
    },
    reset() { store.state = { ...idle }; store.calls = []; },
    api: {
      subscribe: (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      getState: () => store.state,
      toggle: () => {
        store.calls.push('toggle');
        store.set({ phase: store.state.phase === 'playing' || store.state.phase === 'loading' ? 'paused' : 'playing' });
      },
      stop: () => { store.calls.push('stop'); store.set({ ...idle, session: store.state.session }); },
    },
    listenerCount: () => listeners.size,
  };
  return store;
});
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', insets: { top: 47, bottom: 34, left: 0, right: 0 }, mounts: 0 }));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', async () => {
  const { createContext, useContext: use } = await import('react');
  const SafeAreaInsetsContext = createContext<typeof state.insets | null>(null);
  return { SafeAreaInsetsContext, useSafeAreaInsets: () => use(SafeAreaInsetsContext) ?? state.insets };
});
vi.mock('lucide-react-native', () => Object.fromEntries(
  ['BookMarked', 'House', 'LocateFixed', 'NotebookPen', 'Pause', 'Play', 'X'].map((name) => [name, name]),
));
vi.mock('expo-router', () => ({ router: { navigate: vi.fn() } }));
vi.mock('expo-router/tabs', async () => {
  const { createContext } = await import('react');
  return { BottomTabBarHeightCallbackContext: createContext(() => undefined) };
});
vi.mock('@/audio/index', () => ({ audioEngine: engine.api }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemeName: () => 'light', useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/components/MushafDownloadIndicator', () => ({ MushafDownloadIndicator: () => null }));
vi.mock('@/components/HandsHeartIcon', () => ({ HandsHeartIcon: 'HandsHeartIcon' }));
vi.mock('@/components/MushafIcon', () => ({ MushafIcon: 'MushafIcon' }));

const { router } = await import('expo-router');
const { useSafeAreaInsets } = await import('react-native-safe-area-context');
const { ScreenWithAudioControls, openRecitedAyahInMushaf, showsAudioMiniControls } = await import('@/components/AudioMiniControls');
const { AppTabBar, APP_TABS } = await import('@/components/AppTabBar');
const { MUSHAF_TAB_OPTIONS } = await import('@/mushaf/screenOptions');
const { pageOfPosition } = await import('@/audio/quranSequence');

let root: ReactTestRenderer | null = null;
const mount = async (element: ReturnType<typeof createElement>) => {
  await act(async () => { root = create(element); });
};
const hosts = (id: string) => root!.root.findAll((node: ReactTestInstance) => typeof node.type === 'string' && node.props.testID === id);
const press = async (id: string) => {
  const [node] = hosts(id);
  await act(async () => { node.props.onPress(); });
};
/** A child's first host view's testID (a component child is looked into). */
const hostId = (child: ReactTestInstance) => (typeof child.type === 'string' ? child : child.findAll((node) => typeof node.type === 'string')[0])?.props.testID;
const buttons = () => hosts('audio-mini').flatMap((bar) => bar.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button')).map((node) => node.props.testID as string);
const playing = (patch: Record<string, unknown> = {}) => act(async () => {
  engine.set({ phase: 'playing', mode: 'continuous', granularity: 'ayah', position: { surah: 3, ayah: 84 }, error: null, session: 1, ...patch });
});

/** A stack screen's content: what it is told about the bottom safe area, and how often it was mounted. */
let seenBottom = -1;
function Content() {
  seenBottom = useSafeAreaInsets().bottom;
  useEffect(() => { state.mounts += 1; }, []);
  return createElement('View', { testID: 'content' });
}

beforeEach(() => {
  engine.reset();
  state.locale = 'en';
  state.mounts = 0;
  seenBottom = -1;
  vi.mocked(router.navigate).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

describe('when the compact controls show', () => {
  it('the Mushaf\'s session only (playing, loading, paused); never idle, finished, stopped by an error, or an ayah screen\'s single ayah', () => {
    const base = { mode: 'continuous', granularity: 'ayah', position: { surah: 3, ayah: 84 }, error: null, session: 1 };
    const shows = (patch: Record<string, unknown>) => showsAudioMiniControls({ ...base, ...patch } as never);
    expect(['playing', 'loading', 'paused'].map((phase) => shows({ phase }))).toEqual([true, true, true]);
    expect(['idle', 'ended', 'error'].map((phase) => shows({ phase }))).toEqual([false, false, false]);
    expect(shows({ phase: 'playing', mode: 'single' })).toBe(false);
    expect(shows({ phase: 'paused', mode: 'fullSurah' })).toBe(true);
  });
});

describe('a screen of the root stack (ScreenWithAudioControls)', () => {
  it('exactly Play / Pause, Follow recitation and Stop — no reciter, no ayah, no headphones — at the bottom; the screen above is never covered or remounted', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    expect(hosts('audio-mini')).toHaveLength(0);
    expect(seenBottom).toBe(34);
    await playing();
    expect(buttons()).toEqual(['audio-mini-toggle', 'audio-mini-follow', 'audio-mini-stop']);
    expect(hosts('audio-mini')[0].findAll((node) => String(node.type) === 'Text')).toHaveLength(0);
    expect(hosts('audio-mini')[0].findAll((node) => String(node.type) === 'Headphones')).toHaveLength(0);
    expect(hosts('audio-mini-toggle')[0].props.accessibilityLabel).toBe('Pause');
    expect(hosts('audio-mini-follow')[0].props.accessibilityLabel).toBe(MESSAGES.en.audio.followRecitation);
    expect(hosts('audio-mini-follow')[0].findAll((node) => String(node.type) === 'LocateFixed')).toHaveLength(1);
    expect(hosts('audio-mini-stop')[0].props.accessibilityLabel).toBe(MESSAGES.en.audio.stop);
    // Below the screen, which keeps its own layout above them: its bottom inset is the controls' (they pad the device's edge).
    const screen = root!.root.findAll((node) => String(node.type) === 'View' && node.props.style?.flex === 1)[0];
    const children = (screen.children as ReactTestInstance[]).map(hostId);
    expect(children.at(-1)).toBe('audio-mini-screen');
    expect(seenBottom).toBe(0);
    expect(hosts('audio-mini-screen')[0].props.style).toContainEqual({ paddingBottom: 34 });
    expect(state.mounts).toBe(1);
  });

  it('Play / Pause only pauses and resumes: the controls stay, nothing else is called', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing();
    await press('audio-mini-toggle');
    expect(engine.calls).toEqual(['toggle']);
    expect(engine.state.phase).toBe('paused');
    expect(buttons()).toEqual(['audio-mini-toggle', 'audio-mini-follow', 'audio-mini-stop']);
    expect(hosts('audio-mini-toggle')[0].props.accessibilityLabel).toBe('Play');
    expect(hosts('audio-mini-toggle')[0].findAll((node) => String(node.type) === 'Play')).toHaveLength(1);
    await press('audio-mini-toggle');
    expect(engine.state.phase).toBe('playing');
    expect(engine.calls).toEqual(['toggle', 'toggle']);
  });

  it('X stops (the engine\'s own stop) and the controls go; the screen gets its inset back without remounting', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing({ phase: 'paused' });
    await press('audio-mini-stop');
    expect(engine.calls).toEqual(['stop']);
    expect(hosts('audio-mini')).toHaveLength(0);
    expect(seenBottom).toBe(34);
    expect(state.mounts).toBe(1);
  });

  it('Follow recitation opens the Mushaf at the page of the ayah recited when pressed (read then), playing or paused untouched', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing({ phase: 'paused' });
    // The recitation moved on (here without a re-render): the press reads the engine itself.
    engine.set({ position: { surah: 4, ayah: 1 } }, true);
    await press('audio-mini-follow');
    expect(router.navigate).toHaveBeenCalledTimes(1);
    const [route] = vi.mocked(router.navigate).mock.calls[0] as unknown as [{ pathname: string; params: Record<string, string> }];
    expect(route).toMatchObject({ pathname: '/mushaf', params: { page: String(pageOfPosition({ surah: 4, ayah: 1 })) } });
    expect(route.params.at).toMatch(/^\d+$/);
    expect(engine.calls).toEqual([]);
    expect(engine.state.phase).toBe('paused');
  });

  it('no Follow recitation where the ayah is unknown (a whole-surah recording): never a button that does nothing', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing({ granularity: 'surah', position: { surah: 3, ayah: 0 } });
    expect(buttons()).toEqual(['audio-mini-toggle', 'audio-mini-stop']);
    expect(openRecitedAyahInMushaf()).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('gone when the session finishes or stops with an error; an ayah screen\'s single ayah never shows them', async () => {
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing();
    await act(async () => engine.set({ phase: 'ended' }));
    expect(hosts('audio-mini')).toHaveLength(0);
    await playing();
    await act(async () => engine.set({ phase: 'error', error: { kind: 'network' } }));
    expect(hosts('audio-mini')).toHaveLength(0);
    await playing({ mode: 'single' });
    expect(hosts('audio-mini')).toHaveLength(0);
  });

  it('Arabic: the same three, mirrored; one engine subscription per mounted place', async () => {
    state.locale = 'ar';
    await mount(createElement(ScreenWithAudioControls, null, createElement(Content)));
    await playing();
    expect(hosts('audio-mini')[0].props.style).toContainEqual({ flexDirection: 'row-reverse' });
    expect(hosts('audio-mini-toggle')[0].props.accessibilityLabel).toBe(MESSAGES.ar.audio.pause);
    expect(engine.listenerCount()).toBe(1);
  });
});

describe('the tab bar (AppTabBar)', () => {
  const routes = APP_TABS.map((name) => ({ key: `${name}-key`, name, params: undefined }));
  const tabProps = (index: number) => ({
    state: { index, routes, key: 'tabs', routeNames: [...APP_TABS], type: 'tab', stale: false, history: [] },
    descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: r.name === 'mushaf' ? MUSHAF_TAB_OPTIONS : {} }])),
    navigation: { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() },
    insets: { top: 0, bottom: 34, left: 0, right: 0 },
  }) as never;

  it('on every tab but the Mushaf: the controls above the tabs, inside the bar; on the Mushaf none (its own chip is there)', async () => {
    await playing({ phase: 'paused' });
    for (const index of [0, 1, 3, 4]) {
      await mount(createElement(AppTabBar, tabProps(index)));
      const bar = hosts('app-tab-bar')[0];
      const order = (bar.children as ReactTestInstance[]).map(hostId);
      expect(order, APP_TABS[index]).toEqual(['audio-mini-tabBar', 'app-tab-row']);
      expect(buttons()).toEqual(['audio-mini-toggle', 'audio-mini-follow', 'audio-mini-stop']);
      await act(async () => root!.unmount());
      root = null;
    }
    await mount(createElement(AppTabBar, tabProps(2)));
    expect(hosts('app-tab-bar')).toHaveLength(0);
    expect(hosts('audio-mini')).toHaveLength(0);
  });

  it('no session: the tab bar exactly as before', async () => {
    await mount(createElement(AppTabBar, tabProps(0)));
    const order = (hosts('app-tab-bar')[0].children as ReactTestInstance[]).map(hostId);
    expect(order).toEqual(['app-tab-row']);
  });
});
