import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOTTOM_NAV_CLEARANCE, scrollBottomPadding } from '@/utils/safeAreaSpacing';

// Carriage returns removed so the style checks don't depend on the file's line endings.
const indexSource = readFileSync(resolve(__dirname, '../src/app/index.tsx'), 'utf-8').split(String.fromCharCode(13)).join('');

describe('scrollBottomPadding: space between the last item and the system navigation area', () => {
  it('adds a comfortable 24 px clearance on top of the bottom inset', () => {
    expect(BOTTOM_NAV_CLEARANCE).toBe(24);
    expect(scrollBottomPadding(48)).toBe(72); // Android edge-to-edge, 3-button navigation
    expect(scrollBottomPadding(16)).toBe(40); // Android gesture navigation
    expect(scrollBottomPadding(34)).toBe(58); // iPhone home indicator
    expect(scrollBottomPadding(0)).toBe(24); // no inset
  });

  it('is never less than the inset + clearance, and ignores invalid insets', () => {
    for (const inset of [0, 0.5, 13.7, 24, 47.9, 63]) expect(scrollBottomPadding(inset)).toBeGreaterThanOrEqual(inset + 20);
    expect(scrollBottomPadding(-10)).toBe(24);
    expect(scrollBottomPadding(Number.NaN)).toBe(24);
  });
});

describe('Home screen bottom safe area (source-scan)', () => {
  it('reads the bottom inset from react-native-safe-area-context', () => {
    expect(indexSource).toMatch(/import \{ SafeAreaView, useSafeAreaInsets \} from 'react-native-safe-area-context';/);
    expect(indexSource).toMatch(/const insets = useSafeAreaInsets\(\);/);
  });

  it('applies the inset exactly once: on the scroll content, never also on the SafeAreaView', () => {
    expect(indexSource).toMatch(/<SafeAreaView style=\{styles\.safeArea\} edges=\{\['top', 'left', 'right'\]\}>/);
    expect(indexSource).not.toMatch(/edges=\{\[[^\]]*'bottom'/);
    expect(indexSource).toMatch(/contentContainerStyle=\{\[styles\.content, \{ paddingBottom: scrollBottomPadding\(insets\.bottom\) \}\]\}/);
    // No competing fixed bottom padding left in the static content style.
    const contentStyle = indexSource.match(/\n  content: \{[\s\S]*?\n  \},/)?.[0] ?? '';
    expect(contentStyle).not.toMatch(/paddingBottom/);
  });

  it('keeps the disclaimer last, directly below "A Message from the Quran", inside the scroll view', () => {
    const actionIndex = indexSource.indexOf("router.push('/ayah/general')");
    const disclaimerIndex = indexSource.indexOf('messages.home.disclaimer');
    const scrollEnd = indexSource.indexOf('</ScrollView>');
    expect(actionIndex).toBeGreaterThan(-1);
    expect(disclaimerIndex).toBeGreaterThan(actionIndex);
    expect(scrollEnd).toBeGreaterThan(disclaimerIndex);
    expect(indexSource.slice(disclaimerIndex, scrollEnd)).not.toMatch(/<(View|Pressable|Text)\b/);
  });

  it('keeps the disclaimer text styling and RTL direction unchanged', () => {
    expect(indexSource).toMatch(/<Text style=\{\[styles\.disclaimer, direction\]\}>\{messages\.home\.disclaimer\}<\/Text>/);
    expect(indexSource).toMatch(/disclaimer: \{\n    color: colors\.textMuted,\n    fontSize: typography\.caption,\n    lineHeight: 19,\n    paddingHorizontal: spacing\.xs,\n  \},/);
  });
});
