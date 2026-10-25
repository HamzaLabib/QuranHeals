// Quran Heals native patch for expo-audio 57.0.5 (ANDROID ONLY): the app owns its audio. Closing the app from Recents
// stops playback for good, a car or headset cannot bring it back afterwards, and losing the headphones / Bluetooth
// route pauses (as iOS does). iOS sources are not touched. Applied by mobile/package.json's postinstall and checked by
// eas-build-post-install (--verify), like ../expo-audio-exact-mp3-seek.
//
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --check    every anchor found, nothing written
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --apply    edit node_modules/expo-audio (keeps *.qh-orig)
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --verify   fail unless applied in full and Android
//                                                                                 builds expo-audio from source
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --revert   restore the *.qh-orig copies
//
// Each edit replaces one exact, unique text and refuses to run if expo-audio is not 57.0.5 or a text is not found
// exactly once; --apply is idempotent (an applied file is recognised and left alone). See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..', '..', 'node_modules', 'expo-audio');
const VERSION = '57.0.5';
const SERVICE = 'android/src/main/java/expo/modules/audio/service/AudioControlsService.kt';
const PLAYER = 'android/src/main/java/expo/modules/audio/AudioPlayer.kt';

const EDITS = [
  {
    // Headphones unplugged or a Bluetooth device (a car) disconnected: ExoPlayer pauses instead of carrying on through
    // the phone's speaker. The app's engine follows the pause (engine.ts followDevice).
    file: PLAYER,
    find: '    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n',
    replace: '    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n    // Quran Heals patch: headphones or Bluetooth (a car) gone: pause, never the phone\'s speaker.\n    .setHandleAudioBecomingNoisy(true)\n',
  },
  {
    // Every player joins the gate; while it is closed, any play (JavaScript, a notification, a session, a car) is
    // reverted on the spot.
    file: PLAYER,
    find: '  init {\n    installPlayerListeners()\n',
    replace: [
      '  init {',
      '    installPlayerListeners()',
      '    // Quran Heals patch: closed from Recents (QuranHealsPlaybackGate): no play from anyone until the app is opened again.',
      '    QuranHealsPlaybackGate.register(this, context)',
      '    ref.addListener(object : Player.Listener {',
      '      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {',
      '        if (playWhenReady && QuranHealsPlaybackGate.closed) ref.pause()',
      '      }',
      '    })',
      '',
    ].join('\n'),
  },
  {
    file: PLAYER,
    find: '  fun setMediaSource(source: MediaSource) {\n',
    replace: '  fun setMediaSource(source: MediaSource) {\n    // Quran Heals patch: closed from Recents: no new source (a load still in flight) until the app is opened again.\n    if (QuranHealsPlaybackGate.closed) return\n',
  },
  {
    file: PLAYER,
    find: '  fun setActiveForLockScreen(active: Boolean, metadata: Metadata? = null, options: AudioLockScreenOptions? = null) {\n    if (active) {\n',
    replace: '  fun setActiveForLockScreen(active: Boolean, metadata: Metadata? = null, options: AudioLockScreenOptions? = null) {\n    // Quran Heals patch: closed from Recents: no controls and no playback service until the app is opened again.\n    if (active && QuranHealsPlaybackGate.closed) return\n    if (active) {\n',
  },
  {
    file: PLAYER,
    find: '  override fun releasePlayer() {\n    mediaSession.release()\n',
    replace: '  override fun releasePlayer() {\n    // Quran Heals patch: a released player is never closed again.\n    QuranHealsPlaybackGate.unregister(this)\n    mediaSession.release()\n',
  },
  {
    file: PLAYER,
    find: '  internal fun assignBasicMediaSession() {\n',
    replace: [
      '  // Quran Heals patch: the app was closed from Recents (QuranHealsPlaybackGate.close). Paused and emptied at once (a',
      '  // play that slips through has nothing to play), its controls dropped, and JavaScript told (quranHealsTaskRemoved) so',
      '  // the app stops its engine. Main thread (a service callback).',
      '  internal fun closeForRemovedTask() {',
      '    intendedPlayingState = false',
      '    isActiveForLockScreen = false',
      '    ref.pause()',
      '    ref.stop()',
      '    ref.clearMediaItems()',
      '    sendStatusUpdate(mapOf("playing" to false, "quranHealsTaskRemoved" to true))',
      '  }',
      '',
      '  internal fun assignBasicMediaSession() {',
      '',
    ].join('\n'),
  },
  {
    // A media button (car, headset) or a notification action arriving while no app is attached (the app was closed and
    // its process ended, or the service was stopped): nothing to control, so the service does not stay started.
    file: SERVICE,
    find: '    if (currentPlayerRef == null || context == null) {\n      stopForeground(STOP_FOREGROUND_REMOVE)\n      return super.onStartCommand(intent, flags, startId)\n    }\n',
    replace: [
      '    if (currentPlayerRef == null || context == null) {',
      '      stopForeground(STOP_FOREGROUND_REMOVE)',
      '      // Quran Heals patch: a car or headset button (or a notification action) with no app attached: nothing plays,',
      '      // and the service does not stay started. The app\'s own start (MediaSessionService action) is left alone.',
      '      val result = super.onStartCommand(intent, flags, startId)',
      '      if (context == null && intent?.action != SERVICE_INTERFACE) stopSelf(startId)',
      '      return result',
      '    }',
      '',
    ].join('\n'),
  },
  {
    // Media3 1.9.0's default onTaskRemoved stops the service only when nothing is playing: a playing session keeps the
    // foreground service, the player and the app's JavaScript alive after the app is swiped away, and a car's
    // auto-play can resume it. Here a removed task always ends playback, controls and the service.
    file: SERVICE,
    find: '  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {\n',
    replace: [
      '  // Quran Heals patch: the app closed from Recents ends its audio: the gate closes (every player paused and emptied,',
      '  // JavaScript told, every play refused until the app is opened again), the notification and lock-screen controls',
      '  // removed, the session released, the service unbound and stopped. Background playback (Home, Back, screen off,',
      '  // another app) never comes here. Main thread.',
      '  override fun onTaskRemoved(rootIntent: Intent?) {',
      '    val players = QuranHealsPlaybackGate.close()',
      '    playbackListener?.let { listener -> currentPlayer?.ref?.removeListener(listener) }',
      '    playbackListener = null',
      '    // Before the session is cleared: the notification\'s id is derived from the current player.',
      '    hideNotification()',
      '    clearSessionInternal()',
      '    for (player in players) player.serviceConnection.unbind()',
      '    stopSelf()',
      '  }',
      '',
      '  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {',
      '',
    ].join('\n'),
  },
  {
    // Media3 still reports the session's last changes while it is being released: closed, the service never promotes
    // itself or posts a notification again (Android 12+ refuses a background promotion anyway; seen 2026-10-25).
    file: SERVICE,
    find: '  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {\n    postOrStartForegroundNotification(startInForegroundRequired)\n',
    replace: '  override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {\n    // Quran Heals patch: closed from Recents: no notification and no promotion until the app is opened again.\n    if (QuranHealsPlaybackGate.closed) return\n    postOrStartForegroundNotification(startInForegroundRequired)\n',
  },
  {
    file: SERVICE,
    find: 'import androidx.media3.session.MediaSessionService\n',
    replace: 'import androidx.media3.session.MediaSessionService\nimport androidx.media3.session.MediaSessionService.SERVICE_INTERFACE\nimport expo.modules.audio.QuranHealsPlaybackGate\n',
  },
];
const COPIES = [{ from: 'android/QuranHealsPlaybackGate.kt', to: 'android/src/main/java/expo/modules/audio/QuranHealsPlaybackGate.kt' }];

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : process.argv.includes('--verify') ? 'verify' : 'check';
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

// Expo SDK 57 links expo-audio precompiled unless the app builds it from source (see ../expo-audio-exact-mp3-seek).
const appPkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
const fromSource = (appPkg.expo?.autolinking?.android?.buildFromSource ?? []).includes('expo-audio');

if (mode === 'verify') {
  const problems = [];
  const texts = new Map();
  for (const e of EDITS) {
    const p = path.join(pkg, e.file);
    const text = texts.get(p) ?? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    texts.set(p, text);
    if (count(text, e.replace) !== 1) problems.push(`${e.file}: an edit is not applied`);
  }
  for (const c of COPIES) {
    const to = path.join(pkg, c.to);
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(path.join(here, c.from)))) problems.push(`${c.to}: missing or different`);
  }
  if (!fromSource) problems.push('package.json expo.autolinking.android.buildFromSource lacks "expo-audio"');
  if (problems.length) {
    for (const x of problems) console.error(`NOT VERIFIED: ${x}`);
    process.exit(1);
  }
  console.log(`verified: expo-audio ${VERSION} Android playback ownership patched (${EDITS.length} edits, ${COPIES.length} file) and built from source`);
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
if (!fromSource) console.log('NOTE: package.json expo.autolinking.android.buildFromSource lacks "expo-audio": an Android build would use the precompiled, unpatched expo-audio');
if (mode === 'check') { console.log('check passed: nothing written'); process.exit(0); }
for (const [p, text] of files) {
  if (!fs.existsSync(`${p}.qh-orig`)) fs.copyFileSync(p, `${p}.qh-orig`);
  fs.writeFileSync(p, text);
}
for (const c of COPIES) fs.copyFileSync(path.join(here, c.from), path.join(pkg, c.to));
console.log('applied: rebuild the Android app to use it (a JS reload is not enough)');
