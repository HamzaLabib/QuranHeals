import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExpoConfig } from 'expo/config';
import { AndroidConfig } from 'expo/config-plugins';
import { describe, expect, it } from 'vitest';

import appConfig from '../app.config';
import appJson from '../app.json';
import withAdvanceWidthText from '../plugins/withAdvanceWidthText';

/**
 * Android TextViews keep the advance-based layout (plugins/withAdvanceWidthText.js): with the bounds-based one of
 * targetSdk 35+, the Mushaf's centred glyph copies were drawn by half their overhang to the right (page 61 «عَلَىٰٓ»).
 * The plugin is its own file listed in app.json, so the fingerprint runtime version tracks it (docs/release-builds.md).
 */
const PLUGIN = './plugins/withAdvanceWidthText';
type Mods = { android?: { styles?: StylesMod }; ios?: Record<string, unknown> };
type StylesMod = (config: Record<string, unknown>) => Promise<{ modResults: AndroidConfig.Resources.ResourceXML }>;
const modsOf = (config: ExpoConfig) => (config as ExpoConfig & { mods?: Mods }).mods;

/** The theme as Expo's template generates it (styles.xml after `expo prebuild`, 2026-10-16). */
const generatedStyles = (): AndroidConfig.Resources.ResourceXML => ({
  resources: {
    style: [
      {
        $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
        item: [
          { $: { name: 'android:editTextBackground' }, _: '@drawable/rn_edit_text_material' },
          { $: { name: 'colorPrimary' }, _: '@color/colorPrimary' },
        ],
      },
    ],
  },
});
const request = { platform: 'android', modName: 'styles', projectRoot: '', platformProjectRoot: '', introspect: true };
const applyTo = async (styles: AndroidConfig.Resources.ResourceXML, config: ExpoConfig = withAdvanceWidthText({ name: 'x', slug: 'x' } as ExpoConfig)) =>
  (await modsOf(config)!.android!.styles!({ modResults: styles, modRequest: request })).modResults;
const style = (xml: AndroidConfig.Resources.ResourceXML, name: string) => xml.resources.style?.filter((s) => s.$.name === name) ?? [];

describe('Android text: advance-based width (no useBoundsForWidth)', () => {
  it('is registered once in app.json, as a file of this project', () => {
    expect(appJson.expo.plugins.filter((plugin) => plugin === PLUGIN)).toHaveLength(1);
    expect(existsSync(resolve(__dirname, '..', `${PLUGIN}.js`))).toBe(true);
  });

  it("points the app theme's TextView style at AppCompat's own, with only useBoundsForWidth=false (API 35+) added", async () => {
    const xml = await applyTo(generatedStyles());
    expect(AndroidConfig.Styles.getStylesGroupAsObject(xml, AndroidConfig.Styles.getAppThemeGroup())).toEqual({
      'android:editTextBackground': '@drawable/rn_edit_text_material',
      colorPrimary: '@color/colorPrimary',
      'android:textViewStyle': '@style/QuranHealsTextView',
    });
    expect(style(xml, 'AppTheme')[0].$.parent).toBe('Theme.AppCompat.DayNight.NoActionBar');
    const [textView] = style(xml, 'QuranHealsTextView');
    expect(textView.$.parent).toBe('Widget.AppCompat.TextView');
    expect(textView.item).toEqual([{ $: { name: 'android:useBoundsForWidth', 'tools:targetApi': '35' }, _: 'false' }]);
  });

  it('applied twice, adds nothing twice', async () => {
    const xml = await applyTo(await applyTo(generatedStyles()));
    expect(style(xml, 'QuranHealsTextView')).toHaveLength(1);
    expect(style(xml, 'QuranHealsTextView')[0].item).toHaveLength(1);
    expect(style(xml, 'AppTheme')[0].item.filter((item) => item.$.name === 'android:textViewStyle')).toHaveLength(1);
  });

  it('changes nothing on iOS', () => {
    const mods = modsOf(withAdvanceWidthText({ name: 'x', slug: 'x' } as ExpoConfig));
    expect(mods?.ios).toBeUndefined();
    expect(Object.keys(mods?.android ?? {})).toEqual(['styles']);
  });

  it('app.config.ts does not apply it a second time: only the app.json entry does', () => {
    const resolved = appConfig({ config: appJson.expo as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
    expect(resolved.plugins).toEqual(appJson.expo.plugins);
    expect(modsOf(resolved)?.android?.styles).toBeUndefined();
  });
});
