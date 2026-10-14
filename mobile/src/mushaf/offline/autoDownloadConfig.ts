/**
 * Whether the offline Mushaf downloads automatically after the app opens
 * (autoDownload.ts):
 *  - Development builds: always (unchanged).
 *  - EAS preview builds: yes. Recognised by the binary's EAS Update channel,
 *    `preview` (eas.json), not by an environment variable: `eas update`
 *    doesn't apply a build profile's `env`, so a later OTA update to the
 *    preview channel keeps the same behaviour.
 *  - Production (`production` channel), any other channel, or no channel
 *    (expo-updates unavailable, the web): no. Add 'production' here only
 *    after the preview has been verified on devices.
 * Off, nothing else changes: the reader's own Download button and the daily
 * update check of an installed copy work as before.
 */
export const AUTO_DOWNLOAD_CHANNELS: readonly string[] = ['preview'];

export function resolveAutoDownloadEnabled(build: { dev: boolean; channel: string | null | undefined }): boolean {
  if (build.dev) return true;
  return typeof build.channel === 'string' && AUTO_DOWNLOAD_CHANNELS.includes(build.channel);
}

/** This build's answer: __DEV__, then the binary's channel from expo-updates (loaded on first use). */
export async function autoDownloadEnabled(): Promise<boolean> {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (dev) return true;
  const channel = await import('expo-updates').then((updates) => updates.channel ?? null, () => null);
  return resolveAutoDownloadEnabled({ dev, channel });
}
