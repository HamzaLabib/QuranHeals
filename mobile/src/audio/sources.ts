import type { AudioFiles } from './downloads';
import type { SourceResolver } from './engine';
import { SOURCE_REGISTRY, type SourceRegistry } from './sourceRegistry';

/**
 * The provider seam: where a surah's audio comes from. A downloaded, verified file on the device always wins (it plays
 * without any network request); otherwise the source registry's preferred stream for this reciter and surah (MP3Quran
 * first), with the other verified, permitted streams of the same reciter as alternates. A surah with no playable source
 * has no URL at all (the engine never asks: it checks the capability first).
 */
export function localFirstSource(files: Pick<AudioFiles, 'uri'>, registry: SourceRegistry = SOURCE_REGISTRY): SourceResolver {
  return async (reciter, surah, timing) => {
    // Phase 4.8.3: human-verified timing plays ITS recording, whatever the catalogue lists. A downloaded file (always the
    // catalogue's) is used only when it is that very recording (same URL and size); a recording outside the audited
    // catalogue is checked before it plays (no redirect, the verified size), like every stream the audit did not pin.
    const verified = timing?.recording;
    if (verified) {
      const capability = registry.capability(reciter.id, surah);
      const catalogueFile = capability.mode === 'ayah' && capability.sources[0].url === verified.url && capability.sources[0].bytes === verified.bytes;
      if (catalogueFile) {
        const local = await files.uri(reciter.id, surah).catch(() => null);
        if (local) return { uri: local, local: true };
        return { uri: verified.url, local: false };
      }
      return { uri: verified.url, local: false, bytes: verified.bytes, verify: true };
    }
    const local = await files.uri(reciter.id, surah).catch(() => null);
    if (local) return { uri: local, local: true };
    const capability = registry.capability(reciter.id, surah);
    if (capability.mode === 'none') throw new Error(`${reciter.id} has no playable source for surah ${surah}`);
    const [preferred, ...others] = capability.sources;
    if (capability.mode === 'surah') {
      // Whole-surah streams are checked before they play (redirect, size, existence) and once loaded (length).
      const stream = (source: (typeof capability.sources)[number]) => ({ uri: source.url, bytes: source.bytes, durationMs: source.durationMs, verify: true });
      return { ...stream(preferred), local: false, ...(others.length ? { alternates: others.map(stream) } : {}) };
    }
    // The audited ayah sources: as before Phase 3 (no extra request before they play).
    return others.length === 0
      ? { uri: preferred.url, local: false }
      : { uri: preferred.url, local: false, alternates: others.map((source) => ({ uri: source.url, bytes: source.bytes })) };
  };
}
