/**
 * Whether the offline Mushaf downloads automatically after the app opens
 * (autoDownload.ts):
 *  - Development builds: always (unchanged).
 *  - EAS preview builds: yes. Recognised by the binary's EAS Update channel,
 *    `preview` (eas.json), not by an environment variable: `eas update`
 *    doesn't apply a build profile's `env`, so a later OTA update to the
 *    preview channel keeps the same behaviour.
 *  - Production (`production` channel): prepared, and held back by
 *    PRODUCTION_AUTO_DOWNLOAD_RELEASED until the physical-device checks in
 *    docs/mushaf-device-testing.md pass. While it is false, no production
 *    binary or OTA update downloads by itself.
 *  - Any other channel, or no channel (expo-updates unavailable, the web): no.
 * When it is on, the same controller decides how: by itself on Wi-Fi; asking
 * first on mobile data or an unknown network (and remembering the answer);
 * never while the reader's Pause or Remove holds; and "ready" only once the
 * engine reports every layout and all 604 page fonts verified.
 * Off, nothing else changes: the reader's own Download button and the daily
 * update check of an installed copy work as before.
 */
export const AUTO_DOWNLOAD_CHANNELS: readonly string[] = ['preview'];

/** The production binaries' EAS Update channel (eas.json → build.production.channel). */
export const PRODUCTION_CHANNEL = 'production';

/**
 * The release gate for production. Set to true — the only change needed — once the device checks pass; until then a
 * production build (and any OTA update to it) keeps automatic downloads off.
 */
export const PRODUCTION_AUTO_DOWNLOAD_RELEASED = false;

/** The channels that download by itself: preview, and production once released. */
export function autoDownloadChannels(productionReleased: boolean = PRODUCTION_AUTO_DOWNLOAD_RELEASED): readonly string[] {
  return productionReleased ? [...AUTO_DOWNLOAD_CHANNELS, PRODUCTION_CHANNEL] : AUTO_DOWNLOAD_CHANNELS;
}

export function resolveAutoDownloadEnabled(
  build: { dev: boolean; channel: string | null | undefined },
  productionReleased: boolean = PRODUCTION_AUTO_DOWNLOAD_RELEASED,
): boolean {
  if (build.dev) return true;
  return typeof build.channel === 'string' && autoDownloadChannels(productionReleased).includes(build.channel);
}

/** This build's answer: __DEV__, then the binary's channel from expo-updates (loaded on first use). */
export async function autoDownloadEnabled(): Promise<boolean> {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (dev) return true;
  const channel = await import('expo-updates').then((updates) => updates.channel ?? null, () => null);
  return resolveAutoDownloadEnabled({ dev, channel });
}
