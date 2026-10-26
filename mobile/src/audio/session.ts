import type { PlaybackState } from './engine';
import type { AyahPosition } from './quranSequence';

/** Playing, or loading to play: the Mushaf's chip and the compact controls offer Pause. */
export const isAudioActive = (state: PlaybackState) => state.phase === 'playing' || state.phase === 'loading';

/**
 * A listening session the reader can still act on: playing, loading or paused. The audio controls (the Mushaf's chip,
 * the compact controls elsewhere) show for exactly these; stopped (idle), finished (ended) or stopped by an error, they
 * are gone, as before.
 */
export const hasAudioSession = (state: PlaybackState) => isAudioActive(state) || state.phase === 'paused';

/**
 * The ayah of the Mushaf's own recitation (continuous or Full Surah) that the Mushaf can show: null when nothing is
 * recited, for an ayah screen's single ayah, for a whole-surah recording (no verified ayah timing: its ayah is unknown)
 * and while a Listen waits for the whole-surah choice (that recording cannot recite the ayah asked for).
 */
export function recitedMushafAyah(state: PlaybackState): AyahPosition | null {
  if (state.phase === 'idle' || state.mode === 'single' || state.granularity !== 'ayah' || state.error?.kind === 'surah-only') return null;
  return state.position;
}
