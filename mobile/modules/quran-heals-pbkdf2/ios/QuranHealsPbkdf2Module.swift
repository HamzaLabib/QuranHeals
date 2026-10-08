import CommonCrypto
import ExpoModulesCore

/// PBKDF2-HMAC-SHA256 over raw bytes (arguments/result are base64 so no text
/// encoding is applied natively). AsyncFunction runs off the JS thread.
public class QuranHealsPbkdf2Module: Module {
  public func definition() -> ModuleDefinition {
    Name("QuranHealsPbkdf2")

    AsyncFunction("pbkdf2Sha256") { (passwordBase64: String, saltBase64: String, iterations: Int, keyLength: Int) -> String in
      guard iterations > 0, keyLength > 0, keyLength <= 1024,
            let password = Data(base64Encoded: passwordBase64),
            let salt = Data(base64Encoded: saltBase64) else {
        throw Pbkdf2InvalidInputException()
      }

      var derived = [UInt8](repeating: 0, count: keyLength)
      let status = password.withUnsafeBytes { (pw: UnsafeRawBufferPointer) -> Int32 in
        salt.withUnsafeBytes { (s: UnsafeRawBufferPointer) -> Int32 in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            pw.bindMemory(to: Int8.self).baseAddress, password.count,
            s.bindMemory(to: UInt8.self).baseAddress, salt.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            UInt32(iterations),
            &derived, keyLength
          )
        }
      }
      guard status == kCCSuccess else {
        throw Pbkdf2FailedException()
      }
      return Data(derived).base64EncodedString()
    }
  }
}

internal final class Pbkdf2InvalidInputException: Exception {
  override var reason: String { "Invalid PBKDF2 input" }
}

internal final class Pbkdf2FailedException: Exception {
  override var reason: String { "PBKDF2 derivation failed" }
}
