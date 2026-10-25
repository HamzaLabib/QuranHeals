import { readNativeMp3Seek, type NativeMp3Seek } from '@/audio/vbrSeek';

type UpdatesInfo = { runtimeVersion?: string | null; updateId?: string | null; isEmbeddedLaunch?: boolean };

/**
 * The app version and expo-updates' identifiers, or nothing where a module is unavailable (tests, web). Required
 * lazily, like vbrSeek.ts's expo-modules-core: importing them at module load fails outside a native runtime. Never throws.
 */
function readBuild(): { version?: string; updates: UpdatesInfo } {
  let version: string | undefined;
  let updates: UpdatesInfo = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    version = (require('expo-constants') as { default: { expoConfig?: { version?: string } | null } }).default.expoConfig?.version;
  } catch {
    // unknown version
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updates = require('expo-updates') as UpdatesInfo;
  } catch {
    // no update identifiers
  }
  return { version, updates };
}

/**
 * One technical line identifying this binary and update, shown at the bottom of Quran Sources & Credits: the app
 * version, the fingerprint runtime version, the EAS update (or "embedded" for the bundle shipped in the binary) and the
 * exact-MP3-seek method the native player reports (audio/vbrSeek.ts; "none" on an unpatched binary). Device-test
 * records copy it (docs/release-device-checklist.md), so each result names the exact binary and capability tested.
 * Language-neutral on purpose: identifiers, not prose.
 */
export function buildInfoLine(source?: { version?: string; updates: UpdatesInfo; seek: NativeMp3Seek | null }): string {
  const { version, updates, seek } = source ?? { ...readBuild(), seek: readNativeMp3Seek() };
  return [
    `v${version ?? '?'}`,
    `runtime ${updates.runtimeVersion ? updates.runtimeVersion.slice(0, 8) : 'unknown'}`,
    updates.isEmbeddedLaunch === false && updates.updateId ? `update ${updates.updateId.slice(0, 8)}` : 'embedded',
    `exact MP3 seek: ${seek ?? 'none'}`,
  ].join(' · ');
}
