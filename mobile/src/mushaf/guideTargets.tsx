import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { View } from 'react-native';

/**
 * The real on-screen controls the first-time Mushaf guide points at (components/MushafGuide.tsx). The page being read
 * registers them as they mount (MushafPageView's running heads and page number, QpcV1PageText's first ayah and its
 * number), and the guide measures them where they are drawn (measureInWindow), so its arrows always follow the actual
 * controls — on any phone, in Normal Mode or full screen, at any text size — never fixed coordinates. Outside the
 * reader (a component rendered alone) registering does nothing.
 *
 * 'memorize' and 'memorizeAll' (Memorization Mode's Eye and its Show All / Hide All) are pointed at only by the
 * Memorization Mode Guide (memorization/memorizationGuide.ts), and only while they are drawn.
 */
export type GuideTarget = 'surah' | 'hizb' | 'page' | 'juz' | 'ayah' | 'marker' | 'memorize' | 'memorizeAll';

type Register = (target: GuideTarget, view: View | null) => void;

const GuideTargetsContext = createContext<Register>(() => undefined);

export function GuideTargetsProvider({ register, children }: { register: Register; children: ReactNode }) {
  return <GuideTargetsContext.Provider value={register}>{children}</GuideTargetsContext.Provider>;
}

/** A callback for a view's `ref` that registers it as `target` while it is mounted (and unregisters it after). */
export function useGuideTarget(target: GuideTarget): (view: View | null) => void {
  const register = useContext(GuideTargetsContext);
  return useCallback((view: View | null) => register(target, view), [register, target]);
}
