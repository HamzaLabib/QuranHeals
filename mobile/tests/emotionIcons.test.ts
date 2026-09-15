import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMOTION_ICON_NAMES } from '../src/utils/emotionIconNames';

// Reads the canonical 29-emotion taxonomy directly from
// backend/src/emotions/emotionCatalog.ts (never duplicated/hardcoded here)
// to prove the mobile icon name table covers every real icon identifier the
// backend actually seeds, including all 17 new (currently-inactive)
// emotions. backend/src/seed/emotions.ts derives from this same catalog, so
// reading the catalog directly is equivalent and avoids depending on the
// seed file's derivation shape.
//
// This suite deliberately imports only the pure name-table module
// (EMOTION_ICON_NAMES: Record<identifier, LucideExportName>), never
// emotionIcons.ts or lucide-react-native/react-native directly: those pull
// in real React Native component modules that this project's plain-Node
// vitest environment cannot parse (the same reason the pre-existing
// apiRuntime.test.ts has to `vi.mock('react-native', ...)`). Resolution
// safety (an unknown identifier falling back to a real component, not
// undefined/a crash) is proven at the EMOTION_ICON_FALLBACK level in
// emotionIcons.ts itself, which every canonical identifier below is proven
// to never need.
const CANONICAL_EMOTIONS_PATH = resolve(__dirname, '../../backend/src/emotions/emotionCatalog.ts');
const VALID_LUCIDE_EXPORT_NAME = /^[A-Z][A-Za-z0-9]*$/;

function loadCanonicalIconIdentifiers(): string[] {
  const source = readFileSync(CANONICAL_EMOTIONS_PATH, 'utf-8');
  const matches = [...source.matchAll(/icon:\s*'([a-z0-9-]+)'/g)];
  return matches.map((match) => match[1]);
}

describe('canonical 29-emotion taxonomy icon coverage (backend/src/seed/emotions.ts)', () => {
  const canonicalIcons = loadCanonicalIconIdentifiers();

  it('the canonical seed actually defines 29 emotions (sanity check on the parser itself)', () => {
    expect(canonicalIcons.length).toBe(29);
  });

  it('has no duplicate icon identifiers within the canonical set', () => {
    expect(new Set(canonicalIcons).size).toBe(canonicalIcons.length);
  });

  it('every canonical icon identifier has a mapped Lucide export name — none fall through to the generic fallback', () => {
    const unmapped = canonicalIcons.filter((icon) => !(icon in EMOTION_ICON_NAMES));
    expect(unmapped, `these canonical icons have no entry in EMOTION_ICON_NAMES: ${unmapped.join(', ')}`).toEqual([]);
  });

  it('EMOTION_ICON_NAMES contains exactly one entry per canonical icon identifier, no more, no fewer', () => {
    expect(Object.keys(EMOTION_ICON_NAMES).sort()).toEqual([...canonicalIcons].sort());
  });

  it('every mapped value is a plausible Lucide PascalCase export name (never empty/lowercase/malformed)', () => {
    Object.entries(EMOTION_ICON_NAMES).forEach(([icon, exportName]) => {
      expect(VALID_LUCIDE_EXPORT_NAME.test(exportName), `"${icon}" -> "${exportName}" is not a plausible export name`).toBe(true);
    });
  });

  it('maps every one of the 17 newly-added (currently-inactive) emotion icons', () => {
    const newIcons = [
      'droplet',
      'heart-crack',
      'waves',
      'user-x',
      'user-minus',
      'scale',
      'unlink',
      'alert-circle',
      'rotate-ccw',
      'battery-warning',
      'hand-heart',
      'hourglass',
      'anchor',
      'sun',
      'smile',
      'map',
      'sparkles',
    ];
    expect(newIcons).toHaveLength(17);
    newIcons.forEach((icon) => {
      expect(EMOTION_ICON_NAMES[icon], `missing mapping for new icon "${icon}"`).toBeTypeOf('string');
    });
  });
});
