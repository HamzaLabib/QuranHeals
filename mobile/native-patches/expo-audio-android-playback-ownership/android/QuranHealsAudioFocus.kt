package expo.modules.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * Quran Heals patch (native-patches/expo-audio-android-playback-ownership): the app's Android audio focus, in one place,
 * replacing expo-audio's own (AudioModule's requestAudioFocus / releaseAudioFocus are switched off).
 *
 * expo-audio released focus whenever ExoPlayer stopped playing for a moment (any pause, every rebuffer or seek, every
 * ayah load) and asked for it again only on JavaScript's play: a resume from the notification, the lock screen, a
 * headset or a car, or ExoPlayer resuming after a rebuffer, then played WITHOUT focus, so another app's recording never
 * paused it (reproduced 2026-10-25). It also resumed by itself when focus came back.
 *
 * Here:
 *  - Long-form focus (AUDIOFOCUS_GAIN) is asked for whenever a player is about to play, wherever the play comes from
 *    (AudioPlayer's playWhenReady listener; AudioModule's play), and kept while paused, as ExoPlayer does; it is given
 *    up only when playback is over (AudioPlayer.clearLockScreenControls) or the app is closed (QuranHealsPlaybackGate).
 *  - Lost to another app (a voice recording, a call, another player: LOSS or LOSS_TRANSIENT): every player is paused
 *    and JavaScript told (quranHealsInterrupted), and the app is INTERRUPTED: no play is allowed — not the engine's next
 *    ayah, not a load finishing — until the reader asks to play ([claim]: the app's play buttons, the notification, the
 *    lock screen, a headset, a car). Focus coming back never resumes anything.
 *  - Asked to duck (LOSS_TRANSIENT_CAN_DUCK, e.g. a navigation prompt): Android lowers the volume by itself; no pause.
 *  - Refused focus (a phone call): nothing plays, and the app is interrupted.
 *  - A start the reader asked for BEFORE another app began recording never takes the focus from that recording: the
 *    play was pressed, then a recorder started before the recitation did (its load still under way; background loads
 *    finish by themselves). Reproduced 2026-10-25: the recitation requested focus after the recorder, took it, and
 *    played over the recording. Android reports active recordings to every app (anonymised: never which app), so such a
 *    start is refused and the app interrupted; a play pressed after the recording began is the reader's own choice.
 * A recorder that records while the recitation already plays and requests no focus is not acted on (only reported
 * focus losses pause). Main thread only.
 */
object QuranHealsAudioFocus {
  /** AudioModule's own requestAudioFocus / releaseAudioFocus return at once while this is true (always). */
  val replacesModuleFocus = true

  private var audioManager: AudioManager? = null
  private var request: AudioFocusRequest? = null

  /** The focus is ours right now. */
  var held = false
    private set

  /** When the reader last asked to play (elapsedRealtime). */
  private var claimedAt = 0L

  /** When a recording last started on the device (elapsedRealtime), 0 if none seen; anonymised, never which app. */
  private var recordingStartedAt = 0L
  private var recordingsActive = 0

  private val recordings = object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
      if (configs.size > recordingsActive) recordingStartedAt = SystemClock.elapsedRealtime()
      recordingsActive = configs.size
      android.util.Log.i("QuranHealsAudioFocus", "active recordings on the device: ${configs.size}")
    }
  }

  /** Another app took the focus since the reader last asked to play: nothing plays on its own. */
  @Volatile
  var interrupted = false
    private set

  private val listener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      // Back from another app's recording or call: noted, never a resume (the reader presses play).
      AudioManager.AUDIOFOCUS_GAIN -> held = true
      AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
        held = false
        interrupt()
      }
      // Ducking is left to Android (automatic since Android 8): the recitation carries on, quieter.
      else -> Unit
    }
  }

  fun init(context: Context) {
    if (audioManager != null) return
    val manager = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    audioManager = manager
    // A recording already running counts as started now (the reader's next play comes after it).
    recordingsActive = manager.activeRecordingConfigurations.size
    if (recordingsActive > 0) recordingStartedAt = SystemClock.elapsedRealtime()
    manager.registerAudioRecordingCallback(recordings, Handler(Looper.getMainLooper()))
  }

  private fun focusRequest(): AudioFocusRequest = request ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
    .setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    )
    .setAcceptsDelayedFocusGain(false)
    .setWillPauseWhenDucked(false)
    .setOnAudioFocusChangeListener(listener, Handler(Looper.getMainLooper()))
    .build()
    .also { request = it }

  /** A player is about to play: allowed only when not interrupted and the focus is (or now becomes) ours. */
  fun mayPlay(): Boolean {
    if (interrupted) return false
    if (held) return true
    // A recording began after the reader last asked to play: this start is older than it and never takes its focus.
    if (recordingStartedAt != 0L && claimedAt <= recordingStartedAt) {
      interrupt()
      return false
    }
    val manager = audioManager ?: return true
    held = manager.requestAudioFocus(focusRequest()) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    if (!held) interrupt()
    return held
  }

  /** The reader asked to play: playback held back by another app may start again (and asks for the focus again). */
  fun claim() {
    interrupted = false
    claimedAt = SystemClock.elapsedRealtime()
  }

  /** Playback is over (stopped, ended, closed): the focus goes back to Android, and nothing is held back any more. */
  fun abandon() {
    request?.let { audioManager?.abandonAudioFocusRequest(it) }
    held = false
    interrupted = false
  }

  private fun interrupt() {
    interrupted = true
    for (player in QuranHealsPlaybackGate.livePlayers()) {
      try {
        player.pauseForInterruption()
      } catch (e: Exception) {
        android.util.Log.w("QuranHealsAudioFocus", "pausing a player failed", e)
      }
    }
  }
}
