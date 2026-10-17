import type { AudioFiles } from './downloads';
import type { SourceResolver } from './engine';
import { surahAudioUrl } from './reciters';

/**
 * The provider seam: where a surah's audio comes from. A downloaded, verified file on the device always wins (it plays
 * without any network request); otherwise MP3Quran's stream, the primary provider. Another authorized provider would
 * be added here (with its own audited timing), never by changing the engine.
 */
export function localFirstSource(files: Pick<AudioFiles, 'uri'>): SourceResolver {
  return async (reciter, surah) => {
    const local = await files.uri(reciter.id, surah).catch(() => null);
    return local ? { uri: local, local: true } : { uri: surahAudioUrl(reciter, surah), local: false };
  };
}
