(function () {
  "use strict";

  const EXPORT_SETTINGS_KEY = "aiChatExporterSettings";
  const EXPORT_REGISTRY_KEY = "aiChatExporterExportRegistry";
  const DEFAULT_EXPORT_ROOT_LABEL = "未设置导出目录";
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
    let cleanFolder = normalizePath(folder || "");
    const cleanFilename = stripUnsafePathSegments(filename || "AI_Chat.md").split("/").pop() || "AI_Chat.md";

    const marker = "/AI Chat History/";
    const markerIndex = cleanFolder.indexOf(marker);
    if (markerIndex >= 0) {
      cleanFolder = cleanFolder.slice(markerIndex + marker.length);
    } else if (/^(?:\/|[A-Za-z]:\/)/.test(cleanFolder)) {
      cleanFolder = cleanFolder.split("/").filter(Boolean).slice(-1).join("/");
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

  function searchDownloads(query) {
    return new Promise((resolve, reject) => {
      chrome.downloads.search(query, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(items || []);
      });
    });
  }

  function exportedMarkdownFile(downloadItem, root) {
    const filename = normalizePath(downloadItem && downloadItem.filename);
    const cleanRoot = normalizePath(root);
    if (!filename || !filename.toLowerCase().endsWith(".md")) {
      return null;
    }

    if (!cleanRoot || filename === cleanRoot || !filename.startsWith(`${cleanRoot}/`)) {
      return null;
    }

    const relativePath = filename.slice(cleanRoot.length).replace(/^\/+/, "");
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

  function exportedMarkdownSnapshotFile(file, root = DEFAULT_EXPORT_ROOT_LABEL) {
    const relativePath = normalizePath(file && file.relativePath);
    const basename = normalizePath(file && file.basename);
    const platformFolder = normalizePath(file && file.platformFolder);
    if (!relativePath || !relativePath.toLowerCase().endsWith(".md")) {
      return null;
    }

    const parts = relativePath.split("/").filter(Boolean);
    return {
      id: file.id || `snapshot:${relativePath}`,
      filename: normalizePath(file.filename || `${root}/${relativePath}`),
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
        .map((file) => exportedMarkdownSnapshotFile(file))
        .filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  async function loadExportSettings() {
    const stored = await chrome.storage.local.get(EXPORT_SETTINGS_KEY).catch(() => ({}));
    const settings = stored && stored[EXPORT_SETTINGS_KEY] && typeof stored[EXPORT_SETTINGS_KEY] === "object"
      ? stored[EXPORT_SETTINGS_KEY]
      : {};
    return {
      root: settings.exportRootLabel || settings.exportRootName || DEFAULT_EXPORT_ROOT_LABEL
    };
  }

  function registryFileFromRecord(record, root) {
    const platform = stripUnsafePathSegments(record && record.platform || "AI") || "AI";
    const basename = stripUnsafePathSegments(record && record.filename || "AI_Chat.md").split("/").pop() || "AI_Chat.md";
    const relativePath = normalizePath((record && record.relativePath) || `${platform}/${basename}`);

    return exportedMarkdownSnapshotFile({
      id: `registry:${platform}:${(record && (record.conversationId || record.url || relativePath)) || relativePath}`,
      filename: `${root}/${relativePath}`,
      relativePath,
      basename,
      platformFolder: platform,
      metadata: {
        platform,
        sourceUrl: (record && record.url) || "",
        conversationId: (record && record.conversationId) || "",
        title: (record && record.title) || "",
        needsMedia: ""
      }
    }, root);
  }

  async function loadRegistryExportedMarkdownFiles(root) {
    const stored = await chrome.storage.local.get(EXPORT_REGISTRY_KEY).catch(() => ({}));
    const registry = stored && stored[EXPORT_REGISTRY_KEY];
    const items = registry && registry.items && typeof registry.items === "object"
      ? Object.values(registry.items)
      : [];

    return items
      .map((record) => registryFileFromRecord(record, root))
      .filter(Boolean);
  }

  async function listExportedMarkdownFiles() {
    const settings = await loadExportSettings();
    const root = normalizePath(settings.root || DEFAULT_EXPORT_ROOT_LABEL);
    const rootPattern = root && root !== DEFAULT_EXPORT_ROOT_LABEL
      ? `^${escapeRegExp(root)}/.*\\.md$`
      : "";
    let items;

    try {
      items = rootPattern
        ? await searchDownloads({ state: "complete", filenameRegex: rootPattern })
        : [];
    } catch (_error) {
      items = [];
    }

    const seen = new Set();
    const files = [];
    const snapshotFiles = await loadPackagedExportedMarkdownFiles();
    const registryFiles = await loadRegistryExportedMarkdownFiles(root);
    const allItems = [
      ...items.filter((item) => item && item.exists !== false).map((item) => exportedMarkdownFile(item, root)),
      ...registryFiles,
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
      root,
      files,
      sources: {
        downloads: items.length,
        registry: registryFiles.length,
        snapshot: snapshotFiles.length
      }
    };
  }

  function downloadText(message, sendResponse) {
    const filename = message.filename || "AI_Chat.md";
    const body = message.markdown || message.text || "";
    const mimeType = message.mimeType || "text/markdown";
    const folder = message.folder || "";
    const conflictAction = message.conflictAction || "uniquify";
    const url = `data:${mimeType};charset=utf-8;base64,${toBase64Utf8(body)}`;
    const targetPath = downloadFilenamePath(folder, filename);

    chrome.downloads.download(
      {
        url,
        filename: targetPath,
        saveAs: false,
        conflictAction: conflictAction
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          sendResponse({ ok: false, error: error.message });
          return;
        }

        sendResponse({ ok: true, downloadId });
      }
    );
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
