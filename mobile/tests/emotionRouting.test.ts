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
// The actual emotionKey → API/history plumbing now lives in the shared
// AyahExperience component (extracted by the general-Quran-flow follow-up
// so app/ayah/[emotion].tsx and app/ayah/general.tsx can share it) — see
// AyahExperience.tsx's own doc comment.
const AYAH_EXPERIENCE_PATH = resolve(__dirname, '../src/components/AyahExperience.tsx');

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

  it('getRandomAyah is called with source.emotionKey (emotion mode only), never with the human-readable label', () => {
    const source = readFileSync(AYAH_EXPERIENCE_PATH, 'utf-8');
    expect(source).toMatch(/getRandomAyah\(source\.emotionKey, exclude\)/);
    expect(source).not.toMatch(/getRandomAyah\(headerTitle/);
    expect(source).not.toMatch(/getRandomAyah\(readableEmotion/);
  });

  it('recordShownAyah and getExcludedVerseKeys (10-minute recent-history exclusion) use historyKey — source.emotionKey in emotion mode, the reserved general-flow key in general mode — never the display label', () => {
    const source = readFileSync(AYAH_EXPERIENCE_PATH, 'utf-8');
    expect(source).toMatch(/getExcludedVerseKeys\(historyKey\)/);
    expect(source).toMatch(/recordShownAyah\(historyKey, nextAyah\)/);
    expect(source).toMatch(/const historyKey = source\.mode === 'emotion' \? source\.emotionKey : GENERAL_QURAN_HISTORY_KEY;/);
    expect(source).not.toMatch(/getExcludedVerseKeys\(headerTitle/);
    expect(source).not.toMatch(/recordShownAyah\(headerTitle/);
  });

  it('headerTitle (the display label) is computed from resolveLocalizedEmotionName in emotion mode, and is never itself fed back into emotionKey/historyKey, the API calls, or history storage', () => {
    const source = readFileSync(AYAH_EXPERIENCE_PATH, 'utf-8');
    expect(source).toMatch(/resolveLocalizedEmotionName\(source\.names, locale, source\.emotionKey\)/);
    // headerTitle may only appear where it's actually displayed — never
    // passed to any of the key-consuming calls.
    // General mode's key-consuming calls used to be the single atomic
    // getRandomGeneralAyah(exclude); it's now the separated
    // resolveGeneralVerseKey(exclude) + getAyah(verseKey) pair (see
    // AyahExperience's doc comment on why selection and content-load are
    // kept as two separate awaits).
    const keyConsumingCalls = ['getRandomAyah(', 'recordShownAyah(', 'getExcludedVerseKeys(', 'resolveGeneralVerseKey(', 'getAyah('];
    keyConsumingCalls.forEach((call) => {
      const callSite = source.indexOf(call);
      expect(callSite).toBeGreaterThan(-1);
      const argsSlice = source.slice(callSite, callSite + call.length + 40);
      expect(argsSlice).not.toMatch(/headerTitle/);
    });
  });
});
