import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOTTOM_NAV_CLEARANCE, scrollBottomPadding } from '@/utils/safeAreaSpacing';

// Carriage returns removed so the style checks don't depend on the file's line endings.
const indexSource = readFileSync(resolve(__dirname, '../src/app/(tabs)/index.tsx'), 'utf-8').split(String.fromCharCode(13)).join('');

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

  it('"A Message from the Quran" is followed only by the Share Feedback action, then the Quran sources footer, inside the scroll view; the disclaimer is no longer on Home', () => {
    const actionIndex = indexSource.indexOf("router.push('/ayah/general')");
    const feedbackIndex = indexSource.indexOf('testID="home-feedback"');
    const footerIndex = indexSource.indexOf('testID="home-sources"');
    const scrollEnd = indexSource.indexOf('</ScrollView>');
    expect(actionIndex).toBeGreaterThan(-1);
    expect(feedbackIndex).toBeGreaterThan(actionIndex);
    expect(footerIndex).toBeGreaterThan(feedbackIndex);
    expect(scrollEnd).toBeGreaterThan(footerIndex);
    // Between the action's end and the footer: the Share Feedback action alone (its row, one button, its label), then the footer's own opening tag.
    const between = indexSource.slice(indexSource.indexOf('</Pressable>', actionIndex), footerIndex);
    expect(between.match(/<(View|Pressable|Text)\b/g)).toEqual(['<View', '<Pressable', '<Text', '<View']);
    expect(indexSource).not.toMatch(/messages\.home\.disclaimer|disclaimer: \{/);
  });

  it('the disclaimer moved to the emotion list (/emotions) with its text styling and RTL direction unchanged, after the cards', () => {
    const emotionsSource = readFileSync(resolve(__dirname, '../src/app/(tabs)/emotions.tsx'), 'utf-8').split(String.fromCharCode(13)).join('');
    expect(emotionsSource).toMatch(/<Text testID="emotions-disclaimer" style=\{\[styles\.disclaimer, direction\]\}>\{messages\.home\.disclaimer\}<\/Text>/);
    expect(emotionsSource).toMatch(/disclaimer: \{\n    color: colors\.textMuted,\n    fontSize: typography\.caption,\n    lineHeight: 19,\n    paddingHorizontal: spacing\.xs,\n  \},/);
    expect(emotionsSource.indexOf('emotions-disclaimer')).toBeGreaterThan(emotionsSource.indexOf('testID="emotions-grid"'));
    expect(emotionsSource.indexOf('</ScrollView>')).toBeGreaterThan(emotionsSource.indexOf('emotions-disclaimer'));
    expect(emotionsSource).toMatch(/paddingBottom: scrollBottomPadding\(insets\.bottom\)/);
  });
});
