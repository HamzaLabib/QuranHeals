import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * native-patches/expo-audio-android-playback-ownership (Android only): the app closed from Recents ends its audio, and
 * another app's recording or call pauses it without any resume by itself. These checks pin what the patched sources
 * must still say; the behaviour was measured on the emulator and still needs a phone
 * (docs/audio/android-ownership-device-test-2026-10-25.md).
 */
const patchDir = path.join(__dirname, '..', 'native-patches', 'expo-audio-android-playback-ownership');
const apply = path.join(patchDir, 'apply.mjs');
const audio = path.join(__dirname, '..', 'node_modules', 'expo-audio');
const read = (relative: string) => fs.readFileSync(path.join(audio, relative), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'android/src/main/java/expo/modules/audio';
const SERVICE = `${DIR}/service/AudioControlsService.kt`;
const SESSION_PLAYER = `${DIR}/service/MetadataInjectingPlayer.kt`;
const PLAYER = `${DIR}/AudioPlayer.kt`;
const MODULE = `${DIR}/AudioModule.kt`;
const GATE = `${DIR}/QuranHealsPlaybackGate.kt`;
const FOCUS = `${DIR}/QuranHealsAudioFocus.kt`;
/** The body of the first function or block that starts with `start`, up to `end`. */
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

describe('Android playback ownership: the native patch (applied on install, verified by EAS)', () => {
  it('its anchors match the installed expo-audio exactly once each (or it is already applied)', () => {
    expect(execFileSync(process.execPath, [apply, '--check'], { encoding: 'utf8' })).toMatch(/check passed: nothing written/);
  });

  it('the installed expo-audio passes the verification EAS runs, with both files copied in byte for byte', () => {
    const out = execFileSync(process.execPath, [apply, '--verify'], { encoding: 'utf8' });
    expect(out.startsWith('verified: expo-audio 57.0.5 Android playback ownership patched (19 edits, 2 files) and built from source')).toBe(true);
    for (const file of [GATE, FOCUS]) {
      expect(fs.readFileSync(path.join(audio, file)).equals(fs.readFileSync(path.join(patchDir, 'android', path.basename(file))))).toBe(true);
    }
  });

  it('no iOS source is touched', () => {
    expect(fs.readFileSync(apply, 'utf8')).not.toMatch(/file: ['"`]ios\//);
  });
});

describe('Android: closing from Recents (QuranHealsPlaybackGate)', () => {
  it('closes the gate first, then removes the notification, the session and the service', () => {
    const body = between(read(SERVICE), 'override fun onTaskRemoved', 'override fun onGetSession');
    const order = ['QuranHealsPlaybackGate.close()', 'hideNotification()', 'clearSessionInternal()', 'serviceConnection.unbind()', 'stopSelf()'].map((call) => body.indexOf(call));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(read(SERVICE)).toMatch(/override fun onUpdateNotification\([^)]*\) \{\n {4}\/\/ Quran Heals patch[^\n]*\n {4}if \(QuranHealsPlaybackGate\.closed\) return\n/);
  });

  it('promoted for playback, the service is started too, so a swipe still reaches onTaskRemoved after an idle stop', () => {
    const promote = between(read(SERVICE), 'private fun postOrStartForegroundNotificationNow', 'startForeground(');
    expect(promote).toMatch(/if \(startInForeground\) \{\n {6}quranHealsEnsureStarted\(\)\n/);
    expect(between(read(SERVICE), 'private fun quranHealsEnsureStarted', 'private fun postOrStartForegroundNotificationNow')).toContain('startService(Intent(this, AudioControlsService::class.java).setAction(SERVICE_INTERFACE))');
    // The app's own start action is never stopped again by onStartCommand.
    expect(read(SERVICE)).toContain('if (context == null && intent?.action != SERVICE_INTERFACE) stopSelf(startId)');
  });

  it('while closed, every way back to sound is refused natively: a new source, the controls and their service, any play', () => {
    const player = read(PLAYER);
    expect(player).toMatch(/fun setMediaSource\(source: MediaSource\) \{\n[^\n]*\n {4}if \(QuranHealsPlaybackGate\.closed\) return\n/);
    expect(player).toMatch(/fun setActiveForLockScreen\([^)]*\) \{\n[^\n]*\n {4}if \(active && QuranHealsPlaybackGate\.closed\) return\n/);
    expect(between(player, 'override fun onPlayWhenReadyChanged', '})')).toContain('if (QuranHealsPlaybackGate.closed) ref.pause()');
    expect(between(read(MODULE), 'Function("play") { player: AudioPlayer ->', 'Function("pause")')).toContain('if (QuranHealsPlaybackGate.closed) return@runOnMain');
    const close = between(player, 'internal fun closeForRemovedTask', 'internal fun pauseForInterruption');
    for (const call of ['ref.pause()', 'ref.stop()', 'ref.clearMediaItems()', '"quranHealsTaskRemoved" to true']) expect(close).toContain(call);
    expect(player).toContain('.setHandleAudioBecomingNoisy(true)');
  });

  it('the gate opens again only when an activity of the app resumes (reopening), and closing gives the focus back', () => {
    const gate = read(GATE);
    // Its declaration (false) aside, it is set in exactly two places.
    expect(gate.match(/(?<!var )closed = (true|false)/g) ?? []).toEqual(['closed = false', 'closed = true']);
    expect(gate).toMatch(/override fun onActivityResumed\(activity: Activity\) \{\n {8}closed = false\n/);
    expect(between(gate, 'fun close()', 'return live')).toContain('QuranHealsAudioFocus.abandon()');
  });
});

describe('Android: another app\'s recording or call (QuranHealsAudioFocus)', () => {
  const focus = () => read(FOCUS);

  it('asks for long-form focus, never delayed, and lets Android duck instead of pausing for a navigation prompt', () => {
    const text = focus();
    expect(text).toContain('AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)');
    expect(text).toContain('.setAcceptsDelayedFocusGain(false)');
    expect(text).toContain('.setWillPauseWhenDucked(false)');
  });

  it('a loss (a recording, a call, another player) pauses every player and interrupts; focus coming back never resumes', () => {
    const listener = between(focus(), 'OnAudioFocusChangeListener { change ->', 'fun init(');
    expect(listener).toMatch(/AUDIOFOCUS_GAIN -> held = true\n/);
    expect(listener).toMatch(/AUDIOFOCUS_LOSS, AudioManager\.AUDIOFOCUS_LOSS_TRANSIENT -> \{\n\s+held = false\n\s+interrupt\(\)/);
    expect(listener).not.toMatch(/play\(\)|claim\(\)/);
    const interrupt = between(focus(), 'private fun interrupt()', '\n}\n');
    expect(interrupt).toContain('interrupted = true');
    expect(interrupt).toContain('player.pauseForInterruption()');
    const pause = between(read(PLAYER), 'internal fun pauseForInterruption', 'internal fun assignBasicMediaSession');
    expect(pause).toContain('ref.pause()');
    expect(pause).toContain('"quranHealsInterrupted" to true');
  });

  it('interrupted, no play is allowed until the reader claims it; a refused focus request interrupts too', () => {
    const mayPlay = between(focus(), 'fun mayPlay(): Boolean {', 'fun claim()');
    expect(mayPlay.indexOf('if (interrupted) return false')).toBeGreaterThan(0);
    expect(mayPlay.indexOf('if (interrupted) return false')).toBeLessThan(mayPlay.indexOf('requestAudioFocus'));
    expect(mayPlay).toContain('if (!held) interrupt()');
    // Only claim() clears it (besides giving the focus up when playback is over or the app is closed).
    expect(focus().match(/(?<!var )interrupted = false/g)).toHaveLength(2);
    expect(between(focus(), 'fun claim()', 'fun abandon()')).toContain('interrupted = false');
  });

  it('a start the reader asked for before another app began recording never takes that recording`s focus', () => {
    const text = focus();
    // Recordings are followed (anonymised: how many, never which app); a newly started one is timed.
    expect(text).toContain('manager.registerAudioRecordingCallback(recordings, Handler(Looper.getMainLooper()))');
    expect(between(text, 'object : AudioManager.AudioRecordingCallback()', 'fun init(')).toContain('if (configs.size > recordingsActive) recordingStartedAt = SystemClock.elapsedRealtime()');
    // Checked before any focus request, after the interrupted / held checks; a refusal interrupts (JavaScript told).
    const mayPlay = between(text, 'fun mayPlay(): Boolean {', 'fun claim()');
    const guard = mayPlay.indexOf('if (recordingStartedAt != 0L && claimedAt <= recordingStartedAt) {');
    expect(guard).toBeGreaterThan(mayPlay.indexOf('if (held) return true'));
    expect(guard).toBeLessThan(mayPlay.indexOf('requestAudioFocus'));
    expect(mayPlay.slice(guard, guard + 120)).toContain('interrupt()');
    // Only the reader's request moves the claim forward.
    expect(text.match(/claimedAt = SystemClock\.elapsedRealtime\(\)/g)).toHaveLength(1);
    expect(between(text, 'fun claim()', 'fun abandon()')).toContain('claimedAt = SystemClock.elapsedRealtime()');
  });

  it('every play passes the focus check: JavaScript\'s play, and any other (notification, session, car, a rebuffer)', () => {
    expect(between(read(MODULE), 'Function("play") { player: AudioPlayer ->', 'Function("pause")')).toContain('if (QuranHealsAudioFocus.mayPlay()) player.ref.play() else player.pauseForInterruption()');
    expect(between(read(PLAYER), 'override fun onPlayWhenReadyChanged', '})')).toContain('else if (!QuranHealsAudioFocus.mayPlay()) pauseForInterruption()');
  });

  it('the reader\'s own plays claim: the app\'s buttons (JavaScript), the media session, the old notification actions', () => {
    expect(read(MODULE)).toMatch(/Function\("quranHealsClaimPlayback"\) \{ _: AudioPlayer ->\n\s+runOnMain \{\n\s+QuranHealsAudioFocus\.claim\(\)/);
    const session = read(SESSION_PLAYER);
    expect(session).toMatch(/override fun play\(\) \{\n\s+QuranHealsAudioFocus\.claim\(\)\n\s+super\.play\(\)/);
    expect(session).toMatch(/override fun setPlayWhenReady\(playWhenReady: Boolean\) \{\n\s+if \(playWhenReady\) QuranHealsAudioFocus\.claim\(\)/);
    expect(read(SERVICE).match(/QuranHealsAudioFocus\.claim\(\)\n\s+currentPlayerRef\.play\(\)/g)).toHaveLength(2);
  });

  it('expo-audio\'s own focus handling is off (it released focus on every rebuffer and resumed by itself)', () => {
    const module = read(MODULE);
    for (const fn of ['private fun requestAudioFocus() {', 'private fun releaseAudioFocus() {']) {
      expect(module).toMatch(new RegExp(`${fn.replace(/[()]/g, '\\$&')}\\n[^\\n]*\\n {4}if \\(QuranHealsAudioFocus\\.replacesModuleFocus\\) return\\n`));
    }
    expect(focus()).toContain('val replacesModuleFocus = true');
  });

  it('the focus goes back to Android when playback is over (stop, the end of one ayah), not on a pause', () => {
    expect(read(PLAYER)).toMatch(/fun clearLockScreenControls\(\) \{\n[^\n]*\n {4}QuranHealsAudioFocus\.abandon\(\)\n/);
    expect(between(read(MODULE), 'Function("pause") { player: AudioPlayer ->', '}\n')).not.toContain('abandon');
  });
});
