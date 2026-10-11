import ExpoModulesCore
import UIKit

/// Shares several local image files in ONE system share sheet, in the given
/// order (expo-sharing takes a single file). Used for a long ayah split
/// across cards, so the whole ayah is shared together.
public class QuranHealsShareFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QuranHealsShareFiles")

    AsyncFunction("shareFilesAsync") { (urls: [URL], dialogTitle: String?, promise: Promise) in
      guard !urls.isEmpty else {
        throw ShareFilesInvalidInputException()
      }
      // A bare path arrives as a scheme-less URL (iOS 17+); treat it as a file path.
      let fileUrls = urls.map { $0.scheme == nil ? URL(fileURLWithPath: $0.path) : $0 }
      for url in fileUrls {
        guard url.isFileURL, FileManager.default.isReadableFile(atPath: url.path) else {
          throw ShareFilesInvalidInputException()
        }
      }
      guard let currentViewController = self.appContext?.utilities?.currentViewController() else {
        throw ShareFilesNoViewControllerException()
      }

      let activityController = UIActivityViewController(activityItems: fileUrls, applicationActivities: nil)
      activityController.title = dialogTitle
      // Called once on dismissal, whatever the user chose (or cancelled).
      activityController.completionWithItemsHandler = { _, _, _, _ in
        promise.resolve(nil)
      }

      // iPad presents the share sheet as a popover.
      if UIDevice.current.userInterfaceIdiom == .pad {
        let frame = currentViewController.view.frame
        activityController.popoverPresentationController?.sourceView = currentViewController.view
        activityController.popoverPresentationController?.sourceRect = CGRect(x: frame.midX, y: frame.maxY, width: 0, height: 0)
        activityController.modalPresentationStyle = .pageSheet
      }

      currentViewController.present(activityController, animated: true)
    }
    .runOnQueue(.main)
  }
}

internal final class ShareFilesInvalidInputException: Exception {
  override var reason: String { "Every item must be a readable local file" }
}

internal final class ShareFilesNoViewControllerException: Exception {
  override var reason: String { "No view controller to present the share sheet from" }
}
