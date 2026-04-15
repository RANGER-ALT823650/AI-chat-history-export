(function () {
  "use strict";

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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || (message.type !== "DOWNLOAD_MARKDOWN" && message.type !== "DOWNLOAD_TEXT")) {
      return false;
    }

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

    return true;
  });
})();
