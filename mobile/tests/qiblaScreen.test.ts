import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DIAL_TICKS, DIAL_VIEWBOX, dialPoint } from '@/qibla/qiblaDialGeometry';
import { SHOW_QIBLA_BEARING_CARD, SHOW_QIBLA_CITY_PICKER, visibleQiblaActions } from '@/qibla/qiblaScreenOptions';

/** Source checks for Home's Qibla Direction button, the /qibla screen and its compass dial (docs/qibla.md). */

const read = (path: string) => readFileSync(resolve(__dirname, '../src', path), 'utf-8').split(String.fromCharCode(13)).join('');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const home = read('app/(tabs)/index.tsx');
const screen = read('app/qibla.tsx');
const dial = read('qibla/QiblaCompassDial.tsx');

describe("Home's Qibla Direction button", () => {
  const block = home.slice(home.lastIndexOf('<Pressable', home.indexOf('testID="home-qibla"')), home.indexOf('</Pressable>', home.indexOf('testID="home-qibla"')) + '</Pressable>'.length);

  it('sits directly after A Message from the Quran and before Share Feedback', () => {
    const general = home.indexOf("router.push('/ayah/general')");
    const qibla = home.indexOf('testID="home-qibla"');
    const feedback = home.indexOf('testID="home-feedback"');
    expect(general).toBeGreaterThan(-1);
    expect(qibla).toBeGreaterThan(general);
    expect(feedback).toBeGreaterThan(qibla);
    // Nothing else in between: the general action's closing tag, then this button.
    const between = home.slice(home.indexOf('</Pressable>', general) + '</Pressable>'.length, home.lastIndexOf('<Pressable', qibla));
    expect(code(between).trim().replace(/\{\s*\}/g, '')).toBe('');
  });

  it('one button holding one centred group: the Kaaba (28 pt, scaled evenly) and the label; no chevron; opens /qibla', () => {
    expect(block).toMatch(/onPress=\{\(\) => router\.push\('\/qibla'\)\}/);
    expect(home).toMatch(/const QIBLA_HOME_ICON_SIZE = 28;/);
    expect(block).toMatch(/<KaabaIcon size=\{QIBLA_HOME_ICON_SIZE\} \/>/);
    expect(block).toMatch(/\{messages\.qibla\.homeAction\}<\/Text>/);
    expect(block).not.toMatch(/Chevron/);
    expect(block.match(/<Pressable\b/g)).toHaveLength(1);
    // The Kaaba and the label sit in one group, the group is the button's only child.
    const inner = block.slice(block.indexOf('>', block.indexOf('style={({ pressed })')) + 1, block.lastIndexOf('</Pressable>'));
    expect(inner.match(/<(View|Text|KaabaIcon)\b/g)).toEqual(['<View', '<KaabaIcon', '<Text']);
    expect(inner).toMatch(/<View style=\{\[styles\.qiblaActionGroup, isRtl && styles\.qiblaActionRtl\]\}>/);
    // The whole button is the press target; RTL mirrors only the group (the Kaaba at the reading start).
    expect(block).toMatch(/style=\{\(\{ pressed \}\) => \[styles\.qiblaAction, pressed && styles\.pressed\]\}/);
  });

  it('is accessible: a button with its label and hint', () => {
    expect(block).toMatch(/accessibilityRole="button"/);
    expect(block).toMatch(/accessibilityLabel=\{messages\.qibla\.homeAction\}/);
    expect(block).toMatch(/accessibilityHint=\{messages\.qibla\.homeActionHint\}/);
  });

  it('matches A Message from the Quran: same surface, border, radius, height and shadow; full width', () => {
    const style = (name: string) => home.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1] ?? '';
    const general = style('generalQuranAction');
    const qibla = style('qiblaAction');
    for (const line of ['backgroundColor: colors.surface', 'borderColor: colors.border', 'borderRadius: radii.lg', 'borderWidth: 1', 'minHeight: 56', '...shadows.soft']) {
      expect(general, line).toContain(line);
      expect(qibla, line).toContain(line);
    }
    // Centred like A Message from the Quran (the group centred inside the button, the group's content centred too).
    expect(general).toContain("justifyContent: 'center'");
    expect(qibla).toContain("justifyContent: 'center'");
    expect(style('qiblaActionGroup')).toContain("justifyContent: 'center'");
    expect(qibla).not.toMatch(/space-between|width:|alignSelf/);
    // 56 pt high with the 28 pt Kaaba: 28 + 2 × spacing.md (14).
    expect(qibla).toContain('paddingVertical: spacing.md');
  });
});

describe('the /qibla screen', () => {
  it('uses the shared controller and its reliability model through the presentation, never the diagnostics', () => {
    expect(screen).toMatch(/useQiblaCompass\(\)/);
    expect(screen).toMatch(/presentQibla\(snapshot, m\)/);
    expect(code(screen)).not.toMatch(/diagnostics|getDiagnostics|magHeading/i);
  });

  it('has the standard page header: Back (mirrored in Arabic, goBackOrHome), the title, Settings', () => {
    expect(screen).toMatch(/const BackIcon = isRtl \? ArrowRight : ArrowLeft;/);
    expect(screen).toMatch(/onPress=\{goBackOrHome\}/);
    expect(screen).toMatch(/<Text accessibilityRole="header" style=\{\[styles\.title, direction\]\}>\{m\.title\}<\/Text>/);
    expect(screen).toMatch(/<SettingsHeaderButton /);
  });

  it('asks for location only from the Allow button; Settings only from its button', () => {
    expect(code(screen).match(/requestPermission\(\)/g)).toHaveLength(1);
    expect(screen).toMatch(/case 'allowLocation':\n\s+requestPermission\(\);/);
    expect(screen).toMatch(/case 'openSettings':\n\s+void Linking\.openSettings\(\)/);
  });

  it('the city fallback stays in the code (ID only, restored, cleared by Use my location) behind its switch', () => {
    expect(screen).toMatch(/saveManualCityId\(city\.id\)/);
    expect(screen).toMatch(/loadManualCityId\(\)\.then/);
    expect(screen).toMatch(/case 'useMyLocation':\n\s+void clearManualCityId\(\);\n\s+chooseDevicePosition\(\);/);
  });

  it('city selection hidden (owner, 2026-11-07): no position line, no city buttons, no picker; a saved city is not applied', () => {
    expect(SHOW_QIBLA_CITY_PICKER).toBe(false);
    expect(screen).toMatch(/\{SHOW_QIBLA_CITY_PICKER && view\.positionLine && /);
    expect(screen).toMatch(/\{SHOW_QIBLA_CITY_PICKER && \(\s+<QiblaCityPicker /);
    expect(screen).toMatch(/const actions = visibleQiblaActions\(view\.actions\);/);
    expect(screen).toMatch(/\{actions\.map\(\(action\) =>/);
    expect(screen).not.toMatch(/view\.actions\.map/);
    // The saved-city restore runs only while the city fallback is shown.
    expect(screen).toMatch(/useEffect\(\(\) => \{\n\s+if \(!SHOW_QIBLA_CITY_PICKER\) return;\n\s+let cancelled = false;\n\s+void loadManualCityId\(\)/);
  });

  it('visibleQiblaActions drops only the city actions, and keeps them when the switch is on', () => {
    expect(visibleQiblaActions(['allowLocation', 'chooseCity'], false)).toEqual(['allowLocation']);
    expect(visibleQiblaActions(['openSettings', 'chooseCity'], false)).toEqual(['openSettings']);
    expect(visibleQiblaActions(['tryAgain', 'useMyLocation', 'chooseCity'], false)).toEqual(['tryAgain']);
    expect(visibleQiblaActions(['chooseCity'], false)).toEqual([]);
    expect(visibleQiblaActions(['allowLocation', 'chooseCity'], true)).toEqual(['allowLocation', 'chooseCity']);
    expect(visibleQiblaActions(['allowLocation'])).toEqual(['allowLocation']); // the default follows the switch (off)
  });

  it('bearing card hidden (owner, 2026-11-07) behind SHOW_QIBLA_BEARING_CARD; the bearing still drives the dial', () => {
    expect(SHOW_QIBLA_BEARING_CARD).toBe(false);
    expect(screen).toMatch(/\{SHOW_QIBLA_BEARING_CARD && view\.bearingText && \(\s+<View testID="qibla-bearing"/);
    // The card itself is kept, unchanged, for when the switch returns.
    expect(screen).toMatch(/\{m\.bearingLabel\}[\s\S]*\{view\.bearingText\}[\s\S]*\{m\.bearingExplain\}/);
    // The needle and the turn hint keep using the calculated bearing.
    expect(screen).toMatch(/bearing=\{snapshot\.qibla\.bearing\}/);
    expect(screen).toMatch(/view\.turnText/);
  });

  it('announces status changes after they settle, not every reading', () => {
    expect(screen).toMatch(/AccessibilityInfo\.announceForAccessibility\(spoken\)/);
    expect(screen).toMatch(/const ANNOUNCE_DELAY_MS = 1_500;/);
  });

  it('keeps the calibration help (collapsible, all four tips); the bottom accuracy caption is no longer shown', () => {
    expect(screen).toMatch(/\[m\.helpFigureEight, m\.helpHoldFlat, m\.helpAwayFromMagnets, m\.helpIndoors\]\.map/);
    expect(screen).toMatch(/cardinals=\{\[m\.cardinalNorth, m\.cardinalEast, m\.cardinalSouth, m\.cardinalWest\]\}/);
    expect(screen).toMatch(/accessibilityState=\{\{ expanded: helpOpen \}\}/);
    expect(screen).toMatch(/accessibilityLabel=\{m\.helpTitle\}/);
    expect(code(screen)).not.toMatch(/m\.caption|styles\.caption/);
    // The help card is the last thing in the scroll view: no empty space after it.
    expect(screen).toMatch(/\n        <\/View>\n      <\/ScrollView>/);
  });

  it('keeps every permission, location and calibration message path (the status line and the notice card)', () => {
    expect(screen).toMatch(/\{view\.status && /);
    expect(screen).toMatch(/\{view\.notice && \(/);
    expect(screen).toMatch(/case 'allowLocation':[\s\S]*case 'openSettings':[\s\S]*case 'tryAgain':/);
  });
});

describe('the compass dial', () => {
  it('never mirrors in Arabic, and respects Reduce Motion', () => {
    expect(dial).toMatch(/direction: 'ltr' as const/);
    expect(dial).toMatch(/useReducedMotion\(\)/);
    expect(dial).toMatch(/rotation\.value = reduceMotion \? frame\.dialRotation : withTiming/);
  });

  it('turns by the controller\'s unwrapped rotation and draws the needle at the bearing; no needle, no letters when hidden', () => {
    expect(dial).toMatch(/transform: \[\{ rotate: `\$\{rotation\.value\}deg` \}\]/);
    expect(dial).toMatch(/<G rotation=\{bearing\}/);
    expect(dial).toMatch(/const live = needle !== 'hidden';/);
    expect(dial).toMatch(/\{live &&\s+cardinals\.map/);
    expect(dial).toMatch(/\{live && \(\s+<G rotation=\{bearing\}/);
    expect(dial).not.toMatch(/KaabaIcon/); // the Kaaba is on Home; the compass has a needle
  });

  it('dialPoint: 0° is the top, 90° the right (clockwise, as bearings are)', () => {
    const c = DIAL_VIEWBOX / 2;
    const [x0, y0] = dialPoint(0, 50);
    const [x90, y90] = dialPoint(90, 50);
    expect(x0).toBeCloseTo(c, 9);
    expect(y0).toBeCloseTo(c - 50, 9);
    expect(x90).toBeCloseTo(c + 50, 9);
    expect(y90).toBeCloseTo(c, 9);
    expect(DIAL_TICKS).toHaveLength(36);
  });
});
