import ExpoModulesCore
import Foundation

/// Marks re-downloadable content (recitation downloads, the offline Mushaf)
/// as excluded from iCloud and computer backups, as the iOS Data Storage
/// Guidelines require for files the app can download again. Set on a
/// directory, the flag covers everything inside it, including files added
/// later. Personal content (reflections, favorites, settings) is never
/// passed here.
public class QuranHealsBackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QuranHealsBackupExclusion")

    /// Sets the flag on an existing file or directory. Resolves false when nothing exists at that location.
    AsyncFunction("excludeFromBackupAsync") { (location: String) -> Bool in
      var url = Self.fileUrl(location)
      guard FileManager.default.fileExists(atPath: url.path) else {
        return false
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return true
    }

    /// The flag as iOS reports it now, or nil when nothing exists at that location (for checks on a device).
    AsyncFunction("isExcludedFromBackupAsync") { (location: String) -> Bool? in
      let url = Self.fileUrl(location)
      guard FileManager.default.fileExists(atPath: url.path) else {
        return nil
      }
      return try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
    }
  }

  /// expo-file-system gives file:// URIs; expo-sqlite gives a bare path.
  private static func fileUrl(_ location: String) -> URL {
    if location.hasPrefix("file://"), let url = URL(string: location) {
      return url
    }
    return URL(fileURLWithPath: location)
  }
}
