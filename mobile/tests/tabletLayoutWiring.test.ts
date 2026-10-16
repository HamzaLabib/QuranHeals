import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResizeSettler, RESIZE_SETTLE_MS } from '@/layout/resizeSettler';
import { pageBoxOnScreen, remapAnchor, sameBox } from '@/mushaf/popupAnchor';

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8').split(String.fromCharCode(13)).join('');

describe('resize settling (the Mushaf page refits once per rotation or resize, at the final size)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the first measurement (the reader opening) applies at once', () => {
    const applied: number[] = [];
    const settler = createResizeSettler((size) => applied.push(size.width));
    settler.measure({ width: 820, height: 1120 });
    expect(applied).toEqual([820]);
  });

  it('a rotation`s several layouts apply once, at the final size, after a quiet period (never an intermediate size)', () => {
    const applied: number[] = [];
    const settler = createResizeSettler((size) => applied.push(size.width));
    settler.measure({ width: 820, height: 1120 });
    settler.measure({ width: 820, height: 760 }); // an intermediate layout (old width, new height)
    settler.measure({ width: 1180, height: 760 });
    expect(applied).toEqual([820]);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1);
    expect(applied).toEqual([820]);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([820, 1180]);
  });

  it('a window being dragged applies only its last size, once it stops', () => {
    const applied: number[] = [];
    const settler = createResizeSettler((size) => applied.push(size.width));
    settler.measure({ width: 800, height: 1000 });
    for (const width of [790, 760, 720, 700, 680]) {
      vi.advanceTimersByTime(16);
      settler.measure({ width, height: 1000 });
    }
    expect(applied).toEqual([800]);
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(applied).toEqual([800, 680]);
  });

  it('`settle` false (phone-sized windows): every change applies at once, as before', () => {
    const applied: number[] = [];
    const settler = createResizeSettler((size) => applied.push(size.width), { settle: () => false });
    settler.measure({ width: 390, height: 797 });
    settler.measure({ width: 390, height: 500 });
    expect(applied).toEqual([390, 390]);
  });

  it('an unchanged size is never applied twice; cancel drops a pending one (unmount)', () => {
    const applied: number[] = [];
    const settler = createResizeSettler((size) => applied.push(size.width));
    settler.measure({ width: 600, height: 900 });
    settler.measure({ width: 600, height: 900 });
    vi.advanceTimersByTime(RESIZE_SETTLE_MS);
    expect(applied).toEqual([600]);
    settler.measure({ width: 500, height: 900 });
    settler.cancel();
    vi.advanceTimersByTime(RESIZE_SETTLE_MS * 2);
    expect(applied).toEqual([600]);
  });
});

describe('popup anchors follow the page when it is refitted', () => {
  it('the page box: centred across the reading area, under the status bar and Back row, after the left inset', () => {
    expect(pageBoxOnScreen({ area: { width: 1180 }, insets: { top: 24, left: 0 }, barHeight: 36, page: { width: 411, height: 702 }, viewportHeight: 740, fullScreen: false }))
      .toEqual({ x: 384.5, y: 60, width: 411, height: 702 });
    expect(pageBoxOnScreen({ area: { width: 1232 }, insets: { top: 0, left: 48 }, barHeight: 36, page: { width: 400, height: 700 }, viewportHeight: 740, fullScreen: true }))
      .toEqual({ x: 464, y: 56, width: 400, height: 700 });
  });

  it('the same point of the page, after a rotation', () => {
    const portrait = { x: 99, y: 60, width: 622, height: 1063 };
    const landscape = { x: 384.5, y: 60, width: 411, height: 702 };
    const tapped = { x: portrait.x + 0.25 * 622, y: portrait.y + 0.5 * 1063 };
    const moved = remapAnchor(tapped, portrait, landscape)!;
    expect(moved.x).toBeCloseTo(landscape.x + 0.25 * 411);
    expect(moved.y).toBeCloseTo(landscape.y + 0.5 * 702);
    expect(remapAnchor(tapped, { x: 0, y: 0, width: 0, height: 0 }, landscape)).toBeNull();
    expect(sameBox(portrait, { ...portrait })).toBe(true);
    expect(sameBox(portrait, landscape)).toBe(false);
  });
});

describe('every sheet and screen uses the shared tablet layout (no per-screen widths)', () => {
  it('bottom sheets: the centred, width-capped frame on tablets', () => {
    for (const path of ['DeleteAccountSheet', 'GuestDataSheet', 'ReflectionSheet', 'ReportIssueSheet', 'ChangeSyncPasswordSheet', 'ShareAyahSheet']) {
      const file = source(`src/components/${path}.tsx`);
      expect(file, path).toMatch(/<SheetSafeArea /);
      expect(file, path).not.toMatch(/<SafeAreaView /);
    }
    expect(source('src/components/SyncPassphraseSheet.tsx').match(/<SheetSafeArea style=\{styles\.safeArea\}>/g)).toHaveLength(2);
    expect(source('src/components/ConfirmSheet.tsx')).toMatch(/useSheetFrameStyle\('absolute'\)/);
    expect(source('src/components/ReminderTimePicker.native.tsx')).toMatch(/useSheetFrameStyle\('absolute'\)/);
    expect(source('src/app/(tabs)/my-reading.tsx')).toMatch(/useSheetFrameStyle\('flow'\)/);
  });

  it('screens: a centred content column (a reading width for the ayah screen)', () => {
    for (const path of ['app/(tabs)/my-reading.tsx', 'app/(tabs)/reflections.tsx', 'app/favorites.tsx', 'app/settings.tsx', 'app/credits.tsx', 'app/khatma-complete.tsx']) {
      expect(source(`src/${path}`), path).toMatch(/const column = useContentColumnStyle\(\);/);
      expect(source(`src/${path}`), path).toMatch(/contentContainerStyle=\{\[styles\.content, column/);
    }
    expect(source('src/app/(tabs)/index.tsx')).toMatch(/contentColumnStyle\(windowClass\)/);
    expect(source('src/app/(tabs)/emotions.tsx').match(/contentColumnStyle\(windowClass\)/g)).toHaveLength(2); // header and list
    expect(source('src/components/AyahExperience.tsx')).toMatch(/useContentColumnStyle\(LAYOUT_TOKENS\.readingMaxWidth\)/);
  });

  it('Modals keep React Native`s per-device orientations (iPad: all; iPhone: portrait): none narrows them', () => {
    for (const path of ['components/ConfirmSheet.tsx', 'components/ReflectionSheet.tsx', 'components/ShareAyahSheet.tsx', 'components/MushafAyahPopups.tsx', 'components/MushafGuide.tsx', 'app/(tabs)/my-reading.tsx']) {
      expect(source(`src/${path}`), path).not.toMatch(/supportedOrientations/);
    }
  });

  it('no device or brand detection anywhere: layouts follow the window, the orientation policy the screen', () => {
    const files = ['layout/windowClass.ts', 'layout/useWindowClass.ts', 'layout/orientationPolicy.ts', 'layout/useDeviceOrientationPolicy.ts'];
    for (const path of files) expect(source(`src/${path}`), path).not.toMatch(/Platform\.isPad|isTablet\(|Device\.(brand|manufacturer|modelName)|getManufacturer|['"](samsung|xiaomi|lenovo|huawei|honor|oneplus|google)['"]/i);
  });
});
