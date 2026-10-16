import { orientationRequestFor, type OrientationRequest } from './orientationPolicy';

/** What the activity currently asks the system for: the manifest's portrait, the system default, or anything else. */
export type CurrentRequest = OrientationRequest | 'other';

export type OrientationApi = {
  current: () => Promise<CurrentRequest>;
  request: (request: OrientationRequest) => Promise<void>;
};

/**
 * Applies orientationRequestFor() through `api` with as few native calls as possible:
 * - a sync whose answer equals the last one applied does nothing (a rotation swaps the screen's sides but never its
 *   shortest side, so it never calls native code, and applying a request can never start a loop);
 * - otherwise the activity's actual request is read first, and changed only when it differs (a phone, already portrait
 *   from its manifest, never gets a call that changes anything);
 * - `recheck` (the app returning to the foreground) reads it again even when nothing changed, so an activity the
 *   system recreated (which starts from the manifest's portrait) is corrected;
 * - calls run one after another, never overlapping; a failure forgets the last request, so the next sync retries.
 */
export function createOrientationController(api: OrientationApi, os: string) {
  let applied: OrientationRequest | null = null;
  let queue: Promise<void> = Promise.resolve();
  return {
    sync(screen: { width: number; height: number }, recheck = false): Promise<void> {
      const wanted = orientationRequestFor(os, screen);
      if (!wanted || (!recheck && wanted === applied)) return queue;
      applied = wanted;
      queue = queue
        .then(async () => {
          if ((await api.current()) !== wanted) await api.request(wanted);
        })
        .catch(() => {
          applied = null;
        });
      return queue;
    },
  };
}
