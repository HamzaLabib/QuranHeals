import type { RefObject } from 'react';
import type { View } from 'react-native';

import type { CaptureSize, SaveImagesResult, ShareImageResult } from './shareImage';

/**
 * Web build: image export is a native-only feature (view-shot's web path
 * needs an extra canvas library, and there is no photo library to save to),
 * so the native modules are never bundled here and the sheet reports
 * sharing as unavailable instead of failing.
 */

export const IMAGE_EXPORT_SUPPORTED = false;

export async function captureCardImage(_ref: RefObject<View | null>, _size: CaptureSize, _fileName: string): Promise<string> {
  throw new Error('Image export is not available on the web.');
}

export async function shareCardImages(_uris: string[], _dialogTitle: string): Promise<ShareImageResult> {
  return 'unavailable';
}

export async function saveCardImages(_uris: string[]): Promise<SaveImagesResult> {
  throw new Error('Saving images is not available on the web.');
}

export function releaseCardImages(_uris: readonly string[]): void {
  // Nothing is ever captured on the web.
}
