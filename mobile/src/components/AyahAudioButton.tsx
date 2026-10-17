import { Pause, Play, RotateCcw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { audioEngine } from '@/audio/index';
import { getReciter, hasAyahPlayback, reciterName } from '@/audio/reciters';
import { useFavoriteReciter } from '@/audio/useFavoriteReciter';
import { usePlayback } from '@/audio/usePlayback';
import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';

export type AyahAudioProblem = string | null;

type Props = {
  surah: number;
  ayah: number;
  copy: Messages['audio'];
  rtl: boolean;
  color: string;
  accent: string;
  /** Tells the card what to show under its controls (unavailable recording, network), or null. */
  onProblem: (problem: AyahAudioProblem) => void;
};

/**
 * The ayah screens' play button, beside Copy (How I Feel and A Message from the Quran): plays the displayed ayah once
 * in the Favorite Reciter (Settings), then stops — never on to another ayah or emotion. Pause and play again; a spinner
 * while it loads. A Favorite Reciter with no verified recording of this surah plays nothing and says so (never another
 * voice).
 *
 * It owns exactly the playback session it started (audio/engine.ts `start` → session, `release`): when the ayah shown
 * changes (Another ayah, a new emotion) or the card closes, that session is stopped — playing, paused, or still loading
 * (a load in flight then never plays) — and the new ayah waits for its own Play. Anything else playing (the Mushaf's
 * recitation) is a different session and is never stopped from here, nor shown as this ayah's.
 */
export function AyahAudioButton({ surah, ayah, copy, rtl, color, accent, onProblem }: Props) {
  const state = usePlayback();
  const { reciterId } = useFavoriteReciter();
  const key = `${surah}:${ayah}`;
  /** The session this button started for the ayah shown (reset when the ayah changes). */
  const [owned, setOwned] = useState<{ key: string; session: number } | null>(null);
  if (owned && owned.key !== key) setOwned(null);
  const session = owned?.key === key ? owned.session : null;
  const isThis = session !== null && state.session === session && state.phase !== 'idle';
  const reciter = getReciter(reciterId);
  const unavailable = !reciter || !hasAyahPlayback(reciter, surah);

  // A different ayah, or the card closing: its own session stops (and only that one).
  useEffect(() => {
    if (session === null) return undefined;
    return () => audioEngine.release(session);
  }, [session]);

  const problem: AyahAudioProblem = (() => {
    if (isThis && state.error) {
      if (state.error.kind === 'unavailable') return fill(copy.ayahUnavailable, { reciter: reciter ? reciterName(reciter, rtl) : '' });
      return state.error.kind === 'network' ? copy.errorNetwork : state.error.kind === 'mismatch' ? copy.errorMismatch : copy.errorPlayback;
    }
    return null;
  })();
  useEffect(() => {
    onProblem(problem);
  }, [problem, onProblem]);

  const playing = isThis && (state.phase === 'playing' || state.phase === 'loading');
  const onPress = () => {
    if (isThis) {
      if (playing) audioEngine.pause();
      else audioEngine.resume();
      return;
    }
    if (unavailable) {
      onProblem(fill(copy.ayahUnavailable, { reciter: reciter ? reciterName(reciter, rtl) : '' }));
      return;
    }
    onProblem(null);
    const started = audioEngine.start({ surah, ayah }, { mode: 'single', reciterId });
    if (started !== null) setOwned({ key, session: started });
  };
  const label = playing ? copy.pauseAyah : isThis && state.phase === 'ended' ? copy.replayAyah : copy.playAyah;

  return (
    <Pressable
      testID="ayah-audio"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: isThis && state.phase === 'loading' }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {isThis && state.phase === 'loading'
        ? <ActivityIndicator size="small" color={accent} />
        : playing
          ? <Pause size={18} color={accent} fill={accent} />
          : isThis && state.phase === 'ended'
            ? <RotateCcw size={18} color={color} />
            : <Play size={18} color={color} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    opacity: 0.78,
  },
});
