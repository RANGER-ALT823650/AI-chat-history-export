(function () {
  "use strict";

  const EXPORTED_MARKDOWN_ROOT = "/Users/mayifan/Downloads/AI Chat Exports";

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
      title: ""
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
    for (const item of items) {
      if (item && item.exists === false) {
        continue;
      }

      const file = exportedMarkdownFile(item);
      if (!file || seen.has(file.filename)) {
        continue;
      }

      seen.add(file.filename);
      files.push(file);
    }

    return {
      ok: true,
      root: EXPORTED_MARKDOWN_ROOT,
      files
    };
  }

  function downloadText(message, sendResponse) {
    const filename = message.filename || "AI_Chat.md";
    const body = message.markdown || message.text || "";
    const mimeType = message.mimeType || "text/markdown";
    const folder = message.folder || "AI Chat Exports";
    const url = `data:${mimeType};charset=utf-8;base64,${toBase64Utf8(body)}`;

    chrome.downloads.download(
      {
        url,
        filename: `${folder}/${filename}`,
        saveAs: false,
        conflictAction: "uniquify"
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
