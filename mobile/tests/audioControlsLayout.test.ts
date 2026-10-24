import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5, absoluteFill: {} } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));
vi.mock('@/audio/index', () => ({ audioEngine: {} }));
vi.mock('@/audio/usePlayback', () => ({ usePlayback: () => null, useSurahProgress: () => null }));

const { controlsLayout } = await import('@/components/MushafAudioPlayer');

/** Window widths: narrowest iPhone, small Android, common phones, large phones, tablets (the window spans the width). */
const WIDTHS = [320, 360, 375, 390, 393, 412, 430, 600, 800, 1024];

describe('the controls bar: five centred controls, Repeat at the right edge', () => {
  for (const width of WIDTHS) {
    it(`${width} pt: the centred group leaves room for Repeat on both sides (never overlaps it)`, () => {
      const available = width - 16 - 24; // the window's side margins and padding
      const l = controlsLayout(available);
      const group = 2 * l.page + 2 * l.ayah + 48 + 4 * l.gap;
      const side = (available - group) / 2; // free space each side of the centred group
      expect(side).toBeGreaterThanOrEqual(l.repeat);
      expect(l.gap).toBeGreaterThanOrEqual(2);
      expect(l.gap).toBeLessThanOrEqual(12);
      // Touch targets stay usable even when compact.
      expect(Math.min(l.page, l.ayah, l.repeat)).toBeGreaterThanOrEqual(34);
    });
  }

  it('uses the regular sizes on common phones and the compact ones only on the narrowest', () => {
    expect(controlsLayout(390 - 40)).toMatchObject({ page: 40, ayah: 44, repeat: 40 });
    expect(controlsLayout(360 - 40)).toMatchObject({ page: 40, ayah: 44, repeat: 40 });
    expect(controlsLayout(320 - 40)).toMatchObject({ page: 34, ayah: 38, repeat: 36 });
    expect(controlsLayout(1024 - 40).gap).toBe(12);
  });
});
