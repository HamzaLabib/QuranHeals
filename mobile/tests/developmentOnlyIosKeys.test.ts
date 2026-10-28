import type { ExpoConfig } from 'expo/config';
import { afterEach, describe, expect, it } from 'vitest';

import appConfig, { withoutDevelopmentOnlyIosKeys } from '../app.config';
import appJson from '../app.json';

/**
 * Release audit R2: preview/production (hosted) builds carry none of the development-only iOS keys; development
 * builds keep them. Also checked with `QURAN_HEALS_API_URL_POLICY=hosted npx expo config --type introspect`. The
 * archive's final Info.plist (after expo-dev-launcher's Release build phase) needs a real build to confirm.
 */
type InfoPlistMod = (config: Record<string, unknown>) => Promise<{ modResults: Record<string, unknown> }>;
const infoPlistModOf = (config: ExpoConfig) => (config as ExpoConfig & { mods?: { ios?: { infoPlist?: InfoPlistMod } } }).mods?.ios?.infoPlist;
const request = { platform: 'ios', modName: 'infoPlist', projectRoot: '', platformProjectRoot: '', introspect: true };
const resolve = () => appConfig({ config: structuredClone(appJson.expo) as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });

const policy = process.env.QURAN_HEALS_API_URL_POLICY;
afterEach(() => {
  if (policy === undefined) delete process.env.QURAN_HEALS_API_URL_POLICY;
  else process.env.QURAN_HEALS_API_URL_POLICY = policy;
});

describe('development-only iOS keys', () => {
  it('a hosted build drops the local-network string and ATS local networking from app.json, and keeps the rest', () => {
    const config = withoutDevelopmentOnlyIosKeys(structuredClone(appJson.expo) as ExpoConfig);
    const infoPlist = config.ios!.infoPlist!;
    expect(infoPlist.NSLocalNetworkUsageDescription).toBeUndefined();
    expect(infoPlist.NSAppTransportSecurity).toBeUndefined();
    expect(infoPlist.NSPhotoLibraryAddUsageDescription).toBe(appJson.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription);
    expect(infoPlist.ITSAppUsesNonExemptEncryption).toBe(appJson.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption);
  });

  it('its Info.plist mod removes the unused Face ID string and pins HTTPS-only ATS (never arbitrary loads)', async () => {
    const mod = infoPlistModOf(withoutDevelopmentOnlyIosKeys({ name: 'x', slug: 'x' }))!;
    const result = await mod({
      modResults: { NSFaceIDUsageDescription: 'Allow $(PRODUCT_NAME) to access your Face ID biometric data.', NSAppTransportSecurity: { NSAllowsArbitraryLoads: true }, UIBackgroundModes: ['audio'] },
      modRequest: request,
    });
    expect(result.modResults).toEqual({ NSAppTransportSecurity: { NSAllowsArbitraryLoads: false }, UIBackgroundModes: ['audio'] });
  });

  it('is applied for hosted builds only', () => {
    process.env.QURAN_HEALS_API_URL_POLICY = 'hosted';
    expect(resolve().ios!.infoPlist!.NSLocalNetworkUsageDescription).toBeUndefined();
    process.env.QURAN_HEALS_API_URL_POLICY = 'local';
    expect(resolve().ios!.infoPlist!.NSLocalNetworkUsageDescription).toBe(appJson.expo.ios.infoPlist.NSLocalNetworkUsageDescription);
  });

  it('the app never asks SecureStore for biometrics, so the Face ID string describes nothing', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
    for (const file of walk(join(__dirname, '..', 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/requireAuthentication|expo-local-authentication/);
    }
  });
});
