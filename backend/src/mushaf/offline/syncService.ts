import { QfUnavailableError, type QfContentClient, type QfEnvironment } from '../../quranFoundation/qfContentClient';
import {
  chunkDataset,
  compileDataset,
  DatasetError,
  datasetVersion,
  DATASET_SCHEMA,
  deleteRecord,
  emptyRecordSet,
  MUSHAF_RESOURCE,
  upsertRecord,
  VERSE_COUNT,
  type CanonicalQuran,
  type RecordSet,
} from './dataset';
import { readSnapshotStream } from './snapshotStream';
import type { MushafSyncStore, OfflineManifest, SyncState } from './store';

/**
 * Keeps the backend's Content Sync copy of Quran Foundation's `mushafs:2`
 * (QCF V1) current, and publishes each validated state as a downloadable
 * version for the app (routes.ts).
 *
 * Terms (Developer Terms, "Developer must NOT", item 3): Content Sync is the
 * only permitted path to an offline copy, and a copy "kept on a backend or an
 * offline device" must sync at least every 7 days when connectivity permits.
 * This service syncs at least daily (SYNC_INTERVAL_MS), and devices check it
 * at least daily when online. Credentials stay in this process.
 */

export const RESOURCE = `${MUSHAF_RESOURCE.group}:${MUSHAF_RESOURCE.id}`;
/** Sync when the last success is older than this (well inside the 7-day rule). */
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_URL = `/api/v4/resources/snapshots/${MUSHAF_RESOURCE.group}/${MUSHAF_RESOURCE.id}`;
const SNAPSHOT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SYNC_PAGES = 1000;
export const ATTRIBUTION = 'Mushaf layout: Quran Foundation (Content Sync mushafs:2, QCF V1). King Fahd Glorious Qur’an Printing Complex, 1405 AH Madani Mushaf.';

export class MushafSyncError extends Error {
  constructor(message: string, readonly reason: 'unavailable' | 'deleted' | 'invalid' | 'protocol') {
    super(message);
    this.name = 'MushafSyncError';
  }
}

type Mutation = {
  sequence: number;
  type: string;
  resource_group: string;
  resource_id: number;
  record_type: string | null;
  record_key: string | number | null;
  source_record_id: number | null;
  data: Record<string, unknown> | null;
  snapshot_url: string | null;
  unavailable_reason: string | null;
};

export type SyncOutcome =
  | { status: 'published'; version: string; previousVersion: string | null; mutations: number; snapshot: boolean }
  | { status: 'unchanged'; version: string | null; mutations: number }
  /** Synced, but the new state failed validation: kept, not published; the previous version is still served. */
  | { status: 'invalid'; version: string | null; mutations: number; problems: string }
  | { status: 'deleted' };

export type MushafSyncService = {
  /** One sync now (single-flight: concurrent calls share the run in progress). */
  runSync(): Promise<SyncOutcome>;
  /** Syncs when due, now and then every `checkEveryMs`; returns a stop function. */
  start(options?: { checkEveryMs?: number; firstCheckAfterMs?: number }): () => void;
};

export function createMushafSyncService(deps: {
  client: QfContentClient;
  environment: QfEnvironment;
  store: MushafSyncStore;
  quran: () => CanonicalQuran;
  now?: () => Date;
  log?: (line: string) => void;
}): MushafSyncService {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.log(line));
  let running: Promise<SyncOutcome> | null = null;

  /** All change pages of one sync run; the token comes from the final page only. */
  async function collectChanges(start: { bootstrap: true } | { syncToken: string }) {
    const first = 'bootstrap' in start ? 'bootstrap=true' : `sync_token=${encodeURIComponent(start.syncToken)}`;
    let path: string | null = `/content/api/v4/resources/sync?${first}&resources=${encodeURIComponent(RESOURCE)}&per_page=100`;
    const mutations: Mutation[] = [];
    let nextSyncToken: string | null = null;
    let untilSequence = 0;
    for (let page = 0; path; page++) {
      if (page >= MAX_SYNC_PAGES) throw new MushafSyncError('Too many change pages in one sync', 'protocol');
      const body = (await deps.client.get(path)) as { sync?: { mutations?: unknown; has_more?: unknown; next_page_url?: unknown; next_sync_token?: unknown; sync_until_sequence?: unknown } };
      const sync = body?.sync;
      if (!sync || !Array.isArray(sync.mutations)) throw new MushafSyncError('Malformed sync response', 'protocol');
      mutations.push(...(sync.mutations as Mutation[]));
      if (typeof sync.sync_until_sequence === 'number') untilSequence = Math.max(untilSequence, sync.sync_until_sequence);
      if (sync.has_more === true) {
        // Relative to this environment's Content API; anything else is refused.
        if (typeof sync.next_page_url !== 'string' || !sync.next_page_url.startsWith('/api/v4/resources/sync?')) throw new MushafSyncError('Unexpected next_page_url', 'protocol');
        path = `/content${sync.next_page_url}`;
      } else {
        if (typeof sync.next_sync_token !== 'string' || sync.next_sync_token.length === 0) throw new MushafSyncError('The final sync page has no next_sync_token', 'protocol');
        nextSyncToken = sync.next_sync_token;
        path = null;
      }
    }
    const own = mutations
      .filter((m) => m && m.resource_group === MUSHAF_RESOURCE.group && m.resource_id === MUSHAF_RESOURCE.id)
      .sort((a, b) => a.sequence - b.sequence);
    return { mutations: own, nextSyncToken: nextSyncToken!, untilSequence };
  }

  async function fetchSnapshot(url: string | null) {
    if (url !== SNAPSHOT_URL) throw new MushafSyncError(`Unexpected snapshot_url ${JSON.stringify(url)}`, 'protocol');
    const body = await deps.client.stream(`/content${url}`, { timeoutMs: SNAPSHOT_TIMEOUT_MS });
    const set = emptyRecordSet();
    const { envelope, records, bytes } = await readSnapshotStream(body, (record) => upsertRecord(set, record));
    if (envelope.resource_group !== MUSHAF_RESOURCE.group || envelope.resource_id !== MUSHAF_RESOURCE.id) throw new MushafSyncError('The snapshot is for another resource', 'protocol');
    if (envelope.schema_version !== 1) throw new MushafSyncError(`Unsupported snapshot schema_version ${String(envelope.schema_version)}`, 'protocol');
    if (typeof envelope.sync_sequence !== 'number') throw new MushafSyncError('The snapshot has no sync_sequence', 'protocol');
    return { set, sequence: envelope.sync_sequence, records, bytes };
  }

  /** Applies changes in sequence order; returns whether a snapshot replaced everything. */
  async function apply(set: RecordSet, mutations: Mutation[], afterSequence: number) {
    let current = set;
    let snapshot = false;
    let deleted = false;
    let snapshotSequence: number | null = null;
    for (const m of mutations) {
      if (m.sequence <= afterSequence) continue;
      switch (m.type) {
        case 'RESOURCE_CREATE':
        case 'RESOURCE_INVALIDATE': {
          if (m.unavailable_reason) throw new MushafSyncError(`The resource is unavailable (${m.unavailable_reason})`, 'unavailable');
          const fetched = await fetchSnapshot(m.snapshot_url);
          current = fetched.set;
          snapshot = true;
          deleted = false;
          snapshotSequence = fetched.sequence;
          // A snapshot reflects the state when fetched: later rows in this run are already in it.
          afterSequence = Math.max(afterSequence, fetched.sequence);
          log(`Mushaf sync: snapshot sequence=${fetched.sequence} records=${fetched.records} bytes=${fetched.bytes}`);
          break;
        }
        case 'RESOURCE_DELETE':
          deleted = true;
          break;
        case 'RESOURCE_UPDATE':
          break; // freshness marker only
        case 'ROW_CREATE':
        case 'ROW_UPDATE':
          if (!m.data || m.data.record_type !== m.record_type) throw new MushafSyncError(`${m.type} ${m.sequence} has no matching row data`, 'protocol');
          upsertRecord(current, m.data);
          break;
        case 'ROW_DELETE': {
          const id = Number(m.record_key ?? m.source_record_id ?? m.data?.id);
          if (!Number.isInteger(id)) throw new MushafSyncError(`ROW_DELETE ${m.sequence} names no row`, 'protocol');
          deleteRecord(current, m.record_type, id);
          break;
        }
        default:
          throw new MushafSyncError(`Unknown mutation type ${JSON.stringify(m.type)}`, 'protocol');
      }
    }
    return { set: current, snapshot, deleted, snapshotSequence };
  }

  /**
   * Saves the synced records (the faithful Content Sync copy) and publishes
   * them as a new version only if they pass validation. A state that fails is
   * kept but never offered: devices keep receiving the last valid version,
   * and a later sync or a corrected check republishes without downloading again.
   */
  async function publish(previous: SyncState | null, set: RecordSet, next: { syncToken: string; appliedSequence: number; snapshotSequence: number; snapshotFetchedAt: string; mutations: number; snapshot: boolean }): Promise<SyncOutcome> {
    const at = now().toISOString();
    const base: SyncState = {
      schema: 1,
      resource: RESOURCE,
      environment: deps.environment,
      syncToken: next.syncToken,
      appliedSequence: next.appliedSequence,
      snapshotSequence: next.snapshotSequence,
      snapshotFetchedAt: next.snapshotFetchedAt,
      recordsFile: `records-${next.appliedSequence}.json.gz`,
      currentVersion: previous?.environment === deps.environment && !previous.deleted ? previous.currentVersion : null,
      lastSuccessAt: at,
    };
    let dataset: ReturnType<typeof compileDataset>;
    try {
      dataset = compileDataset(set, deps.quran());
    } catch (error) {
      if (!(error instanceof DatasetError)) throw error;
      await deps.store.commit({ state: { ...base, validationError: error.message }, records: set });
      log(`Mushaf sync: synced but NOT published (validation failed; version ${base.currentVersion ?? 'none'} still served): ${error.message}`);
      return { status: 'invalid', version: base.currentVersion, mutations: next.mutations, problems: error.message };
    }
    const chunks = chunkDataset(dataset);
    const version = datasetVersion(chunks);
    const manifest: OfflineManifest = {
      schema: DATASET_SCHEMA,
      edition: 'qpc-v1',
      version,
      mushaf: { id: MUSHAF_RESOURCE.id, ...dataset.mushaf },
      verses: VERSE_COUNT,
      words: dataset.report.words,
      source: { provider: 'Quran Foundation', resource: RESOURCE, snapshotSequence: next.snapshotSequence, appliedSequence: next.appliedSequence },
      publishedAt: at,
      syncedAt: at,
      attribution: ATTRIBUTION,
      chunks: chunks.map(({ json: _json, ...chunk }) => chunk),
      totalBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
      report: { wordTypes: dataset.report.wordTypes },
    };
    const state: SyncState = { ...base, currentVersion: version };
    await deps.store.commit({ state, records: set, published: { manifest, chunks } });
    const changed = version !== previous?.currentVersion;
    log(`Mushaf sync: ${changed ? 'published' : 'unchanged'} version=${version} pages=${dataset.report.pages} words=${dataset.report.words} mutations=${next.mutations}`);
    return changed
      ? { status: 'published', version, previousVersion: previous?.currentVersion ?? null, mutations: next.mutations, snapshot: next.snapshot }
      : { status: 'unchanged', version, mutations: next.mutations };
  }

  async function bootstrap(previous: SyncState | null): Promise<SyncOutcome> {
    const changes = await collectChanges({ bootstrap: true });
    const start = changes.mutations.find((m) => m.type === 'RESOURCE_CREATE' || m.type === 'RESOURCE_INVALIDATE');
    if (!start) {
      if (changes.mutations.some((m) => m.type === 'RESOURCE_DELETE')) throw new MushafSyncError('mushafs:2 has been deleted upstream', 'deleted');
      throw new MushafSyncError('mushafs:2 is not offered by Content Sync', 'unavailable');
    }
    const applied = await apply(emptyRecordSet(), changes.mutations, 0);
    if (applied.deleted) throw new MushafSyncError('mushafs:2 has been deleted upstream', 'deleted');
    return publish(previous, applied.set, {
      syncToken: changes.nextSyncToken,
      appliedSequence: Math.max(changes.untilSequence, applied.snapshotSequence ?? 0),
      snapshotSequence: applied.snapshotSequence ?? 0,
      snapshotFetchedAt: now().toISOString(),
      mutations: changes.mutations.length,
      snapshot: true,
    });
  }

  async function sync(): Promise<SyncOutcome> {
    let state = await deps.store.readState();
    // Never mix environments: another environment's copy is started over, not reused.
    if (state && state.environment !== deps.environment) state = null;
    const records = state && !state.deleted ? await deps.store.readRecords(state) : null;
    if (!state || !records || !state.syncToken) return bootstrap(state);

    let changes: Awaited<ReturnType<typeof collectChanges>>;
    try {
      changes = await collectChanges({ syncToken: state.syncToken });
    } catch (error) {
      // 410 resync_required: the cursor is too old; start again from a snapshot.
      if (error instanceof QfUnavailableError && error.status === 410) {
        log('Mushaf sync: resync required; bootstrapping');
        return bootstrap(state);
      }
      throw error;
    }
    const pending = changes.mutations.filter((m) => m.sequence > state.appliedSequence);
    if (pending.length === 0) {
      // Nothing new upstream. If the stored copy was never published (it failed an earlier
      // check), validate it again: a corrected check publishes it without a new download.
      if (state.validationError || !state.currentVersion) {
        return publish(state, records, {
          syncToken: changes.nextSyncToken,
          appliedSequence: Math.max(state.appliedSequence, changes.untilSequence),
          snapshotSequence: state.snapshotSequence,
          snapshotFetchedAt: state.snapshotFetchedAt,
          mutations: 0,
          snapshot: false,
        });
      }
      await deps.store.touch({ ...state, syncToken: changes.nextSyncToken, lastSuccessAt: now().toISOString() });
      return { status: 'unchanged', version: state.currentVersion, mutations: 0 };
    }
    const applied = await apply(records, pending, state.appliedSequence);
    if (applied.deleted) {
      await deps.store.touch({ ...state, syncToken: changes.nextSyncToken, deleted: true, lastSuccessAt: now().toISOString() });
      log('Mushaf sync: mushafs:2 deleted upstream; no longer offered');
      return { status: 'deleted' };
    }
    return publish(state, applied.set, {
      syncToken: changes.nextSyncToken,
      appliedSequence: Math.max(changes.untilSequence, ...pending.map((m) => m.sequence)),
      snapshotSequence: applied.snapshotSequence ?? state.snapshotSequence,
      snapshotFetchedAt: applied.snapshot ? now().toISOString() : state.snapshotFetchedAt,
      mutations: pending.length,
      snapshot: applied.snapshot,
    });
  }

  const runSync = () => {
    running ??= sync().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    runSync,
    start({ checkEveryMs = 60 * 60 * 1000, firstCheckAfterMs = 10_000 } = {}) {
      const check = async () => {
        try {
          const state = await deps.store.readState();
          const due = !state || state.environment !== deps.environment || now().getTime() - Date.parse(state.lastSuccessAt) >= SYNC_INTERVAL_MS;
          if (due) await runSync();
        } catch (error) {
          // A safe line only: categories, statuses and paths; never tokens or bodies.
          const described = error instanceof QfUnavailableError ? error.describe() : `${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? ''}`;
          log(`Mushaf sync failed (the previous version is still served): ${described}`);
        }
      };
      const first = setTimeout(() => void check(), firstCheckAfterMs);
      const timer = setInterval(() => void check(), checkEveryMs);
      first.unref?.();
      timer.unref?.();
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    },
  };
}
