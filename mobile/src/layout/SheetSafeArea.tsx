import type { ComponentProps } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDismissKeyboardOnResize } from './useDismissKeyboardOnResize';
import { useSheetFrameStyle } from './useWindowClass';

/**
 * The SafeAreaView that holds a bottom sheet (at the end of a justifyContent: 'flex-end' backdrop): on phones exactly
 * that SafeAreaView; on tablets also centred and at most LAYOUT_TOKENS.sheetMaxWidth wide (layout/windowClass.ts), so
 * a sheet never stretches across a tablet. Re-renders on rotation and window resizing, and (Android) closes the
 * keyboard then, so the sheet's form is laid out again whole (layout/useDismissKeyboardOnResize.ts).
 */
export function SheetSafeArea({ style, ...props }: ComponentProps<typeof SafeAreaView>) {
  const frame = useSheetFrameStyle('flow');
  useDismissKeyboardOnResize();
  return <SafeAreaView {...props} style={[style, frame]} />;
}
