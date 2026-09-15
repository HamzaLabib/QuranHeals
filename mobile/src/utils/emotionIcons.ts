import {
  Activity,
  AlertCircle,
  Anchor,
  BatteryLow,
  BatteryWarning,
  Circle,
  CloudRain,
  Compass,
  Droplet,
  Flame,
  Gauge,
  HandHeart,
  Heart,
  HeartCrack,
  HelpCircle,
  Hourglass,
  Leaf,
  type LucideIcon,
  Map,
  Moon,
  RotateCcw,
  Scale,
  ShieldAlert,
  Smile,
  Sparkles,
  Sun,
  Sunrise,
  Unlink,
  UserMinus,
  UserX,
  Waves,
} from 'lucide-react-native';

import { EMOTION_ICON_NAMES } from './emotionIconNames';

/** Every `lucide-react-native` component EMOTION_ICON_NAMES can point at, keyed by its own export name. */
const LUCIDE_COMPONENTS_BY_NAME: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  Anchor,
  BatteryLow,
  BatteryWarning,
  CloudRain,
  Compass,
  Droplet,
  Flame,
  Gauge,
  HandHeart,
  Heart,
  HeartCrack,
  HelpCircle,
  Hourglass,
  Leaf,
  Map,
  Moon,
  RotateCcw,
  Scale,
  ShieldAlert,
  Smile,
  Sparkles,
  Sun,
  Sunrise,
  Unlink,
  UserMinus,
  UserX,
  Waves,
};

/**
 * Maps every canonical emotion `icon` identifier (see
 * backend/src/seed/emotions.ts, the 29-key taxonomy) to its Lucide icon
 * component, using the same icon library EmotionCard already depends on —
 * no new icon dependency. Built from EMOTION_ICON_NAMES (pure data, see
 * that module for the full identifier -> Lucide-export-name rationale).
 * Extending the taxonomy only requires adding one entry to
 * EMOTION_ICON_NAMES (plus importing the component above, if new);
 * `EMOTION_ICON_FALLBACK` covers any identifier not yet mapped, so an
 * unrecognized future icon name never crashes or renders nothing.
 */
export const EMOTION_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(EMOTION_ICON_NAMES).map(([icon, exportName]) => [icon, LUCIDE_COMPONENTS_BY_NAME[exportName]]),
);

export const EMOTION_ICON_FALLBACK: LucideIcon = Circle;

/** Resolves a canonical `icon` identifier to its Lucide component, falling back to a generic circle for any unrecognized identifier. */
export function resolveEmotionIcon(iconName: string): LucideIcon {
  return EMOTION_ICONS[iconName] ?? EMOTION_ICON_FALLBACK;
}
