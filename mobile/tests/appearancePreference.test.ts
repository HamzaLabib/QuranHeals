import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' | null }));
const asyncStorageState = vi.hoisted(() => new Map<string, string>());
const asyncStorageShouldFail = vi.hoisted(() => ({ current: false }));

vi.mock('react-native', () => ({
  useColorScheme: () => state.scheme,
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (asyncStorageShouldFail.current) throw new Error('storage unavailable');
      return asyncStorageState.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (asyncStorageShouldFail.current) throw new Error('storage unavailable');
      asyncStorageState.set(key, value);
    }),
  },
}));

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8');

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  state.scheme = 'light';
  asyncStorageState.clear();
  asyncStorageShouldFail.current = false;
});

describe('appearancePreference.ts: validation', () => {
  it('defaults to Light, not System (a user who has never chosen an appearance gets Light)', async () => {
    const { DEFAULT_APPEARANCE_MODE } = await import('@/theme/appearancePreference');
    expect(DEFAULT_APPEARANCE_MODE).toBe('light');
  });

  it('isValidAppearanceMode accepts exactly system/light/dark', async () => {
    const { isValidAppearanceMode } = await import('@/theme/appearancePreference');
    expect(isValidAppearanceMode('system')).toBe(true);
    expect(isValidAppearanceMode('light')).toBe(true);
    expect(isValidAppearanceMode('dark')).toBe(true);
    expect(isValidAppearanceMode('auto')).toBe(false);
    expect(isValidAppearanceMode('')).toBe(false);
    expect(isValidAppearanceMode(null)).toBe(false);
    expect(isValidAppearanceMode(undefined)).toBe(false);
    expect(isValidAppearanceMode(1)).toBe(false);
  });

  it('parseAppearanceMode falls back to Light for any invalid/malformed payload, without throwing', async () => {
    const { parseAppearanceMode } = await import('@/theme/appearancePreference');
    expect(parseAppearanceMode('light')).toBe('light');
    expect(parseAppearanceMode('dark')).toBe('dark');
    expect(parseAppearanceMode('system')).toBe('system');
    expect(parseAppearanceMode('neon')).toBe('light');
    expect(parseAppearanceMode(null)).toBe('light');
    expect(parseAppearanceMode(undefined)).toBe('light');
    expect(parseAppearanceMode({ mode: 'dark' })).toBe('light');
    expect(parseAppearanceMode(42)).toBe('light');
  });
});

describe('appearancePreference.ts: AsyncStorage-backed load/save round trip', () => {
  it('fresh install (storage key has never been written): loadAppearancePreference returns Light', async () => {
    const { loadAppearancePreference } = await import('@/theme/appearancePreference');
    expect(await loadAppearancePreference()).toBe('light');
  });

  it('missing stored value (key explicitly absent) resolves to Light', async () => {
    asyncStorageState.delete('quran-heals:appearance-preference:v1');
    const { loadAppearancePreference } = await import('@/theme/appearancePreference');
    expect(await loadAppearancePreference()).toBe('light');
  });

  it('saveAppearancePreference persists, and a subsequent load reads exactly what was saved (system)', async () => {
    const { loadAppearancePreference, saveAppearancePreference } = await import('@/theme/appearancePreference');
    await saveAppearancePreference('system');
    expect(await loadAppearancePreference()).toBe('system');
  });

  it('saveAppearancePreference persists, and a subsequent load reads exactly what was saved (light)', async () => {
    const { loadAppearancePreference, saveAppearancePreference } = await import('@/theme/appearancePreference');
    await saveAppearancePreference('light');
    expect(await loadAppearancePreference()).toBe('light');
  });

  it('saveAppearancePreference persists, and a subsequent load reads exactly what was saved (dark)', async () => {
    const { loadAppearancePreference, saveAppearancePreference } = await import('@/theme/appearancePreference');
    await saveAppearancePreference('dark');
    expect(await loadAppearancePreference()).toBe('dark');
  });

  it('corrupted stored value (unparsable JSON) recovers safely to Light', async () => {
    asyncStorageState.set('quran-heals:appearance-preference:v1', '{not valid json');
    const { loadAppearancePreference } = await import('@/theme/appearancePreference');
    expect(await loadAppearancePreference()).toBe('light');
  });

  it('corrupted stored value (validly-parsed but not one of system/light/dark) recovers safely to Light', async () => {
    asyncStorageState.set('quran-heals:appearance-preference:v1', JSON.stringify('ultra-dark'));
    const { loadAppearancePreference } = await import('@/theme/appearancePreference');
    expect(await loadAppearancePreference()).toBe('light');
  });

  it('a storage read failure falls back to Light without throwing', async () => {
    asyncStorageShouldFail.current = true;
    const { loadAppearancePreference } = await import('@/theme/appearancePreference');
    await expect(loadAppearancePreference()).resolves.toBe('light');
  });

  it('a storage write failure is swallowed (non-fatal) without throwing', async () => {
    asyncStorageShouldFail.current = true;
    const { saveAppearancePreference } = await import('@/theme/appearancePreference');
    await expect(saveAppearancePreference('dark')).resolves.toBeUndefined();
  });

  it('uses a versioned/namespaced storage key distinct from other local preferences', async () => {
    const { saveAppearancePreference } = await import('@/theme/appearancePreference');
    await saveAppearancePreference('dark');
    expect(asyncStorageState.has('quran-heals:appearance-preference:v1')).toBe(true);
    expect(asyncStorageState.has('quran-heals:quran-font-size-preference:v1')).toBe(false);
    expect(asyncStorageState.has('quran-heals:app-locale:v1')).toBe(false);
  });
});

describe('AppearancePreferenceProvider + useThemeName: resolves the effective theme', () => {
  type Snapshot = { mode: string; isReady: boolean; theme: string; setMode: (mode: 'system' | 'light' | 'dark') => void };

  function mountProbe(): { renderer: ReactTestRenderer; latest: () => Snapshot; rerender: () => void } {
    let latestSnapshot: Snapshot | undefined;
    function Probe() {
      // Imported lazily inside the component body via module-level imports below.
      const appearance = useAppearancePreferenceRef.current();
      const theme = useThemeNameRef.current();
      latestSnapshot = { mode: appearance.mode, isReady: appearance.isReady, theme, setMode: appearance.setMode };
      return null;
    }
    const tree = () => createElement(AppearancePreferenceProviderRef.current, null, createElement(Probe));
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(tree());
    });
    // Re-renders the SAME element tree, forcing Probe/useColorScheme to be
    // re-evaluated — needed to observe a live device-appearance change,
    // which isn't itself React state.
    const rerender = () => renderer.update(tree());
    return { renderer, latest: () => latestSnapshot!, rerender };
  }

  // Indirection so the mocks above (react-native / AsyncStorage) are in place before these modules load.
  const useAppearancePreferenceRef = { current: null as unknown as typeof import('@/theme/useAppearancePreference').useAppearancePreference };
  const useThemeNameRef = { current: null as unknown as typeof import('@/theme/useTheme').useThemeName };
  const AppearancePreferenceProviderRef = { current: null as unknown as typeof import('@/theme/useAppearancePreference').AppearancePreferenceProvider };

  async function loadRefs() {
    const theme = await import('@/theme/useTheme');
    const appearance = await import('@/theme/useAppearancePreference');
    useThemeNameRef.current = theme.useThemeName;
    useAppearancePreferenceRef.current = appearance.useAppearancePreference;
    AppearancePreferenceProviderRef.current = appearance.AppearancePreferenceProvider;
  }

  it('fresh install: defaults synchronously to Light and resolves immediately without waiting on the AsyncStorage load (never blocks startup, no full-screen loading state)', async () => {
    await loadRefs();
    // The device being in dark mode must NOT affect the default — Light
    // does not follow the device appearance.
    state.scheme = 'dark';
    const { latest } = mountProbe();
    // Synchronously after the first render — before any awaited microtask —
    // the mode is already 'light' and the theme is already resolved.
    expect(latest().mode).toBe('light');
    expect(latest().theme).toBe('light');
  });

  it('becomes isReady after the (empty) AsyncStorage load resolves, remaining on Light when nothing was saved', async () => {
    await loadRefs();
    const { latest } = mountProbe();
    expect(latest().isReady).toBe(false);
    await flushMicrotasks();
    expect(latest().isReady).toBe(true);
    expect(latest().mode).toBe('light');
  });

  it('selecting Light (explicitly) forces the light theme and ignores the device being in dark mode', async () => {
    await loadRefs();
    state.scheme = 'dark';
    const { latest } = mountProbe();
    await flushMicrotasks();
    act(() => latest().setMode('light'));
    expect(latest().mode).toBe('light');
    expect(latest().theme).toBe('light');
  });

  it('selecting Dark forces the dark theme and ignores the device being in light mode', async () => {
    await loadRefs();
    state.scheme = 'light';
    const { latest } = mountProbe();
    await flushMicrotasks();
    act(() => latest().setMode('dark'));
    expect(latest().mode).toBe('dark');
    expect(latest().theme).toBe('dark');
  });

  it('selecting System switches to following the device appearance (the default is Light, so this is no longer a no-op)', async () => {
    await loadRefs();
    state.scheme = 'dark';
    const { latest } = mountProbe();
    await flushMicrotasks();
    expect(latest().mode).toBe('light'); // still the default before any explicit choice
    expect(latest().theme).toBe('light');
    act(() => latest().setMode('system'));
    expect(latest().mode).toBe('system');
    expect(latest().theme).toBe('dark'); // now follows the device scheme
  });

  it('System reacts live to the device appearance changing while mounted', async () => {
    await loadRefs();
    state.scheme = 'light';
    const { latest, rerender } = mountProbe();
    await flushMicrotasks();
    act(() => latest().setMode('system')); // must be explicitly selected — Light is the default
    expect(latest().theme).toBe('light');
    state.scheme = 'dark';
    act(() => rerender());
    expect(latest().theme).toBe('dark');
  });

  it('persists the last selected option: a fresh provider instance (simulating an app restart) restores it (Dark example)', async () => {
    await loadRefs();
    const first = mountProbe();
    await flushMicrotasks();
    act(() => first.latest().setMode('dark'));
    await flushMicrotasks(); // let the fire-and-forget save complete

    // Unmount (app closes) and mount a brand-new provider tree (app restarts).
    act(() => first.renderer.unmount());
    const second = mountProbe();
    expect(second.latest().mode).toBe('light'); // default, not yet loaded
    await flushMicrotasks();
    expect(second.latest().isReady).toBe(true);
    expect(second.latest().mode).toBe('dark'); // restored from storage
    expect(second.latest().theme).toBe('dark');
  });

  it('persists the last selected option across a simulated restart (System example): remains System and keeps following the device', async () => {
    await loadRefs();
    state.scheme = 'dark';
    const first = mountProbe();
    await flushMicrotasks();
    act(() => first.latest().setMode('system'));
    await flushMicrotasks();

    act(() => first.renderer.unmount());
    const second = mountProbe();
    await flushMicrotasks();
    expect(second.latest().mode).toBe('system');
    expect(second.latest().theme).toBe('dark'); // still following the (dark) device scheme
  });

  it('persists the last selected option across a simulated restart (Light example, after switching away from the default)', async () => {
    await loadRefs();
    const first = mountProbe();
    await flushMicrotasks();
    act(() => first.latest().setMode('dark')); // move away from the default first
    await flushMicrotasks();
    act(() => first.latest().setMode('light')); // then explicitly choose Light
    await flushMicrotasks();

    act(() => first.renderer.unmount());
    const second = mountProbe();
    await flushMicrotasks();
    expect(second.latest().mode).toBe('light');
    expect(second.latest().theme).toBe('light');
  });

  it('a storage read failure during initialization falls back to Light and still becomes ready (never blocks/crashes)', async () => {
    await loadRefs();
    asyncStorageShouldFail.current = true;
    const { latest } = mountProbe();
    expect(latest().mode).toBe('light');
    await flushMicrotasks();
    expect(latest().isReady).toBe(true);
    expect(latest().mode).toBe('light');
  });

  it('useAppearancePreference never throws when rendered without a provider (safe Light default, unlike the font-size preference hook)', async () => {
    await loadRefs();
    let seenMode: string | undefined;
    function Probe() {
      seenMode = useAppearancePreferenceRef.current().mode;
      return null;
    }
    expect(() => {
      act(() => {
        create(createElement(Probe));
      });
    }).not.toThrow();
    expect(seenMode).toBe('light');
  });
});

describe('useTheme.ts is the only place useColorScheme is read (no screen bypasses the saved Appearance preference)', () => {
  function listSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) files.push(...listSourceFiles(path));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path);
    }
    return files;
  }

  it('only src/theme/useTheme.ts imports useColorScheme from react-native, anywhere under src/', () => {
    const offenders = listSourceFiles('src').filter(
      (path) => path !== 'src/theme/useTheme.ts' && /\buseColorScheme\b/.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  it('src/theme/useTheme.ts itself still reads useColorScheme (the one intentional call site)', () => {
    expect(read('src/theme/useTheme.ts')).toMatch(/\buseColorScheme\b/);
  });
});

describe('_layout.tsx wires the Appearance preference provider app-wide', () => {
  const layout = read('src/app/_layout.tsx');

  it('wraps the app in AppearancePreferenceProvider', () => {
    expect(layout).toMatch(/<AppearancePreferenceProvider>/);
    expect(layout).toMatch(/<\/AppearancePreferenceProvider>/);
  });

  it('calls useThemeName() from inside AppearancePreferenceProvider (not above it)', () => {
    const providerIndex = layout.indexOf('<AppearancePreferenceProvider>');
    const useThemeNameIndex = layout.indexOf('useThemeName()');
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(useThemeNameIndex).toBeGreaterThan(providerIndex);
  });
});

describe('Settings screen: Appearance selection (source-scan, matching the App Language/Quran Translation row convention)', () => {
  const source = read('src/app/settings.tsx');

  it('offers exactly system/light/dark, derived from APPEARANCE_MODES (never a hardcoded duplicate list)', () => {
    expect(source).toMatch(/APPEARANCE_MODES[\s\S]*?=\s*\['system', 'light', 'dark'\]/);
    expect(source).toMatch(/APPEARANCE_MODES\.map\(/);
  });

  it('is placed directly under the Quran Translation section, and before the Account section', () => {
    const quranTranslationIndex = source.indexOf('messages.settings.quranTranslationSection');
    const appearanceIndex = source.indexOf('messages.appearance.sectionLabel');
    const accountSectionIndex = source.indexOf('<AccountSection');
    expect(quranTranslationIndex).toBeGreaterThanOrEqual(0);
    expect(appearanceIndex).toBeGreaterThan(quranTranslationIndex);
    expect(accountSectionIndex).toBeGreaterThan(appearanceIndex);
  });

  it('selecting an option calls setMode, which (per useAppearancePreference.tsx) updates and persists the choice immediately', () => {
    expect(source).toMatch(/onPress=\{\(\) => setMode\(option\)\}/);
  });

  it('marks the currently-active mode as selected for accessibility/visual state', () => {
    expect(source).toMatch(/selected=\{option === mode\}/);
  });

  it('every Appearance label is sourced from the localized messages object, not a hardcoded string', () => {
    expect(source).toMatch(/messages\.appearance\.sectionLabel/);
    expect(source).toMatch(/messages\.appearance\.system/);
    expect(source).toMatch(/messages\.appearance\.light/);
    expect(source).toMatch(/messages\.appearance\.dark/);
  });

  it('reads/writes the preference via the shared hook, never touching AsyncStorage directly in this screen', () => {
    expect(source).toMatch(/useAppearancePreference\(\)/);
  });
});

describe('Appearance labels are localized correctly in every app locale', () => {
  it('en: System / Light / Dark', async () => {
    const { MESSAGES } = await import('@/localization/messages');
    expect(MESSAGES.en.appearance).toMatchObject({ system: 'System', light: 'Light', dark: 'Dark' });
  });

  it('ar (Standard Arabic): تلقائي / فاتح / الوضع الليلي', async () => {
    const { MESSAGES } = await import('@/localization/messages');
    expect(MESSAGES.ar.appearance).toMatchObject({ system: 'تلقائي', light: 'فاتح', dark: 'الوضع الليلي' });
  });

  it('ar-EG (Egyptian Arabic): تلقائي / فاتح / الوضع الليلي', async () => {
    const { MESSAGES } = await import('@/localization/messages');
    expect(MESSAGES['ar-EG'].appearance).toMatchObject({ system: 'تلقائي', light: 'فاتح', dark: 'الوضع الليلي' });
  });

  it('Dark never uses a banned literal "dark theme" phrasing in Arabic — only الوضع الليلي', async () => {
    const { MESSAGES } = await import('@/localization/messages');
    for (const locale of ['ar', 'ar-EG'] as const) {
      expect(MESSAGES[locale].appearance.dark).toBe('الوضع الليلي');
      expect(MESSAGES[locale].appearance.dark).not.toBe('الوضع الداكن');
      expect(MESSAGES[locale].appearance.dark).not.toBe('المظهر الداكن');
      expect(MESSAGES[locale].appearance.dark).not.toBe('السمة الداكنة');
    }
  });

  it('every locale defines the exact same appearance keys (no locale missing a string the others have)', async () => {
    const { MESSAGES } = await import('@/localization/messages');
    const { APP_LOCALES } = await import('@/localization/locales');
    const keySet = (locale: (typeof APP_LOCALES)[number]) => Object.keys(MESSAGES[locale].appearance).sort();
    expect(keySet('ar')).toEqual(keySet('en'));
    expect(keySet('ar-EG')).toEqual(keySet('en'));
  });
});
