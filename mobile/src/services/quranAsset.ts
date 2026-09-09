import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import manifest from '@/assets/quran/quran-manifest.json';
import { QuranDataError } from './quranReference';
import { bundledQuranAssets } from './quranAssets';

export async function openBundledQuran() {
  // Release builds embed this exact asset. downloadAsync resolves its local URI;
  // only Expo development loads the bundled asset from the development server.
  const asset = await Asset.fromModule(bundledQuranAssets.database).downloadAsync();
  if (!asset.localUri) throw new QuranDataError('The bundled Quran is unavailable. Please try again.');
  const bytes = await new File(asset.localUri).bytes();
  if (bytes.byteLength !== manifest.database.bytes) throw new QuranDataError('The local Quran asset could not be verified.', 'integrity');
  const { deserializeDatabaseAsync } = await import('expo-sqlite');
  // A private in-memory connection cannot modify the bundled file. The repository
  // immediately enables query_only before exposing any verse lookup methods.
  return deserializeDatabaseAsync(bytes, { useNewConnection: true });
}
