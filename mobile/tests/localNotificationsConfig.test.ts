import type { ExpoConfig } from 'expo/config';
import { describe, expect, it } from 'vitest';

import appConfig, { withoutPushEntitlement } from '../app.config';
import appJson from '../app.json';

/**
 * The reminders are local notifications only (docs/notifications.md): the
 * unused iOS push entitlement that expo-notifications' config plugin adds is
 * removed again (app.config.ts). Also verified for the real app config with
 * `npx expo config --type introspect` (read-only: no native project, no build).
 */
type EntitlementsMod = (config: Record<string, unknown>) => Promise<{ modResults: Record<string, unknown> }>;
const entitlementsModOf = (config: ExpoConfig) => (config as ExpoConfig & { mods?: { ios?: { entitlements?: EntitlementsMod } } }).mods?.ios?.entitlements;

const ENTITLEMENTS = {
  'aps-environment': 'development',
  'com.apple.developer.applesignin': ['Default'],
  'com.apple.developer.associated-domains': ['applinks:quran-heals-api.onrender.com'],
};
const request = { platform: 'ios', modName: 'entitlements', projectRoot: '', platformProjectRoot: '', introspect: true };

describe('Local notifications only: no iOS push entitlement', () => {
  it('removes aps-environment and keeps every other entitlement', async () => {
    const mod = entitlementsModOf(withoutPushEntitlement({ name: 'x', slug: 'x' } as ExpoConfig))!;
    const result = await mod({ modResults: { ...ENTITLEMENTS }, modRequest: request });
    expect(result.modResults).toEqual({ 'com.apple.developer.applesignin': ['Default'], 'com.apple.developer.associated-domains': ['applinks:quran-heals-api.onrender.com'] });
  });

  it('the app config applies it before the app.json plugins (so it runs after them), and keeps every listed plugin', async () => {
    const resolved = appConfig({ config: appJson.expo as never, projectRoot: '', staticConfigPath: null, packageJsonPath: null });
    expect(resolved.plugins).toEqual(appJson.expo.plugins);
    expect(resolved.plugins).toContainEqual(['expo-notifications', expect.objectContaining({ icon: './assets/images/android-icon-monochrome.png' })]);
    const mod = entitlementsModOf(resolved)!;
    expect(typeof mod).toBe('function');
    const result = await mod({ modResults: { ...ENTITLEMENTS }, modRequest: request });
    expect(result.modResults['aps-environment']).toBeUndefined();
  });
});
