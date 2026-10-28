import { loadNativeBackupExclusionModule, type NativeBackupExclusionModule } from './backupExclusionModule';

/**
 * Keeps content the app can download again out of iCloud and computer backups (iOS Data Storage Guidelines; App
 * Review 2.23): the recitation downloads and the offline Mushaf. Only these locations are ever marked, so reflections,
 * favorites, reading records and settings (AsyncStorage, SecureStore) stay in the user's backup.
 *
 *   <documents>/quran-audio                       recitations, ayah timing (audio/storage.ts)
 *   <documents>/mushaf                            the 604 page fonts (mushaf/offline/index.ts)
 *   <documents>/SQLite/mushaf-qpc-v1.db(-wal/-shm) the offline Mushaf's layout (mushaf/offline/store.ts)
 *
 * The two directories are created if missing and marked once per launch: the flag on a directory covers what is
 * already inside (downloads made before this existed) and everything added later, and nothing deletes either
 * directory itself. The database files are marked whenever the database is opened, since SQLite may recreate its
 * -wal and -shm files.
 */
export const DOWNLOAD_DIRECTORIES = ['quran-audio', 'mushaf'] as const;
export const OFFLINE_MUSHAF_DB_FILES = (name: string) => [name, `${name}-wal`, `${name}-shm`];

export type ExclusionResult = 'excluded' | 'unavailable' | 'failed';

type Deps = {
  native: () => NativeBackupExclusionModule | null;
  /** Creates the directory if missing and returns its URI. */
  ensureDirectory: (name: string) => Promise<string>;
};

const defaultDeps: Deps = {
  native: loadNativeBackupExclusionModule,
  ensureDirectory: async (name) => {
    const { Directory, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, name);
    if (!dir.exists) dir.create({ intermediates: true });
    return dir.uri;
  },
};

/** Marks each existing location. Never throws: a failure leaves the content where it is, only backed up. */
export async function excludeFromBackup(locations: readonly string[], native = loadNativeBackupExclusionModule()): Promise<ExclusionResult> {
  if (!native) return 'unavailable';
  let failed = false;
  for (const location of locations) {
    try {
      await native.excludeFromBackupAsync(location);
    } catch {
      failed = true;
    }
  }
  return failed ? 'failed' : 'excluded';
}

let directoriesOnce: Promise<ExclusionResult> | null = null;

/** The download directories, once per launch (later calls share the first result). Called at startup and before a download. */
export function excludeDownloadDirectoriesFromBackup(deps: Deps = defaultDeps): Promise<ExclusionResult> {
  directoriesOnce ??= (async () => {
    const native = deps.native();
    if (!native) return 'unavailable';
    try {
      const uris: string[] = [];
      for (const name of DOWNLOAD_DIRECTORIES) uris.push(await deps.ensureDirectory(name));
      const result = await excludeFromBackup(uris, native);
      if (result === 'failed') directoriesOnce = null; // try again next time
      return result;
    } catch {
      directoriesOnce = null;
      return 'failed';
    }
  })();
  return directoriesOnce;
}

/** The offline Mushaf's SQLite files in expo-sqlite's directory (only those that exist are marked). */
export async function excludeOfflineMushafDatabaseFromBackup(directory: string | null | undefined, name: string, native = loadNativeBackupExclusionModule()): Promise<ExclusionResult> {
  if (!native || !directory) return 'unavailable';
  return excludeFromBackup(OFFLINE_MUSHAF_DB_FILES(name).map((file) => `${directory.replace(/\/+$/, '')}/${file}`), native);
}

/** Tests only. */
export function resetBackupExclusionForTests() {
  directoriesOnce = null;
}
