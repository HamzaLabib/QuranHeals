import { useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { formatClock } from '@/audio/format';
import { audioEngine } from '@/audio/index';
import { useSurahProgress } from '@/audio/usePlayback';
import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';

/** The screen reader's step (and the "Back / Forward 15 seconds" actions). */
export const SEEK_STEP_MS = 15_000;

type Props = {
  rtl: boolean;
  copy: Messages['audio'];
  tone: { track: string; fill: string; text: string; muted: string };
};

/**
 * Whole-surah playback's position bar: where the recitation is in the surah's file and how long the file is (never an
 * ayah). Touch or drag along it to move; the screen reader adjusts it in 15 s steps. It runs in the Mushaf's direction
 * in Arabic (from the right), like the ayah progress bar it replaces. It subscribes to the position itself, so the
 * window around it does not re-render while the recitation plays.
 */
export function SurahSeekBar({ rtl, copy, tone }: Props) {
  const progress = useSurahProgress();
  const [width, setWidth] = useState(0);
  // While a finger is on the bar: where it points (the recitation moves there when it lifts).
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const duration = progress.durationMs;
  const shown = scrubMs ?? progress.positionMs;
  const fraction = duration ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const msAt = (event: GestureResponderEvent) => {
    if (!duration || width <= 0) return null;
    const x = Math.min(width, Math.max(0, event.nativeEvent.locationX));
    return Math.round(((rtl ? width - x : x) / width) * duration);
  };
  const elapsed = formatClock(shown, rtl);
  const total = duration ? formatClock(duration, rtl) : '–';
  const label = fill(copy.surahPosition, { elapsed, total });
  const step = (delta: number) => audioEngine.seekTo(progress.positionMs + delta);

  return (
    <View style={styles.box}>
      <View
        testID="audio-seek"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: label }}
        accessibilityActions={[{ name: 'increment', label: copy.seekForward }, { name: 'decrement', label: copy.seekBack }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') step(SEEK_STEP_MS);
          else if (event.nativeEvent.actionName === 'decrement') step(-SEEK_STEP_MS);
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => duration !== null}
        onMoveShouldSetResponder={() => duration !== null}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => setScrubMs(msAt(event))}
        onResponderMove={(event) => setScrubMs(msAt(event))}
        onResponderRelease={(event) => {
          const target = msAt(event) ?? scrubMs;
          setScrubMs(null);
          if (target !== null) audioEngine.seekTo(target);
        }}
        onResponderTerminate={() => setScrubMs(null)}
        hitSlop={{ top: 12, bottom: 12 }}
        style={styles.touch}>
        <View style={[styles.track, { backgroundColor: tone.track }, rtl && styles.trackRtl]}>
          <View style={[styles.fill, { backgroundColor: tone.fill, width: `${Math.round(fraction * 1000) / 10}%` }]} />
        </View>
      </View>
      <View style={[styles.times, rtl && styles.timesRtl]}>
        <Text testID="audio-elapsed" style={[styles.time, { color: tone.text }]}>{elapsed}</Text>
        <Text testID="audio-duration" style={[styles.time, { color: tone.muted }]}>{total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 2,
  },
  touch: {
    justifyContent: 'center',
    minHeight: 20,
  },
  track: {
    borderRadius: 2,
    flexDirection: 'row',
    height: 4,
    overflow: 'hidden',
  },
  trackRtl: {
    flexDirection: 'row-reverse',
  },
  fill: {
    borderRadius: 2,
    height: 4,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timesRtl: {
    flexDirection: 'row-reverse',
  },
  time: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
