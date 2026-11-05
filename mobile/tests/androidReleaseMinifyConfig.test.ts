import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExpoConfig } from 'expo/config';
import type { AndroidConfig } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';

import appJson from '../app.json';
import withReleaseMinify from '../plugins/withReleaseMinify';

/**
 * Android release builds go through R8 (plugins/withReleaseMinify.js): without it they were dexed by D8 alone and
 * Play reported "Obfuscation 1%". Resource shrinking stays off so the res/raw Mushaf fonts the JS bundle looks up by
 * name are never dropped. The plugin is its own file listed in app.json, so the fingerprint runtime version tracks it.
 */
const PLUGIN = './plugins/withReleaseMinify';
type GradleProperties = AndroidConfig.Properties.PropertiesItem[];
type Mods = { android?: { gradleProperties?: GradlePropertiesMod }; ios?: Record<string, unknown> };
type GradlePropertiesMod = (config: Record<string, unknown>) => Promise<{ modResults: GradleProperties }>;
const modsOf = (config: ExpoConfig) => (config as ExpoConfig & { mods?: Mods }).mods;

/** Part of gradle.properties as Expo's template generates it (`expo prebuild`, 2026-11-02): neither key is set. */
const generatedProperties = (): GradleProperties => [
  { type: 'comment', value: 'Use this property to enable or disable the Hermes JS engine.' },
  { type: 'property', key: 'hermesEnabled', value: 'true' },
  { type: 'property', key: 'newArchEnabled', value: 'true' },
];
const request = { platform: 'android', modName: 'gradleProperties', projectRoot: '', platformProjectRoot: '', introspect: true };
const applyTo = async (properties: GradleProperties) =>
  (await modsOf(withReleaseMinify({ name: 'x', slug: 'x' } as ExpoConfig))!.android!.gradleProperties!({ modResults: properties, modRequest: request })).modResults;
const valueOf = (properties: GradleProperties, key: string) =>
  properties.filter((item) => item.type === 'property' && item.key === key).map((item) => (item as { value: string }).value);

describe('Android release builds: R8 on, resource shrinking off', () => {
  it('is registered once in app.json, as a file of this project', () => {
    expect(appJson.expo.plugins.filter((plugin) => plugin === PLUGIN)).toHaveLength(1);
    expect(existsSync(resolve(__dirname, '..', `${PLUGIN}.js`))).toBe(true);
  });

  it('enables minify in release builds and pins resource shrinking off, leaving the other properties alone', async () => {
    const properties = await applyTo(generatedProperties());
    expect(valueOf(properties, 'android.enableMinifyInReleaseBuilds')).toEqual(['true']);
    expect(valueOf(properties, 'android.enableShrinkResourcesInReleaseBuilds')).toEqual(['false']);
    expect(properties.slice(0, 3)).toEqual(generatedProperties());
  });

  it('overrides an existing value instead of adding a second line, and applied twice adds nothing twice', async () => {
    const properties = await applyTo(await applyTo([
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
      { type: 'property', key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
    ]));
    expect(properties).toEqual([
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
      { type: 'property', key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'false' },
    ]);
  });

  it('changes nothing on iOS', () => {
    const mods = modsOf(withReleaseMinify({ name: 'x', slug: 'x' } as ExpoConfig));
    expect(mods?.ios).toBeUndefined();
    expect(Object.keys(mods?.android ?? {})).toEqual(['gradleProperties']);
  });
});
