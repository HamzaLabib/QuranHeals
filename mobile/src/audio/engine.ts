import { firstAyahOfPage, nextAyah, pageOfPosition, previousAyah, samePosition, type AyahPosition } from './quranSequence';
import { perAyahSegments } from './perAyah';
import { FALLBACK_RECITER_ID, getReciter, hasAyahPlayback, type Reciter } from './reciters';
import type { CapabilityMode } from './sourceRegistry';
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
  /** The file's length, once the player knows it (whole-surah playback shows it). */
  durationMs?: number;
  /**
   * The app was closed (Android: swiped away from Recents; native-patches/expo-audio-android-playback-ownership). The
   * player has already paused: the engine stops, so nothing plays again until the reader starts it.
   */
  closed?: boolean;
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

/**
 * One stream to try. `verify`: it must pass the stream check before it plays (whole-surah sources; the audited MP3Quran
 * ayah sources are pinned by the audit, check-live.mjs and their timing fingerprint, and play as before, with no extra
 * request). `bytes` / `durationMs`: the verified size and length, for the stream check and the duration check.
 */
export type StreamCandidate = { uri: string; bytes?: number | null; durationMs?: number | null; verify?: boolean };

/**
 * Where a surah's audio comes from: a verified file on the device, else the source registry's preferred stream.
 * `alternates`: other verified, permitted streams of the same reciter and surah (and, for ayah playback, the same
 * validated timing), tried in order when the preferred one cannot be reached or fails its check.
 */
export type ResolvedSource = StreamCandidate & { local: boolean; alternates?: readonly StreamCandidate[] };
/**
 * `timing`: the timing the surah will play with. Phase 4.8.3: human-verified timing names its own recording
 * (`timing.recording`), and the resolver returns exactly that recording, so timing and file always belong together.
 */
export type SourceResolver = (reciter: Reciter, surah: number, timing?: SurahTiming | null) => Promise<ResolvedSource>;

/**
 * What a stream check found (audio/streamCheck.ts). Only 'ok' lets a stream that needs the check play: 'redirected'
 * (another file, e.g. MP3Quran's redirect of a missing surah to another Sheikh), 'size-mismatch' (not the verified
 * file) and 'missing' (gone, or an expired URL) refuse it as not the verified file; 'unverifiable' (no answer, no
 * trustworthy size) refuses it too, as a network failure that may pass on retry. It fails closed.
 */
export type StreamCheck = 'ok' | 'redirected' | 'size-mismatch' | 'missing' | 'unverifiable';

/** A whole-surah file whose length differs from its verified length by more than this is not the verified file. */
export const DURATION_TOLERANCE = { ms: 3000, ratio: 0.03 };

export type PlaybackMode =
  /** Ayah after ayah, surah after surah, to the end of the Quran (the Mushaf). */
  | 'continuous'
  /** One surah from its first ayah to its last, then stop (the player's Full Surah): never into the next surah. */
  | 'fullSurah'
  /** One ayah, then stop (the ayah screens). */
  | 'single';

/**
 * Repeat Ayah (the Mushaf player): how many more times each ayah is recited after its first recitation before playback
 * moves on: 0 (off), 1, 2, 3, or 'infinite' (the same ayah until the setting changes or playback stops). Repeats seek
 * back to the ayah's verified start in the file already loaded; they never reload it. The ayah screens' single ayah
 * never repeats.
 */
export type RepeatSetting = 0 | 1 | 2 | 3 | 'infinite';
export const REPEAT_CYCLE: readonly RepeatSetting[] = [0, 1, 2, 3, 'infinite'];

export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'ended';

export type PlaybackError = {
  /**
   * 'unavailable': the reciter has no recording that may play for this surah (never substituted);
   * 'network': the audio or its timing could not be fetched;
   * 'mismatch': MP3Quran's timing changed since the audit, so it is not used;
   * 'playback': the device could not play the file;
   * 'surah-only': an ayah inside the surah was asked for, but this recording can only play the whole surah from its
   *   start (no validated ayah timing): nothing plays until the listener chooses that (playWholeSurah);
   * 'source': the stream is not the verified file (a redirect to another recording, another size, gone, or another
   *   length once loaded): refused, never played on.
   */
  kind: 'unavailable' | 'network' | 'mismatch' | 'playback' | 'surah-only' | 'source';
  surah: number;
  reciterId: string;
};

export type PlaybackNotice =
  /** A reciter chosen during playback has no verified recording of the surah coming next: not queued. */
  | { kind: 'reciter-unavailable'; reciterId: string; surah: number }
  /**
   * A reciter chosen during ayah playback can only play this surah whole, from its start: not queued (the ayah coming
   * next would be lost). The listener may start the whole surah in that voice (playWholeSurah).
   */
  | { kind: 'reciter-surah-only'; reciterId: string; surah: number };

/**
 * 'ayah': ayah by ayah, with verified timing (the ayah is known, highlighted and followed).
 * 'surah': a whole-surah recording without usable timing: `position.ayah` is 0 (unknown); nothing is highlighted,
 * followed or reported as the ayah being recited.
 */
export type PlaybackGranularity = 'ayah' | 'surah';

/** Whole-surah playback's place in the file (ayah playback has none: it follows ayahs). */
export type SurahProgress = { positionMs: number; durationMs: number | null };

export type PlaybackState = {
  phase: PlaybackPhase;
  mode: PlaybackMode;
  /**
   * The ayah being recited (or loading, paused, failed on); null when idle. In whole-surah playback (granularity
   * 'surah') `ayah` is 0: the surah is known, the ayah is not.
   */
  position: AyahPosition | null;
  granularity: PlaybackGranularity;
  /** The voice of `position`: the one being heard (Al-Minshawi while the reciter asked for falls back to him). */
  reciterId: string | null;
  /**
   * The reciter asked for (the Favorite Reciter, or the one chosen in the player), whose voice plays wherever it has a
   * verified recording; where it has none, `reciterId` is the fallback (FALLBACK_RECITER_ID) and playback returns to
   * this one at the next surah it can play. Null when idle.
   */
  preferredReciterId: string | null;
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
  /** Repeat Ayah: kept for the listening session (the Mushaf player); off again once the player is closed (stop). */
  repeat: RepeatSetting;
};

export const IDLE_STATE: PlaybackState = {
  phase: 'idle',
  mode: 'continuous',
  position: null,
  granularity: 'ayah',
  reciterId: null,
  preferredReciterId: null,
  pendingReciterId: null,
  sessionReciterId: null,
  buffering: false,
  offline: false,
  error: null,
  notice: null,
  session: 0,
  repeat: 0,
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
  /** How a surah can play for a reciter (the source registry). Default: by ayah where verified timing exists, else not at all. */
  capability?: (reciter: Reciter, surah: number) => CapabilityMode;
  /**
   * Checks a stream is the verified file before it plays (redirects, size, existence). Called for streams that need it
   * (whole-surah sources); without it, such a stream cannot be verified and is refused.
   */
  checkStream?: (uri: string, bytes: number | null) => Promise<StreamCheck>;
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

/**
 * `timing` null: a whole-surah recording (no ayah timing). `segment`: a per-ayah recording's file playing for the
 * current ayah (0, or 1 for ayah 1's own file after its Basmala); always 0 otherwise.
 */
type Loaded = { reciter: Reciter; surah: number; timing: SurahTiming | null; uri: string; local: boolean; expectedDurationMs: number | null; segment: number };

/**
 * A per-ayah file whose length differs from its scanned length by more than this is not the scanned file (the check
 * every per-ayah file gets once loaded, instead of a request before it plays).
 */
export const PER_AYAH_DURATION_TOLERANCE = { ms: 500, ratio: 0.05 };
/** A per-ayah file has ended when the player stopped this close to its end (should it not report it). */
const FILE_END_SLACK_MS = 250;
/** Within this of a per-ayah file's end, the player stopping is its end coming, not a pause from outside the app. */
const FILE_END_WAIT_MS = 1000;

/** Whole-surah playback is armed (its end detectable) once the player reports this close to the start of the new file. */
const SURAH_ARM_MS = 5000;
/** Whole-surah playback has ended when stopped this close to the file's end (should the player not report it). */
const SURAH_END_SLACK_MS = 250;

const firstOfSurah = (surah: number): AyahPosition => ({ surah, ayah: 1 });

/**
 * The app's one Quran audio engine: a single source of truth for what is playing, shared by the Mushaf (page and
 * selected-ayah playback) and the ayah screens. Rules:
 *  - Continuous playback follows the canonical order (quranSequence.ts) and stops after An-Nas 6.
 *  - The ayah being recited is tracked from verified timing only (timing.ts); a surah without it is never played.
 *  - Changing the reciter never interrupts an ayah: the new one is "up next" and takes over at the next ayah
 *    boundary; several changes in one ayah keep the last; a manual skip applies it at once; pausing keeps it; a reciter
 *    without the coming surah is refused with a notice, never substituted.
 *  - Whole-surah recordings (capability 'surah': complete and verified, no usable timing) play from the surah's start
 *    only, with no ayah known: an ayah inside the surah is never approximated; asking for one stops with a choice
 *    ('surah-only') instead. Next / previous move by surah, a reciter change applies at once (from the surah's start),
 *    and the place in the file is reported separately (getProgress), never as an ayah.
 *  - The listening position is separate from reading progress: nothing here touches a ورد or a Khatma.
 */
export function createPlaybackEngine(deps: EngineDeps) {
  const { output } = deps;
  const schedule = deps.schedule ?? ((run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  const now = deps.now ?? Date.now;
  const capabilityOf = deps.capability ?? ((reciter: Reciter, surah: number): CapabilityMode => (hasAyahPlayback(reciter, surah) ? 'ayah' : 'none'));
  const canPlay = (reciter: Reciter, surah: number) => capabilityOf(reciter, surah) !== 'none';
  /**
   * The voice for `surah` when `asked` is wanted: `asked` wherever it can play the surah in this mode; otherwise the
   * fallback reciter (Al-Minshawi) if he has verified ayah timing for it; otherwise `asked`, which then stops with the
   * usual "unavailable" error (never an unverified recording, never a third voice, never a skipped ayah). Availability is
   * per surah (a recording's timing covers every ayah of its surah or none), so a change of voice happens at an ayah
   * boundary that starts a new surah, a skip, or a start: never inside an ayah.
   */
  const voiceFor = (asked: Reciter, surah: number): Reciter => {
    const capability = capabilityOf(asked, surah);
    if (capability === 'ayah' || (capability === 'surah' && state.mode === 'continuous')) return asked;
    const fallback = getReciter(FALLBACK_RECITER_ID);
    return fallback && fallback.id !== asked.id && capabilityOf(fallback, surah) === 'ayah' ? fallback : asked;
  };
  /** The reciter asked for now: one chosen in the player and up next, else the one asked for at the start. */
  const askedReciter = (): Reciter | null => getReciter(state.pendingReciterId ?? state.preferredReciterId ?? state.reciterId);
  /** Plays `position` for the reciter asked for: its voice, or the fallback's where it has no verified recording (voiceFor). */
  const go = (asked: Reciter, position: AyahPosition, autoplay: boolean) => {
    set({ preferredReciterId: asked.id });
    return transition(voiceFor(asked, position.surah), position, autoplay);
  };
  let state: PlaybackState = IDLE_STATE;
  const listeners = new Set<(state: PlaybackState) => void>();
  const NO_PROGRESS: SurahProgress = { positionMs: 0, durationMs: null };
  let progress: SurahProgress = NO_PROGRESS;
  const progressListeners = new Set<(progress: SurahProgress) => void>();
  const setProgress = (next: SurahProgress) => {
    if (next.positionMs === progress.positionMs && next.durationMs === progress.durationMs) return;
    progress = next;
    for (const listener of progressListeners) listener(progress);
  };
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
  /** Whole-surah playback: the loaded stream's length has been compared with the verified length. */
  let durationChecked = false;
  /** Repeat Ayah: how many times the current ayah has been recited completely (reset by every new ayah or reciter). */
  let recitedTimes = 0;
  /** A repeat's seek back is in flight: the player's reports are not read until it lands (no double end, no overlap). */
  let repeating = false;
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

  /**
   * Loads the resolved source (else its alternates, in order) at `startMs`. A stream that needs the check (a whole-surah
   * stream always does) plays only after it passes; otherwise the next one is tried. Null: superseded by a newer
   * transition.
   */
  const loadFirst = async (
    mine: number,
    source: ResolvedSource,
    startMs: number,
    wholeSurah: boolean,
  ): Promise<{ ok: true; uri: string; local: boolean; durationMs: number | null } | { ok: false; kind: 'network' | 'playback' | 'source' } | null> => {
    const first = { uri: source.uri, local: source.local, bytes: source.bytes ?? null, durationMs: source.durationMs ?? null, verify: source.verify === true };
    const candidates = [first, ...(source.alternates ?? []).map((a) => ({ uri: a.uri, local: false, bytes: a.bytes ?? null, durationMs: a.durationMs ?? null, verify: a.verify === true }))];
    let notTheFile = 0;
    let lastLocal = source.local;
    for (const candidate of candidates) {
      const reuse = loaded !== null && loaded.uri === candidate.uri;
      if (!candidate.local && !reuse && (candidate.verify || wholeSurah)) {
        const check = deps.checkStream ? await deps.checkStream(candidate.uri, candidate.bytes) : 'unverifiable';
        if (mine !== token) return null;
        if (check !== 'ok') {
          if (check !== 'unverifiable') notTheFile++;
          lastLocal = false;
          continue;
        }
      }
      try {
        if (reuse) await output.seek(startMs);
        else {
          loaded = null;
          await output.load(candidate.uri, startMs);
        }
      } catch {
        if (mine !== token) return null;
        loaded = null;
        lastLocal = candidate.local;
        continue;
      }
      if (mine !== token) return null;
      return { ok: true, uri: candidate.uri, local: candidate.local, durationMs: candidate.durationMs };
    }
    // Every stream refused as not the verified file: 'source' (no retry). Anything else may pass on retry.
    return { ok: false, kind: notTheFile === candidates.length ? 'source' : lastLocal ? 'playback' : 'network' };
  };

  /** Loads `position` in `reciter`'s recording and plays it (if `autoplay`). The only way audio changes source. */
  const transition = async (reciter: Reciter, requested: AyahPosition, autoplay: boolean) => {
    const mine = ++token;
    transitioning = true;
    armed = false;
    recitedTimes = 0;
    repeating = false;
    wantPlaying = autoplay;
    clearRetry();
    // Ayah 0 (whole-surah playback's unknown ayah) restarts from the surah's start.
    const position = requested.ayah < 1 ? firstOfSurah(requested.surah) : requested;
    const capability = capabilityOf(reciter, position.surah);
    const wholeSurah = capability === 'surah' && state.mode === 'continuous' && position.ayah === 1;
    set({
      phase: 'loading',
      position: wholeSurah ? { surah: position.surah, ayah: 0 } : position,
      granularity: wholeSurah ? 'surah' : 'ayah',
      reciterId: reciter.id,
      pendingReciterId: null,
      error: null,
      buffering: false,
    });
    setProgress(NO_PROGRESS);
    if (capability === 'none' || (capability === 'surah' && state.mode !== 'continuous')) {
      // The ayah screens play single ayahs only: a whole-surah recording cannot serve them.
      fail('unavailable', position, reciter);
      return;
    }
    if (capability === 'surah' && !wholeSurah) {
      // Never an approximate start inside the surah: the listener chooses whether to hear it whole, from its start.
      fail('surah-only', position, reciter);
      return;
    }
    let timing: SurahTiming | null = null;
    if (!wholeSurah) {
      const timingResult = await deps.timing.load(reciter, position.surah);
      if (mine !== token) return;
      if (!timingResult.ok) {
        fail(timingResult.reason === 'network' ? 'network' : timingResult.reason, position, reciter);
        return;
      }
      timing = timingResult.timing;
    }
    // A per-ayah recording names its own files (its timing is its file list): the ayah's first file, from its start.
    const firstFile = timing?.perAyah ? perAyahSegments(timing, position.ayah)[0] : null;
    if (timing?.perAyah && !firstFile) {
      fail('unavailable', position, reciter);
      return;
    }
    let source: ResolvedSource;
    try {
      source = firstFile ? { uri: firstFile.url, local: false } : await deps.resolveSource(reciter, position.surah, timing);
    } catch {
      if (mine === token) fail('network', position, reciter);
      return;
    }
    if (mine !== token) return;
    const startMs = timing ? ayahStartMs(timing, position.ayah) : 0;
    const result = await loadFirst(mine, source, startMs, wholeSurah);
    if (result === null) return;
    if (!result.ok) {
      fail(result.kind, position, reciter);
      return;
    }
    loaded = { reciter, surah: position.surah, timing, uri: result.uri, local: result.local, expectedDurationMs: wholeSurah ? result.durationMs : firstFile?.durationMs ?? null, segment: 0 };
    durationChecked = false;
    transitioning = false;
    retries = 0;
    output.setNowPlaying(nowPlaying(state.position ?? position, reciter));
    // A play from outside the app while it loaded (a notification, a headset) never starts it: the app decides.
    if (wantPlaying) play();
    else pause();
    set({ phase: wantPlaying ? 'playing' : 'paused', offline: result.local });
    preloadAhead();
  };

  /** Buffers the file most likely needed next: the pending reciter's, or the next surah's on a surah's last ayah. */
  const preloadAhead = () => {
    const position = state.position;
    if (!position) return;
    // A per-ayah recording: the file that plays next in the same voice (ayah 1's own file after its Basmala, or the
    // next ayah's), Full Surah included.
    const nextFile = !state.pendingReciterId && state.mode !== 'single' ? perAyahNextFile() : null;
    if (nextFile) {
      if (nextFile !== lastPreload) {
        lastPreload = nextFile;
        output.preload(nextFile);
      }
      return;
    }
    if (state.mode !== 'continuous') return;
    const upcoming = state.granularity === 'surah' ? nextSurahStart(position) : nextAyah(position);
    if (!upcoming) return;
    const asked = askedReciter();
    const reciter = asked ? voiceFor(asked, upcoming.surah) : null;
    if (!reciter || !canPlay(reciter, upcoming.surah)) return;
    if (reciter.id === loaded?.reciter.id && upcoming.surah === loaded.surah) return;
    // The timing first (it decides which recording plays: Phase 4.8.3), then that recording's source.
    const timingAhead: Promise<SurahTiming | null> = capabilityOf(reciter, upcoming.surah) === 'ayah'
      ? deps.timing.load(reciter, upcoming.surah).then((r) => (r.ok ? r.timing : null), () => null)
      : Promise.resolve(null);
    void timingAhead.then((timing): Promise<ResolvedSource> | ResolvedSource => {
      const file = timing?.perAyah ? perAyahSegments(timing, upcoming.ayah)[0] : null;
      return file ? { uri: file.url, local: false } : deps.resolveSource(reciter, upcoming.surah, timing);
    }).then((source) => {
      // A stream that must pass the stream check is never buffered ahead of it: a preload follows redirects, so it could
      // fetch another recording's file (seen on the device with MP3Quran's redirect to Minshawi).
      if (source.local || source.verify || source.uri === lastPreload) return;
      lastPreload = source.uri;
      output.preload(source.uri);
    }, () => undefined);
  };

  const nextSurahStart = (position: AyahPosition): AyahPosition | null => (position.surah < 114 ? firstOfSurah(position.surah + 1) : null);

  /** The URL of the per-ayah file that plays after the current one in the same surah and voice, or null. */
  const perAyahNextFile = (): string | null => {
    const position = state.position;
    const timing = loaded?.timing;
    if (!position || !loaded || !timing?.perAyah) return null;
    const segments = perAyahSegments(timing, position.ayah);
    if (loaded.segment + 1 < segments.length) return segments[loaded.segment + 1].url;
    const upcoming = nextAyah(position);
    if (!upcoming || upcoming.surah !== position.surah) return null;
    return perAyahSegments(timing, upcoming.ayah)[0]?.url ?? null;
  };

  /**
   * A per-ayah recording: plays file `index` of `position` in the loaded voice and surah without leaving playback (the
   * phase stays as it is): ayah 1's own file after its Basmala, the next ayah's file, or a repeat (file 0 again: a seek
   * back when it is the file already loaded, so a one-file repeat stays a seek, never a reload). A skip, stop or another
   * load meanwhile wins (token). `onMissing`: there is no such file.
   */
  const loadFile = (position: AyahPosition, index: number, onMissing: () => void) => {
    const current = loaded;
    const file = current?.timing ? perAyahSegments(current.timing, position.ayah)[index] : undefined;
    if (!current || !file) {
      onMissing();
      return;
    }
    const mine = ++token;
    transitioning = true;
    armed = false;
    repeating = false;
    clearRetry();
    if (!samePosition(state.position, position)) {
      set({ position, notice: null });
      output.setNowPlaying(nowPlaying(position, current.reciter));
    }
    void loadFirst(mine, { uri: file.url, local: false }, 0, false).then((result) => {
      if (result === null) return;
      if (!result.ok) {
        fail(result.kind, position, current.reciter);
        return;
      }
      if (result.uri !== current.uri) durationChecked = false;
      loaded = { ...current, uri: result.uri, local: result.local, expectedDurationMs: file.durationMs, segment: index };
      transitioning = false;
      retries = 0;
      if (wantPlaying) play();
      else pause();
      preloadAhead();
    });
  };

  /** A whole surah has played to its end: the next surah (by ayah or whole, as that surah can play), or the end of the Quran. */
  const onSurahEnd = () => {
    const position = state.position;
    if (!position || !loaded) return;
    const upcoming = nextSurahStart(position);
    if (!upcoming) {
      wantPlaying = false;
      output.stop();
      loaded = null;
      set({ phase: 'ended', buffering: false, pendingReciterId: null });
      return;
    }
    void go(askedReciter() ?? loaded.reciter, upcoming, true);
  };

  /** The current ayah has been recited completely: the next one, in the pending reciter's voice if one is chosen. */
  /** Whether the ayah just recited is to be recited again (Repeat Ayah; never on the ayah screens). */
  const repeatsAgain = () => {
    if (state.mode === 'single' || state.repeat === 0) return false;
    return state.repeat === 'infinite' || recitedTimes < 1 + state.repeat;
  };

  /**
   * Recites the current ayah again: a seek back to its verified start in the loaded file (never a reload). If the
   * timestamp is not usable or the seek fails, playback moves on as if repeat were off: never a loop on a bad seek.
   */
  const repeatAyah = (onFailure: () => void) => {
    const position = state.position;
    const timing = loaded?.timing;
    if (position && timing?.perAyah) {
      // A per-ayah recording repeats the ayah's files from the first (ayah 1 with its Basmala, as every start of ayah 1).
      loadFile(position, 0, onFailure);
      return;
    }
    const ayah = position && timing ? timing.ayahs[position.ayah - 1] : undefined;
    if (!position || !timing || !ayah || !Number.isFinite(ayah.startMs) || !(ayah.endMs > ayah.startMs)) {
      onFailure();
      return;
    }
    const mine = token;
    repeating = true;
    armed = false;
    commandAt = now();
    // Opening rule: ayah 1 repeats from the file's start (with its istiʿādha / Basmala), like every other way of starting
    // it; its onset (introEndMs) still marks where highlighting begins. Every other ayah repeats from its own start.
    output.seek(ayahStartMs(timing, position.ayah)).then(() => {
      if (mine !== token) return;
      repeating = false;
      if (wantPlaying) play();
    }, () => {
      if (mine !== token) return;
      repeating = false;
      onFailure();
    });
  };

  const onAyahEnd = () => {
    const position = state.position;
    if (!position || !loaded || !loaded.timing) return;
    recitedTimes++;
    if (repeatsAgain()) {
      const pending = getReciter(state.pendingReciterId);
      // A reciter chosen meanwhile takes over now, on the same ayah (its repeat count starts again).
      if (pending) void go(pending, position, true);
      else repeatAyah(() => advance(position));
      return;
    }
    advance(position);
  };

  /** The current ayah is finished (and repeated as asked): the next one, or the end. */
  const advance = (position: AyahPosition) => {
    if (!loaded || !loaded.timing) return;
    recitedTimes = 0;
    if (state.mode === 'single') {
      transitioning = false;
      wantPlaying = false;
      pause();
      output.setNowPlaying(null);
      set({ phase: 'ended', buffering: false });
      return;
    }
    const following = nextAyah(position);
    // Full Surah stops after the surah's last ayah: never into the next surah.
    const upcoming = state.mode === 'fullSurah' && following && following.surah !== position.surah ? null : following;
    if (!upcoming) {
      // After An-Nas 6 (the end of the Quran), or the end of a Full Surah.
      wantPlaying = false;
      output.stop();
      loaded = null;
      set({ phase: 'ended', buffering: false, pendingReciterId: null });
      return;
    }
    const pending = getReciter(state.pendingReciterId);
    if (!pending && upcoming.surah === loaded.surah && loaded.timing.perAyah) {
      // Same voice, a per-ayah recording: the next ayah's own file, playback carrying on.
      const reciter = loaded.reciter;
      loadFile(upcoming, 0, () => void transition(reciter, upcoming, true));
      return;
    }
    if (!pending && upcoming.surah === loaded.surah) {
      // Same voice, same file: it simply carries on (no seek, no gap).
      set({ position: upcoming });
      output.setNowPlaying(nowPlaying(upcoming, loaded.reciter));
      if (loaded.timing.ayahs.length === upcoming.ayah) preloadAhead();
      return;
    }
    // A new surah (or a voice chosen meanwhile): the reciter asked for, or the fallback where it has no recording.
    void go(askedReciter() ?? loaded.reciter, upcoming, true);
  };

  const onStatus = (status: OutputStatus) => {
    // The app was closed: everything stops, whatever it was doing (a load in flight never plays afterwards).
    if (status.closed) {
      if (state.phase !== 'idle') api.stop();
      return;
    }
    // Playing although the app is not (ended, failed, stopped, or a load it holds paused): a stale notification or
    // lock-screen control, a headset or a car. Paused again: nothing plays that the app does not show.
    if (status.playing && now() - commandAt >= COMMAND_GRACE_MS && ((transitioning && !wantPlaying) || state.phase === 'ended' || state.phase === 'error' || state.phase === 'idle')) {
      pause();
      return;
    }
    if (transitioning || repeating || !loaded || !state.position) return;
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    if (status.error) {
      fail(loaded.local ? 'playback' : 'network', state.position, loaded.reciter);
      loaded = null;
      return;
    }
    if (state.buffering !== status.buffering) set({ buffering: status.buffering });
    if (loaded.timing === null) {
      onSurahStatus(status);
      return;
    }
    if (loaded.timing.perAyah) {
      onFileStatus(status);
      return;
    }
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
    followDevice(status);
  };

  /** Paused or resumed outside the app (a call, the lock screen, headphones unplugged): follow the device. */
  const followDevice = (status: OutputStatus) => {
    if (now() - commandAt < COMMAND_GRACE_MS) return;
    if (state.phase === 'playing' && !status.playing && !status.buffering && status.loaded) {
      wantPlaying = false;
      set({ phase: 'paused' });
    } else if (state.phase === 'paused' && status.playing) {
      wantPlaying = true;
      set({ phase: 'playing' });
    }
  };

  /** The loaded whole-surah stream is not the verified file: stopped at once (never played on), reloaded on retry. */
  const failNotTheFile = () => {
    if (!loaded || !state.position) return;
    const reciter = loaded.reciter;
    loaded = null;
    wantPlaying = false;
    output.stop();
    fail('source', state.position, reciter);
  };

  /**
   * A per-ayah file: it ends where the file ends (never at an estimated time), then comes the ayah's next file or the
   * ayah's end. Its loaded length must be the scanned one (else it is not the scanned file: stopped, never played on).
   * Pauses from outside the app are followed.
   */
  const onFileStatus = (status: OutputStatus) => {
    const position = state.position;
    const timing = loaded?.timing;
    if (!loaded || !position || !timing) return;
    if (!armed) {
      // Right after a load or a seek back the player can still report the previous file (its end): ignored.
      if (!status.finished && status.positionMs < 1500) armed = true;
      else return;
    }
    const expected = loaded.expectedDurationMs;
    if (!durationChecked && status.durationMs && status.durationMs > 0 && expected) {
      durationChecked = true;
      if (Math.abs(status.durationMs - expected) > Math.max(PER_AYAH_DURATION_TOLERANCE.ms, expected * PER_AYAH_DURATION_TOLERANCE.ratio)) {
        failNotTheFile();
        return;
      }
    }
    const length = status.durationMs ?? 0;
    const atEnd = status.finished || (length > 0 && status.positionMs >= length - FILE_END_SLACK_MS && !status.playing && !status.buffering && status.loaded);
    if (state.phase === 'playing' && atEnd) {
      if (loaded.segment + 1 < perAyahSegments(timing, position.ayah).length) loadFile(position, loaded.segment + 1, onAyahEnd);
      else onAyahEnd();
      return;
    }
    // Stopped just short of its end: the file's end report is coming, this is no pause from outside the app.
    if (length > 0 && status.positionMs >= length - FILE_END_WAIT_MS && !status.playing) return;
    followDevice(status);
  };

  /** Whole-surah playback: its place and length (never an ayah), its end, and pauses from outside the app. */
  const onSurahStatus = (status: OutputStatus) => {
    if (!armed) {
      // Right after a load the player can still report the previous file (its end, its position): ignored.
      if (!status.finished && status.positionMs < SURAH_ARM_MS) armed = true;
      else return;
    }
    // Identity, independently of any HEAD answer: the loaded stream must be as long as the verified file.
    if (!durationChecked && loaded && status.durationMs && status.durationMs > 0) {
      durationChecked = true;
      const expected = loaded.expectedDurationMs;
      const off = expected === null ? !loaded.local : Math.abs(status.durationMs - expected) > Math.max(DURATION_TOLERANCE.ms, expected * DURATION_TOLERANCE.ratio);
      if (off) {
        failNotTheFile();
        return;
      }
    }
    const durationMs = status.durationMs && status.durationMs > 0 ? Math.round(status.durationMs) : progress.durationMs;
    setProgress({ positionMs: Math.max(0, status.positionMs), durationMs });
    const atEnd = status.finished || (durationMs !== null && status.positionMs >= durationMs - SURAH_END_SLACK_MS && !status.playing && !status.buffering && status.loaded);
    if (state.phase === 'playing' && atEnd) {
      onSurahEnd();
      return;
    }
    followDevice(status);
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
    /** Whole-surah playback's place in the file (a separate store: it changes several times a second). */
    getProgress: () => progress,
    subscribeProgress(listener: (progress: SurahProgress) => void) {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
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
        sessionReciterId: options.mode !== 'single' ? state.sessionReciterId : null,
      });
      void go(reciter, from, true);
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

    /**
     * The player's Full Surah: `surah` from its first ayah to its last in `reciterId`'s verified recording, the ayah
     * followed and highlighted, then stop (never into the next surah). Never a whole-surah recording without timing.
     */
    startFullSurah(surah: number, reciterId: string) {
      if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
      return api.start(firstOfSurah(surah), { mode: 'fullSurah', reciterId });
    },

    /** Repeat Ayah's setting. Applies at once, to the ayah being recited too (no restart): its count is kept. */
    setRepeat(repeat: RepeatSetting) {
      if (!REPEAT_CYCLE.includes(repeat) || repeat === state.repeat) return;
      set({ repeat });
    },

    /** The Repeat button: Off → 1 → 2 → 3 → ∞ → Off. */
    cycleRepeat() {
      api.setRepeat(REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(state.repeat) + 1) % REPEAT_CYCLE.length]);
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
        const reciter = askedReciter();
        if (reciter) {
          retries = 0;
          void go(reciter, state.position, true);
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
      setProgress(NO_PROGRESS);
    },

    /**
     * The next / previous ayah, played at once (from any state: playing, paused, ended, an error), across surahs; a
     * pending reciter takes over now. Nothing before Al-Fatiha 1 or after An-Nas 6. The one output is replaced, never
     * doubled: a skip made while another is still loading wins.
     */
    skip(direction: 1 | -1) {
      const position = state.position;
      if (!position) return;
      // Whole-surah playback moves by surah (to the adjacent surah's start); ayah playback by ayah.
      const target = state.granularity === 'surah'
        ? direction === 1 ? nextSurahStart(position) : position.surah > 1 ? firstOfSurah(position.surah - 1) : null
        : direction === 1 ? nextAyah(position) : previousAyah(position);
      if (!target) return;
      const reciter = askedReciter();
      if (!reciter) return;
      retries = 0;
      set({ notice: null });
      void go(reciter, target, true);
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
      // Whole-surah playback: the page being recited is unknown, so there is no page to move from.
      if (!position || state.granularity === 'surah') return;
      const target = firstAyahOfPage(pageOfPosition(position) + direction);
      if (!target) return;
      const reciter = askedReciter();
      if (!reciter) return;
      retries = 0;
      set({ notice: null });
      void go(reciter, target, true);
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
          void go(reciter, position, true);
        } else set({ reciterId: reciter.id, preferredReciterId: reciter.id });
        return;
      }
      if (reciter.id === state.reciterId) {
        set({ pendingReciterId: null, preferredReciterId: reciter.id, sessionReciterId: reciter.id, notice: null });
        return;
      }
      if (state.granularity === 'surah') {
        // No ayah boundary to wait for: the new voice takes over at once, from the surah's start (a place in one
        // recording is not the same place in another).
        if (!canPlay(reciter, position.surah)) {
          set({ notice: { kind: 'reciter-unavailable', reciterId: reciter.id, surah: position.surah } });
          return;
        }
        set({ sessionReciterId: reciter.id, notice: null });
        retries = 0;
        void go(reciter, firstOfSurah(position.surah), wantPlaying);
        return;
      }
      const upcoming = state.mode === 'single' ? position : nextAyah(position);
      if (upcoming) {
        const capability = capabilityOf(reciter, upcoming.surah);
        if (capability === 'none' || (capability === 'surah' && state.mode === 'single')) {
          set({ notice: { kind: 'reciter-unavailable', reciterId: reciter.id, surah: upcoming.surah } });
          return;
        }
        if (capability === 'surah' && upcoming.ayah > 1) {
          set({ notice: { kind: 'reciter-surah-only', reciterId: reciter.id, surah: upcoming.surah } });
          return;
        }
      }
      set({ pendingReciterId: reciter.id, sessionReciterId: reciter.id, notice: null });
      preloadAhead();
    },

    /**
     * The listener's choice after a 'surah-only' stop or notice: that reciter's whole surah, from its start (the
     * Listen's or the reciter choice's surah). Does nothing otherwise.
     */
    playWholeSurah() {
      const offer = state.error?.kind === 'surah-only' ? state.error : state.notice?.kind === 'reciter-surah-only' ? state.notice : null;
      const reciter = offer ? reciterOrNull(offer.reciterId) : null;
      if (!offer || !reciter || state.mode !== 'continuous') return;
      retries = 0;
      // A reciter chosen in the player becomes the session's; the Favorite Reciter stays as it is.
      set({ notice: null, sessionReciterId: state.notice ? reciter.id : state.sessionReciterId });
      void go(reciter, firstOfSurah(offer.surah), true);
    },

    /** Moves within a whole-surah recording (ayah playback moves by ayah instead). */
    seekTo(ms: number) {
      if (state.granularity !== 'surah' || !loaded || loaded.timing !== null || transitioning || !Number.isFinite(ms)) return;
      const target = Math.max(0, Math.min(Math.round(ms), progress.durationMs ?? Number.MAX_SAFE_INTEGER));
      commandAt = now();
      setProgress({ positionMs: target, durationMs: progress.durationMs });
      void output.seek(target).catch(() => undefined);
    },

    dismissNotice() {
      if (state.notice) set({ notice: null });
    },

    /** Try again after an error, from the start of the ayah it stopped on. */
    retry() {
      if (state.phase !== 'error' || !state.position || state.error?.kind === 'surah-only') return;
      const reciter = askedReciter();
      if (!reciter) return;
      retries = 0;
      void go(reciter, state.position, true);
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
