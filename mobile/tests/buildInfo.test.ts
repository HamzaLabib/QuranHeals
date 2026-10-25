import { describe, expect, it } from 'vitest';

import { buildInfoLine } from '@/utils/buildInfo';

/** The build line on Quran Sources & Credits (utils/buildInfo.ts), copied into device-test records. */
const runtimeVersion = '80848c9e4cc30447987d23e37394da285e08720c';

describe('build info line', () => {
  it('names the version, runtime fingerprint, OTA update and exact-seek method', () => {
    expect(buildInfoLine({ version: '1.0.0', updates: { runtimeVersion, updateId: 'f00dfeed-0000', isEmbeddedLaunch: false }, seek: 'index' }))
      .toBe('v1.0.0 · runtime 80848c9e · update f00dfeed · exact MP3 seek: index');
  });

  it('says "embedded" for the binary\'s own bundle, and "none" for an unpatched player', () => {
    expect(buildInfoLine({ version: '1.0.0', updates: { runtimeVersion, updateId: 'f00dfeed-0000', isEmbeddedLaunch: true }, seek: null }))
      .toBe('v1.0.0 · runtime 80848c9e · embedded · exact MP3 seek: none');
  });

  it('without expo-updates (tests, web) the identifiers are unknown and nothing throws', () => {
    expect(buildInfoLine({ version: undefined, updates: {}, seek: 'avfoundation-precise' })).toBe('v? · runtime unknown · embedded · exact MP3 seek: avfoundation-precise');
    expect(() => buildInfoLine()).not.toThrow();
    expect(buildInfoLine()).toMatch(/exact MP3 seek: none$/); // vitest: no native player
  });
});
