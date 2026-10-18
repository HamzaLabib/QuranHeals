import AsyncStorage from '@react-native-async-storage/async-storage';

import { mushafRouteForAyah, type MushafAyahRoute } from '@/mushaf/ayahInMushaf';

import type { NotificationResponseEvent } from './api';
import { parseNotificationPayload } from './content';

/**
 * Where a tapped reminder goes. Decided at tap time, from the payload alone
 * (content.ts) and — for the Wird Reminder — the reading data of whoever is
 * using the app now:
 *  - Random Quran Ayah → that exact verse in the Mushaf: its page, with the
 *    ayah selected as a tap selects it (mushafRouteForAyah, as an ayah card's
 *    reference does). Its `at` moves a reader that is already open, on any
 *    page; the active ورد and its saved page are unchanged. Never a new random
 *    choice.
 *  - Emotional Check-in → the full emotion list (/emotions, How I Feel —
 *    المشاعر). Nothing is chosen or recorded: the user picks, as always.
 *  - Wird Reminder → the ورد it named (`stopId`), if it still exists for the
 *    current owner: the Mushaf on its current saved page (the same
 *    openMushafFor as Home's Continue Reciting: it opens the page and makes
 *    that ورد the active one, so its saved ayah is marked; it saves no page,
 *    completes nothing and counts no Khatma). Deleted since, or another
 *    owner's: أورادي وختماتي. A reminder that named no ورد (generic copy, or
 *    payload version 1): with exactly one ورد, that one; otherwise أورادي وختماتي.
 *  - Anything unrecognised (another version, a damaged payload): the app
 *    opens where it is, without navigating.
 */
export type NotificationDestination =
  | { type: 'ayah'; surah: number; ayah: number }
  | { type: 'emotions' }
  | { type: 'wird'; stopId?: string };

export function destinationOf(event: Pick<NotificationResponseEvent, 'data'>): NotificationDestination | null {
  const payload = parseNotificationPayload(event.data);
  if (!payload) return null;
  if (payload.kind === 'randomAyah') return { type: 'ayah', surah: payload.surah, ayah: payload.ayah };
  if (payload.kind === 'emotionCheckIn') return { type: 'emotions' };
  return payload.stopId ? { type: 'wird', stopId: payload.stopId } : { type: 'wird' };
}

export type RoutingDeps = {
  /** The current owner's ورد list (guest or the signed-in account), read at tap time. */
  loadStops: () => Promise<readonly { id: string; page: number }[]>;
  openMushafFor: (stop: { id: string; page: number }) => Promise<void>;
  navigate: (route: MushafAyahRoute | '/emotions' | '/my-reading') => void;
  /** Taps already acted on, kept across a reload of the app's code (the OS may report the launching tap again). */
  handledStore?: HandledTapStore;
};

export type HandledTapStore = { load(): Promise<string[]>; save(keys: string[]): Promise<void> };

/** Remembered taps (identifier + delivery time), so one tap navigates once: reported twice (launch response and listener), or again after a reload. */
export const HANDLED_TAPS_STORAGE_KEY = 'quran-heals:notification-handled-taps:v1';
export const HANDLED_LIMIT = 50;

export const asyncStorageHandledTapStore: HandledTapStore = {
  async load() {
    try {
      const raw = await AsyncStorage.getItem(HANDLED_TAPS_STORAGE_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string').slice(-HANDLED_LIMIT) : [];
    } catch {
      return [];
    }
  },
  async save(keys) {
    try {
      await AsyncStorage.setItem(HANDLED_TAPS_STORAGE_KEY, JSON.stringify(keys.slice(-HANDLED_LIMIT)));
    } catch {
      // Non-fatal: at worst a tap reported again after a reload opens its screen again.
    }
  },
};

export function createNotificationResponseHandler(deps: RoutingDeps) {
  // Checked and updated synchronously first, so two reports of one tap arriving together can never both pass.
  const handled: string[] = [];
  let persisted: Promise<string[]> | null = null;

  return async function handle(event: NotificationResponseEvent): Promise<NotificationDestination | null> {
    if (!event.isDefaultAction) return null;
    const key = `${event.identifier}@${event.deliveredAt}`;
    if (handled.includes(key)) return null;
    handled.push(key);
    if (handled.length > HANDLED_LIMIT) handled.shift();
    if (deps.handledStore) {
      persisted ??= deps.handledStore.load();
      const earlier = await persisted;
      if (earlier.includes(key)) return null;
      earlier.push(key);
      if (earlier.length > HANDLED_LIMIT) earlier.splice(0, earlier.length - HANDLED_LIMIT);
      void deps.handledStore.save([...earlier]);
    }

    const destination = destinationOf(event);
    if (!destination) return null;
    if (destination.type === 'ayah') {
      const route = mushafRouteForAyah(destination.surah, destination.ayah);
      if (!route) return null;
      deps.navigate(route);
    } else if (destination.type === 'emotions') {
      deps.navigate('/emotions');
    } else {
      let stops: readonly { id: string; page: number }[] = [];
      try {
        stops = await deps.loadStops();
      } catch {
        stops = [];
      }
      const named = destination.stopId ? stops.find((stop) => stop.id === destination.stopId) : undefined;
      const target = destination.stopId ? named : stops.length === 1 ? stops[0] : undefined;
      if (target) await deps.openMushafFor(target);
      else deps.navigate('/my-reading');
    }
    return destination;
  };
}
