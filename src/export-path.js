(function (global) {
  "use strict";

  const namespace = (global.AIChatExporterExportPath = global.AIChatExporterExportPath || {});

  const SETTINGS_KEY = "aiChatExporterSettings";
  const REGISTRY_KEY = "aiChatExporterExportRegistry";
  const DB_NAME = "ai-chat-exporter";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const EXPORT_DIRECTORY_KEY = "exportDirectory";
  const DEFAULT_DOWNLOAD_ROOT_LABEL = "浏览器默认下载目录";
  const DEFAULT_EXPORT_ROOT_LABEL = DEFAULT_DOWNLOAD_ROOT_LABEL;

  function isSupported() {
    return Boolean(
      (global.chrome && chrome.runtime && chrome.runtime.sendMessage) ||
      canPickExportDirectory()
    );
  }

  function canPickExportDirectory() {
    return Boolean(global.showDirectoryPicker && global.indexedDB);
  }

  function chromeGet(key) {
    return chrome.storage.local.get(key).catch(() => ({}));
  }

  function chromeSet(payload) {
    return chrome.storage.local.set(payload);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withHandleStore(mode, callback) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let callbackResult;

      transaction.oncomplete = () => {
        database.close();
        resolve(callbackResult);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };

      callbackResult = callback(store);
    });
  }

  function saveDirectoryHandle(handle) {
    return withHandleStore("readwrite", (store) => store.put(handle, EXPORT_DIRECTORY_KEY));
  }

  function loadDirectoryHandle() {
    return withHandleStore("readonly", (store) => requestToPromise(store.get(EXPORT_DIRECTORY_KEY)));
  }

  async function loadSettings() {
    const stored = await chromeGet(SETTINGS_KEY);
    const settings = stored && stored[SETTINGS_KEY] && typeof stored[SETTINGS_KEY] === "object"
      ? stored[SETTINGS_KEY]
      : {};

    return {
      exportMode: settings.exportMode || "downloads",
      exportRootLabel: settings.exportRootLabel || "",
      exportRootName: settings.exportRootName || "",
      updatedAt: settings.updatedAt || ""
    };
  }

  async function saveSettings(settings) {
    const next = {
      ...(await loadSettings()),
      ...settings,
      updatedAt: new Date().toISOString()
    };
    await chromeSet({ [SETTINGS_KEY]: next });
    return next;
  }

  async function exportRootLabel() {
    const settings = await loadSettings();
    if (settings.exportMode === "file-system-access") {
      return settings.exportRootLabel || settings.exportRootName || DEFAULT_DOWNLOAD_ROOT_LABEL;
    }

    return DEFAULT_DOWNLOAD_ROOT_LABEL;
  }

  async function queryPermission(handle, requestWrite) {
    if (!handle) {
      return false;
    }

    const options = requestWrite ? { mode: "readwrite" } : { mode: "read" };
    return handle.queryPermission
      ? (await handle.queryPermission(options)) === "granted"
      : false;
  }

  async function requestPermission(handle, requestWrite) {
    if (!handle) {
      return false;
    }

    if (await queryPermission(handle, requestWrite)) {
      return true;
    }

    const options = requestWrite ? { mode: "readwrite" } : { mode: "read" };
    return handle.requestPermission
      ? (await handle.requestPermission(options)) === "granted"
      : false;
  }

  async function pickExportDirectory() {
    if (!canPickExportDirectory()) {
      throw new Error("当前浏览器不支持自由选择本地导出目录，请使用新版 Chrome 或 Edge。");
    }

    const handle = await global.showDirectoryPicker({
      id: "ai-chat-exporter-root",
      mode: "readwrite"
    });
    const granted = await requestPermission(handle, true);
    if (!granted) {
      throw new Error("没有获得导出目录写入权限。");
    }

    await saveDirectoryHandle(handle);
    return saveSettings({
      exportMode: "file-system-access",
      exportRootName: handle.name || "AI Chat History",
      exportRootLabel: handle.name || "AI Chat History"
    });
  }

  async function getExportDirectoryHandle() {
    if (!canPickExportDirectory()) {
      return null;
    }

    const handle = await loadDirectoryHandle().catch(() => null);
    if (!handle) {
      return null;
    }

    const granted = await queryPermission(handle, true);
    if (granted) {
      return handle;
    }

    return null;
  }

  async function hasExportDirectory() {
    const settings = await loadSettings();
    if (settings.exportMode !== "file-system-access") {
      return true;
    }

    return Boolean(await getExportDirectoryHandle());
  }

  function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/");
  }

  function cleanSegment(value, fallback) {
    const clean = normalizePath(value)
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part && part !== "." && part !== "..")
      .join(" ")
      .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120);

    return clean || fallback;
  }

  function cleanFilename(value, fallback) {
    const basename = normalizePath(value).split("/").pop() || fallback;
    return cleanSegment(basename, fallback);
  }

  async function fileExists(directoryHandle, filename) {
    try {
      await directoryHandle.getFileHandle(filename, { create: false });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function uniqueFilename(directoryHandle, filename, conflictAction) {
    const clean = cleanFilename(filename, "AI_Chat.md");
    if (conflictAction === "overwrite" || !(await fileExists(directoryHandle, clean))) {
      return clean;
    }

    const match = clean.match(/^(.*?)(\.[^.]+)?$/);
    const stem = (match && match[1]) || "AI_Chat";
    const extension = (match && match[2]) || "";

    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${stem} (${index})${extension}`;
      if (!(await fileExists(directoryHandle, candidate))) {
        return candidate;
      }
    }

    return `${stem}_${Date.now()}${extension}`;
  }

  function registryKey(record) {
    const platform = record.platform || "";
    const identity = record.conversationId || record.sourceUrl || record.url || record.relativePath || "";
    return platform && identity ? `${platform}:${identity}` : "";
  }

  async function rememberExportedFile(record) {
    const key = registryKey(record);
    if (!key) {
      return false;
    }

    const stored = await chromeGet(REGISTRY_KEY);
    const registry = stored && stored[REGISTRY_KEY] && stored[REGISTRY_KEY].items
      ? stored[REGISTRY_KEY]
      : { version: 1, items: {} };

    registry.items[key] = {
      platform: record.platform || "",
      conversationId: record.conversationId || "",
      url: record.sourceUrl || record.url || "",
      title: record.title || "",
      conversationTime: record.conversationTime || "",
      rawDateText: record.rawDateText || "",
      filename: record.filename || "",
      relativePath: record.relativePath || "",
      messageCount: record.messageCount || 0,
      exportRoot: record.exportRoot || "",
      backedUpAt: new Date().toISOString()
    };

    await chromeSet({ [REGISTRY_KEY]: registry });
    return true;
  }

  async function writeFileSystemMarkdownFile(options = {}) {
    const directoryHandle = await getExportDirectoryHandle();
    if (!directoryHandle) {
      throw new Error("自定义导出目录权限不可用，请点击“自定义导出目录”重新授权。");
    }

    const platform = cleanSegment(options.platform || "AI", "AI");
    const platformDirectory = await directoryHandle.getDirectoryHandle(platform, { create: true });
    const filename = await uniqueFilename(platformDirectory, options.filename || "AI_Chat.md", options.conflictAction);
    const fileHandle = await platformDirectory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([options.markdown || options.text || ""], {
      type: options.mimeType || "text/markdown;charset=utf-8"
    }));
    await writable.close();

    const relativePath = `${platform}/${filename}`;
    const rootLabel = await exportRootLabel();
    await rememberExportedFile({
      platform,
      conversationId: options.conversationId || "",
      sourceUrl: options.sourceUrl || options.url || "",
      title: options.title || "",
      conversationTime: options.conversationTime || "",
      rawDateText: options.rawDateText || "",
      filename,
      relativePath,
      messageCount: options.messageCount || 0,
      exportRoot: rootLabel
    });

    return {
      ok: true,
      filename,
      relativePath,
      path: `${rootLabel}/${relativePath}`
    };
  }

  async function downloadMarkdownFile(options = {}) {
    const platform = cleanSegment(options.platform || "AI", "AI");
    const filename = cleanFilename(options.filename || "AI_Chat.md", "AI_Chat.md");
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_MARKDOWN",
      folder: platform,
      filename,
      markdown: options.markdown || options.text || "",
      mimeType: options.mimeType || "text/markdown",
      conflictAction: options.conflictAction || "uniquify"
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || "写入 Markdown 失败。");
    }

    const relativePath = response.relativePath || `${platform}/${response.filename || filename}`;
    const actualFilename = response.filename || relativePath.split("/").pop() || filename;
    await rememberExportedFile({
      platform,
      conversationId: options.conversationId || "",
      sourceUrl: options.sourceUrl || options.url || "",
      title: options.title || "",
      conversationTime: options.conversationTime || "",
      rawDateText: options.rawDateText || "",
      filename: actualFilename,
      relativePath,
      messageCount: options.messageCount || 0,
      exportRoot: DEFAULT_DOWNLOAD_ROOT_LABEL
    });

    return {
      ok: true,
      filename: actualFilename,
      relativePath,
      path: `${DEFAULT_DOWNLOAD_ROOT_LABEL}/${relativePath}`,
      downloadId: response.downloadId || null
    };
  }

  async function writeMarkdownFile(options = {}) {
    const settings = await loadSettings();
    if (settings.exportMode === "file-system-access") {
      return writeFileSystemMarkdownFile(options);
    }

    return downloadMarkdownFile(options);
  }

  namespace.DEFAULT_EXPORT_ROOT_LABEL = DEFAULT_EXPORT_ROOT_LABEL;
  namespace.DEFAULT_DOWNLOAD_ROOT_LABEL = DEFAULT_DOWNLOAD_ROOT_LABEL;
  namespace.SETTINGS_KEY = SETTINGS_KEY;
  namespace.REGISTRY_KEY = REGISTRY_KEY;
  namespace.canPickExportDirectory = canPickExportDirectory;
  namespace.exportRootLabel = exportRootLabel;
  namespace.hasExportDirectory = hasExportDirectory;
  namespace.isSupported = isSupported;
  namespace.loadSettings = loadSettings;
  namespace.pickExportDirectory = pickExportDirectory;
  namespace.rememberExportedFile = rememberExportedFile;
  namespace.writeMarkdownFile = writeMarkdownFile;
})(globalThis);
