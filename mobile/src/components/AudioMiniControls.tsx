import { router } from 'expo-router';
import { LocateFixed, Pause, Play, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PlaybackState } from '@/audio/engine';
import { audioEngine } from '@/audio/index';
import { pageOfPosition } from '@/audio/quranSequence';
import { hasAudioSession, isAudioActive, recitedMushafAyah } from '@/audio/session';
import { usePlayback } from '@/audio/usePlayback';
import { radii, spacing, type Palette } from '@/constants/theme';
import { isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

/**
 * Whether the compact controls show: during the Mushaf's own listening session (playing, loading or paused), on every
 * screen but the Mushaf (which has its own chip). An ayah screen's single ayah is that screen's own (its own button,
 * released when it closes): no compact controls for it. Finished, stopped or stopped by an error: none, as the chip.
 */
export const showsAudioMiniControls = (state: PlaybackState) => hasAudioSession(state) && state.mode !== 'single';

/**
 * Follow recitation from outside the Mushaf: the Mushaf opened at the page of the ayah being recited when pressed (read
 * from the engine then, not from the last render), as Home's Continue Reciting opens a page. The reader follows and
 * highlights that ayah (app/(tabs)/mushaf.tsx); playing or paused stays as it is. Nothing when the ayah is unknown.
 */
export function openRecitedAyahInMushaf(): boolean {
  const recited = recitedMushafAyah(audioEngine.getState());
  if (!recited) return false;
  router.navigate({ pathname: '/mushaf', params: { page: String(pageOfPosition(recited)), at: String(Date.now()) } });
  return true;
}

type Props = {
  state: PlaybackState;
  /** 'tabBar': inside the tab bar, above the tabs (AppTabBar); 'screen': at the bottom of a screen with no tab bar. */
  placement: 'tabBar' | 'screen';
};

/**
 * The compact audio controls outside the Mushaf: exactly Play / Pause, Follow recitation (the Mushaf's GPS icon, only
 * where the ayah being recited can be shown) and Stop (X). One centred row, mirrored in Arabic. Play / Pause only
 * pauses or resumes the session; X stops it and closes the player (the controls go with it). The one engine
 * (audio/engine.ts) drives everything: no player of its own.
 */
export function AudioMiniControls({ state, placement }: Props) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { messages, locale } = useAppLocale();
  const copy = messages.audio;
  const active = isAudioActive(state);
  const locatable = recitedMushafAyah(state) !== null;
  const rtl = isRtlLocale(locale);
  const button = (testID: string, label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {icon}
    </Pressable>
  );
  return (
    <View
      testID={`audio-mini-${placement}`}
      style={[placement === 'screen' && styles.screenBar, placement === 'screen' && { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      <View testID="audio-mini" accessibilityRole="toolbar" style={[styles.pill, rtl && styles.rtl]}>
        {button(
          'audio-mini-toggle',
          active ? copy.pause : copy.play,
          state.phase === 'loading'
            ? <ActivityIndicator size="small" color={colors.icon} />
            : active ? <Pause size={18} color={colors.icon} fill={colors.icon} /> : <Play size={18} color={colors.icon} fill={colors.icon} />,
          () => audioEngine.toggle(),
        )}
        {locatable && button('audio-mini-follow', copy.followRecitation, <LocateFixed size={19} color={colors.accent} />, () => void openRecitedAyahInMushaf())}
        {button('audio-mini-stop', copy.stop, <X size={19} color={colors.icon} />, () => audioEngine.stop())}
      </View>
    </View>
  );
}

/**
 * A screen of the root stack (Settings, Favorites, the ayah screens, …) with the compact controls at its bottom while
 * they show (app/_layout.tsx's screenLayout). The screen keeps its own layout above them: inside it the bottom safe-area
 * inset is 0 then, since the controls take the device's bottom edge themselves, so nothing is covered or doubled.
 */
export function ScreenWithAudioControls({ children }: { children: ReactNode }) {
  const state = usePlayback();
  const insets = useSafeAreaInsets();
  const shown = showsAudioMiniControls(state);
  return (
    <View style={styles.screen}>
      <SafeAreaInsetsContext.Provider value={shown ? { ...insets, bottom: 0 } : insets}>
        <View style={styles.screen}>{children}</View>
      </SafeAreaInsetsContext.Provider>
      {shown && <AudioMiniControls state={state} placement="screen" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});

const makeStyles = (colors: Palette) => StyleSheet.create({
  screenBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  pill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radii.full,
    flexDirection: 'row',
    gap: spacing.xs,
    marginVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  rtl: {
    flexDirection: 'row-reverse',
  },
  button: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    opacity: 0.7,
  },
});
