const { withGradleProperties } = require('expo/config-plugins');

/**
 * Turns on R8 (code shrinking + obfuscation) for Android release builds, which the Expo template leaves off
 * (android/app/build.gradle: `minifyEnabled` reads android.enableMinifyInReleaseBuilds, default false). Without it
 * every release was dexed by D8 alone (BUNDLE-METADATA/com.android.tools/d8.json in vc3–vc5), so only the
 * pre-obfuscated Play services/Firebase classes counted and Play reported "Obfuscation 1%". Debug builds and the
 * development client are untouched (release buildType only). AGP puts R8's mapping file into the AAB, so Play
 * still deobfuscates crash reports. Keep rules come from the libraries' own consumer rules and the template's
 * proguard-rules.pro.
 *
 * Resource shrinking stays explicitly off: the 604 Mushaf page fonts and the other `require()`d assets are res/raw
 * and drawable resources that React Native looks up by name from the JS bundle, which the resource shrinker
 * cannot see, so it could drop them.
 *
 * Its own file, listed in app.json `plugins`, so the fingerprint runtime version tracks it. Android only.
 */
const RELEASE_BUILD_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'false',
};

const withReleaseMinify = (config) =>
  withGradleProperties(config, (mod) => {
    for (const [key, value] of Object.entries(RELEASE_BUILD_PROPERTIES)) {
      const existing = mod.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else mod.modResults.push({ type: 'property', key, value });
    }
    return mod;
  });

module.exports = withReleaseMinify;
