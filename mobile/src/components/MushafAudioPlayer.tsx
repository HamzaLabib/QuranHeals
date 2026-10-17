import { ChevronDown, ChevronsLeft, ChevronsRight, ChevronUp, LocateFixed, Pause, Play, SkipBack, SkipForward } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ayahLabel, localDigits, surahLabel } from '@/audio/format';
import { audioEngine } from '@/audio/index';
import { nextAyah, pageOfPosition, previousAyah } from '@/audio/quranSequence';
import { getReciter, hasAyahPlayback, reciterName } from '@/audio/reciters';
import { usePlayback } from '@/audio/usePlayback';
import type { PlaybackState } from '@/audio/engine';
import { ReciterList } from '@/components/ReciterList';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

type Props = {
  dark: boolean;
  rtl: boolean;
  copy: Messages['audio'];
  /** Whether the page shown follows the recitation; false after the reader swiped away. */
  following: boolean;
  /** Back to the recited ayah's page (and following again): Follow recitation, and after the window's Previous / Next (ayah or page). */
  onFollow: () => void;
  /** The window opens just under this (the top bar's bottom edge, in window coordinates). */
  panelTop: number;
};

/** Playing, or loading to play: the toolbar shows its active icon and Play / Pause offers Pause. */
export const isAudioActive = (state: PlaybackState) => state.phase === 'playing' || state.phase === 'loading';

/** The message for an error or a notice, or null. */
function problemText(state: PlaybackState, copy: Messages['audio'], rtl: boolean): string | null {
  if (state.notice) {
    const reciter = getReciter(state.notice.reciterId);
    return fill(copy.noticeReciterUnavailable, { reciter: reciter ? reciterName(reciter, rtl) : '', surah: surahLabel(state.notice.surah, rtl) });
  }
  if (!state.error) return null;
  const reciter = getReciter(state.error.reciterId);
  switch (state.error.kind) {
    case 'unavailable':
      return fill(copy.errorUnavailable, { reciter: reciter ? reciterName(reciter, rtl) : '', surah: surahLabel(state.error.surah, rtl) });
    case 'network':
      return copy.errorNetwork;
    case 'mismatch':
      return copy.errorMismatch;
    default:
      return copy.errorPlayback;
  }
}

/**
 * The Mushaf's audio player, neither part of which changes the page's size or position:
 *  - while playing, a compact chip in the reader's top bar (in place of the headphones, app/(tabs)/mushaf.tsx): its own
 *    Play / Pause button, then the Sheikh's name and the ayah number (a separate touch target that opens the window),
 *    with ⌄ while the window is closed and ⌃ while it is open, and Follow recitation after the reader swiped away. Paused,
 *    stopped, finished or stopped by an error, the chip is gone and the headphones are back;
 *  - the window, top to bottom: the Sheikh's name with its ⌄ / ⌃ (the reciter list: all 16, each with its coverage, the
 *    current one highlighted, an "Up next" one marked), the Surah and ayah being recited, the recitation's progress
 *    through its surah, then, from the right in every language (the Mushaf's direction), Previous page — Previous ayah —
 *    Play / Pause — Next ayah — Next page. The
 *    page buttons move the recitation itself (the adjacent page's first ayah, from the page being recited), unlike a
 *    swipe, which only shows another page. No close button: a tap outside or Back hides it,
 *    and hiding it never stops the recitation. It stays open when playback is paused from inside it.
 * Directional icons are chosen per direction (ChevronUp / ChevronDown, SkipBack / SkipForward), never mirrored or
 * rotated with a style transform: react-native-svg applies a style transform to the drawing itself around its corner,
 * which moves a flipped or rotated glyph out of its own box (blank on the device).
 * Choosing a reciter here never interrupts the ayah being recited (audio/engine.ts) and never changes the Favorite
 * Reciter setting.
 */
export function MushafAudioPlayer({ dark, rtl, copy, following, onFollow, panelTop }: Props) {
  const state = usePlayback();
  const [expanded, setExpanded] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // A stopped recitation closes the window too, so the next one never opens with it.
  if (state.phase === 'idle' && (expanded || listOpen)) {
    setExpanded(false);
    setListOpen(false);
  }
  if (state.phase === 'idle' || !state.position) return null;

  const position = state.position;
  const reciter = getReciter(state.reciterId);
  const pending = getReciter(state.pendingReciterId);
  const name = reciter ? reciterName(reciter, rtl) : '';
  const ayahText = fill(copy.ayahOnly, { ayah: localDigits(position.ayah, rtl) });
  /** The window's second row: the Surah and the ayah ("Al-Faatiha · Ayah 7", «سورة الفاتحة · الآية ٧»). */
  const surahAyahText = ayahLabel(position, copy, rtl);
  const total = SURAH_AYAH_COUNTS[position.surah - 1];
  const problem = problemText(state, copy, rtl);
  const active = isAudioActive(state);
  const followable = state.mode === 'continuous';
  const hasPrevious = previousAyah(position) !== null;
  const hasNext = nextAyah(position) !== null;
  const recitedPage = pageOfPosition(position);
  const hasPreviousPage = recitedPage > 1;
  const hasNextPage = recitedPage < MUSHAF_PAGE_COUNT;
  // The surah a newly chosen reciter must have: the next ayah's while one is being recited, else this one's.
  const neededSurah = state.phase === 'error' || state.phase === 'ended' || state.mode === 'single' ? position.surah : nextAyah(position)?.surah ?? position.surah;
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const close = () => {
    setExpanded(false);
    setListOpen(false);
  };
  /** Previous / Next ayah: plays that ayah at once, and the page follows it. */
  const skip = (direction: 1 | -1) => {
    audioEngine.skip(direction);
    if (followable) onFollow();
  };
  /** Previous / Next page: plays the adjacent page (of the one being recited) from its first ayah; the page follows. */
  const skipPage = (direction: 1 | -1) => {
    audioEngine.skipPage(direction);
    if (followable) onFollow();
  };

  return (
    <>
      {active && (
      <View testID="audio-chip" style={[styles.chip, theme.pill, rtl && styles.rowRtl]}>
        <Pressable
          testID="audio-toggle"
          accessibilityRole="button"
          accessibilityLabel={copy.pause}
          accessibilityHint={copy.stopHint}
          accessibilityActions={[{ name: 'stop', label: copy.stop }]}
          onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'stop') audioEngine.stop(); }}
          onPress={() => audioEngine.pause()}
          onLongPress={() => audioEngine.stop()}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={({ pressed }) => [styles.chipButton, pressed && styles.pressed]}>
          {state.phase === 'loading' ? <ActivityIndicator size="small" color={theme.icon} /> : <Pause size={16} color={theme.icon} fill={theme.icon} />}
        </Pressable>
        <Pressable
          testID="audio-expand"
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? copy.collapse : copy.expand}: ${[name, ayahText].filter(Boolean).join(', ')}`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(true)}
          style={({ pressed }) => [styles.chipText, rtl && styles.rowRtl, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={[styles.chipLabel, { color: theme.text }, align]}>
            {name}
            <Text style={{ color: theme.muted }}>{` · ${localDigits(position.ayah, rtl)}`}</Text>
          </Text>
          {expanded ? <ChevronUp testID="audio-chip-chevron-up" size={14} color={theme.muted} /> : <ChevronDown testID="audio-chip-chevron-down" size={14} color={theme.muted} />}
        </Pressable>
        {followable && !following && (
          <Pressable testID="audio-follow" accessibilityRole="button" accessibilityLabel={copy.followRecitation} onPress={onFollow} hitSlop={6} style={({ pressed }) => [styles.chipButton, pressed && styles.pressed]}>
            <LocateFixed size={17} color={theme.accent} />
          </Pressable>
        )}
      </View>
      )}

      <Modal visible={expanded} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
        <Pressable testID="audio-panel-backdrop" accessibilityLabel={copy.collapse} style={StyleSheet.absoluteFill} onPress={close} />
        <View
          testID="audio-panel"
          accessibilityViewIsModal
          style={[styles.panel, theme.sheet, { shadowColor: theme.surface.shadowColor, top: panelTop + 4, maxHeight: window.height - panelTop - insets.bottom - 16 }]}>
          {/* 1. The Sheikh, with its dropdown. */}
          <Pressable
            testID="audio-reciter-dropdown"
            accessibilityRole="button"
            accessibilityLabel={`${copy.reciter}: ${name}`}
            accessibilityHint={copy.chooseReciter}
            accessibilityState={{ expanded: listOpen }}
            onPress={() => setListOpen((open) => !open)}
            style={({ pressed }) => [styles.dropdown, rtl && styles.rowRtl, pressed && styles.pressed]}>
            <Text testID="audio-reciter-name" numberOfLines={1} style={[styles.dropdownName, { color: theme.text }, align]}>{name}</Text>
            <View style={styles.chevronBox}>
              {listOpen ? <ChevronUp testID="audio-reciter-chevron-up" size={18} color={theme.icon} /> : <ChevronDown testID="audio-reciter-chevron-down" size={18} color={theme.icon} />}
            </View>
          </Pressable>
          {pending && <Text testID="audio-up-next" style={[styles.upNext, { color: theme.accent }, align]} numberOfLines={1}>{fill(copy.upNext, { reciter: reciterName(pending, rtl) })}</Text>}

          {listOpen && (
            <ScrollView testID="audio-reciter-list" style={styles.list} contentContainerStyle={styles.listContent}>
              <ReciterList
                testIDPrefix="audio-reciter"
                selectedId={state.pendingReciterId ?? state.reciterId}
                onSelect={(id) => {
                  audioEngine.selectReciter(id);
                  setListOpen(false);
                }}
                copy={copy}
                rtl={rtl}
                tone={{ text: theme.text, muted: theme.muted, accent: theme.accent, selected: theme.selected.backgroundColor, divider: theme.divider }}
                badge={(id) => (id === state.reciterId ? copy.nowReciting : id === state.pendingReciterId ? copy.upNextBadge : null)}
                note={(id) => {
                  const candidate = getReciter(id);
                  return candidate && candidate.timingRead !== null && !hasAyahPlayback(candidate, neededSurah) ? copy.notForThisSurah : null;
                }}
              />
            </ScrollView>
          )}

          {/* 2. The ayah being recited (and how it is playing). */}
          <View style={styles.info}>
            <Text testID="audio-ayah" numberOfLines={1} style={[styles.ayah, { color: theme.text }, align]}>{surahAyahText}</Text>
            {state.offline && <Text style={[styles.subtle, { color: theme.muted }, align]}>{copy.playingOffline}</Text>}
            {state.buffering && <Text style={[styles.subtle, { color: theme.muted }, align]}>{copy.buffering}</Text>}
            {state.phase === 'ended' && state.mode === 'continuous' && <Text style={[styles.subtle, { color: theme.muted }, align]}>{copy.ended}</Text>}
          </View>

          {/* 3. Progress: this ayah's place in its surah. */}
          <View
            testID="audio-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={fill(copy.surahProgress, { ayah: localDigits(position.ayah, rtl), total: localDigits(total, rtl) })}
            accessibilityValue={{ min: 0, max: total, now: position.ayah }}
            style={[styles.track, { backgroundColor: theme.divider }, rtl && styles.trackRtl]}>
            <View style={[styles.fill, { backgroundColor: theme.accent, width: `${Math.round((position.ayah / total) * 100)}%` }]} />
          </View>

          {/*
            4. The Mushaf's own direction, the same in every app language (never mirrored by language): from the right,
            Previous page — Previous ayah — Play / Pause — Next ayah — Next page. "Previous" glyphs point right, "next"
            glyphs left, each chosen directly (no flipping transform). Page jumps: double chevrons; ayah jumps: skip icons.
          */}
          <View testID="audio-controls" style={[styles.controls, styles.rowRtl]}>
            <Pressable
              testID="audio-previous-page"
              accessibilityRole="button"
              accessibilityLabel={copy.previousPage}
              accessibilityState={{ disabled: !hasPreviousPage }}
              disabled={!hasPreviousPage}
              onPress={() => skipPage(-1)}
              hitSlop={4}
              style={({ pressed }) => [styles.pageControl, !hasPreviousPage && styles.disabled, pressed && styles.pressed]}>
              <ChevronsRight testID="audio-previous-page-icon" size={22} color={theme.icon} />
            </Pressable>
            <Pressable
              testID="audio-previous"
              accessibilityRole="button"
              accessibilityLabel={copy.previousAyah}
              accessibilityState={{ disabled: !hasPrevious }}
              disabled={!hasPrevious}
              onPress={() => skip(-1)}
              hitSlop={6}
              style={({ pressed }) => [styles.control, !hasPrevious && styles.disabled, pressed && styles.pressed]}>
              <SkipForward testID="audio-previous-icon" size={22} color={theme.icon} />
            </Pressable>
            <Pressable
              testID="audio-toggle-large"
              accessibilityRole="button"
              accessibilityLabel={active ? copy.pause : copy.play}
              onPress={() => audioEngine.toggle()}
              style={({ pressed }) => [styles.mainControl, theme.go, pressed && styles.pressed]}>
              {state.phase === 'loading'
                ? <ActivityIndicator size="small" color={theme.onGo} />
                : active ? <Pause size={22} color={theme.onGo} fill={theme.onGo} /> : <Play size={22} color={theme.onGo} fill={theme.onGo} />}
            </Pressable>
            <Pressable
              testID="audio-next"
              accessibilityRole="button"
              accessibilityLabel={copy.nextAyah}
              accessibilityState={{ disabled: !hasNext }}
              disabled={!hasNext}
              onPress={() => skip(1)}
              hitSlop={6}
              style={({ pressed }) => [styles.control, !hasNext && styles.disabled, pressed && styles.pressed]}>
              <SkipBack testID="audio-next-icon" size={22} color={theme.icon} />
            </Pressable>
            <Pressable
              testID="audio-next-page"
              accessibilityRole="button"
              accessibilityLabel={copy.nextPage}
              accessibilityState={{ disabled: !hasNextPage }}
              disabled={!hasNextPage}
              onPress={() => skipPage(1)}
              hitSlop={4}
              style={({ pressed }) => [styles.pageControl, !hasNextPage && styles.disabled, pressed && styles.pressed]}>
              <ChevronsLeft testID="audio-next-page-icon" size={22} color={theme.icon} />
            </Pressable>
          </View>

          {followable && !following && (
            <Pressable
              testID="audio-follow-panel"
              accessibilityRole="button"
              onPress={() => {
                close();
                onFollow();
              }}
              style={({ pressed }) => [styles.followRow, rtl && styles.rowRtl, pressed && styles.pressed]}>
              <LocateFixed size={16} color={theme.accent} />
              <Text style={[styles.followText, { color: theme.accent }]}>{copy.followRecitation}</Text>
            </Pressable>
          )}

          {problem && (
            <View testID="audio-problem" style={[styles.problem, rtl && styles.rowRtl]}>
              <Text accessibilityLiveRegion="polite" style={[styles.problemText, { color: theme.error }, align]}>{problem}</Text>
              {state.notice ? (
                <Pressable accessibilityRole="button" onPress={() => audioEngine.dismissNotice()} hitSlop={6}>
                  <Text style={[styles.problemAction, { color: theme.accent }]}>{copy.dismiss}</Text>
                </Pressable>
              ) : state.error && state.error.kind !== 'unavailable' ? (
                <Pressable testID="audio-retry" accessibilityRole="button" onPress={() => audioEngine.retry()} hitSlop={6}>
                  <Text style={[styles.problemAction, { color: theme.accent }]}>{copy.retry}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexShrink: 1,
    height: 30,
    maxWidth: 360,
    paddingHorizontal: 6,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  chipButton: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  chipText: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 4,
    height: 30,
    paddingHorizontal: 2,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  panel: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    gap: 6,
    left: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: 'absolute',
    right: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  dropdown: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
  },
  dropdownName: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '700',
  },
  chevronBox: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    width: 22,
  },
  upNext: {
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    flexGrow: 0,
    maxHeight: 300,
  },
  listContent: {
    paddingBottom: 4,
  },
  info: {
    gap: 2,
  },
  ayah: {
    fontSize: 14,
    fontWeight: '600',
  },
  subtle: {
    fontSize: 12,
  },
  track: {
    borderRadius: 2,
    flexDirection: 'row',
    height: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
  trackRtl: {
    flexDirection: 'row-reverse',
  },
  fill: {
    borderRadius: 2,
    height: 4,
  },
  /** Five controls in one row (about 272 pt with its gaps): fits the narrowest iPhone's window (304 pt less padding). */
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  pageControl: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 40,
  },
  control: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  mainControl: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  disabled: {
    opacity: 0.35,
  },
  followRow: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  followText: {
    fontSize: 14,
    fontWeight: '700',
  },
  problem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  problemText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  problemAction: {
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
