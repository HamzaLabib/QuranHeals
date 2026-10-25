/**
 * Exact seeking in the MP3Quran VBR recordings of Islam Sobhi, Yasser Mahmoud Salama (48) and Ahmed Al-Agamy (42).
 *
 * expo-audio's players seek a VBR MP3 through its Xing table: seconds away from an ayah's start (Android, measured up
 * to 7 s). The native patch native-patches/expo-audio-exact-mp3-seek makes a binary seek them exactly, for sources
 * marked with EXACT_MP3_SEEK_HEADER only (every other source, every CBR file, plays exactly as before), and reports it
 * as the ExpoAudio constant `quranHealsExactMp3Seek`.
 *
 * DEVELOPMENT builds only (reciters.ts), and only when ALL hold: the installed binary reports the patch, and the
 * platform's method was verified on a real device (VBR_SEEK_DEVICE_VERIFIED) or, in a development build only, the test
 * flag EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1 is set for the device test itself. Otherwise nothing changes anywhere. Every
 * build compiles the patch (mobile/package.json: postinstall applies it, eas-build-post-install verifies it).
 */
export const EXACT_MP3_SEEK_HEADER = 'X-Quran-Heals-Mp3-Seek';
export const EXACT_MP3_SEEK_VALUE = 'index';

/** What the patched binary does: Android 'index' (TOC-less Xing + media3 index seeking), iOS AVFoundation precise timing. */
export type NativeMp3Seek = 'index' | 'avfoundation-precise';

/**
 * Methods verified on a real device (native-patches/expo-audio-exact-mp3-seek/DEVICE-TEST-PLAN.md). Set to true only
 * from a recorded device result; until then the VBR surahs play only in a device test with the test flag.
 * A platform-level result: it lets a patched binary of that platform use the VBR timing (development builds only), and
 * each surah still needs its accepted timing and the catalogue file's fingerprint (reciters.ts withVbrSeek).
 *  - 'avfoundation-precise' (iOS): owner-approved 2026-10-24 after listening on an iPhone (EAS development build
 *    f9ada32f): Yasser Mahmoud Salama 48, Islam Sobhi 99 and 108, Ahmed Al-Agamy 42:29 and 42:53, with Repeat, Full
 *    Surah, Previous / Next, continuous and lock-screen playback. Only those recordings were heard.
 *  - 'index' (Android): measured on the emulator (seek lab), not yet listened to on a device.
 */
export const VBR_SEEK_DEVICE_VERIFIED: Readonly<Record<NativeMp3Seek, boolean>> = { index: false, 'avfoundation-precise': true };

/** The installed binary's exact-seek method, or null (an unpatched binary, tests, web). Never throws. */
export function readNativeMp3Seek(): NativeMp3Seek | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as typeof import('expo-modules-core');
    const value = core.requireOptionalNativeModule<{ quranHealsExactMp3Seek?: unknown }>('ExpoAudio')?.quranHealsExactMp3Seek;
    return value === 'index' || value === 'avfoundation-precise' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether the VBR recordings may play ayah by ayah: a patched binary, and a verified method or the device-test flag.
 * The flag counts in development builds only: a release build never trusts it, whatever its environment.
 */
export function vbrSeekEnabled(
  native: NativeMp3Seek | null,
  testFlag: string | undefined,
  verified: Readonly<Record<NativeMp3Seek, boolean>> = VBR_SEEK_DEVICE_VERIFIED,
  development: boolean = __DEV__,
): boolean {
  return native !== null && (verified[native] === true || (development && testFlag === '1'));
}
