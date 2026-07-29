(function () {
  "use strict";

  const extensionApi = globalThis.chrome || globalThis.browser;
  if (!extensionApi) {
    throw new Error("Browser extension API is not available.");
  }
  const chrome = extensionApi;
  const EXPORTED_MARKDOWN_ROOT = "/Users/mayifan/Library/Mobile Documents/iCloud~md~obsidian/Documents/同步/10_Raw/AI Chat History";
  const PACKAGED_EXPORTED_INDEX_PATH = "src/exported-markdown-index.json";

  function toBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }

    return btoa(binary);
  }

  function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/");
  }

  function stripUnsafePathSegments(value) {
    return normalizePath(value)
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");
  }

  function downloadFilenamePath(folder, filename) {
    const root = normalizePath(EXPORTED_MARKDOWN_ROOT);
    let cleanFolder = normalizePath(folder || "");
    const cleanFilename = stripUnsafePathSegments(filename || "AI_Chat.md").split("/").pop() || "AI_Chat.md";

    if (cleanFolder === root || cleanFolder.startsWith(`${root}/`)) {
      cleanFolder = cleanFolder.slice(root.length).replace(/^\/+/, "");
    }

    cleanFolder = stripUnsafePathSegments(cleanFolder);
    return cleanFolder ? `${cleanFolder}/${cleanFilename}` : cleanFilename;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
  }

  function decodeDataUrlText(urlLike) {
    const text = String(urlLike || "");
    if (!/^data:/i.test(text)) {
      return "";
    }

    const commaIndex = text.indexOf(",");
    if (commaIndex < 0) {
      return "";
    }

    const metadata = text.slice(5, commaIndex).toLowerCase();
    const payload = text.slice(commaIndex + 1);
    try {
      return metadata.includes(";base64")
        ? decodeBase64Utf8(payload)
        : decodeURIComponent(payload);
    } catch (_error) {
      return "";
    }
  }

  function unescapeMetadataValue(value) {
    let clean = String(value || "").trim();
    if (
      (clean.startsWith("\"") && clean.endsWith("\"")) ||
      (clean.startsWith("'") && clean.endsWith("'"))
    ) {
      clean = clean.slice(1, -1);
    }

    return clean
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .trim();
  }

  function metadataFieldName(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function assignMetadataField(target, key, value) {
    const cleanValue = unescapeMetadataValue(value);
    if (!cleanValue) {
      return;
    }

    const normalizedKey = metadataFieldName(key);
    if (normalizedKey === "platform") {
      target.platform = target.platform || cleanValue;
    } else if (normalizedKey === "source_url") {
      target.sourceUrl = target.sourceUrl || cleanValue;
    } else if (normalizedKey === "conversation_id") {
      target.conversationId = target.conversationId || cleanValue;
    } else if (normalizedKey === "conversation_title") {
      target.title = target.title || cleanValue;
    } else if (normalizedKey === "needs_media") {
      target.needsMedia = target.needsMedia || cleanValue;
    }
  }

  function parseYamlFrontMatter(markdown, target) {
    const match = String(markdown || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) {
      return;
    }

    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (field) {
        assignMetadataField(target, field[1], field[2]);
      }
    }
  }

  function parseVisibleMetadata(markdown, target) {
    const match = String(markdown || "").match(/(?:^|\r?\n)## Metadata\s*\r?\n+([\s\S]*?)(?=\r?\n## |\r?\n# |$)/i);
    if (!match) {
      return;
    }

    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^\s*-\s*([^:]+?)\s*:\s*(.*?)\s*$/);
      if (field) {
        assignMetadataField(target, field[1], field[2]);
      }
    }
  }

  function parseMarkdownMetadata(markdown) {
    const metadata = {
      platform: "",
      sourceUrl: "",
      conversationId: "",
      title: "",
      needsMedia: ""
    };
    if (!markdown) {
      return metadata;
    }

    parseYamlFrontMatter(markdown, metadata);
    parseVisibleMetadata(markdown, metadata);
    return metadata;
  }

  function markdownMetadataFromDownload(downloadItem) {
    const markdown = decodeDataUrlText((downloadItem && (downloadItem.url || downloadItem.finalUrl)) || "");
    return parseMarkdownMetadata(markdown);
  }

  function runtimeLastError() {
    return chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
  }

  function extensionApiError(error, fallbackMessage = "Browser extension API call failed.") {
    if (error instanceof Error) {
      return error;
    }

    const message = error && error.message ? error.message : String(error || fallbackMessage);
    return new Error(message);
  }

  function callbackUnsupported(error) {
    const message = error && error.message ? error.message : String(error || "");
    return /callback|argument|too many|does not accept/i.test(message);
  }

  function nativeMessagingAvailable() {
    return Boolean(chrome.runtime && chrome.runtime.sendNativeMessage);
  }

  function sendNativeMessage(message) {
    if (!nativeMessagingAvailable()) {
      return Promise.reject(new Error("This browser does not support native messaging."));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (handler, value) => {
        if (settled) {
          return;
        }

        settled = true;
        handler(value);
      };
      const callback = (response) => {
        const error = runtimeLastError();
        if (error) {
          settle(reject, extensionApiError(error));
          return;
        }

        settle(resolve, response || {});
      };
      const retryWithoutCallback = (originalError) => {
        try {
          Promise.resolve(chrome.runtime.sendNativeMessage(message))
            .then((response) => settle(resolve, response || {}), (error) => settle(reject, extensionApiError(error || originalError)));
        } catch (promiseError) {
          settle(reject, extensionApiError(promiseError || originalError));
        }
      };

      try {
        const maybePromise = chrome.runtime.sendNativeMessage(message, callback);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(
            (response) => settle(resolve, response || {}),
            (error) => {
              if (callbackUnsupported(error)) {
                retryWithoutCallback(error);
                return;
              }

              settle(reject, extensionApiError(error));
            }
          );
        }
      } catch (callbackError) {
        retryWithoutCallback(callbackError);
      }
    });
  }

  function searchDownloads(query) {
    if (!chrome.downloads || !chrome.downloads.search) {
      return Promise.resolve([]);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (handler, value) => {
        if (settled) {
          return;
        }

        settled = true;
        handler(value);
      };
      const callback = (items) => {
        const error = runtimeLastError();
        if (error) {
          settle(reject, extensionApiError(error));
          return;
        }

        settle(resolve, items || []);
      };
      const retryWithoutCallback = (originalError) => {
        try {
          Promise.resolve(chrome.downloads.search(query))
            .then((items) => settle(resolve, items || []), (error) => settle(reject, extensionApiError(error || originalError)));
        } catch (promiseError) {
          settle(reject, extensionApiError(promiseError || originalError));
        }
      };

      try {
        const maybePromise = chrome.downloads.search(query, callback);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(
            (items) => settle(resolve, items || []),
            (error) => {
              if (callbackUnsupported(error)) {
                retryWithoutCallback(error);
                return;
              }

              settle(reject, extensionApiError(error));
            }
          );
        }
      } catch (callbackError) {
        retryWithoutCallback(callbackError);
      }
    });
  }

  function downloadWithOptions(options) {
    if (!chrome.downloads || !chrome.downloads.download) {
      return Promise.reject(new Error("This browser does not support the downloads API."));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (handler, value) => {
        if (settled) {
          return;
        }

        settled = true;
        handler(value);
      };
      const callback = (downloadId) => {
        const error = runtimeLastError();
        if (error) {
          settle(reject, extensionApiError(error));
          return;
        }

        settle(resolve, downloadId);
      };
      const retryWithoutCallback = (originalError) => {
        try {
          Promise.resolve(chrome.downloads.download(options))
            .then((downloadId) => settle(resolve, downloadId), (error) => settle(reject, extensionApiError(error || originalError)));
        } catch (promiseError) {
          settle(reject, extensionApiError(promiseError || originalError));
        }
      };

      try {
        const maybePromise = chrome.downloads.download(options, callback);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(
            (downloadId) => settle(resolve, downloadId),
            (error) => {
              if (callbackUnsupported(error)) {
                retryWithoutCallback(error);
                return;
              }

              settle(reject, extensionApiError(error));
            }
          );
        }
      } catch (callbackError) {
        retryWithoutCallback(callbackError);
      }
    });
  }

  async function downloadMarkdownFile(options) {
    try {
      return await downloadWithOptions(options);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (Object.prototype.hasOwnProperty.call(options, "conflictAction") && /conflictAction|unsupported|unexpected|invalid/i.test(message)) {
        const fallbackOptions = { ...options };
        delete fallbackOptions.conflictAction;
        return downloadWithOptions(fallbackOptions);
      }

      throw error;
    }
  }

  async function saveWithNativeApp(message) {
    const response = await sendNativeMessage({
      type: "SAVE_MARKDOWN_FILE",
      relativePath: message.relativePath,
      textBase64: toBase64Utf8(message.text || ""),
      mimeType: message.mimeType || "text/markdown",
      conflictAction: message.conflictAction || "uniquify"
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Native Safari file save failed.");
    }

    return response;
  }

  async function downloadOrSaveText(options, nativeMessage) {
    if (chrome.downloads && chrome.downloads.download) {
      try {
        return { downloadId: await downloadMarkdownFile(options) };
      } catch (error) {
        if (!nativeMessagingAvailable()) {
          throw error;
        }
      }
    }

    const nativeResult = await saveWithNativeApp(nativeMessage);
    return {
      nativePath: nativeResult.path || "",
      relativePath: nativeResult.relativePath || nativeMessage.relativePath
    };
  }

  function exportedMarkdownFile(downloadItem) {
    const filename = normalizePath(downloadItem && downloadItem.filename);
    const root = normalizePath(EXPORTED_MARKDOWN_ROOT);
    if (!filename || !filename.toLowerCase().endsWith(".md")) {
      return null;
    }

    if (filename !== root && !filename.startsWith(`${root}/`)) {
      return null;
    }

    const relativePath = filename.slice(root.length).replace(/^\/+/, "");
    if (!relativePath) {
      return null;
    }

    const parts = relativePath.split("/").filter(Boolean);
    return {
      id: downloadItem.id,
      filename,
      relativePath,
      basename: parts[parts.length - 1] || relativePath,
      platformFolder: parts.length > 1 ? parts[0] : "",
      metadata: markdownMetadataFromDownload(downloadItem)
    };
  }

  function exportedMarkdownSnapshotFile(file) {
    const relativePath = normalizePath(file && file.relativePath);
    const basename = normalizePath(file && file.basename);
    const platformFolder = normalizePath(file && file.platformFolder);
    if (!relativePath || !relativePath.toLowerCase().endsWith(".md")) {
      return null;
    }

    const parts = relativePath.split("/").filter(Boolean);
    return {
      id: file.id || `snapshot:${relativePath}`,
      filename: normalizePath(file.filename || `${EXPORTED_MARKDOWN_ROOT}/${relativePath}`),
      relativePath,
      basename: basename || parts[parts.length - 1] || relativePath,
      platformFolder: platformFolder || (parts.length > 1 ? parts[0] : ""),
      metadata: {
        platform: "",
        sourceUrl: "",
        conversationId: "",
        title: "",
        needsMedia: "",
        ...((file && file.metadata) || {})
      }
    };
  }

  async function loadPackagedExportedMarkdownFiles() {
    if (!globalThis.fetch || !chrome.runtime.getURL) {
      return [];
    }

    try {
      const response = await fetch(chrome.runtime.getURL(PACKAGED_EXPORTED_INDEX_PATH), { cache: "no-store" });
      if (!response || !response.ok) {
        return [];
      }

      const payload = await response.json();
      return (payload.files || [])
        .map(exportedMarkdownSnapshotFile)
        .filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  async function listExportedMarkdownFiles() {
    const rootPattern = `^${escapeRegExp(normalizePath(EXPORTED_MARKDOWN_ROOT))}/.*\\.md$`;
    let items;

    try {
      items = await searchDownloads({ state: "complete", filenameRegex: rootPattern });
    } catch (_error) {
      items = await searchDownloads({ state: "complete" });
    }

    const seen = new Set();
    const files = [];
    const snapshotFiles = await loadPackagedExportedMarkdownFiles();
    const allItems = [
      ...items.filter((item) => item && item.exists !== false).map(exportedMarkdownFile),
      ...snapshotFiles
    ].filter(Boolean);

    for (const file of allItems) {
      const key = normalizePath(file.filename || file.relativePath);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      files.push(file);
    }

    return {
      ok: true,
      root: EXPORTED_MARKDOWN_ROOT,
      files,
      sources: {
        downloads: items.length,
        snapshot: snapshotFiles.length
      }
    };
  }

  function downloadText(message, sendResponse) {
    const filename = message.filename || "AI_Chat.md";
    const body = message.markdown || message.text || "";
    const mimeType = message.mimeType || "text/markdown";
    const folder = message.folder || EXPORTED_MARKDOWN_ROOT;
    const conflictAction = message.conflictAction || "uniquify";
    const url = `data:${mimeType};charset=utf-8;base64,${toBase64Utf8(body)}`;
    const targetPath = downloadFilenamePath(folder, filename);

    downloadOrSaveText({
      url,
      filename: targetPath,
      saveAs: false,
      conflictAction: conflictAction
    }, {
      relativePath: targetPath,
      text: body,
      mimeType,
      conflictAction
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "LIST_EXPORTED_MARKDOWN_FILES") {
      listExportedMarkdownFiles()
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error)
        }));
      return true;
    }

    if (message.type === "DOWNLOAD_MARKDOWN" || message.type === "DOWNLOAD_TEXT") {
      downloadText(message, sendResponse);
      return true;
    }

    return false;
  });
})();
