import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DIAL_TICKS, DIAL_VIEWBOX, dialPoint } from '@/qibla/qiblaDialGeometry';

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

  it('one button: the Kaaba (22 pt), the label, a chevron that follows the reading direction; opens /qibla', () => {
    expect(block).toMatch(/onPress=\{\(\) => router\.push\('\/qibla'\)\}/);
    expect(block).toMatch(/<KaabaIcon size=\{22\} \/>/);
    expect(block).toMatch(/\{messages\.qibla\.homeAction\}<\/Text>/);
    expect(block).toMatch(/\{isRtl \? <ChevronLeft size=\{18\} color=\{colors\.textSecondary\} \/> : <ChevronRight size=\{18\} color=\{colors\.textSecondary\} \/>\}/);
    expect(block.match(/<Pressable\b/g)).toHaveLength(1);
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
    expect(qibla).toContain("justifyContent: 'space-between'");
    expect(qibla).not.toMatch(/width:|alignSelf/);
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

  it('a chosen city: saved as its ID only, restored on the next visit, cleared by Use my location', () => {
    expect(screen).toMatch(/saveManualCityId\(city\.id\)/);
    expect(screen).toMatch(/loadManualCityId\(\)\.then/);
    expect(screen).toMatch(/case 'useMyLocation':\n\s+void clearManualCityId\(\);\n\s+chooseDevicePosition\(\);/);
  });

  it('announces status changes after they settle, not every reading', () => {
    expect(screen).toMatch(/AccessibilityInfo\.announceForAccessibility\(spoken\)/);
    expect(screen).toMatch(/const ANNOUNCE_DELAY_MS = 1_500;/);
  });

  it('shows the calibration help (collapsible) and the accuracy caption', () => {
    expect(screen).toMatch(/\[m\.helpFigureEight, m\.helpHoldFlat, m\.helpAwayFromMagnets, m\.helpIndoors\]\.map/);
    expect(screen).toMatch(/cardinals=\{\[m\.cardinalNorth, m\.cardinalEast, m\.cardinalSouth, m\.cardinalWest\]\}/);
    expect(screen).toMatch(/accessibilityState=\{\{ expanded: helpOpen \}\}/);
    expect(screen).toMatch(/\{m\.caption\}/);
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
