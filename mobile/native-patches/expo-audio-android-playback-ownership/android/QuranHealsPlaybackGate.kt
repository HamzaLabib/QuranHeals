package expo.modules.audio

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import java.lang.ref.WeakReference

/**
 * Quran Heals patch (native-patches/expo-audio-android-playback-ownership): the app closed from Recents ends its audio
 * natively, for the whole process, without waiting for JavaScript.
 *
 * AudioControlsService.onTaskRemoved calls [close]: every player is paused and emptied (nothing left to play), and until
 * an activity of the app resumes (the reader opens it again) every way back to sound is refused — a new source
 * (AudioPlayer.setMediaSource), the lock-screen controls and their service (AudioPlayer.setActiveForLockScreen) and any
 * play, whoever asks for it (JavaScript still finishing an ayah, a notification action, a media session, a car or
 * headset): AudioPlayer reverts playWhenReady at once. Background playback (Home, Back, screen off) never closes it.
 * Main thread only, like ExoPlayer.
 */
object QuranHealsPlaybackGate {
  @Volatile
  var closed = false
    private set

  private val players = mutableListOf<WeakReference<AudioPlayer>>()
  private var watchingActivities = false

  /** Every AudioPlayer, when created. The first one also starts watching the app's activities (reopening). */
  fun register(player: AudioPlayer, context: Context) {
    players.removeAll { it.get() == null || it.get() === player }
    players.add(WeakReference(player))
    if (watchingActivities) return
    val application = context.applicationContext as? Application ?: return
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      // The reader is back in the app: playback is theirs to start again.
      override fun onActivityResumed(activity: Activity) {
        closed = false
      }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
      override fun onActivityStarted(activity: Activity) = Unit
      override fun onActivityPaused(activity: Activity) = Unit
      override fun onActivityStopped(activity: Activity) = Unit
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
      override fun onActivityDestroyed(activity: Activity) = Unit
    })
    watchingActivities = true
  }

  /** A released player is never touched again. */
  fun unregister(player: AudioPlayer) {
    players.removeAll { it.get() == null || it.get() === player }
  }

  /** The app was closed from Recents: closed, and every live player paused and emptied. Returns them. */
  fun close(): List<AudioPlayer> {
    closed = true
    val live = players.mapNotNull { it.get() }
    for (player in live) {
      // One player failing never keeps the others (or the service's shutdown) from closing.
      try {
        player.closeForRemovedTask()
      } catch (e: Exception) {
        android.util.Log.w("QuranHealsPlaybackGate", "closing a player failed", e)
      }
    }
    return live
  }
}
