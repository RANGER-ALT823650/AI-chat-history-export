//
//  SafariWebExtensionHandler.swift
//  AI Chat Markdown Exporter Safari Extension
//

import Foundation
import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let exportRoot = "/Users/mayifan/Library/Mobile Documents/iCloud~md~obsidian/Documents/同步/10_Raw/AI Chat History"

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let responsePayload = handleMessage(message)
        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func handleMessage(_ rawMessage: Any?) -> [String: Any] {
        guard let message = rawMessage as? [String: Any],
              let type = message["type"] as? String else {
            return ["ok": false, "error": "Missing native message type."]
        }

        guard type == "SAVE_MARKDOWN_FILE" else {
            return ["ok": false, "error": "Unsupported native message type: \(type)."]
        }

        return saveMarkdownFile(message)
    }

    private func saveMarkdownFile(_ message: [String: Any]) -> [String: Any] {
        guard let relativePath = sanitizedRelativePath(message["relativePath"] as? String) else {
            return ["ok": false, "error": "Invalid export path."]
        }

        guard let textBase64 = message["textBase64"] as? String,
              let data = Data(base64Encoded: textBase64) else {
            return ["ok": false, "error": "Invalid Markdown payload."]
        }

        let conflictAction = (message["conflictAction"] as? String) ?? "uniquify"
        let rootURL = URL(fileURLWithPath: exportRoot, isDirectory: true)
        var outputURL = rootURL.appendingPathComponent(relativePath, isDirectory: false)
        if conflictAction != "overwrite" {
            outputURL = uniquifiedURL(outputURL)
        }

        do {
            try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: outputURL, options: .atomic)
            os_log(.default, "Saved Safari export to %{public}@", outputURL.path)
            return [
                "ok": true,
                "path": outputURL.path,
                "relativePath": rootURL.pathRelativeString(to: outputURL)
            ]
        } catch {
            os_log(.error, "Failed to save Safari export: %{public}@", error.localizedDescription)
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    private func sanitizedRelativePath(_ value: String?) -> String? {
        let parts = (value ?? "")
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0 != "." && $0 != ".." }

        guard !parts.isEmpty else {
            return nil
        }

        return parts.joined(separator: "/")
    }

    private func uniquifiedURL(_ originalURL: URL) -> URL {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: originalURL.path) else {
            return originalURL
        }

        let directory = originalURL.deletingLastPathComponent()
        let basename = originalURL.deletingPathExtension().lastPathComponent
        let pathExtension = originalURL.pathExtension

        var index = 1
        while true {
            let candidateName = pathExtension.isEmpty
                ? "\(basename) (\(index))"
                : "\(basename) (\(index)).\(pathExtension)"
            let candidateURL = directory.appendingPathComponent(candidateName, isDirectory: false)
            if !fileManager.fileExists(atPath: candidateURL.path) {
                return candidateURL
            }
            index += 1
        }
    }
}

private extension URL {
    func pathRelativeString(to childURL: URL) -> String {
        let rootPath = self.standardizedFileURL.path
        let childPath = childURL.standardizedFileURL.path
        guard childPath.hasPrefix(rootPath) else {
            return childPath
        }

        return String(childPath.dropFirst(rootPath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
