import { firstAyahOfPage, nextAyah, pageOfPosition, previousAyah, samePosition, type AyahPosition } from './quranSequence';
import { getReciter, hasAyahPlayback, type Reciter } from './reciters';
import { ayahStartMs, type SurahTiming, type TimingLoader } from './timing';

/** What the native player reports (audio/expoOutput.ts), in milliseconds. */
export type OutputStatus = {
  positionMs: number;
  playing: boolean;
  buffering: boolean;
  loaded: boolean;
  /** The file played to its end. */
  finished: boolean;
  error: string | null;
};

/**
 * The one audio output (one native player for the whole app). `load` replaces the source and positions it at
 * `startMs`, resolving once it can play (it does not start playing); it rejects when the source cannot be loaded.
 */
export type AudioOutput = {
  load(uri: string, startMs: number): Promise<void>;
  seek(ms: number): Promise<void>;
  play(): void;
  pause(): void;
  /** Stops and unloads: no audio, no lock-screen controls. The output stays usable. */
  stop(): void;
  subscribe(listener: (status: OutputStatus) => void): () => void;
  /** Lock screen / notification: what is playing, or null to clear it. */
  setNowPlaying(info: { title: string; artist: string } | null): void;
  /** Starts buffering a file that is likely next (best effort). */
  preload(uri: string): void;
};

/** Where a surah's audio comes from: a verified file on the device, else MP3Quran's stream. */
export type SourceResolver = (reciter: Reciter, surah: number) => Promise<{ uri: string; local: boolean }>;

export type PlaybackMode =
  /** Ayah after ayah, surah after surah, to the end of the Quran (the Mushaf). */
  | 'continuous'
  /** One ayah, then stop (the ayah screens). */
  | 'single';

export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'ended';

export type PlaybackError = {
  /**
   * 'unavailable': the reciter has no recording with verified timing for this surah (never substituted);
   * 'network': the audio or its timing could not be fetched;
   * 'mismatch': MP3Quran's timing changed since the audit, so it is not used;
   * 'playback': the device could not play the file.
   */
  kind: 'unavailable' | 'network' | 'mismatch' | 'playback';
  surah: number;
  reciterId: string;
};

export type PlaybackNotice =
  /** A reciter chosen during playback has no verified recording of the surah coming next: not queued. */
  { kind: 'reciter-unavailable'; reciterId: string; surah: number };

export type PlaybackState = {
  phase: PlaybackPhase;
  mode: PlaybackMode;
  /** The ayah being recited (or loading, paused, failed on); null when idle. */
  position: AyahPosition | null;
  /** The voice of `position`. */
  reciterId: string | null;
  /** Chosen during an ayah: takes over at the next ayah boundary (or at once on a manual skip). */
  pendingReciterId: string | null;
  /**
   * The reciter chosen in the player for this listening session, if any: new playback in the Mushaf uses it instead of
   * the Favorite Reciter until the player is closed. Never written to the Favorite Reciter setting.
   */
  sessionReciterId: string | null;
  buffering: boolean;
  /** The local file is playing (no network needed). */
  offline: boolean;
  error: PlaybackError | null;
  notice: PlaybackNotice | null;
  /** A new number for every start (a Listen, Play, or the ayah screen's play button). */
  session: number;
};

export const IDLE_STATE: PlaybackState = {
  phase: 'idle',
  mode: 'continuous',
  position: null,
  reciterId: null,
  pendingReciterId: null,
  sessionReciterId: null,
  buffering: false,
  offline: false,
  error: null,
  notice: null,
  session: 0,
};

export type EngineDeps = {
  output: AudioOutput;
  timing: TimingLoader;
  resolveSource: SourceResolver;
  /** The lock-screen text for an ayah. */
  describe?: (position: AyahPosition, reciter: Reciter) => { title: string; artist: string };
  /** Timers for the automatic retries (injectable for tests). */
  schedule?: (run: () => void, ms: number) => () => void;
  /** The clock (injectable for tests). */
  now?: () => number;
};

/** A network failure is retried by itself this many times (after RETRY_DELAYS_MS) before the error is shown. */
export const RETRY_DELAYS_MS = [1500, 4000] as const;
/** An ayah ends when playback reaches its end time less this (status updates arrive every ~100 ms). */
export const BOUNDARY_LEAD_MS = 40;
/**
 * After the app itself plays or pauses, the player's own playing flag is not read as a pause or resume from outside
 * (a call, the lock screen) for this long: the first status updates after a command can still report the old state.
 */
export const COMMAND_GRACE_MS = 1500;

type Loaded = { reciter: Reciter; surah: number; timing: SurahTiming; uri: string; local: boolean };

/**
 * The app's one Quran audio engine: a single source of truth for what is playing, shared by the Mushaf (page and
 * selected-ayah playback) and the ayah screens. Rules:
 *  - Continuous playback follows the canonical order (quranSequence.ts) and stops after An-Nas 6.
 *  - The ayah being recited is tracked from verified timing only (timing.ts); a surah without it is never played.
 *  - Changing the reciter never interrupts an ayah: the new one is "up next" and takes over at the next ayah
 *    boundary; several changes in one ayah keep the last; a manual skip applies it at once; pausing keeps it; a reciter
 *    without the coming surah is refused with a notice, never substituted.
 *  - The listening position is separate from reading progress: nothing here touches a ورد or a Khatma.
 */
export function createPlaybackEngine(deps: EngineDeps) {
  const { output } = deps;
  const schedule = deps.schedule ?? ((run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  const now = deps.now ?? Date.now;
  let state: PlaybackState = IDLE_STATE;
  const listeners = new Set<(state: PlaybackState) => void>();
  let loaded: Loaded | null = null;
  /** Bumped by every transition (and stop): an older transition finishing late changes nothing. */
  let token = 0;
  let transitioning = false;
  /** Whether playback should be running (false after a pause, even while a transition loads). */
  let wantPlaying = false;
  let retries = 0;
  let cancelRetry: (() => void) | null = null;
  let lastPreload: string | null = null;
  /**
   * Ayah ends are detected only once the player reports a position inside the ayah just loaded: right after a load or
   * seek it can still report the previous position, which must never count as this ayah's end.
   */
  let armed = false;
  let commandAt = 0;
  const play = () => {
    commandAt = now();
    output.play();
  };
  const pause = () => {
    commandAt = now();
    output.pause();
  };

  const set = (patch: Partial<PlaybackState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const nowPlaying = (position: AyahPosition, reciter: Reciter) =>
    deps.describe?.(position, reciter) ?? { title: `${position.surah}:${position.ayah}`, artist: reciter.nameEn };

  const clearRetry = () => {
    cancelRetry?.();
    cancelRetry = null;
  };

  const fail = (kind: PlaybackError['kind'], position: AyahPosition, reciter: Reciter) => {
    transitioning = false;
    pause();
    set({ phase: 'error', error: { kind, surah: position.surah, reciterId: reciter.id }, buffering: false });
    if (kind === 'network' && retries < RETRY_DELAYS_MS.length) {
      const attempt = retries++;
      const session = state.session;
      clearRetry();
      cancelRetry = schedule(() => {
        cancelRetry = null;
        if (state.session === session && state.phase === 'error' && state.error?.kind === 'network' && state.position) {
          void transition(reciter, state.position, true);
        }
      }, RETRY_DELAYS_MS[attempt]);
    }
  };

  /** Loads `position` in `reciter`'s recording and plays it (if `autoplay`). The only way audio changes source. */
  const transition = async (reciter: Reciter, position: AyahPosition, autoplay: boolean) => {
    const mine = ++token;
    transitioning = true;
    armed = false;
    wantPlaying = autoplay;
    clearRetry();
    set({ phase: 'loading', position, reciterId: reciter.id, pendingReciterId: null, error: null, buffering: false });
    if (!hasAyahPlayback(reciter, position.surah)) {
      fail('unavailable', position, reciter);
      return;
    }
    const timingResult = await deps.timing.load(reciter, position.surah);
    if (mine !== token) return;
    if (!timingResult.ok) {
      fail(timingResult.reason === 'network' ? 'network' : timingResult.reason, position, reciter);
      return;
    }
    const timing = timingResult.timing;
    let source: { uri: string; local: boolean };
    try {
      source = await deps.resolveSource(reciter, position.surah);
    } catch {
      if (mine === token) fail('network', position, reciter);
      return;
    }
    if (mine !== token) return;
    const startMs = ayahStartMs(timing, position.ayah);
    try {
      if (loaded && loaded.uri === source.uri) await output.seek(startMs);
      else {
        loaded = null;
        await output.load(source.uri, startMs);
      }
    } catch {
      if (mine === token) {
        loaded = null;
        fail(source.local ? 'playback' : 'network', position, reciter);
      }
      return;
    }
    if (mine !== token) return;
    loaded = { reciter, surah: position.surah, timing, uri: source.uri, local: source.local };
    transitioning = false;
    retries = 0;
    output.setNowPlaying(nowPlaying(position, reciter));
    if (wantPlaying) play();
    set({ phase: wantPlaying ? 'playing' : 'paused', offline: source.local });
    preloadAhead();
  };

  /** Buffers the file most likely needed next: the pending reciter's, or the next surah's on a surah's last ayah. */
  const preloadAhead = () => {
    const position = state.position;
    if (!position || state.mode !== 'continuous') return;
    const upcoming = nextAyah(position);
    if (!upcoming) return;
    const reciter = getReciter(state.pendingReciterId ?? state.reciterId);
    if (!reciter || !hasAyahPlayback(reciter, upcoming.surah)) return;
    if (reciter.id === loaded?.reciter.id && upcoming.surah === loaded.surah) return;
    void deps.resolveSource(reciter, upcoming.surah).then((source) => {
      if (source.local || source.uri === lastPreload) return;
      lastPreload = source.uri;
      output.preload(source.uri);
    }, () => undefined);
    void deps.timing.load(reciter, upcoming.surah).catch(() => undefined);
  };

  /** The current ayah has been recited completely: the next one, in the pending reciter's voice if one is chosen. */
  const onAyahEnd = () => {
    const position = state.position;
    if (!position || !loaded) return;
    if (state.mode === 'single') {
      transitioning = false;
      wantPlaying = false;
      pause();
      output.setNowPlaying(null);
      set({ phase: 'ended', buffering: false });
      return;
    }
    const upcoming = nextAyah(position);
    if (!upcoming) {
      // After An-Nas 6: the end of the Quran.
      wantPlaying = false;
      output.stop();
      loaded = null;
      set({ phase: 'ended', buffering: false, pendingReciterId: null });
      return;
    }
    const pending = getReciter(state.pendingReciterId);
    if (!pending && upcoming.surah === loaded.surah) {
      // Same voice, same file: it simply carries on (no seek, no gap).
      set({ position: upcoming });
      output.setNowPlaying(nowPlaying(upcoming, loaded.reciter));
      if (loaded.timing.ayahs.length === upcoming.ayah) preloadAhead();
      return;
    }
    void transition(pending ?? loaded.reciter, upcoming, true);
  };

  const onStatus = (status: OutputStatus) => {
    if (transitioning || !loaded || !state.position) return;
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    if (status.error) {
      fail(loaded.local ? 'playback' : 'network', state.position, loaded.reciter);
      loaded = null;
      return;
    }
    if (state.buffering !== status.buffering) set({ buffering: status.buffering });
    const ayah = loaded.timing.ayahs[state.position.ayah - 1];
    if (!armed) {
      const startMs = ayahStartMs(loaded.timing, state.position.ayah);
      if (status.positionMs >= startMs - 1000 && status.positionMs < ayah.endMs - BOUNDARY_LEAD_MS) armed = true;
      else return;
    }
    if (state.phase === 'playing' && (status.finished || status.positionMs >= ayah.endMs - BOUNDARY_LEAD_MS)) {
      onAyahEnd();
      return;
    }
    if (now() - commandAt < COMMAND_GRACE_MS) return;
    // Paused or resumed outside the app (a call, the lock screen, headphones unplugged): follow the device.
    if (state.phase === 'playing' && !status.playing && !status.buffering && status.loaded) {
      wantPlaying = false;
      set({ phase: 'paused' });
    } else if (state.phase === 'paused' && status.playing) {
      wantPlaying = true;
      set({ phase: 'playing' });
    }
  };

  const unsubscribeOutput = output.subscribe(onStatus);

  const reciterOrNull = (id: string | null | undefined) => getReciter(id ?? null);

  const api = {
    getState: () => state,
    subscribe(listener: (state: PlaybackState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * Starts playing at `from`: the Mushaf's Play (a page's first ayah) and Listen (the selected ayah) in 'continuous'
     * mode, the ayah screens in 'single' mode. `reciterId`: the voice to use (the player's session reciter or the
     * Favorite Reciter, chosen by the caller). Replaces whatever was playing.
     */
    start(from: AyahPosition, options: { mode: PlaybackMode; reciterId: string }): number | null {
      const reciter = reciterOrNull(options.reciterId);
      if (!reciter) return null;
      retries = 0;
      set({
        mode: options.mode,
        session: state.session + 1,
        notice: null,
        // The ayah screens use the Favorite Reciter and never set the Mushaf's session reciter.
        sessionReciterId: options.mode === 'continuous' ? state.sessionReciterId : null,
      });
      void transition(reciter, from, true);
      return state.session;
    },

    /**
     * Stops `session` if it is still the one playing (or loading, paused, ended, failed): the ayah screens call it when
     * their ayah changes or they close. A newer session (the Mushaf, another ayah) is never touched, so releasing twice,
     * late, or after something else started is harmless. A load still in flight never plays afterwards (stop bumps the
     * transition token).
     */
    release(session: number) {
      if (state.session === session && state.phase !== 'idle') api.stop();
    },

    /** Play from the start of a Mushaf page (its first ayah: pages always begin with a whole ayah). */
    startPage(page: number, reciterId: string) {
      const from = firstAyahOfPage(page);
      if (from) api.start(from, { mode: 'continuous', reciterId });
    },

    /** Pauses at the current position (resume carries on from there). While an ayah is still loading: paused at once, and it stays paused once loaded. */
    pause() {
      wantPlaying = false;
      if (state.phase === 'playing') {
        pause();
        set({ phase: 'paused' });
      } else if (state.phase === 'loading') {
        set({ phase: 'paused' });
      }
    },

    resume() {
      if (state.phase === 'paused' && transitioning) {
        // Paused while loading: it plays once loaded (never started early, at the wrong place).
        wantPlaying = true;
        set({ phase: 'loading' });
      } else if (state.phase === 'paused') {
        wantPlaying = true;
        play();
        set({ phase: 'playing' });
      } else if (state.phase === 'loading') {
        wantPlaying = true;
      } else if ((state.phase === 'ended' || state.phase === 'error') && state.position) {
        // Replay (an ayah screen's ayah, or the Quran's last ayah) or retry.
        const reciter = reciterOrNull(state.pendingReciterId ?? state.reciterId);
        if (reciter) {
          retries = 0;
          void transition(reciter, state.position, true);
        }
      }
    },

    toggle() {
      if (state.phase === 'playing' || state.phase === 'loading') api.pause();
      else api.resume();
    },

    /** Stops and closes the player: nothing plays, and the session reciter is dropped (back to the Favorite Reciter). */
    stop() {
      token++;
      transitioning = false;
      wantPlaying = false;
      clearRetry();
      loaded = null;
      output.stop();
      set({ ...IDLE_STATE, session: state.session });
    },

    /**
     * The next / previous ayah, played at once (from any state: playing, paused, ended, an error), across surahs; a
     * pending reciter takes over now. Nothing before Al-Fatiha 1 or after An-Nas 6. The one output is replaced, never
     * doubled: a skip made while another is still loading wins.
     */
    skip(direction: 1 | -1) {
      const position = state.position;
      if (!position) return;
      const target = direction === 1 ? nextAyah(position) : previousAyah(position);
      if (!target) return;
      const reciter = reciterOrNull(state.pendingReciterId ?? state.reciterId);
      if (!reciter) return;
      retries = 0;
      set({ notice: null });
      void transition(reciter, target, true);
    },

    /**
     * The audio window's Previous / Next page: from the page being recited (never the page merely shown), the adjacent
     * page's first ayah, played at once from any state (playing, paused, ended, an error) — the same transition as a
     * skip, so a pending reciter takes over now, a load in flight is replaced, and a reciter without that surah stops
     * there with its message (never another voice). Every page begins with a whole ayah, so its first ayah's start is
     * the page's start; nothing before page 1 or after page 604.
     */
    skipPage(direction: 1 | -1) {
      const position = state.position;
      if (!position) return;
      const target = firstAyahOfPage(pageOfPosition(position) + direction);
      if (!target) return;
      const reciter = reciterOrNull(state.pendingReciterId ?? state.reciterId);
      if (!reciter) return;
      retries = 0;
      set({ notice: null });
      void transition(reciter, target, true);
    },

    /**
     * The player's reciter choice. While an ayah is being recited (or paused, or loading) it is queued for the next
     * ayah, unless that ayah's surah has no verified recording by this reciter (a notice instead). With nothing being
     * recited (an error, the end), it applies at once and playback resumes in that voice. Never changes the Favorite
     * Reciter setting.
     */
    selectReciter(reciterId: string) {
      const reciter = reciterOrNull(reciterId);
      if (!reciter) return;
      const position = state.position;
      if (!position || state.phase === 'idle') {
        set({ sessionReciterId: reciter.id, notice: null });
        return;
      }
      if (state.phase === 'error' || state.phase === 'ended') {
        set({ sessionReciterId: reciter.id, notice: null, pendingReciterId: null });
        if (state.phase === 'error') {
          retries = 0;
          void transition(reciter, position, true);
        } else set({ reciterId: reciter.id });
        return;
      }
      if (reciter.id === state.reciterId) {
        set({ pendingReciterId: null, sessionReciterId: reciter.id, notice: null });
        return;
      }
      const upcoming = state.mode === 'single' ? position : nextAyah(position);
      if (upcoming && !hasAyahPlayback(reciter, upcoming.surah)) {
        set({ notice: { kind: 'reciter-unavailable', reciterId: reciter.id, surah: upcoming.surah } });
        return;
      }
      set({ pendingReciterId: reciter.id, sessionReciterId: reciter.id, notice: null });
      preloadAhead();
    },

    dismissNotice() {
      if (state.notice) set({ notice: null });
    },

    /** Try again after an error, from the start of the ayah it stopped on. */
    retry() {
      if (state.phase !== 'error' || !state.position) return;
      const reciter = reciterOrNull(state.reciterId);
      if (!reciter) return;
      retries = 0;
      void transition(reciter, state.position, true);
    },

    /** Whether `position` is the ayah being recited right now in this mode. */
    isAt(position: AyahPosition, mode?: PlaybackMode) {
      return samePosition(state.position, position) && (mode === undefined || state.mode === mode) && state.phase !== 'idle';
    },

    /** Tests and teardown. */
    dispose() {
      api.stop();
      unsubscribeOutput();
      listeners.clear();
    },
  };
  return api;
}

export type PlaybackEngine = ReturnType<typeof createPlaybackEngine>;
