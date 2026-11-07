import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ExpoConfig } from 'expo/config';
import { describe, expect, it } from 'vitest';

import appConfig from '../app.config';
import appJson from '../app.json';
import packageJson from '../package.json';

/**
 * Qibla Direction, Stage 2: expo-location is configured for foreground, on-device location only (docs/qibla.md).
 * The plugin's own mods are run here in memory; the same result was checked with a disposable
 * `expo prebuild` (Android) and `expo config --type introspect` (iOS) on 2026-11-06.
 */

type Mod = (config: Record<string, unknown>) => Promise<{ modResults: unknown }>;
type WithMods = ExpoConfig & { mods?: { ios?: { infoPlist?: Mod }; android?: { manifest?: Mod } } };

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the plugin's CommonJS build, exactly as Expo loads it.
const withLocation = require('expo-location/plugin/build/withLocation').default as (config: ExpoConfig, props: unknown) => ExpoConfig;

const plugins = appJson.expo.plugins as unknown[];
const locationEntry = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location') as [string, Record<string, unknown>] | undefined;
const options = locationEntry?.[1] ?? {};
const blocked = appJson.expo.android.blockedPermissions as string[];

const iosRequest = { platform: 'ios', modName: 'infoPlist', projectRoot: '', platformProjectRoot: '', introspect: true };
const androidRequest = { platform: 'android', modName: 'manifest', projectRoot: '', platformProjectRoot: '', introspect: true };

async function infoPlistFrom(props: unknown): Promise<Record<string, unknown>> {
  const config = withLocation({ name: 'x', slug: 'x' }, props) as WithMods;
  const result = await config.mods!.ios!.infoPlist!({ modResults: { UIBackgroundModes: ['audio'] }, modRequest: iosRequest });
  return result.modResults as Record<string, unknown>;
}

/**
 * The permissions the plugin requests. In SDK 57, AndroidConfig.Permissions.withPermissions writes them to
 * `android.permissions`; prebuild's base manifest mod turns that list into <uses-permission> lines (checked in the
 * disposable prebuild: the generated manifest gained exactly these two plus the blocked entries).
 */
function requestedAndroidPermissions(props: unknown): string[] {
  const config = withLocation({ name: 'x', slug: 'x' }, props);
  return [...(config.android?.permissions ?? [])].sort();
}

/** The plugin's AndroidManifest mod (the foreground-service icon meta-data) must leave the manifest's permissions alone. */
async function manifestModPermissions(props: unknown): Promise<string[]> {
  const config = withLocation({ name: 'x', slug: 'x' }, props) as WithMods;
  const mod = config.mods?.android?.manifest;
  if (!mod) return [];
  const result = await mod({
    modResults: { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [{ $: { 'android:name': '.MainApplication' } }] } },
    modRequest: androidRequest,
  });
  const manifest = (result.modResults as { manifest: { 'uses-permission'?: { $: Record<string, string> }[]; application: { 'meta-data'?: unknown[] }[] } }).manifest;
  expect(manifest.application[0]['meta-data'] ?? []).toEqual([]); // no foreground-service icon
  return (manifest['uses-permission'] ?? []).map((p) => p.$['android:name']);
}

describe('expo-location dependency', () => {
  it('is the Expo SDK 57 version, pinned like the other Expo modules', () => {
    expect((packageJson.dependencies as Record<string, string>)['expo-location']).toMatch(/^~57\.0\.\d+$/);
    const installed = JSON.parse(readFileSync(resolve(__dirname, '../node_modules/expo-location/package.json'), 'utf-8')) as { version: string };
    expect(installed.version).toMatch(/^57\.0\./);
  });

  it('expo-task-manager is NOT installed: background location tasks (and LocationTaskService) stay unreachable', () => {
    expect(packageJson.dependencies).not.toHaveProperty('expo-task-manager');
  });
});

describe('expo-location plugin options (app.json)', () => {
  it('is listed once, with every background/motion/foreground-service option explicitly off', () => {
    expect(plugins.filter((p) => (Array.isArray(p) ? p[0] : p) === 'expo-location')).toHaveLength(1);
    expect(options).toEqual({
      locationWhenInUsePermission: expect.any(String),
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
      isAndroidMotionActivityEnabled: false,
    });
  });

  it('the iOS purpose string is one bilingual English/Arabic text: Qibla only, on this device, never sent or stored', () => {
    const text = options.locationWhenInUsePermission as string;
    expect(text).toContain('Quran Heals uses your location on this device only to find the Qibla direction. It is never sent or stored.');
    expect(text).toContain('موقعك على هذا الجهاز فقط لتحديد اتجاه القبلة، ولا يُرسَل ولا يُحفَظ.');
    expect(text).not.toMatch(/\$\(PRODUCT_NAME\)|Allow /); // never the plugin's generic default
  });
});

describe('generated iOS Info.plist', () => {
  it('adds only the When-In-Use string: no Always strings, no Motion string, no background location mode', async () => {
    const plist = await infoPlistFrom(options);
    expect(plist).toEqual({ UIBackgroundModes: ['audio'], NSLocationWhenInUseUsageDescription: options.locationWhenInUsePermission });
  });

  it('(control) without these options the plugin WOULD add the Always and Motion strings', async () => {
    const plist = await infoPlistFrom({});
    expect(plist).toHaveProperty('NSLocationAlwaysUsageDescription');
    expect(plist).toHaveProperty('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(plist).toHaveProperty('NSMotionUsageDescription');
  });

  it('adds no localisation (no ar.lproj route, so RTL and system-UI language on Arabic iPhones stay as they are)', () => {
    expect(appJson.expo).not.toHaveProperty('locales');
    expect(appJson.expo.ios.infoPlist).not.toHaveProperty('CFBundleLocalizations');
    // expo-localization stays unconfigured (no supportsRTL/forcesRTL), exactly as before.
    expect(plugins).toContain('expo-localization');
    expect(plugins.some((p) => Array.isArray(p) && p[0] === 'expo-localization')).toBe(false);
  });

  it('survives the hosted (preview/production) build policy', () => {
    const previous = process.env.QURAN_HEALS_API_URL_POLICY;
    process.env.QURAN_HEALS_API_URL_POLICY = 'hosted';
    try {
      const config = appConfig({ config: structuredClone(appJson.expo) as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
      expect(config.plugins).toContainEqual(locationEntry);
    } finally {
      if (previous === undefined) delete process.env.QURAN_HEALS_API_URL_POLICY;
      else process.env.QURAN_HEALS_API_URL_POLICY = previous;
    }
  });
});

describe('generated Android permissions', () => {
  it('the plugin asks for coarse and fine location only (no background, no foreground service, no activity recognition)', async () => {
    expect(requestedAndroidPermissions(options)).toEqual(['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION']);
    expect(await manifestModPermissions(options)).toEqual([]);
  });

  it('(control) with background location on, the plugin WOULD add background and foreground-service permissions', () => {
    expect(requestedAndroidPermissions({ isAndroidBackgroundLocationEnabled: true })).toEqual(
      expect.arrayContaining(['android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION']),
    );
  });

  it('blocks background location, the location foreground-service permission and activity recognition, from any library', () => {
    for (const permission of [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
      'com.google.android.gms.permission.ACTIVITY_RECOGNITION',
    ]) {
      expect(blocked).toContain(permission);
    }
  });

  it('keeps BOTH coarse and fine location until approximate-only is proven on real phones (owner decision 8)', () => {
    expect(blocked).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(blocked).not.toContain('android.permission.ACCESS_COARSE_LOCATION');
  });

  it('keeps the existing blocked media permissions and the audio foreground service untouched', () => {
    for (const permission of ['android.permission.READ_MEDIA_VISUAL_USER_SELECTED', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO']) {
      expect(blocked).toContain(permission);
    }
    expect(blocked).not.toContain('android.permission.FOREGROUND_SERVICE');
    expect(blocked).not.toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
  });
});
