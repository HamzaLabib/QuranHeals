/**
 * Favorites, reflections and settings are merged last-write-wins on
 * instants the device declares ("when the user changed this"), not on the
 * server's write time (see models/UserFavorite.ts, UserReflection.ts,
 * UserPreference.ts). A device whose clock runs ahead would otherwise win
 * every later comparison — and keep winning until real time caught up —
 * so an instant further ahead of the server's clock than ordinary drift is
 * stored as the server's own time instead. The record that comes back
 * carries the instant actually stored; the app adopts it
 * (mobile/src/sync/favoritesSync.ts, reflectionsSync.ts, preferencesSync.ts),
 * so a later change on any device can still win.
 *
 * Instants in the past are never changed. Not used for أورادي وختماتي,
 * which is ordered by revisions (services/readingSync.ts).
 */

/** How far ahead of the server's clock a declared instant may be and still be stored as declared. */
export const CLIENT_CLOCK_TOLERANCE_MS = 2 * 60_000;

/** `value` (an ISO instant the validators already accepted), or the server's time `now` when `value` lies beyond the tolerance. */
export function acceptClientInstant(value: string, now: number): string {
  return Date.parse(value) - now > CLIENT_CLOCK_TOLERANCE_MS ? new Date(now).toISOString() : value;
}

/** A record's creation instant, accepted the same way and never later than its accepted `updatedAt`. */
export function acceptCreatedAt(createdAt: string, acceptedUpdatedAt: string, now: number): string {
  const accepted = acceptClientInstant(createdAt, now);
  return Date.parse(accepted) > Date.parse(acceptedUpdatedAt) ? acceptedUpdatedAt : accepted;
}
