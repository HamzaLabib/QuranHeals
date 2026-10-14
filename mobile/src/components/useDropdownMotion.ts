import { useEffect, useState } from 'react';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { chevronDirection, type DropdownPhase, type DropdownPlacement } from '@/utils/dropdownPlacement';

/** The menu's opening and closing, and the chevron's turn, together. Reanimated's default follows the system's Reduce Motion (then instant). */
const MOTION = { duration: 180, easing: Easing.out(Easing.cubic) };
/** How far the menu travels from (and back to) its selector. */
const TRAVEL = 8;

/**
 * A dropdown's motion: it opens (fading in, coming away from its selector on
 * the side it is placed) and closes (going back toward it) while the
 * selector's chevron turns to show that movement (utils/dropdownPlacement.ts).
 * `mounted` stays true until the menu has finished closing, so the closing
 * can be seen; reopening mid-close turns everything straight back.
 *
 * `chevron: 'state'` makes the chevron show whether the menu is open instead
 * (Home): down while closed, up from the moment it opens until it is closed,
 * wherever the menu is placed. It turns toward the latest state, so rapid or
 * interrupted toggles always end on it.
 */
export function useDropdownMotion(open: boolean, placement: DropdownPlacement, options: { chevron?: 'motion' | 'state' } = {}) {
  const [phase, setPhase] = useState<DropdownPhase>(open ? 'open' : 'closed');
  // Applied while rendering (React's "adjust state when a prop changes").
  if (open && phase !== 'open') setPhase('open');
  if (!open && phase === 'open') setPhase('closing');
  const direction = options.chevron === 'state' ? (open ? 'up' : 'down') : chevronDirection(phase, placement);

  const angle = useSharedValue(direction === 'up' ? 180 : 0);
  const shown = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    angle.set(withTiming(direction === 'up' ? 180 : 0, MOTION));
  }, [angle, direction]);
  useEffect(() => {
    const closed = () => setPhase((now) => (now === 'closing' ? 'closed' : now));
    if (phase === 'open') shown.set(withTiming(1, MOTION));
    else if (phase === 'closing') {
      shown.set(withTiming(0, MOTION, (finished) => {
        if (finished) scheduleOnRN(closed);
      }));
    }
  }, [shown, phase]);

  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * (placement === 'below' ? -TRAVEL : TRAVEL) }],
  }), [placement]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return { phase, mounted: phase !== 'closed', direction, chevronStyle, menuStyle, backdropStyle };
}
