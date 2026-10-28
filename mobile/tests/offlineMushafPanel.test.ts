import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * The reader's offline Mushaf panel (shown on a page that isn't downloaded):
 * the one-time-download note sits beside the Download button and its
 * progress, and goes away once the complete copy is on the device.
 */
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  auto: { phase: 'idle', progress: null, runs: 0, error: null } as Record<string, unknown>,
  status: { installed: false, stagedChunks: 0 } as Record<string, unknown>,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('@/theme/useTheme', () => ({ useThemedStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock('@/localization/useAppLocale', async () => {
  const { MESSAGES: messages } = await import('@/localization/messages');
  return { useAppLocale: () => ({ locale: state.locale, messages: messages[state.locale] }) };
});
vi.mock('@/mushaf/offline/useMushafAutoDownload', () => ({ useMushafAutoDownload: () => state.auto }));
vi.mock('@/mushaf/offline/autoDownloadService', () => ({
  mushafAutoDownload: () => ({ status: async () => state.status, resume: async () => undefined, pause: async () => undefined }),
}));

import { OfflineMushafPanel } from '@/components/OfflineMushafPanel';

let root: ReactTestRenderer | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.auto = { phase: 'idle', progress: null, runs: 0, error: null };
  state.status = { installed: false, stagedChunks: 0 };
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

async function render() {
  await act(async () => {
    root = create(createElement(OfflineMushafPanel));
  });
}
const note = () => root!.root.findAll((node) => node.props.testID === 'offline-mushaf-one-time-note');

describe('OfflineMushafPanel: one-time download note', () => {
  it('shows beside the Download button before anything is downloaded', async () => {
    await render();
    expect(note()).toHaveLength(1);
    expect(note()[0].props.children).toBe(MESSAGES.en.mushaf.offlineOneTimeNote);
  });

  it('stays beside the progress while downloading', async () => {
    state.auto = { phase: 'downloading', progress: { phase: 'fonts', fontsReady: 120, fontsTotal: 604, bytesReady: 0, bytesTotal: 0 }, runs: 0, error: null };
    await render();
    expect(note()).toHaveLength(1);
  });

  it('is gone once the complete copy is installed', async () => {
    state.status = { installed: true, complete: true, stagedChunks: 0, syncedAt: '2026-10-28T00:00:00Z', fonts: { ready: 604, total: 604 } };
    await render();
    expect(note()).toHaveLength(0);
  });

  it('is written in each app language, without promising the copy survives removal or a reinstall', async () => {
    for (const locale of ['ar', 'ar-EG'] as const) {
      state.locale = locale;
      await render();
      expect(note()[0].props.children).toBe(MESSAGES[locale].mushaf.offlineOneTimeNote);
    }
    expect(MESSAGES.en.mushaf.offlineOneTimeNote).toMatch(/one-time/);
    expect(MESSAGES.en.mushaf.offlineOneTimeNote).toMatch(/downloaded again/);
    expect(MESSAGES.ar.mushaf.offlineOneTimeNote).toMatch(/من جديد/);
    expect(MESSAGES['ar-EG'].mushaf.offlineOneTimeNote).toMatch(/تاني/);
  });
});
