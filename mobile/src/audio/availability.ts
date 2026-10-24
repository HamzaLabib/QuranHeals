import { useSyncExternalStore } from 'react';

import { FALLBACK_RECITER_ID, getReciter, hasAyahPlayback, type Reciter } from './reciters';
import { SOURCE_REGISTRY, type CapabilityMode } from './sourceRegistry';
import { isPreviewSurah } from './timedPreview';
import { verifiedCatalog } from './verifiedCatalog';

/**
 * Phase 4.8.3: how a reciter's surah can play, with the published human-verified timing first (verifiedCatalog.ts),
 * then the built-in source registry. A published surah plays ayah by ayah (its own recording, with verified timing); a
 * surah whose published entry failed validation on this device plays not at all (never the catalogue instead).
 */
export function audioMode(reciterId: string, surah: number): CapabilityMode {
  if (verifiedCatalog.rejected(reciterId, surah)) return 'none';
  if (verifiedCatalog.entry(reciterId, surah)) return 'ayah';
  // A per-ayah recording (development preview, perAyah.ts): ayah by ayah wherever its surah's file set is complete.
  const reciter = getReciter(reciterId);
  // A timed preview surah (timedPreview.ts): ayah by ayah where its aligned timing is valid, never whole. A reciter
  // with no recording of its own plays nothing else (the registry has no source for it).
  if (reciter?.perAyah || (reciter && isPreviewSurah(reciter, surah))) return hasAyahPlayback(reciter, surah) ? 'ayah' : 'none';
  return SOURCE_REGISTRY.mode(reciterId, surah);
}

/** Whether a surah plays ayah by ayah with this reciter (published timing, else the catalogue's verified timing). */
export function hasAyahAudio(reciter: Reciter, surah: number): boolean {
  if (verifiedCatalog.rejected(reciter.id, surah)) return false;
  if (verifiedCatalog.entry(reciter.id, surah)) return true;
  return hasAyahPlayback(reciter, surah);
}

/**
 * Whether a surah plays ayah by ayah when `reciter` is asked for: in its own voice, or in the fallback reciter's
 * (Al-Minshawi: reciters.ts FALLBACK_RECITER_ID) where it has none — the engine's own rule (engine.ts `voiceFor`).
 */
export function hasAyahAudioOrFallback(reciter: Reciter, surah: number): boolean {
  if (hasAyahAudio(reciter, surah)) return true;
  const fallback = getReciter(FALLBACK_RECITER_ID);
  return fallback !== null && fallback.id !== reciter.id && audioMode(fallback.id, surah) === 'ayah';
}

/** Surahs a reciter can play, by capability, published timing included. */
export function audioCoverage(reciterId: string): { ayah: number[]; surah: number[] } {
  const r = getReciter(reciterId);
  const base = r?.perAyah ? { ayah: r.surahs, surah: [] } : SOURCE_REGISTRY.coverage(reciterId);
  const ayah = new Set(base.ayah);
  const whole = new Set(base.surah);
  // Timed preview surahs (their own files): added to what the catalogue's recording plays, if it has one.
  for (const s of Object.keys(r?.timedPreview?.surahs ?? {}).map(Number)) if (r && hasAyahPlayback(r, s)) { ayah.add(s); whole.delete(s); }
  for (let s = 1; s <= 114; s++) {
    if (verifiedCatalog.rejected(reciterId, s)) { ayah.delete(s); whole.delete(s); }
    else if (verifiedCatalog.entry(reciterId, s)) { ayah.add(s); whole.delete(s); }
  }
  return { ayah: [...ayah].sort((a, b) => a - b), surah: [...whole].sort((a, b) => a - b) };
}

/** Re-renders when the published timing changes (a new manifest took effect). */
export function useAudioAvailability(): number {
  return useSyncExternalStore(verifiedCatalog.subscribe, verifiedCatalog.getVersion, verifiedCatalog.getVersion);
}
