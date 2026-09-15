/**
 * Pure data: maps every canonical emotion `icon` identifier (see
 * backend/src/seed/emotions.ts, the 29-key taxonomy) to the exact
 * `lucide-react-native` export name that renders it. Deliberately has no
 * dependency on `lucide-react-native`/`react-native` itself, so this table
 * — and the identifier coverage it represents — can be unit-tested in a
 * plain Node environment (see mobile/tests/emotionIcons.test.ts) without
 * needing a React Native rendering environment. `emotionIcons.ts` is the
 * only module that turns these names into real icon components.
 *
 * Some entries point at a Lucide export name that differs from the
 * identifier's own spelling because Lucide renamed the underlying icon
 * upstream and kept the original name as a backward-compatible alias
 * export (e.g. `alert-circle` -> `AlertCircle`, still exported, now backed
 * by the `circle-alert` icon file) — still the same visual icon.
 */
export const EMOTION_ICON_NAMES: Record<string, string> = {
  activity: 'Activity',
  'alert-circle': 'AlertCircle',
  anchor: 'Anchor',
  'battery-low': 'BatteryLow',
  'battery-warning': 'BatteryWarning',
  'cloud-rain': 'CloudRain',
  compass: 'Compass',
  droplet: 'Droplet',
  flame: 'Flame',
  gauge: 'Gauge',
  'hand-heart': 'HandHeart',
  heart: 'Heart',
  'heart-crack': 'HeartCrack',
  'help-circle': 'HelpCircle',
  hourglass: 'Hourglass',
  leaf: 'Leaf',
  map: 'Map',
  moon: 'Moon',
  'rotate-ccw': 'RotateCcw',
  scale: 'Scale',
  'shield-alert': 'ShieldAlert',
  smile: 'Smile',
  sparkles: 'Sparkles',
  sun: 'Sun',
  sunrise: 'Sunrise',
  unlink: 'Unlink',
  'user-minus': 'UserMinus',
  'user-x': 'UserX',
  waves: 'Waves',
};
