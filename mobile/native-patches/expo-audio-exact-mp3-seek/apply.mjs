// Quran Heals native patch for expo-audio 57.0.5: exact seeking in VBR MP3 files, for sources the app marks only.
// NOT applied by any install hook: run it on purpose before a native build the owner has approved (README.md).
//
//   node native-patches/expo-audio-exact-mp3-seek/apply.mjs --check    every anchor found, nothing written (default)
//   node native-patches/expo-audio-exact-mp3-seek/apply.mjs --apply    edit node_modules/expo-audio (keeps *.qh-orig)
//   node native-patches/expo-audio-exact-mp3-seek/apply.mjs --revert   restore the *.qh-orig copies
//
// Each edit replaces one exact, unique text and refuses to run if expo-audio is not 57.0.5 or a text is not found
// exactly once; --apply is idempotent (an applied file is recognised and left alone).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..', '..', 'node_modules', 'expo-audio');
const VERSION = '57.0.5';
const MARK = 'Quran Heals patch';
const HEADER = 'X-Quran-Heals-Mp3-Seek';

const EDITS = [
  {
    file: 'android/build.gradle',
    find: '  implementation "androidx.media3:media3-exoplayer:$androidxMedia3Version"\n',
    replace: '  implementation "androidx.media3:media3-exoplayer:$androidxMedia3Version"\n  // Quran Heals patch: Mp3Extractor flags (exact VBR MP3 seeking)\n  implementation "androidx.media3:media3-extractor:$androidxMedia3Version"\n',
  },
  {
    file: 'android/src/main/java/expo/modules/audio/AudioModule.kt',
    find: 'import androidx.media3.exoplayer.source.ProgressiveMediaSource\n',
    replace: 'import androidx.media3.exoplayer.source.ProgressiveMediaSource\nimport androidx.media3.extractor.DefaultExtractorsFactory\nimport androidx.media3.extractor.mp3.Mp3Extractor\n',
  },
  {
    file: 'android/src/main/java/expo/modules/audio/AudioModule.kt',
    find: '  override fun definition() = ModuleDefinition {\n    Name("ExpoAudio")\n',
    replace: '  override fun definition() = ModuleDefinition {\n    Name("ExpoAudio")\n    // Quran Heals patch: this binary seeks marked VBR MP3 sources exactly (XingTocStrippingDataSource).\n    Constants("quranHealsExactMp3Seek" to "index")\n',
  },
  {
    file: 'android/src/main/java/expo/modules/audio/AudioModule.kt',
    find: [
      '    val preloadedBytes = AudioPreloadManager.get(uriString)',
      '    val factory: DataSource.Factory = if (preloadedBytes != null) {',
      '      InMemoryDataSourceFactory(preloadedBytes)',
      '    } else {',
      '      when (uri.scheme) {',
      '        "http", "https" -> httpDataSourceFactory(source.headers)',
      '        else -> DefaultDataSource.Factory(context)',
      '      }',
      '    }',
      '    return buildMediaSourceFactory(factory, mediaItem)',
      '',
    ].join('\n'),
    replace: [
      '    // Quran Heals patch: a source marked for exact MP3 seeking plays through XingTocStrippingDataSource with index',
      '    // seeking; the marker header is never sent. Every other source is built exactly as before.',
      '    val exactMp3Seek = source.headers?.get(XingTocStrippingDataSource.MARKER_HEADER) == XingTocStrippingDataSource.MARKER_VALUE',
      '    val requestHeaders = source.headers?.filterKeys { it != XingTocStrippingDataSource.MARKER_HEADER }',
      '    val preloadedBytes = AudioPreloadManager.get(uriString)',
      '    val factory: DataSource.Factory = if (preloadedBytes != null) {',
      '      InMemoryDataSourceFactory(preloadedBytes)',
      '    } else {',
      '      when (uri.scheme) {',
      '        "http", "https" -> httpDataSourceFactory(requestHeaders)',
      '        else -> DefaultDataSource.Factory(context)',
      '      }',
      '    }',
      '    if (exactMp3Seek) {',
      '      val extractors = DefaultExtractorsFactory().setMp3ExtractorFlags(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING)',
      '      return ProgressiveMediaSource.Factory(XingTocStrippingDataSource.Factory(factory), extractors).createMediaSource(mediaItem)',
      '    }',
      '    return buildMediaSourceFactory(factory, mediaItem)',
      '',
    ].join('\n'),
  },
  {
    file: 'ios/AudioUtils.swift',
    find: '    var options: [String: Any]?\n    if let headers = source.headers {\n      options = ["AVURLAssetHTTPHeaderFieldsKey": headers]\n    }\n',
    replace: [
      '    var options: [String: Any]?',
      `    // ${MARK}: a source marked for exact MP3 seeking asks AVFoundation for precise timing; the marker is never sent.`,
      `    let exactMp3Seek = source.headers?["${HEADER}"] == "index"`,
      '    if let headers = source.headers {',
      `      options = ["AVURLAssetHTTPHeaderFieldsKey": headers.filter { $0.key != "${HEADER}" }]`,
      '    }',
      '    if exactMp3Seek {',
      '      options = (options ?? [:]).merging([AVURLAssetPreferPreciseDurationAndTimingKey: true]) { $1 }',
      '    }',
      '',
    ].join('\n'),
  },
  {
    file: 'ios/AudioModule.swift',
    find: '  public func definition() -> ModuleDefinition {\n    Name("ExpoAudio")\n',
    replace: `  public func definition() -> ModuleDefinition {\n    Name("ExpoAudio")\n    // ${MARK}: this binary asks AVFoundation for precise timing on marked MP3 sources.\n    Constants(["quranHealsExactMp3Seek": "avfoundation-precise"])\n`,
  },
];
const COPIES = [{ from: 'android/XingTocStrippingDataSource.java', to: 'android/src/main/java/expo/modules/audio/XingTocStrippingDataSource.java' }];

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : 'check';
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
if (version !== VERSION) throw new Error(`expo-audio ${version} installed; this patch is for ${VERSION} only`);
const count = (s, t) => s.split(t).length - 1;

if (mode === 'revert') {
  for (const f of new Set(EDITS.map((e) => e.file))) {
    const p = path.join(pkg, f);
    if (fs.existsSync(`${p}.qh-orig`)) { fs.copyFileSync(`${p}.qh-orig`, p); fs.rmSync(`${p}.qh-orig`); console.log(`restored ${f}`); }
  }
  for (const c of COPIES) { const p = path.join(pkg, c.to); if (fs.existsSync(p)) { fs.rmSync(p); console.log(`removed ${c.to}`); } }
  process.exit(0);
}

const files = new Map();
for (const e of EDITS) {
  const p = path.join(pkg, e.file);
  const text = files.get(p) ?? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (count(text, e.replace) === 1) { files.set(p, text); console.log(`already applied: ${e.file}`); continue; }
  if (count(text, e.find) !== 1) throw new Error(`${e.file}: anchor found ${count(text, e.find)} times (expected exactly 1): not patched`);
  files.set(p, text.replace(e.find, e.replace));
  console.log(`${mode === 'apply' ? 'patching' : 'anchor ok'}: ${e.file}`);
}
// Expo SDK 57 links expo-audio as a PRECOMPILED library (node_modules/expo-audio/local-maven-repo, and an xcframework
// on iOS): the patched sources are compiled only when the app's package.json asks for it. Found 2026-10-24: a build
// without this setting contained none of the patch.
const appPkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
const fromSource = (p) => (appPkg.expo?.autolinking?.[p]?.buildFromSource ?? []).includes('expo-audio');
for (const p of ['android', 'ios']) if (!fromSource(p)) console.log(`NOTE: package.json expo.autolinking.${p}.buildFromSource lacks "expo-audio": a ${p} build would use the precompiled, unpatched expo-audio`);
if (mode === 'check') { console.log('check passed: nothing written'); process.exit(0); }
for (const [p, text] of files) {
  if (!fs.existsSync(`${p}.qh-orig`)) fs.copyFileSync(p, `${p}.qh-orig`);
  fs.writeFileSync(p, text);
}
for (const c of COPIES) fs.copyFileSync(path.join(here, c.from), path.join(pkg, c.to));
console.log('applied: rebuild the native app to use it (a JS reload is not enough)');
