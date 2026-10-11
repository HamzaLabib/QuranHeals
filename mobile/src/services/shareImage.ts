import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { loadNativeShareFilesModule } from './shareFilesModule';

/**
 * On-device image export for ShareAyahSheet: no upload, no backend call, no
 * account. Files are view-shot temp files in the app's cache.
 */

/** False only in shareImage.web.ts. */
export const IMAGE_EXPORT_SUPPORTED = true;

export type CaptureSize = { width: number; height: number };

/**
 * Captures a rendered card as a PNG temp file. ShareAyahCard's export copy
 * is laid out at `width / PixelRatio` points, so iOS (which renders at the
 * screen scale and reads width/height as points) already produces exactly
 * `size` pixels; Android reads width/height as pixels and gets them
 * explicitly, absorbing any sub-pixel rounding of a fractional pixel ratio.
 */
export async function captureCardImage(ref: RefObject<View | null>, size: CaptureSize, fileName: string): Promise<string> {
  if (!ref.current) throw new Error('The card is not ready to capture yet.');
  return captureRef(ref, {
    format: 'png',
    result: 'tmpfile',
    ...(Platform.OS === 'android' ? { width: size.width, height: size.height, fileName } : {}),
  });
}

/**
 * view-shot returns a plain path on iOS ("/private/var/…/x.png") and a
 * file:// URI on Android. Native share/save code needs a file:// URL (on
 * iOS 17+ a bare path becomes a scheme-less URL that expo-sharing rejects
 * as unreadable). releaseCardImages keeps the original string, which is
 * what view-shot's releaseCapture expects.
 */
export function toFileUrl(uri: string): string {
  if (!uri.startsWith('/')) return uri;
  return `file://${uri.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 'multiple-unavailable': several cards, but this binary can't share more
 * than one file at once (built before modules/quran-heals-share-files).
 * The caller then offers Save instead — never a partial ayah.
 */
export type ShareImageResult = 'shared' | 'unavailable' | 'multiple-unavailable';

/**
 * Opens the system share sheet with every given card, in order: one card
 * through expo-sharing, several through the local share-files module. It
 * resolves the same way whether the user picked an app or dismissed the
 * sheet (neither platform reports which), so dismissing is never an error.
 */
export async function shareCardImages(uris: string[], dialogTitle: string): Promise<ShareImageResult> {
  const fileUrls = uris.map(toFileUrl);
  if (fileUrls.length > 1) {
    const module = loadNativeShareFilesModule();
    if (!module) return 'multiple-unavailable';
    await module.shareFilesAsync(fileUrls, dialogTitle);
    return 'shared';
  }
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(fileUrls[0], { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
  return 'shared';
}

export type SaveImagesResult = { status: 'saved'; count: number } | { status: 'denied'; canAskAgain: boolean };

/**
 * Saves to the photo library with write-only access: iOS asks only for
 * "add photos" (NSPhotoLibraryAddUsageDescription), Android 13+ needs no
 * permission, and Android 12 and older ask for WRITE_EXTERNAL_STORAGE. The
 * permission is only requested here, when the user taps Save.
 */
export async function saveCardImages(uris: string[]): Promise<SaveImagesResult> {
  let permission = await MediaLibrary.getPermissionsAsync(true);
  if (!permission.granted && permission.canAskAgain) permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };
  for (const uri of uris) await MediaLibrary.saveToLibraryAsync(toFileUrl(uri));
  return { status: 'saved', count: uris.length };
}

/** Best-effort cleanup of captured temp files; a failure never surfaces to the user. */
export function releaseCardImages(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      releaseCapture(uri);
    } catch {
      // Already gone, or the OS cleared the cache: nothing to do.
    }
  }
}
