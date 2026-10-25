import type { AudioOutput, OutputStatus } from './engine';
import { EXACT_MP3_SEEK_HEADER, EXACT_MP3_SEEK_VALUE } from './vbrSeek';

/** A load that a newer load or a stop replaced: expected (switching ayahs), never an error to report. */
export class LoadSupersededError extends Error {
  constructor() {
    super('load superseded');
    this.name = 'LoadSupersededError';
  }
}

/** How often the native player reports its position: ayah ends are detected within about this much. */
export const STATUS_INTERVAL_MS = 100;
/** A source that has not become playable in this long counts as failed (the engine then retries or reports it). */
export const LOAD_TIMEOUT_MS = 20_000;
const LOAD_POLL_MS = 100;

type ExpoAudio = typeof import('expo-audio');
type Player = ReturnType<ExpoAudio['createAudioPlayer']>;

/**
 * The engine's output over expo-audio: a single AudioPlayer for the whole app (never one per screen), created on first
 * use, with the audio session set for listening — plays with the silent switch on, keeps playing in the background and
 * with the screen locked, pauses other apps' audio (required for lock-screen controls), and shows play / pause on the
 * lock screen and in Android's media notification. Seeks are exact (no tolerance) so an ayah starts where its timing
 * says. expo-audio is loaded on first use, so importing this never loads native code (tests, web start-up).
 * `exactSeekUrls`: VBR files the patched binary must seek exactly (vbrSeek.ts); they carry its marker header, which the
 * native player removes before any request. Empty (the default): every source loads exactly as before.
 */
export function createExpoOutput(load: () => Promise<ExpoAudio> = () => import('expo-audio'), exactSeekUrls: ReadonlySet<string> = new Set()): AudioOutput {
  let module: ExpoAudio | null = null;
  let player: Player | null = null;
  let ready: Promise<Player> | null = null;
  const listeners = new Set<(status: OutputStatus) => void>();
  let nowPlaying: { title: string; artist: string } | null = null;
  let lockScreenActive = false;
  /** Bumped by every load and stop: a load still waiting for its source checks it, and gives up once replaced. */
  let generation = 0;
  /**
   * The source given to the player that has not become playable yet. A load of the same URL (the engine's retry after
   * LOAD_TIMEOUT_MS) keeps waiting for it instead of replacing it: a host slow to answer (2026-10-24: archive.org's
   * ia600903, 7–9 s before the first byte of every request, and iOS makes several before it can play) would otherwise
   * start from nothing on every retry and never finish.
   */
  let pendingUri: string | null = null;

  /** A seek that has not completed in LOAD_TIMEOUT_MS fails (the engine retries or reports it), never waits forever. */
  const seekWithin = (p: Player, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('seek timeout')), LOAD_TIMEOUT_MS);
    });
    return Promise.race([p.seekTo(ms / 1000, 0, 0), timeout]).finally(() => clearTimeout(timer));
  };

  const ensure = () => (ready ??= (async () => {
    module = await load();
    await module.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
    const created = module.createAudioPlayer(null, { updateInterval: STATUS_INTERVAL_MS });
    created.addListener('playbackStatusUpdate', (status) => {
      const out: OutputStatus = {
        positionMs: Math.round((status.currentTime ?? 0) * 1000),
        playing: Boolean(status.playing),
        buffering: Boolean(status.isBuffering),
        loaded: Boolean(status.isLoaded),
        finished: Boolean(status.didJustFinish),
        error: status.error ?? null,
        durationMs: Number.isFinite(status.duration) && status.duration > 0 ? Math.round(status.duration * 1000) : undefined,
      };
      // Android, patched binary only: the app was closed from Recents (the native player has paused and dropped its controls).
      // Its controls are gone natively, so the next play after the app is opened again shows them afresh.
      if ((status as { quranHealsTaskRemoved?: boolean }).quranHealsTaskRemoved === true) {
        out.closed = true;
        lockScreenActive = false;
        pendingUri = null;
      }
      for (const listener of listeners) listener(out);
    });
    player = created;
    return created;
  })().catch((error) => {
    ready = null;
    throw error;
  }));

  const showLockScreen = () => {
    if (!player || !nowPlaying) return;
    try {
      if (!lockScreenActive) {
        player.setActiveForLockScreen(true, { title: nowPlaying.title, artist: nowPlaying.artist, albumTitle: 'Quran Heals' }, { showSeekForward: false, showSeekBackward: false });
        lockScreenActive = true;
      } else player.updateLockScreenMetadata({ title: nowPlaying.title, artist: nowPlaying.artist, albumTitle: 'Quran Heals' });
    } catch {
      // Lock-screen controls are a convenience: playback never depends on them.
    }
  };

  return {
    async load(uri, startMs) {
      const mine = ++generation;
      const p = await ensure();
      if (mine !== generation) throw new LoadSupersededError();
      p.pause();
      if (pendingUri !== uri || p.currentStatus?.error) {
        p.replace(exactSeekUrls.has(uri) ? { uri, headers: { [EXACT_MP3_SEEK_HEADER]: EXACT_MP3_SEEK_VALUE } } : { uri });
        pendingUri = uri;
      }
      const started = Date.now();
      // Wait until the new source can play (polling: a status event of the previous source can still arrive first).
      // Replaced meanwhile (another ayah, a stop): stop waiting at once, and never report the newer source's state.
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (mine !== generation) return reject(new LoadSupersededError());
          const status = p.currentStatus;
          if (status?.error) {
            pendingUri = null;
            reject(new Error(status.error));
          } else if (p.isLoaded) {
            pendingUri = null;
            resolve();
          } else if (Date.now() - started > LOAD_TIMEOUT_MS) reject(new Error('load timeout'));
          else setTimeout(check, LOAD_POLL_MS);
        };
        setTimeout(check, LOAD_POLL_MS);
      });
      if (mine !== generation) throw new LoadSupersededError();
      if (startMs > 0) await seekWithin(p, startMs);
      if (mine !== generation) throw new LoadSupersededError();
    },
    async seek(ms) {
      const p = await ensure();
      await seekWithin(p, ms);
    },
    play() {
      if (!player) return;
      player.play();
      showLockScreen();
    },
    pause() {
      player?.pause();
    },
    /** Safe to call any number of times, in any state (also before the player exists, or mid-load). */
    stop() {
      generation++;
      pendingUri = null;
      if (!player) return;
      try {
        player.pause();
        player.clearLockScreenControls();
      } catch {
        // Nothing to pause or clear.
      }
      lockScreenActive = false;
      nowPlaying = null;
      try {
        player.replace(null);
      } catch {
        // Already empty.
      }
      void module?.clearAllPreloadedSources().catch(() => undefined);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setNowPlaying(info) {
      nowPlaying = info;
      if (!info) {
        if (player && lockScreenActive) {
          try {
            player.clearLockScreenControls();
          } catch {
            // Nothing to clear.
          }
        }
        lockScreenActive = false;
        return;
      }
      if (lockScreenActive) showLockScreen();
    },
    preload(uri) {
      void ensure().then(async () => {
        // At most one preloaded file at a time, to keep memory bounded.
        await module?.clearAllPreloadedSources().catch(() => undefined);
        await module?.preload({ uri }, { preferredForwardBufferDuration: 15 }).catch(() => undefined);
      }, () => undefined);
    },
  };
}
