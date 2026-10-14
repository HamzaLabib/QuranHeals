import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoState } from '@/mushaf/offline/autoDownload';
import { MESSAGES } from '@/localization/messages';

/**
 * The automatic Mushaf download's quiet line above the tab bar
 * (components/MushafDownloadIndicator.tsx): only while downloading, for the
 * mobile-data question, and briefly once the Mushaf is ready. Everything
 * else (waiting, retrying, failures, pauses) stays silent here.
 */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  auto: null as unknown as AutoState,
  listeners: new Set<() => void>(),
  calls: [] as string[],
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('lucide-react-native', () => ({ Check: 'Check' }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', async () => {
  const { MESSAGES: messages } = await import('@/localization/messages');
  return { useAppLocale: () => ({ locale: state.locale, messages: messages[state.locale] }) };
});
vi.mock('@/mushaf/offline/autoDownloadService', () => ({
  mushafAutoDownload: () => ({
    getState: () => state.auto,
    subscribe: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
    allowCellular: async () => { state.calls.push('allowCellular'); },
    waitForWifi: async () => { state.calls.push('waitForWifi'); },
    dismissCompleted: () => { state.calls.push('dismissCompleted'); },
  }),
}));

const { MushafDownloadIndicator, READY_NOTICE_MS } = await import('@/components/MushafDownloadIndicator');

const base: AutoState = { phase: 'starting', network: 'wifi', progress: null, error: null, retryAt: null, justCompleted: false, runs: 0 };
let root: ReactTestRenderer;
const texts = () => root.root.findAll((n) => n.type === ('Text' as never)).map((n) => [n.props.children].flat().join(''));
const byId = (id: string) => root.root.findAll((n: ReactTestInstance) => n.props.testID === id && typeof n.type === 'string');

async function show(auto: Partial<AutoState>) {
  state.auto = { ...base, ...auto };
  await act(async () => { root = create(createElement(MushafDownloadIndicator)); });
}
async function change(auto: Partial<AutoState>) {
  state.auto = { ...state.auto, ...auto };
  await act(async () => { for (const listener of state.listeners) listener(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.listeners.clear();
  state.calls = [];
});
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.useRealTimers();
});

describe('the download line above the tab bar', () => {
  it('nothing at all while starting, ready (already installed), waiting, retrying, failed, paused, removed, suspended or disabled', async () => {
    for (const phase of ['starting', 'ready', 'waiting-wifi', 'waiting-network', 'retrying', 'failed', 'paused', 'removed', 'suspended', 'disabled'] as const) {
      await show({ phase, error: phase === 'failed' ? 'unavailable' : null });
      expect(root.toJSON()).toBeNull();
      await act(async () => root.unmount());
    }
  });

  it('downloading: «Preparing your Mushaf for offline reading» and one progress over the layout and the fonts', async () => {
    await show({ phase: 'downloading', progress: { phase: 'downloading', chunksTotal: 31, chunksReady: 15, bytesTotal: 1000, bytesReady: 500 } });
    expect(texts()).toEqual([`${MESSAGES.en.mushaf.autoPreparing} · 10%`]);
    expect(byId('mushaf-download-progress')[0].props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '10%' })]));
    await change({ progress: { phase: 'fonts', chunksTotal: 31, chunksReady: 31, bytesTotal: 1000, bytesReady: 1000, fontsTotal: 604, fontsReady: 302 } });
    expect(texts()).toEqual([`${MESSAGES.en.mushaf.autoPreparing} · 60%`]);
  });

  it('Arabic: the approved wording', async () => {
    state.locale = 'ar';
    await show({ phase: 'downloading' });
    expect(texts()[0]).toMatch(/^جارٍ تجهيز المصحف للقراءة دون اتصال · /);
    await act(async () => root.unmount());
    await show({ phase: 'ready', justCompleted: true });
    expect(texts()).toEqual(['المصحف جاهز للقراءة دون اتصال']);
  });

  it('mobile data: the question, with Wait for Wi-Fi and Download now', async () => {
    await show({ phase: 'needs-consent', network: 'cellular' });
    expect(texts()).toEqual([MESSAGES.en.mushaf.autoConsentCellular, MESSAGES.en.mushaf.autoWaitForWifi, MESSAGES.en.mushaf.autoDownloadNow]);
    const [wait, now] = root.root.findAll((n) => n.type === ('Pressable' as never));
    await act(async () => { wait.props.onPress(); });
    await act(async () => { now.props.onPress(); });
    expect(state.calls).toEqual(['waitForWifi', 'allowCellular']);
  });

  it('an unknown network type: the neutral question, with Not now', async () => {
    await show({ phase: 'needs-consent', network: 'unknown' });
    expect(texts()).toEqual([MESSAGES.en.mushaf.autoConsentUnknown, MESSAGES.en.mushaf.autoNotNow, MESSAGES.en.mushaf.autoDownloadNow]);
  });

  it('completed in this session: «Your Mushaf is ready for offline reading» once, dismissed after a few seconds', async () => {
    vi.useFakeTimers();
    await show({ phase: 'ready', justCompleted: true });
    expect(texts()).toEqual([MESSAGES.en.mushaf.autoReady]);
    expect(state.calls).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(READY_NOTICE_MS); });
    expect(state.calls).toEqual(['dismissCompleted']);
    await change({ justCompleted: false });
    expect(root.toJSON()).toBeNull();
  });

  it('removes its subscription when it unmounts', async () => {
    await show({ phase: 'downloading' });
    expect(state.listeners.size).toBe(1);
    await act(async () => root.unmount());
    expect(state.listeners.size).toBe(0);
  });
});
