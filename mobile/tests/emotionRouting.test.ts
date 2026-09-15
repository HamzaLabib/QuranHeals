import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Structural (source-scan) proof that the emotion route key is passed
// through unmodified end to end, alongside the plain formatting-logic proof
// in emotionLabel.test.ts. The screens themselves are .tsx React Native
// components and cannot be rendered in this project's plain-Node vitest
// environment (see emotionIcons.test.ts's note on the same constraint), so
// — matching the source-scan pattern already used for structural proofs
// elsewhere in this repository — this reads the actual screen source and
// asserts the exact identifier flows, rather than re-deriving the key by
// pattern and hoping it matches.
const INDEX_SCREEN_PATH = resolve(__dirname, '../src/app/index.tsx');
const AYAH_SCREEN_PATH = resolve(__dirname, '../src/app/ayah/[emotion].tsx');

describe('Routing safety: the emotion key reaches the API/history/navigation layer unmodified', () => {
  it('the emotion picker screen navigates with the raw emotion.key, and separately forwards emotion.names (the localized display map) as JSON for display only', () => {
    const source = readFileSync(INDEX_SCREEN_PATH, 'utf-8');
    expect(source).toMatch(/params:\s*{\s*emotion:\s*emotion\.key,\s*namesJson:\s*JSON\.stringify\(emotion\.names\)\s*}/);
  });

  it('the ayah screen derives emotionKey directly from the route param, with no string transformation applied to it', () => {
    const source = readFileSync(AYAH_SCREEN_PATH, 'utf-8');
    // emotionKey is assigned only from rawEmotion (the raw params.emotion
    // value) via a type-narrowing ternary — never fed through .split/.map/
    // .toUpperCase/.toLowerCase/.replace or similar.
    const assignment = source.match(/const emotionKey =\s*([\s\S]*?);/);
    expect(assignment, 'could not locate the emotionKey assignment').not.toBeNull();
    const body = assignment![1];
    expect(body).toMatch(/rawEmotion/);
    expect(body).not.toMatch(/\.split\(|\.replace\(|\.toUpperCase\(|\.toLowerCase\(|\.charAt\(/);
  });

  it('getRandomAyah and rememberAyahForEmotion are called with emotionKey, never with the human-readable label', () => {
    const source = readFileSync(AYAH_SCREEN_PATH, 'utf-8');
    expect(source).toMatch(/getRandomAyah\(emotionKey,/);
    expect(source).toMatch(/rememberAyahForEmotion\(emotionKey,/);
    expect(source).not.toMatch(/getRandomAyah\(readableEmotion/);
    expect(source).not.toMatch(/rememberAyahForEmotion\(readableEmotion/);
  });

  it('getRecentVerseKeyState (favorites/history exclusion) also uses the stable emotionKey, not the display label', () => {
    const source = readFileSync(AYAH_SCREEN_PATH, 'utf-8');
    expect(source).toMatch(/getRecentVerseKeyState\(emotionKey\)/);
  });

  it('readableEmotion (the display label) is computed from resolveLocalizedEmotionName, and is never itself fed back into emotionKey, the API calls, or history storage', () => {
    const source = readFileSync(AYAH_SCREEN_PATH, 'utf-8');
    expect(source).toMatch(/resolveLocalizedEmotionName\(names, locale, emotionKey\)/);
    // readableEmotion may only appear where it's actually displayed/shared —
    // never passed to any of the key-consuming calls.
    const keyConsumingCalls = ['getRandomAyah(', 'rememberAyahForEmotion(', 'getRecentVerseKeyState('];
    keyConsumingCalls.forEach((call) => {
      const callSite = source.indexOf(call);
      expect(callSite).toBeGreaterThan(-1);
      const argsSlice = source.slice(callSite, callSite + call.length + 40);
      expect(argsSlice).not.toMatch(/readableEmotion/);
    });
  });
});
