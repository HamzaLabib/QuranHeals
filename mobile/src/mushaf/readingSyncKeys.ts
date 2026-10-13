/**
 * Where an account's أورادي وختماتي sync state is kept on the device (the
 * last version each record had on the account, and the download position;
 * sync/readingSyncState.ts). Per account, like the reading data itself:
 * `<key>:account:<userId>`. Guests have none.
 *
 * v2: account-based sync. v1 belonged to an unreleased, end-to-end
 * encrypted development build; it is discarded on first use (never the
 * reading data itself), so that device simply re-uploads its own copy.
 */
export const READING_SYNC_STORAGE_KEY = 'quran-heals:mushaf-reading-sync:v2';
export const LEGACY_READING_SYNC_STORAGE_KEY = 'quran-heals:mushaf-reading-sync:v1';
