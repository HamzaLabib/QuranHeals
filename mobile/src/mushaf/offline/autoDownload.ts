import type { DownloadProgress, OfflineErrorKind, OfflineStatus } from './offlineMushaf';

/**
 * Automatic preparation of the offline Mushaf (all 604 pages and their
 * fonts) after the app opens, with no setup step and no sign-in. One
 * controller per app (autoDownloadService.ts), started once by the root
 * layout; every screen only reads its state and calls its actions.
 *
 * It never downloads or verifies anything itself: the verified engine
 * (offlineMushaf.ts) does, unchanged — SHA-256 per chunk, the whole Mushaf
 * checked against the local Tanzil text before it is installed, fonts
 * checked one by one, resuming from what is already verified. This decides
 * only WHEN that engine runs:
 *  - Complete (layout installed and all 604 fonts verified): nothing to
 *    download; the daily update check runs as before.
 *  - Otherwise, on Wi-Fi: starts by itself. On mobile data, or when the
 *    network type can't be told (network.ts): asks first, and remembers the
 *    answer ('allowed' or 'wifi-only').
 *  - Leaving Wi-Fi mid-download without permission pauses it; Wi-Fi resumes it.
 *  - The app going to the background stops the run (the OS would suspend it
 *    anyway); becoming active again resumes it. Nothing claims to download
 *    in the background.
 *  - Failures retry a bounded number of times with growing delays, then stop
 *    until the network returns, the app is reopened after a while, or the
 *    reader taps Try again. Low storage never retries by itself.
 *  - The reader's Pause and Remove are remembered: no automatic download
 *    until they choose Resume / Download again.
 * Only the engine's own complete status makes the phase 'ready': a partial
 * download is never shown as complete.
 */

export type NetworkKind = 'wifi' | 'cellular' | 'none' | 'unknown';
export type NetworkSource = {
  current(): Promise<NetworkKind>;
  subscribe(listener: (kind: NetworkKind) => void): () => void;
};
/** React Native's AppState values ('active', 'background', 'inactive', …). */
export type AppActivitySource = { subscribe(listener: (state: string) => void): () => void };

export type CellularChoice = 'ask' | 'allowed' | 'wifi-only';
/** Device-wide (offline Mushaf files are shared device content, not account data). */
export type AutoPrefs = { cellular: CellularChoice; hold: 'paused' | 'removed' | null };
export const DEFAULT_AUTO_PREFS: AutoPrefs = { cellular: 'ask', hold: null };
export type AutoPrefsStore = { load(): Promise<AutoPrefs>; save(prefs: AutoPrefs): Promise<void> };

export type UpdateOutcome = 'not-installed' | 'not-due' | 'up-to-date' | 'updated' | 'offline' | 'failed';
/** The parts of offlineMushaf.ts this uses. */
export type OfflineEngine = {
  status(): Promise<OfflineStatus>;
  download(options: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void }): Promise<unknown>;
  remove(): Promise<void>;
  checkForUpdate(options?: { force?: boolean; signal?: AbortSignal }): Promise<UpdateOutcome>;
};

export type AutoPhase =
  | 'starting'
  | 'ready'
  | 'needs-consent'
  | 'waiting-wifi'
  | 'waiting-network'
  | 'downloading'
  | 'retrying'
  | 'failed'
  | 'paused'
  | 'removed'
  /** The app is in the background: stopped, and resumes when it is active again. */
  | 'suspended'
  /** Automatic download is off for this build (autoDownloadConfig.ts); the reader can still download. */
  | 'disabled';

export type AutoState = {
  phase: AutoPhase;
  network: NetworkKind;
  progress: DownloadProgress | null;
  /** Why the last attempt failed, while retrying or failed. */
  error: OfflineErrorKind | null;
  retryAt: number | null;
  /** A download in this session just made the Mushaf complete; shown once, cleared by dismissCompleted(). */
  justCompleted: boolean;
  /** Counts finished downloads, updates and removals: the reader reloads its pages when it changes. */
  runs: number;
};

export type AutoDownloadDeps = {
  engine: OfflineEngine;
  network: NetworkSource;
  appActivity: AppActivitySource;
  prefs: AutoPrefsStore;
  /** Automatic starts allowed (autoDownloadConfig.ts), or a check for it (read once; a failed check means no). The reader's own actions always work. */
  enabled: boolean | (() => Promise<boolean>);
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  retryDelaysMs?: readonly number[];
};

/** Bounded: four retries over about 42 minutes, then it waits for a reason to try again. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000] as const;
/** Reopening the app retries a stopped download only if the last failure is at least this old. */
export const FOREGROUND_RETRY_AFTER_MS = 15 * 60_000;

type StopReason = 'pause' | 'remove' | 'network' | 'background' | 'dispose';
type Run = { controller: AbortController; manual: boolean; stopReason: StopReason | null; done: Promise<void> };

const errorKind = (error: unknown): OfflineErrorKind | null => {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' ? (kind as OfflineErrorKind) : null;
};

export function createMushafAutoDownload(deps: AutoDownloadDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;

  let state: AutoState = { phase: 'starting', network: 'unknown', progress: null, error: null, retryAt: null, justCompleted: false, runs: 0 };
  const listeners = new Set<(state: AutoState) => void>();
  let prefs: AutoPrefs = { ...DEFAULT_AUTO_PREFS };
  let enabled = deps.enabled === true;
  let prefsLoad: Promise<void> | null = null;
  let started: Promise<void> | null = null;
  let unsubscribes: (() => void)[] = [];
  let run: Run | null = null;
  let updating: Promise<UpdateOutcome> | null = null;
  /** The reader asked for this download: it may run on any network, and despite a hold. */
  let manualRequested = false;
  let attempts = 0;
  let lastFailureAt = 0;
  let retryTimer: unknown = null;
  /** Retries used up (or low storage): no automatic attempt until a reason to try again. */
  let stalled = false;
  let active = true;
  let updateCheckedThisSession = false;
  let disposed = false;
  let evaluating: Promise<void> | null = null;
  let evaluateAgain = false;

  const set = (patch: Partial<AutoState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const loadPrefs = () => {
    prefsLoad ??= Promise.all([
      deps.prefs.load().then((loaded) => { prefs = loaded; }, () => undefined),
      typeof deps.enabled === 'function' ? deps.enabled().then((allowed) => { enabled = allowed === true; }, () => { enabled = false; }) : undefined,
    ]).then(() => undefined);
    return prefsLoad;
  };
  const savePrefs = async (patch: Partial<AutoPrefs>) => {
    await loadPrefs();
    prefs = { ...prefs, ...patch };
    await deps.prefs.save(prefs).catch(() => undefined);
  };

  const clearRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };
  const resetFailures = () => {
    attempts = 0;
    stalled = false;
    clearRetry();
  };

  /** Re-decides what to do now. One at a time; a request during one runs once more after it. */
  function evaluate(): Promise<void> {
    if (evaluating) {
      evaluateAgain = true;
      return evaluating;
    }
    evaluating = (async () => {
      do {
        evaluateAgain = false;
        await evaluateOnce();
      } while (evaluateAgain && !disposed);
    })().finally(() => { evaluating = null; });
    return evaluating;
  }

  async function evaluateOnce() {
    if (disposed || run || updating) return;
    await loadPrefs();
    const status = await deps.engine.status().catch(() => null);
    if (disposed || run || updating) return;
    if (status?.installed && status.complete) {
      resetFailures();
      manualRequested = false;
      set({ phase: 'ready', progress: null, error: null, retryAt: null });
      maybeCheckForUpdate();
      return;
    }
    if (prefs.hold && !manualRequested) {
      set({ phase: prefs.hold, progress: null, retryAt: null });
      return;
    }
    if (!enabled && !manualRequested) {
      set({ phase: 'disabled', progress: null });
      // As before automatic downloads existed: an installed copy keeps its daily update check (it also completes missing fonts).
      if (status?.installed) maybeCheckForUpdate();
      return;
    }
    if (!active) {
      set({ phase: 'suspended', progress: null });
      return;
    }
    if (!manualRequested && (stalled || retryTimer !== null)) return; // 'failed' or 'retrying' already shown
    const network = await deps.network.current().catch((): NetworkKind => 'unknown');
    if (disposed || run || updating) return;
    set({ network });
    if (network === 'none') {
      set({ phase: 'waiting-network', progress: null });
      return;
    }
    if (network !== 'wifi' && !manualRequested && prefs.cellular !== 'allowed') {
      set({ phase: prefs.cellular === 'wifi-only' ? 'waiting-wifi' : 'needs-consent', progress: null });
      return;
    }
    startRun();
  }

  function startRun() {
    const manual = manualRequested;
    manualRequested = false;
    clearRetry();
    const controller = new AbortController();
    const current: Run = { controller, manual, stopReason: null, done: Promise.resolve() };
    run = current;
    set({ phase: 'downloading', progress: null, error: null, retryAt: null, justCompleted: false });
    current.done = (async () => {
      let outcome: 'complete' | 'incomplete' | { error: unknown };
      try {
        await deps.engine.download({ signal: controller.signal, onProgress: (progress) => { if (run === current) set({ progress }); } });
        // Only the engine's own verified status counts: layout installed and every one of the 604 fonts checked.
        const after = await deps.engine.status().catch(() => null);
        outcome = after?.installed && after.complete ? 'complete' : 'incomplete';
      } catch (error) {
        outcome = { error };
      }
      run = null;
      finish(current, outcome);
    })();
  }

  function finish(current: Run, outcome: 'complete' | 'incomplete' | { error: unknown }) {
    const runs = state.runs + 1;
    if (disposed) return;
    if (outcome === 'complete') {
      resetFailures();
      // This download just installed the current version: today's update check is done.
      updateCheckedThisSession = true;
      set({ phase: 'ready', progress: null, error: null, retryAt: null, justCompleted: true, runs });
      return;
    }
    const kind = outcome === 'incomplete' ? 'integrity' : errorKind(outcome.error) ?? 'storage';
    if (current.stopReason || kind === 'cancelled') {
      if (current.stopReason === 'pause') set({ phase: 'paused', progress: null, runs });
      else if (current.stopReason !== 'remove') {
        set({ progress: null, runs });
        void evaluate();
      }
      return;
    }
    lastFailureAt = now();
    if (kind === 'insufficient_storage' || kind === 'storage') {
      stall(kind, runs);
      return;
    }
    // offline, unavailable (503, Render restarting), integrity (a damaged chunk or font), busy: transient.
    attempts += 1;
    if (attempts > delays.length) {
      stall(kind, runs);
      return;
    }
    const delay = delays[attempts - 1];
    retryTimer = setTimer(() => {
      retryTimer = null;
      void evaluate();
    }, delay);
    set({ phase: 'retrying', progress: null, error: kind, retryAt: now() + delay, runs });
  }

  function stall(kind: OfflineErrorKind, runs: number) {
    stalled = true;
    clearRetry();
    set({ phase: 'failed', progress: null, error: kind, retryAt: null, runs });
  }

  function stopRun(reason: StopReason): Promise<void> {
    const current = run;
    if (!current) return Promise.resolve();
    current.stopReason ??= reason;
    current.controller.abort();
    return current.done;
  }

  /** At most once per session: the engine's own daily-gated check (Quran Foundation's sync terms). */
  function maybeCheckForUpdate() {
    if (updateCheckedThisSession || !active || state.network === 'none') return;
    updateCheckedThisSession = true;
    void runUpdate(false);
  }

  function runUpdate(force: boolean): Promise<UpdateOutcome> {
    updating = deps.engine.checkForUpdate({ force })
      .catch((): UpdateOutcome => 'failed')
      .then((outcome) => {
        updating = null;
        if (outcome === 'updated') set({ runs: state.runs + 1 });
        void evaluate();
        return outcome;
      });
    return updating;
  }

  function onNetwork(kind: NetworkKind) {
    if (disposed) return;
    const previous = state.network;
    set({ network: kind });
    if (run) {
      if (!run.manual && kind !== 'wifi' && prefs.cellular !== 'allowed') void stopRun('network');
      return;
    }
    // Back online, or onto Wi-Fi: a fresh set of attempts.
    if ((previous === 'none' && kind !== 'none') || (kind === 'wifi' && previous !== 'wifi')) resetFailures();
    void evaluate();
  }

  function onAppActivity(activity: string) {
    if (disposed) return;
    if (activity === 'active') {
      if (!active && (stalled || retryTimer !== null) && now() - lastFailureAt >= FOREGROUND_RETRY_AFTER_MS) resetFailures();
      active = true;
      void evaluate();
    } else if (activity === 'background') {
      active = false;
      void stopRun('background');
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (state: AutoState) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    /** The app's one automatic start. Calling it again does nothing more. */
    start(): Promise<void> {
      started ??= (async () => {
        await loadPrefs();
        if (disposed) return;
        unsubscribes = [deps.network.subscribe(onNetwork), deps.appActivity.subscribe(onAppActivity)];
        await evaluate();
      })();
      return started;
    },

    /** Mobile data (or an unknown network): yes, download now and from now on. */
    async allowCellular() {
      await savePrefs({ cellular: 'allowed' });
      await evaluate();
    },
    /** Mobile data: not now; download by itself on Wi-Fi. */
    async waitForWifi() {
      await savePrefs({ cellular: 'wifi-only' });
      await evaluate();
    },
    /** Stops the download, keeping what is verified; no automatic download until resume(). */
    async pause() {
      await savePrefs({ hold: 'paused' });
      if (run) await stopRun('pause');
      else if (state.phase !== 'ready') set({ phase: 'paused', progress: null, retryAt: null });
    },
    /** The reader's Download / Continue / Try again: now, on any network, clearing a pause or removal. */
    async resume() {
      await savePrefs({ hold: null });
      resetFailures();
      manualRequested = true;
      await evaluate();
    },
    /** Deliberate removal of the offline Mushaf (layout and fonts); it is not downloaded again by itself. */
    async remove() {
      await stopRun('remove');
      await savePrefs({ hold: 'removed' });
      resetFailures();
      try {
        await deps.engine.remove();
      } catch (error) {
        // Not removed: show what is actually there.
        set({ runs: state.runs + 1 });
        await evaluate();
        throw error;
      }
      set({ phase: 'removed', progress: null, error: null, retryAt: null, justCompleted: false, runs: state.runs + 1 });
    },
    /** The reader's Check for updates (not daily-gated). */
    async checkForUpdate(): Promise<UpdateOutcome | 'busy'> {
      if (run || updating) return 'busy';
      return runUpdate(true);
    },
    status: () => deps.engine.status(),
    dismissCompleted() {
      if (state.justCompleted) set({ justCompleted: false });
    },
    /** Settles pending decisions and the current download (tests). */
    async whenIdle() {
      for (let i = 0; i < 20 && (evaluating || run || updating); i++) await (evaluating ?? run?.done ?? updating);
    },
    /** Stops everything and removes every listener. The current download is aborted, not waited for (it stops at its next check). */
    async dispose() {
      disposed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      clearRetry();
      listeners.clear();
      void stopRun('dispose');
    },
  };
}

export type MushafAutoDownload = ReturnType<typeof createMushafAutoDownload>;
