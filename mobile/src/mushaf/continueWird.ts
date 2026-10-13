import { router } from 'expo-router';

import { setActiveReadingStopId } from './readingStops';

/**
 * Opens the Mushaf tab on a ورد's saved page and makes it the active ورد, so
 * the reader's pill and its next save are that ورد's. Without a ورد (Home's
 * first reading), page 1 and no ورد. `at` makes a reader that is already
 * open move to the page too. Changes no ورد's page.
 */
export async function openMushafFor(stop: { id: string; page: number } | null): Promise<void> {
  if (stop) await setActiveReadingStopId(stop.id).catch(() => undefined);
  router.navigate({ pathname: '/mushaf', params: { page: String(stop ? stop.page : 1), at: String(Date.now()) } });
}
