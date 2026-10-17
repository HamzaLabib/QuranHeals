/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  pickScenery,
  SCENERY_CARD_THEME,
  SHARE_CARD_SCENERY,
  SHARE_CARD_SCENERY_OVERLAY_COLOR,
  sceneryById,
  sceneryEdgeOpacity,
} from '@/constants/shareCardScenery';

/**
 * The bundled Scenery photographs: every file present, offline, sized for the
 * 1080 x 1920 export, and in step with the build manifest written by
 * tools/share-backgrounds/build_scenery.py (sources, licence, overlay values).
 */

const mobile = resolve(__dirname, '..');
const assetDir = resolve(mobile, 'assets/share-backgrounds/scenery');
type ManifestPhoto = {
  id: string; file: string; theme: number; description: string; sourceUrl: string; photographer: string; photographerUrl: string;
  license: string; originalSize: [number, number]; optimizedSize: [number, number]; bytes: number; overlayOpacity: number;
};
const manifest = JSON.parse(readFileSync(resolve(mobile, '../docs/share-backgrounds/scenery-manifest.json'), 'utf-8')) as {
  license: { name: string; url: string };
  overlay: { color: string; ink: string; secondaryInk: string; floor: number };
  totalBytes: number;
  photos: ManifestPhoto[];
};
const imagesSource = readFileSync(resolve(mobile, 'src/constants/shareCardSceneryImages.ts'), 'utf-8');

/** Width and height from a baseline or progressive JPEG's start-of-frame marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  throw new Error('No JPEG frame header');
}

describe('the catalogue', () => {
  it('one registry: the catalogue, the image map, the manifest and the asset folder hold the same photographs', () => {
    const count = SHARE_CARD_SCENERY.length;
    expect(count).toBeGreaterThan(1);
    expect(manifest.photos).toHaveLength(count);
    expect(readdirSync(assetDir)).toHaveLength(count);
    expect([...imagesSource.matchAll(/require\(/g)]).toHaveLength(count);
  });

  it('has distinct photographs, in the manifest`s order, with the overlay strengths the build computed', () => {
    expect(new Set(SHARE_CARD_SCENERY.map((scenery) => scenery.id)).size).toBe(SHARE_CARD_SCENERY.length);
    expect(SHARE_CARD_SCENERY.map(({ id, overlayOpacity }) => ({ id, overlayOpacity })))
      .toEqual(manifest.photos.map(({ id, overlayOpacity }) => ({ id, overlayOpacity })));
    expect(manifest.photos.map((photo) => photo.theme)).toEqual(manifest.photos.map((_, index) => index + 1));
  });

  it('overlays stay subtle-to-moderate, never opaque, and only fade (never vanish) outside the text area', () => {
    for (const { id, overlayOpacity } of SHARE_CARD_SCENERY) {
      expect(overlayOpacity, id).toBeGreaterThanOrEqual(manifest.overlay.floor);
      expect(overlayOpacity, id).toBeLessThanOrEqual(0.8);
      expect(sceneryEdgeOpacity(overlayOpacity), id).toBeLessThanOrEqual(overlayOpacity);
      expect(sceneryEdgeOpacity(overlayOpacity), id).toBeGreaterThanOrEqual(0.3);
      expect(sceneryById(id).overlayOpacity).toBe(overlayOpacity);
    }
  });

  it('the card draws the overlay colour and the inks the overlay strengths were computed for', () => {
    expect(SHARE_CARD_SCENERY_OVERLAY_COLOR).toBe(manifest.overlay.color);
    expect([SCENERY_CARD_THEME.arabic, SCENERY_CARD_THEME.translation]).toEqual([manifest.overlay.ink, manifest.overlay.ink]);
    expect([SCENERY_CARD_THEME.reference, SCENERY_CARD_THEME.branding]).toEqual([manifest.overlay.secondaryInk, manifest.overlay.secondaryInk]);
  });
});

describe('the bundled files', () => {
  it('are exactly the manifest JPEGs, each 1080 x 1920, and the folder holds nothing else', () => {
    expect(readdirSync(assetDir).sort()).toEqual(manifest.photos.map((photo) => photo.file).sort());
    let total = 0;
    for (const photo of manifest.photos) {
      const bytes = readFileSync(resolve(assetDir, photo.file));
      expect(jpegSize(bytes), photo.file).toEqual({ width: 1080, height: 1920 });
      expect(photo.optimizedSize).toEqual([1080, 1920]);
      expect(bytes.length, photo.file).toBe(photo.bytes);
      expect(bytes.length, photo.file).toBeLessThan(900 * 1024);
      total += bytes.length;
    }
    expect(total).toBe(manifest.totalBytes);
    // About 350 KB a photograph on average; well under 400 KB keeps the bundle reasonable as the set grows.
    expect(total).toBeLessThan(manifest.photos.length * 400 * 1024);
  });

  it('every photograph is bundled with require() — never fetched — and each id points at its own file', () => {
    expect(imagesSource).not.toMatch(/https?:|uri\s*:/);
    const required = [...imagesSource.matchAll(/'([a-z-]+)': require\('\.\.\/\.\.\/assets\/share-backgrounds\/scenery\/([^']+)'\)/g)]
      .map(([, id, file]) => ({ id, file }));
    expect(required).toEqual(manifest.photos.map(({ id, file }) => ({ id, file })));
    for (const { file } of required) expect(statSync(resolve(assetDir, file)).isFile()).toBe(true);
  });

  it('the card and sheet make no network requests for backgrounds', () => {
    for (const path of ['src/components/ShareAyahCard.tsx', 'src/components/ShareAyahSheet.tsx', 'src/constants/shareCardScenery.ts']) {
      expect(readFileSync(resolve(mobile, path), 'utf-8'), path).not.toMatch(/fetch\(|https?:\/\/|uri:/);
    }
  });

  it('every photograph records its source, photographer, licence and original size', () => {
    expect(manifest.license).toMatchObject({ name: 'Unsplash License', url: 'https://unsplash.com/license' });
    for (const photo of manifest.photos) {
      expect(photo.sourceUrl, photo.id).toMatch(/^https:\/\/unsplash\.com\/photos\/[A-Za-z0-9_-]{11}$/);
      expect(photo.photographerUrl, photo.id).toMatch(/^https:\/\/unsplash\.com\/@/);
      expect(photo.photographer.length, photo.id).toBeGreaterThan(0);
      expect(photo.license).toBe('Unsplash License');
      // Never upscaled: the source covers the 1080 x 1920 crop.
      const [width, height] = photo.originalSize;
      expect(Math.max(1080 / width, 1920 / height), photo.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('random choice', () => {
  const ids = SHARE_CARD_SCENERY.map((scenery) => scenery.id);
  const randoms = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999999];

  it('the first pick of a session can be any photograph', () => {
    const picked = new Set(ids.map((_, index) => pickScenery(null, () => (index + 0.5) / ids.length)));
    expect(picked).toEqual(new Set(ids));
    for (const value of randoms) expect(ids).toContain(pickScenery(null, () => value));
  });

  it('a new pick is never the current photograph, whatever the random value', () => {
    for (const current of ids) {
      for (const value of randoms) {
        const next = pickScenery(current, () => value);
        expect(next).not.toBe(current);
        expect(ids).toContain(next);
      }
    }
  });

  it('every other photograph remains reachable from any current one', () => {
    for (const current of ids) {
      const others = ids.length - 1;
      const reachable = new Set(Array.from({ length: others }, (_, index) => pickScenery(current, () => (index + 0.5) / others)));
      expect(reachable.size).toBe(others);
      expect(reachable.has(current)).toBe(false);
    }
  });
});

describe('the seasonal additions: sakura, autumn and winter', () => {
  const SEASONAL = [
    [21, 'pink-sakura'], [22, 'sakura-sky'], [23, 'pink-roses'], [24, 'autumn-forest-path'], [25, 'autumn-lake'], [26, 'golden-autumn-valley'],
    [27, 'sakura-pathway'], [28, 'sakura-canopy'], [29, 'sakura-lake'], [30, 'maple-path'], [31, 'golden-riverbank'], [32, 'autumn-mountains'],
    [33, 'snowy-forest-path'], [34, 'snowy-mountain-valley'], [35, 'winter-lake'], [36, 'snowy-pines'], [37, 'fresh-snowfall'], [38, 'winter-dawn'],
  ] as const;

  it.each(SEASONAL)('#%s %s is registered, bundled and has a computed overlay', (theme, id) => {
    const photo = manifest.photos.find((entry) => entry.id === id)!;
    expect(photo.theme).toBe(theme);
    expect(photo.file).toBe(`${theme}-${id}.jpg`);
    expect(sceneryById(id).overlayOpacity).toBe(photo.overlayOpacity);
    expect(imagesSource).toContain(`'${id}': require('../../assets/share-backgrounds/scenery/${photo.file}')`);
  });

  it('New Background can reach every seasonal photograph from any current one, and never repeats', () => {
    const ids = SHARE_CARD_SCENERY.map((scenery) => scenery.id);
    for (const current of ids) {
      const others = ids.length - 1;
      const reachable = new Set(Array.from({ length: others }, (_, index) => pickScenery(current, () => (index + 0.5) / others)));
      expect(reachable.has(current)).toBe(false);
      for (const [, id] of SEASONAL) expect(reachable.has(id) || id === current).toBe(true);
    }
  });
});
