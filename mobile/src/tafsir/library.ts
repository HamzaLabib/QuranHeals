import { parseTafsirDataset, type TafsirDataset } from './dataset';
import { DEFAULT_TAFSIR_EDITION, TAFSIR_EDITION_IDS, tafsirEditions, type TafsirEditionId, type TafsirEditionInfo } from './editions';
import type { TafsirFileStore } from './storage';

/**
 * Where each edition stands on this device, for the selector:
 * - 'unavailable': no verified release (source or rights not verified): listed, never offered;
 * - 'notDownloaded': ready to download;
 * - 'downloading': with its progress (0–1, or null before the size is known) — then 'verifying' (size and SHA-256);
 * - 'failed': the last download stopped or did not verify; nothing of it is kept, and a retry starts again;
 * - 'ready': bundled, or downloaded AND verified: it can be read offline.
 * One edition's download never touches another's file, so the edition being read stays readable throughout.
 */
export type TafsirEditionState =
  | { kind: 'unavailable' }
  | { kind: 'notDownloaded' }
  | { kind: 'downloading'; progress: number | null }
  | { kind: 'verifying' }
  | { kind: 'failed'; reason: 'network' | 'verification' | 'storage' }
  | { kind: 'ready' };

export type TafsirLibrarySnapshot = Readonly<Record<TafsirEditionId, TafsirEditionState>>;

export type TafsirLibraryDeps = {
  editions: readonly TafsirEditionInfo[];
  files: TafsirFileStore;
  /** The bundled الميسر (parsed JSON), or null when this build carries none. */
  bundled: () => unknown;
  /** Where a downloadable edition's verified file is served. */
  downloadUrl: (edition: TafsirEditionId, sha256: string) => string;
};

export type TafsirLibrary = ReturnType<typeof createTafsirLibrary>;

export function createTafsirLibrary(deps: TafsirLibraryDeps) {
  const info = new Map(deps.editions.map((edition) => [edition.id, edition]));
  const states = new Map<TafsirEditionId, TafsirEditionState>();
  const datasets = new Map<TafsirEditionId, Promise<TafsirDataset | null>>();
  const running = new Map<TafsirEditionId, { cancel: () => void }>();
  const listeners = new Set<() => void>();
  let snapshot: TafsirLibrarySnapshot | null = null;
  let checking: Promise<void> | null = null;

  for (const id of TAFSIR_EDITION_IDS) {
    const edition = info.get(id);
    states.set(id, !edition?.pin ? { kind: 'unavailable' } : edition.delivery === 'bundled' ? { kind: 'ready' } : { kind: 'notDownloaded' });
  }

  const emit = () => {
    snapshot = null;
    for (const listener of [...listeners]) listener();
  };
  const set = (id: TafsirEditionId, state: TafsirEditionState) => {
    states.set(id, state);
    emit();
  };

  /**
   * Reads which downloads are on the device, for every edition not known to be there yet. Run each time the reader
   * opens (cheap: a file's existence and size), never cached as a result: a check that failed once (a file system not
   * ready) must not leave a downloaded edition looking absent for the rest of the session (found on the emulator).
   */
  function refresh(): Promise<void> {
    checking ??= (async () => {
      for (const edition of deps.editions) {
        if (edition.delivery !== 'download' || !edition.pin) continue;
        const current = states.get(edition.id);
        if (current?.kind !== 'notDownloaded') continue;
        if (await deps.files.has(edition.id, edition.pin.sha256, edition.pin.bytes)) set(edition.id, { kind: 'ready' });
      }
    })().catch(() => undefined).finally(() => {
      checking = null;
    });
    return checking;
  }

  function getSnapshot(): TafsirLibrarySnapshot {
    snapshot ??= Object.fromEntries(TAFSIR_EDITION_IDS.map((id) => [id, states.get(id) as TafsirEditionState])) as TafsirLibrarySnapshot;
    return snapshot;
  }

  /**
   * The edition's verified text, parsed (cached), or null if it cannot be read. A downloaded file that fails to parse is
   * deleted and the edition goes back to "download", so a damaged file is never shown and can be fetched again.
   */
  function load(id: TafsirEditionId): Promise<TafsirDataset | null> {
    const cached = datasets.get(id);
    if (cached) return cached;
    const edition = info.get(id);
    if (!edition?.pin || states.get(id)?.kind !== 'ready') return Promise.resolve(null);
    const pin = edition.pin;
    const loading = (async () => {
      let raw: unknown = null;
      try {
        if (edition.delivery === 'bundled') raw = deps.bundled();
        else {
          const text = await deps.files.read(id, pin.sha256);
          raw = text === null ? null : JSON.parse(text);
        }
      } catch {
        raw = null;
      }
      const parsed = raw === null ? null : parseTafsirDataset(raw, id);
      // The pin's counts must match too: a file that parses but is not the verified one is rejected.
      if (parsed?.ok && parsed.dataset.entryCount === pin.entries && parsed.dataset.rangeCount === pin.ranges) return parsed.dataset;
      datasets.delete(id);
      if (edition.delivery === 'download') {
        await deps.files.remove(id).catch(() => undefined);
        set(id, { kind: 'failed', reason: 'verification' });
      } else set(id, { kind: 'unavailable' });
      return null;
    })();
    datasets.set(id, loading);
    return loading;
  }

  /** Downloads and verifies one edition. Resolves true once it is ready. A second call while it runs joins nothing new. */
  async function download(id: TafsirEditionId): Promise<boolean> {
    const edition = info.get(id);
    const state = states.get(id);
    if (!edition?.pin || edition.delivery !== 'download' || running.has(id)) return false;
    if (state?.kind === 'ready' || state?.kind === 'unavailable') return state.kind === 'ready';
    const pin = edition.pin;
    set(id, { kind: 'downloading', progress: 0 });
    let cancelled = false;
    running.set(id, { cancel: () => { cancelled = true; } });
    try {
      let task;
      try {
        task = await deps.files.download(deps.downloadUrl(id, pin.sha256), id, pin.sha256, (written) => {
          if (!cancelled && states.get(id)?.kind === 'downloading') set(id, { kind: 'downloading', progress: Math.max(0, Math.min(1, written / pin.bytes)) });
        });
      } catch {
        set(id, { kind: 'failed', reason: 'storage' });
        return false;
      }
      running.set(id, { cancel: () => { cancelled = true; task.cancel(); } });
      let finished = false;
      try {
        finished = await task.done;
      } catch {
        finished = false;
      }
      if (!finished || cancelled) {
        await deps.files.discardPartial(id, pin.sha256).catch(() => undefined);
        set(id, cancelled ? { kind: 'notDownloaded' } : { kind: 'failed', reason: 'network' });
        return false;
      }
      set(id, { kind: 'verifying' });
      let committed = false;
      try {
        committed = await deps.files.commit(id, pin.sha256, pin.bytes);
      } catch {
        committed = false;
      }
      if (!committed) {
        await deps.files.discardPartial(id, pin.sha256).catch(() => undefined);
        set(id, { kind: 'failed', reason: 'verification' });
        return false;
      }
      datasets.delete(id);
      set(id, { kind: 'ready' });
      // Parsed now, so a file that verifies by hash but not by content is caught before it is offered.
      return (await load(id)) !== null;
    } finally {
      running.delete(id);
    }
  }

  function cancel(id: TafsirEditionId) {
    running.get(id)?.cancel();
  }

  /** Deletes a downloaded edition (never the bundled one). */
  async function remove(id: TafsirEditionId): Promise<void> {
    const edition = info.get(id);
    if (!edition?.pin || edition.delivery !== 'download') return;
    cancel(id);
    datasets.delete(id);
    await deps.files.remove(id).catch(() => undefined);
    set(id, { kind: 'notDownloaded' });
  }

  /** The edition to open: the preferred one when it is ready, else الميسر (else the first ready edition, else null). */
  function resolve(preferred: TafsirEditionId | null): TafsirEditionId | null {
    if (preferred && states.get(preferred)?.kind === 'ready') return preferred;
    if (states.get(DEFAULT_TAFSIR_EDITION)?.kind === 'ready') return DEFAULT_TAFSIR_EDITION;
    return TAFSIR_EDITION_IDS.find((id) => states.get(id)?.kind === 'ready') ?? null;
  }

  return {
    editions: deps.editions,
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    load,
    download,
    cancel,
    remove,
    resolve,
  };
}

let shared: TafsirLibrary | null = null;

/** The app's one library (native modules and the bundled file are loaded only when first used). */
export function tafsirLibrary(): TafsirLibrary {
  if (shared) return shared;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { tafsirFileStore } = require('./storage') as typeof import('./storage');
  const { bundledMuyassar } = require('./generated/bundledTafsir') as typeof import('./generated/bundledTafsir');
  const { apiBaseUrl } = require('@/services/apiBase') as typeof import('@/services/apiBase');
  /* eslint-enable @typescript-eslint/no-require-imports */
  shared = createTafsirLibrary({
    editions: tafsirEditions(),
    files: tafsirFileStore,
    bundled: bundledMuyassar,
    downloadUrl: (edition, sha256) => `${apiBaseUrl}/api/tafsir/v1/editions/${edition}/${sha256}.json`,
  });
  return shared;
}
