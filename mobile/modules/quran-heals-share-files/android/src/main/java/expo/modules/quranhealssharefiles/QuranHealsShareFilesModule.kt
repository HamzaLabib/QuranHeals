package expo.modules.quranhealssharefiles

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Shares several local image files in ONE system share sheet
 * (ACTION_SEND_MULTIPLE), in the given order — expo-sharing takes a single
 * file. Used for a long ayah split across cards, so the whole ayah is
 * shared together. Files are exposed read-only through this module's own
 * FileProvider; resolves when the chooser returns.
 */
class QuranHealsShareFilesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private var pendingPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("QuranHealsShareFiles")

    AsyncFunction("shareFilesAsync") { urls: List<String>, dialogTitle: String?, promise: Promise ->
      if (pendingPromise != null) {
        throw CodedException("ERR_SHARE_IN_PROGRESS", "Another share is in progress", null)
      }
      if (urls.isEmpty()) {
        throw CodedException("ERR_SHARE_INVALID", "No files to share", null)
      }
      val authority = context.packageName + ".QuranHealsShareFileProvider"
      val contentUris = ArrayList<Uri>()
      for (url in urls) {
        val path = Uri.parse(url).path
        val file = if (path != null) File(path) else null
        if (file == null || !file.isFile || !file.canRead()) {
          throw CodedException("ERR_SHARE_INVALID", "Every item must be a readable local file", null)
        }
        contentUris.add(FileProvider.getUriForFile(context, authority, file))
      }

      val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = "image/png"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, contentUris)
        // ClipData carries the read grant through the chooser to the chosen app.
        clipData = ClipData.newRawUri(null, contentUris[0]).also { clip ->
          contentUris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, dialogTitle)
      context.packageManager.queryIntentActivities(send, PackageManager.MATCH_DEFAULT_ONLY).forEach { info ->
        contentUris.forEach { uri ->
          context.grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
      }
      pendingPromise = promise
      try {
        appContext.throwingActivity.startActivityForResult(chooser, REQUEST_CODE)
      } catch (e: Exception) {
        pendingPromise = null
        throw CodedException("ERR_SHARE_FAILED", "Could not open the share sheet", e)
      }
    }

    OnActivityResult { _, (requestCode) ->
      if (requestCode == REQUEST_CODE) {
        pendingPromise?.resolve(null)
        pendingPromise = null
      }
    }
  }

  companion object {
    private const val REQUEST_CODE = 8524
  }
}

class QuranHealsShareFileProvider : FileProvider()
