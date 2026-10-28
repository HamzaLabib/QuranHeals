import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DOWNLOAD_DIRECTORIES,
  excludeDownloadDirectoriesFromBackup,
  excludeOfflineMushafDatabaseFromBackup,
  resetBackupExclusionForTests,
} from '@/services/backupExclusion';
import type { NativeBackupExclusionModule } from '@/services/backupExclusionModule';

/**
 * Release audit B5: re-downloadable content (recitations, the offline Mushaf) must stay out of iCloud backups, and
 * nothing personal may be marked. The native flag itself (modules/quran-heals-backup-exclusion) needs an iPhone to
 * verify: Settings → iCloud → Manage Storage → Backups → Quran Heals.
 */
function fakeNative(failOn: string[] = []) {
  const marked: string[] = [];
  const native: NativeBackupExclusionModule = {
    excludeFromBackupAsync: async (location) => {
      if (failOn.some((part) => location.includes(part))) throw new Error('setResourceValues failed');
      marked.push(location);
      return true;
    },
    isExcludedFromBackupAsync: async () => null,
  };
  return { native, marked };
}

const created: string[] = [];
const ensureDirectory = async (name: string) => {
  created.push(name);
  return `file:///var/mobile/Containers/Data/Application/X/Documents/${name}/`;
};

beforeEach(() => {
  resetBackupExclusionForTests();
  created.length = 0;
});

describe('backup exclusion', () => {
  it('marks exactly the recitation and offline Mushaf directories, creating them so existing and future downloads are covered', async () => {
    const { native, marked } = fakeNative();
    expect(await excludeDownloadDirectoriesFromBackup({ native: () => native, ensureDirectory })).toBe('excluded');
    expect(created).toEqual(['quran-audio', 'mushaf']);
    expect(marked).toEqual([
      'file:///var/mobile/Containers/Data/Application/X/Documents/quran-audio/',
      'file:///var/mobile/Containers/Data/Application/X/Documents/mushaf/',
    ]);
  });

  it('runs once per launch', async () => {
    const { native, marked } = fakeNative();
    const deps = { native: () => native, ensureDirectory };
    await excludeDownloadDirectoriesFromBackup(deps);
    await excludeDownloadDirectoriesFromBackup(deps);
    expect(marked).toHaveLength(2);
  });

  it('a failure never throws, and is tried again on the next call', async () => {
    const failing = fakeNative(['mushaf']);
    expect(await excludeDownloadDirectoriesFromBackup({ native: () => failing.native, ensureDirectory })).toBe('failed');
    const working = fakeNative();
    expect(await excludeDownloadDirectoriesFromBackup({ native: () => working.native, ensureDirectory })).toBe('excluded');
    expect(working.marked).toHaveLength(2);
  });

  it('does nothing without the native module (Android, the web, binaries built before it)', async () => {
    expect(await excludeDownloadDirectoriesFromBackup({ native: () => null, ensureDirectory })).toBe('unavailable');
    expect(created).toEqual([]);
    expect(await excludeOfflineMushafDatabaseFromBackup('/var/x/Documents/SQLite', 'mushaf-qpc-v1.db', null)).toBe('unavailable');
  });

  it('marks the offline Mushaf database with its WAL files, in expo-sqlite’s directory', async () => {
    const { native, marked } = fakeNative();
    expect(await excludeOfflineMushafDatabaseFromBackup('/var/x/Documents/SQLite/', 'mushaf-qpc-v1.db', native)).toBe('excluded');
    expect(marked).toEqual(['/var/x/Documents/SQLite/mushaf-qpc-v1.db', '/var/x/Documents/SQLite/mushaf-qpc-v1.db-wal', '/var/x/Documents/SQLite/mushaf-qpc-v1.db-shm']);
  });

  it('only download locations are listed (personal data lives in AsyncStorage and SecureStore, never here)', () => {
    expect([...DOWNLOAD_DIRECTORIES]).toEqual(['quran-audio', 'mushaf']);
    const src = (path: string) => readFileSync(resolve(__dirname, '..', 'src', path), 'utf8');
    // The two directories are the ones the download code writes to.
    expect(src('audio/storage.ts')).toContain("new m.Directory(m.Paths.document, 'quran-audio')");
    expect(src('mushaf/offline/index.ts')).toContain("new Directory(Paths.document, 'mushaf', 'qpc-v1', 'fonts')");
    // And each is wired: startup (existing downloads), a new recitation download, the Mushaf database.
    expect(src('app/_layout.tsx')).toContain('excludeDownloadDirectoriesFromBackup');
    expect(src('audio/storage.ts')).toContain('excludeDownloadDirectoriesFromBackup');
    expect(src('mushaf/offline/index.ts')).toContain('excludeOfflineMushafDatabaseFromBackup(defaultDatabaseDirectory, OFFLINE_DB_NAME)');
  });

  it('the native module is iOS-only and sets NSURLIsExcludedFromBackupKey', () => {
    const root = resolve(__dirname, '..', 'modules', 'quran-heals-backup-exclusion');
    expect(JSON.parse(readFileSync(resolve(root, 'expo-module.config.json'), 'utf8'))).toEqual({
      platforms: ['apple'],
      apple: { modules: ['QuranHealsBackupExclusionModule'] },
    });
    const swift = readFileSync(resolve(root, 'ios', 'QuranHealsBackupExclusionModule.swift'), 'utf8');
    expect(swift).toContain('Name("QuranHealsBackupExclusion")');
    expect(swift).toContain('values.isExcludedFromBackup = true');
  });
});
