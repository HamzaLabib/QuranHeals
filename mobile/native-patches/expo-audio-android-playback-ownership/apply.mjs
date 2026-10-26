// Quran Heals native patch for expo-audio 57.0.5 (ANDROID ONLY): the app owns its audio. Closing the app from Recents
// stops playback for good, a car or headset cannot bring it back afterwards, losing the headphones / Bluetooth route
// pauses (as iOS does), and another app's recording or call pauses the recitation, which never resumes by itself
// (QuranHealsAudioFocus). iOS sources are not touched. Applied by mobile/package.json's postinstall and checked by
// eas-build-post-install (--verify), like ../expo-audio-exact-mp3-seek.
//
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --check    every anchor found, nothing written
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --apply    edit node_modules/expo-audio (keeps *.qh-orig)
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --verify   fail unless applied in full and Android
//                                                                                 builds expo-audio from source
//   node native-patches/expo-audio-android-playback-ownership/apply.mjs --revert   undo this patch only
//
// Each edit replaces one exact, unique text and refuses to run if expo-audio is not 57.0.5 or a text is not found
// exactly once; --apply is idempotent (an applied file is recognised and left alone). AudioModule.kt is shared with
// ../expo-audio-exact-mp3-seek, whose *.qh-orig copy it is: this patch's --revert undoes its own edits there and leaves
// the VBR patch's in place (revert this patch before the VBR one). See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, '..', '..', 'node_modules', 'expo-audio');
const VERSION = '57.0.5';
const AUDIO = 'android/src/main/java/expo/modules/audio';
const SERVICE = `${AUDIO}/service/AudioControlsService.kt`;
const SESSION_PLAYER = `${AUDIO}/service/MetadataInjectingPlayer.kt`;
const PLAYER = `${AUDIO}/AudioPlayer.kt`;
const MODULE = `${AUDIO}/AudioModule.kt`;
/** Files another patch also edits: reverted edit by edit, never from *.qh-orig. */
const SHARED = new Set([MODULE]);

const EDITS = [
  {
    // Headphones unplugged or a Bluetooth device (a car) disconnected: ExoPlayer pauses instead of carrying on through
    // the phone's speaker. The app's engine follows the pause (engine.ts followDevice).
    file: PLAYER,
    find: '    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n',
    replace: '    .setAudioAttributes(AudioAttributes.DEFAULT, false)\n    // Quran Heals patch: headphones or Bluetooth (a car) gone: pause, never the phone\'s speaker.\n    .setHandleAudioBecomingNoisy(true)\n',
  },
  {
    // Every player joins the gate. Any play, whoever asks for it (JavaScript, a notification, a session, a car, ExoPlayer
    // after a rebuffer), passes here: refused while the app is closed, and asks for the audio focus first.
    file: PLAYER,
    find: '  init {\n    installPlayerListeners()\n',
    replace: [
      '  init {',
      '    installPlayerListeners()',
      '    // Quran Heals patch: every play passes here. Closed from Recents (QuranHealsPlaybackGate): refused until the app is',
      '    // opened again. Otherwise the audio focus first (QuranHealsAudioFocus): refused while another app\'s recording or',
      '    // call holds it, or since one did until the reader asks to play.',
      '    QuranHealsPlaybackGate.register(this, context)',
      '    ref.addListener(object : Player.Listener {',
      '      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {',
      '        if (!playWhenReady) return',
      '        if (QuranHealsPlaybackGate.closed) ref.pause()',
      '        else if (!QuranHealsAudioFocus.mayPlay()) pauseForInterruption()',
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
    // The app's playback is over (stop, the end of a single ayah): the audio focus goes back to Android.
    file: PLAYER,
    find: '  fun clearLockScreenControls() {\n',
    replace: '  fun clearLockScreenControls() {\n    // Quran Heals patch: playback is over (stopped or ended): the audio focus goes back to Android.\n    QuranHealsAudioFocus.abandon()\n',
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
      '  // Quran Heals patch: another app\'s recording or call took the audio focus, or a play was refused because of it',
      '  // (QuranHealsAudioFocus). Paused (whatever it was doing, a load included), and JavaScript told',
      '  // (quranHealsInterrupted) so the app pauses its engine: no next ayah, no load that plays afterwards. Main thread.',
      '  internal fun pauseForInterruption() {',
      '    intendedPlayingState = false',
      '    if (ref.playWhenReady) ref.pause()',
      '    sendStatusUpdate(mapOf("playing" to false, "quranHealsInterrupted" to true))',
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
    // The notification's own Play (Android 12 and older): the reader's request, like the app's play button.
    file: SERVICE,
    find: '        ACTION_PLAY -> {\n          if (shouldPlayInSilentMode()) {\n            currentPlayerRef.play()\n',
    replace: '        ACTION_PLAY -> {\n          if (shouldPlayInSilentMode()) {\n            // Quran Heals patch: the reader asked to play (QuranHealsAudioFocus.claim).\n            QuranHealsAudioFocus.claim()\n            currentPlayerRef.play()\n',
  },
  {
    file: SERVICE,
    find: '          } else if (shouldPlayInSilentMode()) {\n            currentPlayerRef.play()\n',
    replace: '          } else if (shouldPlayInSilentMode()) {\n            // Quran Heals patch: the reader asked to play (QuranHealsAudioFocus.claim).\n            QuranHealsAudioFocus.claim()\n            currentPlayerRef.play()\n',
  },
  {
    // Media3's default stops the service only when nothing is playing (a playing session kept the service, the player
    // and JavaScript alive after a swipe, and a car could resume it). Here a removed task always ends it all.
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
    // Promoted for playback, the service must also be STARTED: Android delivers onTaskRemoved (the swipe-away shutdown)
    // only to a started service, and stops a started one by itself when the app sits paused in the background for about
    // a minute ("Stopping service due to app idle", seen 2026-10-25), leaving it only bound. A later resume then played
    // on, and a swipe no longer stopped it.
    file: SERVICE,
    find: '  private fun postOrStartForegroundNotificationNow(startInForeground: Boolean) {\n    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager\n    val notification = buildNotification() ?: return\n\n    if (startInForeground) {\n',
    replace: [
      '  // Quran Heals patch: started as well as foreground whenever it plays, so a swipe from Recents always reaches',
      '  // onTaskRemoved, also after Android stopped it while the app was idle (paused in the background).',
      '  private fun quranHealsEnsureStarted() {',
      '    try {',
      '      startService(Intent(this, AudioControlsService::class.java).setAction(SERVICE_INTERFACE))',
      '    } catch (e: Exception) {',
      '      // Not allowed from the background (Android 8+): it is started again by the next play from the app.',
      '      android.util.Log.w("AudioControlsService", "could not keep the playback service started", e)',
      '    }',
      '  }',
      '',
      '  private fun postOrStartForegroundNotificationNow(startInForeground: Boolean) {',
      '    val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager',
      '    val notification = buildNotification() ?: return',
      '',
      '    if (startInForeground) {',
      '      quranHealsEnsureStarted()',
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
    replace: 'import androidx.media3.session.MediaSessionService\nimport androidx.media3.session.MediaSessionService.SERVICE_INTERFACE\nimport expo.modules.audio.QuranHealsAudioFocus\nimport expo.modules.audio.QuranHealsPlaybackGate\n',
  },
  {
    // Every play the media session receives (the notification and lock screen on Android 13+, a headset, a car) is the
    // reader's own: it may start what another app's recording or call held back.
    file: SESSION_PLAYER,
    find: '  override fun getMediaMetadata(): MediaMetadata {\n',
    replace: [
      '  // Quran Heals patch: a play from the notification, the lock screen, a headset or a car is the reader\'s own request:',
      '  // playback held back by another app\'s recording or call may start again (QuranHealsAudioFocus.claim).',
      '  override fun play() {',
      '    QuranHealsAudioFocus.claim()',
      '    super.play()',
      '  }',
      '',
      '  override fun setPlayWhenReady(playWhenReady: Boolean) {',
      '    if (playWhenReady) QuranHealsAudioFocus.claim()',
      '    super.setPlayWhenReady(playWhenReady)',
      '  }',
      '',
      '  override fun getMediaMetadata(): MediaMetadata {',
      '',
    ].join('\n'),
  },
  {
    file: SESSION_PLAYER,
    find: 'import expo.modules.audio.Metadata\n',
    replace: 'import expo.modules.audio.Metadata\nimport expo.modules.audio.QuranHealsAudioFocus\n',
  },
  {
    // expo-audio's own focus handling is switched off: it released the focus on every momentary stop (a rebuffer, a
    // seek, an ayah load) and resumed by itself when the focus came back. QuranHealsAudioFocus is the one owner.
    file: MODULE,
    find: '  private fun requestAudioFocus() {\n',
    replace: '  private fun requestAudioFocus() {\n    // Quran Heals patch: the audio focus is QuranHealsAudioFocus\'s (one owner, no resume by itself).\n    if (QuranHealsAudioFocus.replacesModuleFocus) return\n',
  },
  {
    file: MODULE,
    find: '  private fun releaseAudioFocus() {\n',
    replace: '  private fun releaseAudioFocus() {\n    // Quran Heals patch: the audio focus is QuranHealsAudioFocus\'s (one owner, no resume by itself).\n    if (QuranHealsAudioFocus.replacesModuleFocus) return\n',
  },
  {
    // JavaScript's play: never while closed; the focus first. And the reader's own request (the app's play buttons),
    // which JavaScript marks before playing (expoOutput.claim).
    file: MODULE,
    find: [
      '        runOnMain {',
      '          if (!focusAcquired) {',
      '            requestAudioFocus()',
      '          }',
      '          player.ref.play()',
      '        }',
      '      }',
      '',
      '      Function("pause") { player: AudioPlayer ->',
      '',
    ].join('\n'),
    replace: [
      '        runOnMain {',
      '          // Quran Heals patch: never while closed from Recents; the audio focus first (QuranHealsAudioFocus). Refused',
      '          // (another app\'s recording or call, or one since the reader last asked to play): no play, JavaScript told.',
      '          if (QuranHealsPlaybackGate.closed) return@runOnMain',
      '          if (QuranHealsAudioFocus.mayPlay()) player.ref.play() else player.pauseForInterruption()',
      '        }',
      '      }',
      '',
      '      // Quran Heals patch: the reader asked to play (the app\'s own buttons, never the engine by itself): playback held',
      '      // back by another app\'s recording or call may start again.',
      '      Function("quranHealsClaimPlayback") { _: AudioPlayer ->',
      '        runOnMain {',
      '          QuranHealsAudioFocus.claim()',
      '        }',
      '      }',
      '',
      '      Function("pause") { player: AudioPlayer ->',
      '',
    ].join('\n'),
  },
];
const COPIES = [
  { from: 'android/QuranHealsPlaybackGate.kt', to: `${AUDIO}/QuranHealsPlaybackGate.kt` },
  { from: 'android/QuranHealsAudioFocus.kt', to: `${AUDIO}/QuranHealsAudioFocus.kt` },
];

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : process.argv.includes('--verify') ? 'verify' : 'check';
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
if (version !== VERSION) throw new Error(`expo-audio ${version} installed; this patch is for ${VERSION} only`);
const count = (s, t) => s.split(t).length - 1;

if (mode === 'revert') {
  for (const f of new Set(EDITS.map((e) => e.file))) {
    const p = path.join(pkg, f);
    if (SHARED.has(f)) {
      // Undo this patch's edits only (the other patch's stay, with its *.qh-orig).
      let text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      for (const e of [...EDITS].reverse()) if (e.file === f && count(text, e.replace) === 1) text = text.replace(e.replace, e.find);
      fs.writeFileSync(p, text);
      console.log(`reverted this patch's edits in ${f}`);
    } else if (fs.existsSync(`${p}.qh-orig`)) { fs.copyFileSync(`${p}.qh-orig`, p); fs.rmSync(`${p}.qh-orig`); console.log(`restored ${f}`); }
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
  console.log(`verified: expo-audio ${VERSION} Android playback ownership patched (${EDITS.length} edits, ${COPIES.length} files) and built from source`);
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
