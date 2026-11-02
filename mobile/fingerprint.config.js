/**
 * @expo/fingerprint (runtimeVersion policy "fingerprint", app.json) normally hashes only native inputs. The 604 QCF V1
 * page fonts are bundled assets: an OTA update that adds or changes them must not reach a binary built without them
 * (expo-updates would download every font, ~95 MB, at launch, past the Mushaf's Wi-Fi rules). Hashing their pin file
 * gives each font set its own runtime version, so a new font set ships only in a new store build.
 *
 * @type {import('@expo/fingerprint').Config}
 */
module.exports = {
  extraSources: [{ type: 'file', filePath: 'assets/mushaf/qpc-v1/fonts.lock.json', reasons: ['bundledMushafFonts'] }],
};
