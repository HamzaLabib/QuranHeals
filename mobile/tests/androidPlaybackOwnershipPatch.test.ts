import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * native-patches/expo-audio-android-playback-ownership: the app closed from Recents ends its audio natively (Android
 * only). These checks pin what the patched sources must still say; the behaviour itself was measured on the emulator
 * and still needs a phone (docs/audio/android-ownership-device-test-2026-10-25.md).
 */
const patchDir = path.join(__dirname, '..', 'native-patches', 'expo-audio-android-playback-ownership');
const apply = path.join(patchDir, 'apply.mjs');
const audio = path.join(__dirname, '..', 'node_modules', 'expo-audio');
const read = (relative: string) => fs.readFileSync(path.join(audio, relative), 'utf8').replace(/\r\n/g, '\n');
const SERVICE = 'android/src/main/java/expo/modules/audio/service/AudioControlsService.kt';
const PLAYER = 'android/src/main/java/expo/modules/audio/AudioPlayer.kt';
const GATE = 'android/src/main/java/expo/modules/audio/QuranHealsPlaybackGate.kt';

describe('Android playback ownership: the native patch (applied on install, verified by EAS)', () => {
  it('its anchors match the installed expo-audio exactly once each (or it is already applied)', () => {
    expect(execFileSync(process.execPath, [apply, '--check'], { encoding: 'utf8' })).toMatch(/check passed: nothing written/);
  });

  it('the installed expo-audio passes the verification EAS runs, with the gate copied in byte for byte', () => {
    const out = execFileSync(process.execPath, [apply, '--verify'], { encoding: 'utf8' });
    expect(out.startsWith('verified: expo-audio 57.0.5 Android playback ownership patched (10 edits, 1 file) and built from source')).toBe(true);
    expect(fs.readFileSync(path.join(audio, GATE)).equals(fs.readFileSync(path.join(patchDir, 'android', 'QuranHealsPlaybackGate.kt')))).toBe(true);
  });

  it('closing from Recents closes the gate first, then removes the notification, the session and the service', () => {
    const service = read(SERVICE);
    const body = service.slice(service.indexOf('override fun onTaskRemoved'), service.indexOf('override fun onGetSession'));
    const order = ['QuranHealsPlaybackGate.close()', 'hideNotification()', 'clearSessionInternal()', 'serviceConnection.unbind()', 'stopSelf()'].map((call) => body.indexOf(call));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Closed: no notification and no promotion from Media3's late updates.
    expect(service).toMatch(/override fun onUpdateNotification\([^)]*\) \{\n {4}\/\/ Quran Heals patch[^\n]*\n {4}if \(QuranHealsPlaybackGate\.closed\) return\n/);
  });

  it('while closed, every way back to sound is refused natively: a new source, the controls and their service, any play', () => {
    const player = read(PLAYER);
    expect(player).toMatch(/fun setMediaSource\(source: MediaSource\) \{\n[^\n]*\n {4}if \(QuranHealsPlaybackGate\.closed\) return\n/);
    expect(player).toMatch(/fun setActiveForLockScreen\([^)]*\) \{\n[^\n]*\n {4}if \(active && QuranHealsPlaybackGate\.closed\) return\n/);
    expect(player).toContain('if (playWhenReady && QuranHealsPlaybackGate.closed) ref.pause()');
    expect(player).toContain('QuranHealsPlaybackGate.register(this, context)');
    expect(player).toContain('QuranHealsPlaybackGate.unregister(this)');
    // Closing empties the player, so a play that slips through has nothing to play, and JavaScript is told.
    const close = player.slice(player.indexOf('internal fun closeForRemovedTask'), player.indexOf('internal fun assignBasicMediaSession'));
    for (const call of ['ref.pause()', 'ref.stop()', 'ref.clearMediaItems()', '"quranHealsTaskRemoved" to true']) expect(close).toContain(call);
    expect(player).toContain('.setHandleAudioBecomingNoisy(true)');
  });

  it('the gate opens again only when an activity of the app resumes (reopening), never by a timer or a media command', () => {
    const gate = read(GATE);
    // Its declaration (false) aside, it is set in exactly two places.
    const assignments = gate.match(/(?<!var )closed = (true|false)/g) ?? [];
    expect(assignments).toEqual(['closed = false', 'closed = true']);
    expect(gate).toMatch(/override fun onActivityResumed\(activity: Activity\) \{\n {8}closed = false\n/);
  });

  it('no iOS source is touched', () => {
    const source = fs.readFileSync(apply, 'utf8');
    expect(source).not.toMatch(/file: ['"]ios\//);
  });
});
