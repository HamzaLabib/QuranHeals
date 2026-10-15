import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoState } from '@/mushaf/offline/autoDownload';
import type { OfflineStatus } from '@/mushaf/offline/offlineMushaf';

const state = vi.hoisted(() => ({
  status: null as OfflineStatus | null,
  auto: null as unknown as AutoState,
  listeners: new Set<() => void>(),
  resumes: 0,
}));

vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  Pressable: 'Pressable', Text: 'Text', View: 'View', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('lucide-react-native', () => ({ CircleAlert: 'CircleAlert', CircleCheck: 'CircleCheck', Download: 'Download' }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (make: (palette: typeof lightPalette) => unknown) => make(lightPalette) };
});
// The one download controller: its status and phase are what the row reads, and resume() is the download it starts.
vi.mock('@/mushaf/offline/autoDownloadService', () => ({
  mushafAutoDownload: () => ({
    status: async () => {
      if (!state.status) throw new Error('unreadable');
      return state.status;
    },
    resume: async () => { state.resumes += 1; },
    getState: () => state.auto,
    subscribe: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  }),
}));

import { lightPalette } from '@/constants/theme';
import { MESSAGES } from '@/localization/messages';
import { OfflineMushafSettingsRow, offlineRowPercent, offlineRowStatus } from '@/components/OfflineMushafSettingsRow';

const autoState = (patch: Partial<AutoState>): AutoState => ({ phase: 'ready', network: 'wifi', progress: null, error: null, retryAt: null, justCompleted: false, runs: 0, ...patch } as AutoState);
const fonts = (ready: number) => ({ ready, total: 604 }) as OfflineStatus['fonts'];
const COMPLETE: OfflineStatus = { installed: true, version: 'v1', syncedAt: '2026-10-01T00:00:00Z', installedAt: '2026-10-01T00:00:00Z', lastCheckAt: '2026-10-01T00:00:00Z', attribution: '', stagedChunks: 0, fonts: fonts(604), complete: true };
const NOTHING: OfflineStatus = { installed: false, stagedChunks: 0, fonts: fonts(1), complete: false };

let root: ReactTestRenderer | null = null;
const render = async (locale: 'en' | 'ar' = 'en') => {
  const isRtl = locale === 'ar';
  await act(async () => {
    root = create(createElement(OfflineMushafSettingsRow, { messages: MESSAGES[locale], locale, isRtl, direction: { writingDirection: isRtl ? 'rtl' : 'ltr', textAlign: isRtl ? 'right' : 'left' } }));
  });
};
const row = () => root!.root.find((node) => node.props.testID === 'settings-offline-mushaf' && typeof node.type === 'string');
const texts = () => root!.root.findAllByType('Text' as never).map((node: ReactTestInstance) => [node.props.children].flat().join(''));
const iconIds = () => root!.root.findAll((node) => typeof node.type === 'string' && /^offline-mushaf-icon-/.test(node.props.testID ?? '')).map((node) => node.props.testID);
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean));

beforeEach(() => {
  state.status = NOTHING;
  state.auto = autoState({ phase: 'disabled' });
  state.listeners.clear();
  state.resumes = 0;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

describe('offlineRowStatus: what the row may claim', () => {
  it('Available only when the engine reports the Mushaf installed and complete, with every page font verified', () => {
    expect(offlineRowStatus(COMPLETE, 'ready')).toBe('available');
    // Even while an update downloads, the installed copy stays readable.
    expect(offlineRowStatus(COMPLETE, 'downloading')).toBe('available');
    // Installed layout, fonts still missing: not available, whatever the phase says.
    expect(offlineRowStatus({ ...COMPLETE, fonts: fonts(603), complete: false }, 'ready')).toBe('required');
    expect(offlineRowStatus({ ...COMPLETE, fonts: fonts(603), complete: undefined }, 'ready')).toBe('required');
  });
  it('Downloading, Download Failed, Download Required; nothing until the status is known', () => {
    expect(offlineRowStatus(NOTHING, 'downloading')).toBe('downloading');
    expect(offlineRowStatus(NOTHING, 'failed')).toBe('failed');
    expect(offlineRowStatus(NOTHING, 'retrying')).toBe('failed');
    for (const phase of ['starting', 'ready', 'needs-consent', 'waiting-wifi', 'waiting-network', 'paused', 'removed', 'suspended', 'disabled'] as const) {
      expect(offlineRowStatus(NOTHING, phase), phase).toBe('required');
    }
    expect(offlineRowStatus(null, 'downloading')).toBeNull();
  });
  it('progress: the page fonts by count; no number for the layout step', () => {
    expect(offlineRowPercent(null)).toBeNull();
    expect(offlineRowPercent({ phase: 'downloading', chunksTotal: 10, chunksReady: 3, bytesTotal: 100, bytesReady: 30 })).toBeNull();
    expect(offlineRowPercent({ phase: 'fonts', chunksTotal: 10, chunksReady: 10, bytesTotal: 100, bytesReady: 100, fontsTotal: 604, fontsReady: 151 })).toBe(0.25);
  });
});

describe('Settings → Offline Mushaf row', () => {
  it('Download Required: the title, the status, a download icon; tapping starts the existing download', async () => {
    await render();
    expect(texts()).toEqual(['Offline Mushaf', 'Download Required']);
    expect(iconIds()).toEqual(['offline-mushaf-icon-required']);
    expect(row().props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Offline Mushaf, Download Required', disabled: false });
    await act(async () => row().props.onPress());
    expect(state.resumes).toBe(1);
  });

  it('Downloading…: real progress once the page fonts download; not tappable', async () => {
    state.auto = autoState({ phase: 'downloading', progress: { phase: 'downloading', chunksTotal: 4, chunksReady: 1, bytesTotal: 10, bytesReady: 2 } });
    await render();
    expect(texts()).toEqual(['Offline Mushaf', 'Downloading…']);
    expect(iconIds()).toEqual(['offline-mushaf-icon-downloading']);
    expect(row().props.disabled).toBe(true);
    await act(async () => {
      state.auto = autoState({ phase: 'downloading', progress: { phase: 'fonts', chunksTotal: 4, chunksReady: 4, bytesTotal: 10, bytesReady: 10, fontsTotal: 604, fontsReady: 302 } });
      state.listeners.forEach((listener) => listener());
    });
    expect(texts()).toEqual(['Offline Mushaf', 'Downloading… 50%']);
  });

  it('Download Failed: in the danger colour with an alert icon; tapping tries again', async () => {
    state.auto = autoState({ phase: 'failed', error: 'offline' });
    await render();
    expect(texts()).toEqual(['Offline Mushaf', 'Download Failed']);
    expect(iconIds()).toEqual(['offline-mushaf-icon-failed']);
    expect(flat(root!.root.findByProps({ testID: 'settings-offline-mushaf-status' }).props.style).color).toBe(lightPalette.danger);
    await act(async () => row().props.onPress());
    expect(state.resumes).toBe(1);
  });

  it('Available Offline: only from a complete installed copy; information only, no buttons or panel', async () => {
    state.status = COMPLETE;
    state.auto = autoState({ phase: 'ready' });
    await render();
    expect(texts()).toEqual(['Offline Mushaf', 'Available Offline']);
    expect(iconIds()).toEqual(['offline-mushaf-icon-available']);
    expect(row().props).toMatchObject({ accessibilityRole: undefined, disabled: true });
    expect(root!.root.findAll((node) => node.props.accessibilityRole === 'button')).toHaveLength(0);
  });

  it('while the status is unknown: the title alone, no icon and no claim', async () => {
    state.status = null;
    await render();
    expect(texts()).toEqual(['Offline Mushaf']);
    expect(iconIds()).toEqual([]);
    expect(row().props.disabled).toBe(true);
  });

  it('Arabic: the approved wording, mirrored (icon on the left), right-aligned text', async () => {
    await render('ar');
    expect(texts()).toEqual(['المصحف بدون إنترنت', 'يحتاج إلى تحميل']);
    expect(flat(row().props.style({ pressed: false })).flexDirection).toBe('row-reverse');
    for (const text of root!.root.findAllByType('Text' as never)) expect(flat(text.props.style)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
    for (const [key, ar] of [['offlineMushafAvailable', 'متاح بدون إنترنت'], ['offlineMushafDownloading', 'جارٍ التحميل'], ['offlineMushafFailed', 'فشل التحميل']] as const) {
      expect(MESSAGES.ar.settings[key]).toBe(ar);
      expect(MESSAGES['ar-EG'].settings[key]).toBe(ar);
    }
  });
});

describe('the download size, as the reader is told it', () => {
  it('about 100 MB everywhere it is mentioned (measured: ~95 MB of page fonts and ~2 MB of layout), in every language', () => {
    const m = (locale: 'en' | 'ar' | 'ar-EG') => MESSAGES[locale].mushaf;
    for (const key of ['offlineIntro', 'autoConsentCellular', 'autoConsentUnknown'] as const) {
      expect(m('en')[key], key).toContain('about 100 MB');
      expect(m('ar')[key], key).toContain('حوالي ١٠٠ ميغابايت');
      expect(m('ar-EG')[key], key).toContain('حوالي ١٠٠ ميجا');
      for (const locale of ['en', 'ar', 'ar-EG'] as const) expect(m(locale)[key], `${locale} ${key}`).not.toMatch(/115|١١٥/);
    }
  });
});
