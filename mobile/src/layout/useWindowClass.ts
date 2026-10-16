import { useWindowDimensions } from 'react-native';

import { contentColumnStyle, sheetFrameStyle, windowClassFor, type WindowClass } from './windowClass';

export type WindowLayout = {
  windowClass: WindowClass;
  width: number;
  height: number;
  /** Not compact: a tablet-sized window (either orientation). */
  isWide: boolean;
  isLandscape: boolean;
};

/** The current window's size class, re-rendering when the window is rotated or resized (layout/windowClass.ts). */
export function useWindowClass(): WindowLayout {
  const { width, height } = useWindowDimensions();
  const windowClass = windowClassFor(width);
  return { windowClass, width, height, isWide: windowClass !== 'compact', isLandscape: width > height };
}

/** contentColumnStyle() for the current window: nothing on phones, a centred column on tablets. */
export function useContentColumnStyle(maxWidth?: number) {
  return contentColumnStyle(useWindowClass().windowClass, maxWidth);
}

/** sheetFrameStyle() for the current window: nothing on phones, a centred, width-capped sheet on tablets. */
export function useSheetFrameStyle(placement: 'absolute' | 'flow') {
  const { windowClass, width } = useWindowClass();
  return sheetFrameStyle(windowClass, width, placement);
}
