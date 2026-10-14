/// <reference types="node" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMushafAutoDownload,
  DEFAULT_AUTO_PREFS,
  FOREGROUND_RETRY_AFTER_MS,
  RETRY_DELAYS_MS,
  type AutoPrefs,
  type NetworkKind,
  type OfflineEngine,
  type UpdateOutcome,
} from '@/mushaf/offline/autoDownload';
import { createOfflineMushaf, type DownloadProgress, type OfflineStatus } from '@/mushaf/offline/offlineMushaf';
import type { ChunkPage } from '@/mushaf/offline/dataset';
import type { OfflineDb } from '@/mushaf/offline/store';
import { createQuranRepository, type QuranVerse } from '@/services/quranRepository';

import { openTestDatabase } from './helpers/sqlite';
import { fakeFontCdn, memoryFontFiles } from './helpers/syntheticFonts';
import { fakeRelay, nodeOfflineDb, publishVersion, syntheticPages } from './helpers/syntheticOfflineMushaf';

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));

/**
 * The automatic first-launch download of the offline Mushaf
 * (mushaf/offline/autoDownload.ts): when it starts, how it asks on mobile
 * data, how it pauses, resumes and retries, and that only the engine's own
 * verified "complete" ever counts. The first part drives the controller with
 * a scripted engine; the second runs the real verified engine
 * (offlineMushaf.ts) on synthetic data and a real SQLite file.
 */

const cancelled = () => Object.assign(new Error('The download was cancelled'), { kind: 'cancelled' });
const failure = (kind: string) => Object.assign(new Error(kind), { kind });
const PROGRESS: DownloadProgress = { phase: 'downloading', chunksTotal: 31, chunksReady: 3, bytesTotal: 100, bytesReady: 10 };

/** A scripted engine: each download takes the next step ('ok' completes; 'hang' waits for finish() or an abort). */
function scriptedEngine() {
  const s = {
    installed: false,
    complete: false,
    downloads: 0,
    removes: 0,
    steps: [] as ('ok' | 'hang' | 'incomplete' | Error)[],
    updateCalls: [] as { force?: boolean }[],
    updateOutcome: 'up-to-date' as UpdateOutcome,
    finish: null as null | (() => void),
  };
  const engine: OfflineEngine = {
    status: async () => ({ installed: s.installed, stagedChunks: 0, complete: s.complete }) as OfflineStatus,
    async download({ signal, onProgress }) {
      s.downloads += 1;
      const step = s.steps.shift() ?? 'ok';
      onProgress?.(PROGRESS);
      if (step instanceof Error) throw step;
      if (step === 'incomplete') {
        s.installed = true; // layout in, fonts still missing
        return {};
      }
      if (step === 'hang') {
        await new Promise<void>((resolve, reject) => {
          s.finish = resolve;
          signal?.addEventListener('abort', () => reject(cancelled()));
        });
      }
      s.installed = true;
      s.complete = true;
      return {};
    },
    async remove() {
      s.removes += 1;
      s.installed = false;
      s.complete = false;
    },
    async checkForUpdate(options) {
      s.updateCalls.push(options ?? {});
      return s.updateOutcome;
    },
  };
  return { engine, s };
}

function harness(options: { network?: NetworkKind; prefs?: AutoPrefs; enabled?: boolean; engine?: OfflineEngine } = {}) {
  const scripted = scriptedEngine();
  const net = { kind: options.network ?? 'wifi', listeners: new Set<(k: NetworkKind) => void>() };
  const app = { listeners: new Set<(s: string) => void>() };
  const stored = { prefs: options.prefs ?? { ...DEFAULT_AUTO_PREFS }, saves: 0 };
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  let clock = Date.parse('2026-10-14T10:00:00Z');
  const controller = createMushafAutoDownload({
    engine: options.engine ?? scripted.engine,
    network: {
      current: async () => net.kind,
      subscribe: (listener) => { net.listeners.add(listener); return () => net.listeners.delete(listener); },
    },
    appActivity: { subscribe: (listener) => { app.listeners.add(listener); return () => app.listeners.delete(listener); } },
    prefs: {
      load: async () => ({ ...stored.prefs }),
      save: async (prefs) => { stored.prefs = { ...prefs }; stored.saves += 1; },
    },
    enabled: options.enabled ?? true,
    now: () => clock,
    setTimer: (run, ms) => { const t = { run, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
  });
  const settle = () => controller.whenIdle();
  /** Lets the controller react to an event without waiting for a download that is meant to keep running. */
  const quiet = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return {
    controller,
    s: scripted.s,
    net,
    app,
    stored,
    timers,
    settle,
    phase: () => controller.getState().phase,
    advance: (ms: number) => { clock += ms; },
    async network(kind: NetworkKind) { net.kind = kind; for (const l of [...net.listeners]) l(kind); await quiet(); },
    async activity(state: string) { for (const l of [...app.listeners]) l(state); await quiet(); },
    /** Fires the pending retry timer (the delay elapsed). */
    async fireRetry() {
      const t = timers.filter((x) => !x.cleared).at(-1)!;
      t.cleared = true;
      clock += t.ms;
      t.run();
      await settle();
    },
  };
}

let h: ReturnType<typeof harness>;
afterEach(async () => {
  await h?.controller.dispose();
});

describe('first launch', () => {
  it('fresh installation on Wi-Fi: downloads by itself, and is ready once — and only once — the engine reports it complete', async () => {
    h = harness({ network: 'wifi' });
    const seen: string[] = [];
    h.controller.subscribe((state) => seen.push(state.phase));
    await h.controller.start();
    await h.settle();
    expect(h.s.downloads).toBe(1);
    expect(seen).toContain('downloading');
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', justCompleted: true, runs: 1 });
    // The completion notice is shown once.
    h.controller.dismissCompleted();
    expect(h.controller.getState().justCompleted).toBe(false);
  });

  it('fresh installation on mobile data: nothing downloads until the reader agrees; the answer is remembered', async () => {
    h = harness({ network: 'cellular' });
    await h.controller.start();
    expect(h.phase()).toBe('needs-consent');
    expect(h.controller.getState().network).toBe('cellular');
    expect(h.s.downloads).toBe(0);
    await h.controller.allowCellular();
    await h.settle();
    expect(h.s.downloads).toBe(1);
    expect(h.phase()).toBe('ready');
    expect(h.stored.prefs.cellular).toBe('allowed');
  });

  it('a later launch on mobile data, after "Download now" was chosen, continues without asking again', async () => {
    h = harness({ network: 'cellular', prefs: { cellular: 'allowed', hold: null } });
    await h.controller.start();
    await h.settle();
    expect(h.s.downloads).toBe(1);
    expect(h.phase()).toBe('ready');
  });

  it('permission declined: waits for Wi-Fi without asking again, even after a restart; Wi-Fi then starts it', async () => {
    h = harness({ network: 'cellular' });
    await h.controller.start();
    await h.controller.waitForWifi();
    expect(h.phase()).toBe('waiting-wifi');
    expect(h.stored.prefs.cellular).toBe('wifi-only');
    const saved = h.stored.prefs;
    await h.controller.dispose();

    h = harness({ network: 'cellular', prefs: saved });
    await h.controller.start();
    expect(h.phase()).toBe('waiting-wifi'); // no question again
    expect(h.s.downloads).toBe(0);
    await h.network('wifi');
    expect(h.s.downloads).toBe(1);
    expect(h.phase()).toBe('ready');
  });

  it('an unknown network type (no network module in this build) is treated like mobile data: it asks first', async () => {
    h = harness({ network: 'unknown' });
    await h.controller.start();
    expect(h.controller.getState()).toMatchObject({ phase: 'needs-consent', network: 'unknown' });
    expect(h.s.downloads).toBe(0);
  });

  it('existing completed download: nothing is downloaded again; only the daily-gated update check runs, once', async () => {
    h = harness({ network: 'wifi' });
    h.s.installed = true;
    h.s.complete = true;
    await h.controller.start();
    await h.settle();
    expect(h.s.downloads).toBe(0);
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', justCompleted: false });
    expect(h.s.updateCalls).toEqual([{ force: false }]);
    await h.activity('background');
    await h.activity('active');
    expect(h.s.updateCalls).toHaveLength(1); // once per session; the engine itself gates it to daily
  });

  it('no network at all: waits, then starts when the connection returns', async () => {
    h = harness({ network: 'none' });
    await h.controller.start();
    expect(h.phase()).toBe('waiting-network');
    await h.network('wifi');
    expect(h.phase()).toBe('ready');
  });

  it('concurrent startup attempts start one controller and one download', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['hang'];
    await Promise.all([h.controller.start(), h.controller.start(), h.controller.start()]);
    expect(h.phase()).toBe('downloading');
    expect(h.net.listeners.size).toBe(1);
    expect(h.app.listeners.size).toBe(1);
    expect(h.s.downloads).toBe(1);
    await h.network('wifi'); // more triggers while it runs: still one download
    await h.activity('active');
    expect(h.s.downloads).toBe(1);
    h.s.finish!();
    await h.settle();
    expect(h.phase()).toBe('ready');
  });

  it('automatic download off for this build (release gate): no automatic start, but the reader`s Download still works', async () => {
    h = harness({ network: 'wifi', enabled: false });
    await h.controller.start();
    expect(h.phase()).toBe('disabled');
    expect(h.s.downloads).toBe(0);
    await h.controller.resume();
    await h.settle();
    expect(h.s.downloads).toBe(1);
    expect(h.phase()).toBe('ready');
  });

  it('release gate off, but a copy already installed: its update check still runs as before', async () => {
    h = harness({ network: 'wifi', enabled: false });
    h.s.installed = true; // fonts not all in yet
    await h.controller.start();
    await h.settle();
    expect(h.phase()).toBe('disabled');
    expect(h.s.updateCalls).toHaveLength(1);
  });
});

describe('never complete until verified complete', () => {
  it('a download that ends without the engine reporting complete is not ready: it retries', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['incomplete'];
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'retrying', error: 'integrity', justCompleted: false });
  });
});

describe('failures: bounded retries with growing delays', () => {
  it('server unavailable (503, Render restarting): retries after 30 s, 2, 10 and 30 min, then stops trying by itself', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = Array.from({ length: 5 }, () => failure('unavailable'));
    await h.controller.start();
    await h.settle();
    const delays: number[] = [];
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      expect(h.controller.getState()).toMatchObject({ phase: 'retrying', error: 'unavailable' });
      delays.push(h.timers.filter((t) => !t.cleared).at(-1)!.ms);
      await h.fireRetry();
    }
    expect(delays).toEqual([...RETRY_DELAYS_MS]);
    expect(h.s.downloads).toBe(5);
    expect(h.controller.getState()).toMatchObject({ phase: 'failed', error: 'unavailable' });
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0); // nothing scheduled: no endless retrying
    await h.activity('active');
    expect(h.s.downloads).toBe(5); // a quick return to the app does not start again
  });

  it('after giving up: reopening the app a while later, the network returning, or Try again starts a fresh set of attempts', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = Array.from({ length: 5 }, () => failure('offline'));
    await h.controller.start();
    await h.settle();
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) await h.fireRetry();
    expect(h.phase()).toBe('failed');
    await h.activity('background');
    h.advance(FOREGROUND_RETRY_AFTER_MS);
    await h.activity('active');
    expect(h.s.downloads).toBe(6);
    expect(h.phase()).toBe('ready');
  });

  it('low storage: reported, never retried by itself; Try again tries once more', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = [failure('insufficient_storage')];
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'failed', error: 'insufficient_storage' });
    expect(h.timers).toHaveLength(0);
    await h.network('wifi');
    await h.activity('active');
    expect(h.s.downloads).toBe(1);
    await h.controller.resume();
    await h.settle();
    expect(h.s.downloads).toBe(2);
    expect(h.phase()).toBe('ready');
  });

  it('a lost connection mid-download waits for the network, and its return retries at once', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = [failure('offline')];
    await h.controller.start();
    await h.settle();
    expect(h.phase()).toBe('retrying');
    await h.network('none');
    expect(h.phase()).toBe('retrying'); // the scheduled retry still stands
    await h.network('wifi');
    expect(h.timers.every((t) => t.cleared)).toBe(true);
    expect(h.s.downloads).toBe(2);
    expect(h.phase()).toBe('ready');
  });
});

describe('changing network type, app lifecycle, pause and removal', () => {
  it('Wi-Fi to mobile data mid-download pauses it and asks; back on Wi-Fi it continues', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['hang', 'ok'];
    await h.controller.start();
    expect(h.phase()).toBe('downloading');
    await h.network('cellular');
    expect(h.phase()).toBe('needs-consent');
    await h.network('wifi');
    expect(h.s.downloads).toBe(2);
    expect(h.phase()).toBe('ready');
  });

  it('with mobile data allowed, leaving Wi-Fi does not interrupt the download', async () => {
    h = harness({ network: 'wifi', prefs: { cellular: 'allowed', hold: null } });
    h.s.steps = ['hang'];
    await h.controller.start();
    await h.network('cellular');
    expect(h.phase()).toBe('downloading');
    h.s.finish!();
    await h.settle();
    expect(h.s.downloads).toBe(1);
    expect(h.phase()).toBe('ready');
  });

  it('the app going to the background stops the run; becoming active resumes it', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['hang', 'ok'];
    await h.controller.start();
    await h.activity('background');
    expect(h.phase()).toBe('suspended');
    expect(h.s.downloads).toBe(1);
    await h.activity('inactive'); // iOS's transient state changes nothing
    expect(h.s.downloads).toBe(1);
    await h.activity('active');
    expect(h.s.downloads).toBe(2);
    expect(h.phase()).toBe('ready');
  });

  it('Pause is remembered across a restart; Continue resumes', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['hang'];
    await h.controller.start();
    await h.controller.pause();
    expect(h.phase()).toBe('paused');
    expect(h.stored.prefs.hold).toBe('paused');
    const saved = h.stored.prefs;
    await h.controller.dispose();

    h = harness({ network: 'wifi', prefs: saved });
    await h.controller.start();
    expect(h.phase()).toBe('paused');
    expect(h.s.downloads).toBe(0);
    await h.controller.resume();
    await h.settle();
    expect(h.stored.prefs.hold).toBeNull();
    expect(h.phase()).toBe('ready');
  });

  it('a deliberate removal is never undone by itself; Download brings it back', async () => {
    h = harness({ network: 'wifi' });
    await h.controller.start();
    await h.settle();
    const runs = h.controller.getState().runs;
    await h.controller.remove();
    expect(h.s.removes).toBe(1);
    expect(h.controller.getState()).toMatchObject({ phase: 'removed', runs: runs + 1 });
    await h.network('wifi');
    await h.activity('active');
    expect(h.s.downloads).toBe(1);
    await h.controller.resume();
    await h.settle();
    expect(h.s.downloads).toBe(2);
    expect(h.phase()).toBe('ready');
  });

  it('removing during a download stops it first, then removes', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = ['hang'];
    await h.controller.start();
    await h.controller.remove();
    expect(h.s.removes).toBe(1);
    expect(h.phase()).toBe('removed');
  });

  it('update detection: Check for updates reports what the engine found, and the reader reloads after an update', async () => {
    h = harness({ network: 'wifi' });
    h.s.installed = true;
    h.s.complete = true;
    await h.controller.start();
    await h.settle();
    const runs = h.controller.getState().runs;
    h.s.updateOutcome = 'updated';
    expect(await h.controller.checkForUpdate()).toBe('updated');
    expect(h.s.updateCalls.at(-1)).toEqual({ force: true });
    expect(h.controller.getState().runs).toBe(runs + 1);
    h.s.updateOutcome = 'up-to-date';
    expect(await h.controller.checkForUpdate()).toBe('up-to-date');
    expect(h.controller.getState().runs).toBe(runs + 1);
  });

  it('dispose removes every listener and pending retry', async () => {
    h = harness({ network: 'wifi' });
    h.s.steps = [failure('offline')];
    await h.controller.start();
    await h.settle();
    const changes = vi.fn();
    h.controller.subscribe(changes);
    await h.controller.dispose();
    expect(h.net.listeners.size).toBe(0);
    expect(h.app.listeners.size).toBe(0);
    expect(h.timers.every((t) => t.cleared)).toBe(true);
    await h.network('wifi');
    expect(changes).not.toHaveBeenCalled();
    expect(h.s.downloads).toBe(1);
  });
});

describe('stored choices (autoDownloadService.ts)', () => {
  it('device-wide key; damaged or unknown values fall back to asking first', async () => {
    const { AUTO_DOWNLOAD_PREFS_KEY, parseAutoPrefs } = await import('@/mushaf/offline/autoDownloadService');
    expect(AUTO_DOWNLOAD_PREFS_KEY).toBe('quran-heals:mushaf-offline-auto:v1');
    expect(AUTO_DOWNLOAD_PREFS_KEY).not.toMatch(/account/);
    expect(parseAutoPrefs(JSON.stringify({ cellular: 'allowed', hold: 'paused' }))).toEqual({ cellular: 'allowed', hold: 'paused' });
    for (const raw of [null, '{', JSON.stringify({ cellular: 'always' }), JSON.stringify({ cellular: 'ask', hold: 'gone' })]) expect(parseAutoPrefs(raw)).toEqual(DEFAULT_AUTO_PREFS);
  });

});

describe('build gate (autoDownloadConfig.ts): development and EAS preview builds only', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('expo-updates');
    vi.resetModules();
  });

  it('the rule: development always; otherwise only the preview channel — never production, another channel, or none', async () => {
    const { AUTO_DOWNLOAD_CHANNELS, resolveAutoDownloadEnabled } = await import('@/mushaf/offline/autoDownloadConfig');
    expect(AUTO_DOWNLOAD_CHANNELS).toEqual(['preview']);
    expect(resolveAutoDownloadEnabled({ dev: true, channel: null })).toBe(true); // development builds: unchanged
    expect(resolveAutoDownloadEnabled({ dev: true, channel: 'production' })).toBe(true);
    expect(resolveAutoDownloadEnabled({ dev: false, channel: 'preview' })).toBe(true);
    for (const channel of ['production', 'development', 'Preview', 'preview-2', '', null, undefined]) {
      expect(resolveAutoDownloadEnabled({ dev: false, channel }), String(channel)).toBe(false);
    }
  });

  it('matches eas.json: the preview profile builds on the preview channel, production on its own', async () => {
    const { readFileSync } = await import('node:fs');
    const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8')) as { build: Record<string, { channel?: string }> };
    const { resolveAutoDownloadEnabled } = await import('@/mushaf/offline/autoDownloadConfig');
    expect(eas.build.preview.channel).toBe('preview');
    expect(resolveAutoDownloadEnabled({ dev: false, channel: eas.build.preview.channel })).toBe(true);
    expect(resolveAutoDownloadEnabled({ dev: false, channel: eas.build.production.channel })).toBe(false);
  });

  for (const [channel, expected] of [['preview', true], ['production', false], [null, false]] as const) {
    it(`a release binary on channel ${String(channel)}: ${expected ? 'on' : 'off'} (read from expo-updates)`, async () => {
      vi.stubGlobal('__DEV__', false);
      vi.doMock('expo-updates', () => ({ channel }));
      const { autoDownloadEnabled } = await import('@/mushaf/offline/autoDownloadConfig');
      expect(await autoDownloadEnabled()).toBe(expected);
    });
  }

  it('a development build is on without reading the channel (development builds have none)', async () => {
    vi.stubGlobal('__DEV__', true);
    vi.doMock('expo-updates', () => { throw new Error('must not be loaded'); });
    const { autoDownloadEnabled } = await import('@/mushaf/offline/autoDownloadConfig');
    expect(await autoDownloadEnabled()).toBe(true);
  });

  it('expo-updates failing to load in a release build: off', async () => {
    vi.stubGlobal('__DEV__', false);
    vi.doMock('expo-updates', () => { throw new Error('no native module'); });
    const { autoDownloadEnabled } = await import('@/mushaf/offline/autoDownloadConfig');
    expect(await autoDownloadEnabled()).toBe(false);
  });

  it('the controller honours the check: off (production) never starts by itself, on (preview) does; a failing check means off', async () => {
    for (const [enabled, downloads, phase] of [
      [async () => false, 0, 'disabled'],
      [async () => true, 1, 'ready'],
      [async () => { throw new Error('check failed'); }, 0, 'disabled'],
    ] as const) {
      const scripted = scriptedEngine();
      const controller = createMushafAutoDownload({
        engine: scripted.engine,
        network: { current: async () => 'wifi', subscribe: () => () => undefined },
        appActivity: { subscribe: () => () => undefined },
        prefs: { load: async () => ({ ...DEFAULT_AUTO_PREFS }), save: async () => undefined },
        enabled,
      });
      await controller.start();
      await controller.whenIdle();
      expect(scripted.s.downloads).toBe(downloads);
      expect(controller.getState().phase).toBe(phase);
      await controller.dispose();
    }
  });
});

// ── With the real verified engine (offlineMushaf.ts): synthetic data, a real SQLite file ──

let verses: QuranVerse[];
let pages: ChunkPage[];
beforeAll(async () => {
  verses = await createQuranRepository(async () => openTestDatabase()).getAllVerses();
  pages = syntheticPages(verses);
});

let dir: string;
let opened: OfflineDb[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auto-download-'));
  opened = [];
});
afterEach(async () => {
  for (const db of opened) await db.closeAsync().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

function realDevice() {
  const relay = fakeRelay(publishVersion(pages));
  const cdn = fakeFontCdn();
  const files = memoryFontFiles();
  const dbPath = join(dir, 'm.db');
  /** A fresh engine on the same database and files: what an app restart sees. */
  const engine = () => createOfflineMushaf({
    openDb: async () => { const db = nodeOfflineDb(dbPath); opened.push(db); return db; },
    relay: relay.relay,
    verses: async () => verses,
    freeBytes: () => 1e10,
    now: () => new Date('2026-10-14T10:00:00Z'),
    fonts: { source: cdn.source, files },
  });
  return { relay, cdn, files, engine };
}

describe('with the real engine', { timeout: 20_000 }, () => {
  it('interrupted download and restart: the next launch resumes with only what is missing, and is complete; a later launch downloads nothing', async () => {
    const device = realDevice();
    device.relay.state.dropAfter = 12; // the connection drops after 12 of the 31 layout chunks
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'retrying', error: 'offline' });
    expect(await device.engine().status()).toMatchObject({ installed: false, stagedChunks: 12 });
    await h.controller.dispose(); // the app is closed

    device.relay.state.dropAfter = Infinity;
    device.relay.state.chunkCalls = [];
    h = harness({ network: 'wifi', engine: device.engine() }); // relaunched
    await h.controller.start();
    await h.settle();
    expect(device.relay.state.chunkCalls).toHaveLength(31 - 12); // the 12 verified chunks were kept
    expect(device.cdn.state.calls).toHaveLength(603); // page 61's font is bundled
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', justCompleted: true });
    expect(await device.engine().status()).toMatchObject({ installed: true, complete: true, fonts: { ready: 604, total: 604 } });
    await h.controller.dispose();

    // No unnecessary full re-download: complete, so nothing is fetched at all.
    device.relay.state.chunkCalls = [];
    device.cdn.state.calls = [];
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', justCompleted: false });
    expect(device.relay.state.chunkCalls).toHaveLength(0);
    expect(device.cdn.state.calls).toHaveLength(0);
  });

  it('partial download resume across the fonts: an interrupted font download is never complete, and continues where it stopped', async () => {
    const device = realDevice();
    device.cdn.state.dropAfter = 300;
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    expect(h.phase()).toBe('retrying');
    const partial = await device.engine().status();
    expect(partial).toMatchObject({ installed: true, complete: false });
    device.cdn.state.dropAfter = Infinity;
    device.cdn.state.calls = [];
    device.relay.state.chunkCalls = [];
    await h.fireRetry();
    expect(device.relay.state.chunkCalls).toHaveLength(0); // the layout is installed: not downloaded again
    expect(device.cdn.state.calls).toHaveLength(604 - partial.fonts!.ready);
    expect(h.phase()).toBe('ready');
  });

  it('complete resource validation: a chunk that never matches its SHA-256 is never installed, never shown as ready', async () => {
    const device = realDevice();
    device.relay.state.tamper.set(7, 'always');
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'retrying', error: 'integrity', justCompleted: false });
    expect(await device.engine().status()).toMatchObject({ installed: false });
    expect(await device.engine().readPage(150)).toBeNull(); // chunk 7 holds pages 141–160
  });

  it('server returning 503 (the relay not ready, or Render restarting): nothing installed, retried later, then completes', async () => {
    const device = realDevice();
    device.relay.state.available = false;
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'retrying', error: 'unavailable' });
    device.relay.state.available = true;
    await h.fireRetry();
    expect(h.phase()).toBe('ready');
  });

  it('low storage: refused before anything is downloaded', async () => {
    const device = realDevice();
    const engine = createOfflineMushaf({
      openDb: async () => { const db = nodeOfflineDb(join(dir, 'small.db')); opened.push(db); return db; },
      relay: device.relay.relay,
      verses: async () => verses,
      freeBytes: () => 5 * 1024 * 1024,
      fonts: { source: device.cdn.source, files: device.files },
    });
    h = harness({ network: 'wifi', engine });
    await h.controller.start();
    await h.settle();
    expect(h.controller.getState()).toMatchObject({ phase: 'failed', error: 'insufficient_storage' });
    expect(device.relay.state.chunkCalls).toHaveLength(0);
  });

  it('correct offline reading after completion: every page and its font come from the device', async () => {
    const device = realDevice();
    h = harness({ network: 'wifi', engine: device.engine() });
    await h.controller.start();
    await h.settle();
    device.relay.state.online = false;
    device.cdn.state.online = false;
    const engine = device.engine();
    for (const page of [1, 2, 187, 300, 604]) {
      const layout = await engine.readPage(page);
      expect(layout).toMatchObject({ page, fontFamily: `QCF_P${String(page).padStart(3, '0')}` });
      expect(layout!.lines.length).toBeGreaterThan(0);
    }
    expect(await engine.pageFont(300)).toEqual({ family: 'QCF_P300', uri: 'file:///fonts/p300.ttf' });
    expect(await engine.pageFont(61)).toBe('bundled');
  });
});

