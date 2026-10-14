import type { GestureResponderEvent } from 'react-native';

/**
 * Where a press landed, relative to the pressed view. Native responder
 * events carry locationX/Y; on the web, Pressable's onPress receives the
 * DOM click, which has offsetX/Y instead (relative to the click target,
 * which is the pressed view itself when its children take no touches).
 */
export function pressLocation(event: GestureResponderEvent): { x: number; y: number } {
  const native = event.nativeEvent as GestureResponderEvent['nativeEvent'] & { offsetX?: number; offsetY?: number };
  const x = Number.isFinite(native.locationX) ? native.locationX : native.offsetX;
  const y = Number.isFinite(native.locationY) ? native.locationY : native.offsetY;
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}
