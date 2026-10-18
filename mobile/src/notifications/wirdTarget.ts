import { loadActiveReadingStopId, loadReadingStops, type ReadingStop } from '@/mushaf/readingStops';
import { getLocalDataOwnerState } from '@/storage/localDataOwner';

import { isValidWirdTarget, type WirdReminderTarget } from './content';

/**
 * Which ورد the Wird Reminder names: the same one Home's Continue Reciting shows (ContinueReadingCard's
 * continueTarget) — the active ورد (the one chosen in the reader or on Home), else the most recently saved — with its
 * name exactly as saved and its saved page. Never derived from the time of day, never invented: no ورد (or no valid
 * page) is null, and the reminder then uses its generic copy.
 */
export function selectWirdReminderTarget(stops: readonly ReadingStop[], activeStopId: string | null): WirdReminderTarget | null {
  // Stops are newest first (parseReadingStops).
  const stop = stops.find((candidate) => candidate.id === activeStopId) ?? stops[0] ?? null;
  if (!stop) return null;
  const target = { stopId: stop.id, name: stop.name, page: stop.page };
  return isValidWirdTarget(target) ? target : null;
}

/**
 * What the reminder can say now: `known` false while the app does not yet know whose data is active (at launch, until
 * the account's sign-in state is resolved), so the reminder already scheduled is left as it is rather than replaced
 * by another owner's, or by the generic copy for a moment. Device-local only: offline and in guest mode alike.
 */
export type WirdTargetLookup = { known: false } | { known: true; target: WirdReminderTarget | null };

export async function loadWirdReminderTarget(): Promise<WirdTargetLookup> {
  const owner = await getLocalDataOwnerState();
  if (!owner.resolved) return { known: false };
  const [stops, activeStopId] = await Promise.all([loadReadingStops(owner.activeUserId), loadActiveReadingStopId(owner.activeUserId)]);
  return { known: true, target: selectWirdReminderTarget(stops, activeStopId) };
}
