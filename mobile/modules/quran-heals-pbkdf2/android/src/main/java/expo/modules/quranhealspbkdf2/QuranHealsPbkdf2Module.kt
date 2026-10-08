package expo.modules.quranhealspbkdf2

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018) over raw bytes. Hand-rolled over javax HMAC
 * instead of SecretKeyFactory so the password is used as exact bytes (the
 * char[]-based PBEKeySpec would re-encode it). AsyncFunction runs off the
 * JS thread.
 */
class QuranHealsPbkdf2Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuranHealsPbkdf2")

    AsyncFunction("pbkdf2Sha256") { passwordBase64: String, saltBase64: String, iterations: Int, keyLength: Int ->
      require(iterations > 0 && keyLength in 1..1024) { "Invalid PBKDF2 input" }
      val password = Base64.decode(passwordBase64, Base64.NO_WRAP)
      val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
      Base64.encodeToString(pbkdf2Sha256(password, salt, iterations, keyLength), Base64.NO_WRAP)
    }
  }

  private fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray {
    // HmacSHA256 rejects an empty key spec, so an empty password uses a single zero byte,
    // which HMAC zero-pads to the same block as an empty key.
    val keyBytes = if (password.isEmpty()) ByteArray(1) else password
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))

    val hLen = mac.macLength
    val blocks = (keyLength + hLen - 1) / hLen
    val out = ByteArray(keyLength)
    for (block in 1..blocks) {
      mac.update(salt)
      mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
      var u = mac.doFinal()
      val t = u.copyOf()
      for (i in 1 until iterations) {
        u = mac.doFinal(u)
        for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
      }
      val offset = (block - 1) * hLen
      System.arraycopy(t, 0, out, offset, minOf(hLen, keyLength - offset))
    }
    return out
  }
}
