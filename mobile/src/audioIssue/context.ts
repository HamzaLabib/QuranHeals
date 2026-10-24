import { audioMode } from '@/audio/availability';
import type { PlaybackState } from '@/audio/engine';
import { perAyahUrl } from '@/audio/perAyah';
import { getReciter } from '@/audio/reciters';
import { SOURCE_REGISTRY } from '@/audio/sourceRegistry';
import { verifiedCatalog } from '@/audio/verifiedCatalog';
import type { AudioIssueProblem } from '@/services/issueReportApi';

/** Where an Audio Issue is reported from: an ayah screen (that ayah attached) or Settings (whatever is playing, if anything). */
export type AudioIssueOrigin = 'ayah' | 'settings';

/** The phase of playback the report describes, for its review (a label each) and the report itself. */
export type AudioIssuePlayback = 'not-played' | PlaybackState['phase'];

/**
 * What an Audio Issue attaches, read once when the sheet opens: app identifiers only (surah, ayah, reciter id, the
 * recording's provider and URL, the playback phase), never personal, reading or account data.
 */
export type AudioIssueContext = {
  surah?: number;
  ayah?: number;
  reciterId?: string;
  /** "provider url", or "none (reason)" when this reciter has no recording that may play for the surah. */
  audioSource?: string;
  playback: AudioIssuePlayback;
  /** One line for the report: where it came from and the playback's state (mode, granularity, error, offline). */
  playbackContext: string;
};

export const AUDIO_ISSUE_PROBLEMS: readonly AudioIssueProblem[] = ['not_playing', 'wrong_reciter', 'missing_ayah', 'timing_highlight', 'stopped', 'other'];

/**
 * The recording that plays (or would play) for this reciter, surah and ayah, as audio/availability.ts and the engine
 * choose it: published verified timing's own recording first, a development preview's file, else the source registry's
 * preferred stream. Read only: nothing is fetched, played or changed.
 */
export function recordingIdentifier(reciterId: string, surah: number, ayah?: number): string {
  if (verifiedCatalog.rejected(reciterId, surah)) return 'none (published timing rejected on this device)';
  const published = verifiedCatalog.entry(reciterId, surah);
  if (published) return `${published.audio.provider} ${published.audio.url} (verified ${published.recordingId} v${published.versionNo})`;
  const reciter = getReciter(reciterId);
  if (reciter?.perAyah) {
    return audioMode(reciterId, surah) === 'ayah' ? `${reciter.perAyah.provider} ${perAyahUrl(reciter.perAyah, surah, ayah ?? 1)}` : 'none (no-recording)';
  }
  const preview = reciter?.timedPreview?.surahs[surah];
  if (preview && audioMode(reciterId, surah) === 'ayah') return `${preview.provider} ${preview.url} (preview)`;
  const capability = SOURCE_REGISTRY.capability(reciterId, surah);
  if (capability.mode === 'none') return `none (${capability.reason})`;
  const [source] = capability.sources;
  return `${source.provider} ${source.url}`;
}

/**
 * The context of a new Audio Issue. From an ayah screen: that ayah, in the reciter its Listen plays (the Favorite
 * Reciter), and the playback state when that ayah is the one playing. From Settings: what is playing or paused (its
 * surah, ayah when known, and reciter), else just the Favorite Reciter.
 */
export function audioIssueContext(args: {
  origin: AudioIssueOrigin;
  favoriteReciterId: string;
  playback: PlaybackState;
  ayah?: { surah: number; ayah: number };
}): AudioIssueContext {
  const { origin, favoriteReciterId, playback } = args;
  const active = playback.phase !== 'idle' && playback.position !== null ? playback.position : null;
  const ofThisAyah = active !== null && (args.ayah === undefined || (active.surah === args.ayah.surah && active.ayah === args.ayah.ayah));
  const surah = args.ayah?.surah ?? active?.surah;
  // Whole-surah playback (granularity 'surah') does not know the ayah: position.ayah is 0.
  const ayah = args.ayah?.ayah ?? (active && active.ayah > 0 ? active.ayah : undefined);
  const reciterId = (ofThisAyah ? playback.reciterId : null) ?? favoriteReciterId;
  const phase: AudioIssuePlayback = ofThisAyah ? playback.phase : 'not-played';
  const parts = [
    origin === 'ayah' ? 'ayah screen' : 'settings',
    phase === 'not-played' ? (origin === 'ayah' ? 'not playing this ayah' : 'nothing playing') : `phase ${phase}`,
  ];
  if (ofThisAyah) {
    parts.push(`mode ${playback.mode}`, `granularity ${playback.granularity}`, playback.offline ? 'local file' : 'streaming');
    if (playback.buffering) parts.push('buffering');
    if (playback.error) parts.push(`error ${playback.error.kind}`);
    if (playback.repeat !== 0) parts.push(`repeat ${playback.repeat}`);
  }
  return {
    surah,
    ayah,
    reciterId,
    audioSource: surah !== undefined ? recordingIdentifier(reciterId, surah, ayah) : undefined,
    playback: phase,
    playbackContext: parts.join('; '),
  };
}
