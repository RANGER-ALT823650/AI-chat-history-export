(function () {
  "use strict";

  const CONTENT_FILES = [
    "src/content/platform-utils.js",
    "src/content/timestamp-cache.js",
    "src/content/structured-cache.js",
    "src/content/markdown.js",
    "src/content/adapters/common.js",
    "src/content/adapters/chatgpt.js",
    "src/content/adapters/gemini.js",
    "src/content/adapters/grok.js",
    "src/content/adapters/deepseek.js",
    "src/content/adapters/doubao.js",
    "src/content/adapters/claude.js",
    "src/content/history-discovery.js",
    "src/content/content.js"
  ];
  const MAIN_WORLD_FILES = [
    "src/content/api-interceptor.js"
  ];
  const STORAGE_KEY = "aiChatExporterBatchState";
  const REGISTRY_KEY = "aiChatExporterExportRegistry";
  const EXPORTED_MARKDOWN_ROOT = "/Users/mayifan/Downloads/AI Chat Exports";
  const params = new URLSearchParams(window.location.search);
  const sourceTabId = Number(params.get("sourceTabId"));

  const sourceElement = document.getElementById("source");
  const statusElement = document.getElementById("status");
  const discoverButton = document.getElementById("discoverButton");
  const exportButton = document.getElementById("exportButton");
  const cancelButton = document.getElementById("cancelButton");
  const clearButton = document.getElementById("clearButton");
  const clearRegistryButton = document.getElementById("clearRegistryButton");
  const queueElement = document.getElementById("queue");
  const totalCountElement = document.getElementById("totalCount");
  const queuedCountElement = document.getElementById("queuedCount");
  const successCountElement = document.getElementById("successCount");
  const skippedCountElement = document.getElementById("skippedCount");
  const failedCountElement = document.getElementById("failedCount");
  const registryCountElement = document.getElementById("registryCount");

  let state = {
    sourceTabId,
    sourceUrl: "",
    platform: "",
    items: [],
    forceReexportExistingFiles: false,
    updatedAt: ""
  };
  let exportRegistry = {
    version: 1,
    items: {}
  };
  let exportedFileIndex = {
    root: EXPORTED_MARKDOWN_ROOT,
    files: [],
    identityKeys: new Set(),
    sourceUrlKeys: new Set(),
    filenameKeys: new Set()
  };
  let cancelRequested = false;
  let running = false;

  function setStatus(value) {
    statusElement.textContent = value;
  }

  function statusLabel(status) {
    const labels = {
      queued: "待导出",
      running: "正在导出",
      succeeded: "成功",
      failed: "失败",
      skipped: "已跳过"
    };
    return labels[status] || status || "待导出";
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    return chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY] && stored[STORAGE_KEY].sourceTabId === sourceTabId) {
      state = stored[STORAGE_KEY];
    }
  }

  function validRegistry(value) {
    return Boolean(value && typeof value === "object" && value.items && typeof value.items === "object");
  }

  async function loadRegistry() {
    const stored = await chrome.storage.local.get(REGISTRY_KEY);
    exportRegistry = validRegistry(stored && stored[REGISTRY_KEY])
      ? stored[REGISTRY_KEY]
      : { version: 1, items: {} };
  }

  function saveRegistry() {
    return chrome.storage.local.set({ [REGISTRY_KEY]: exportRegistry });
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function truncate(value, maxLength) {
    const clean = normalizeWhitespace(value);
    if (clean.length <= maxLength) {
      return clean;
    }

    return clean.slice(0, maxLength).replace(/\s+\S*$/, "").trim() || clean.slice(0, maxLength).trim();
  }

  function makeSlug(value, fallback) {
    const source = truncate(value, 80) || fallback || "AI Chat";
    const slug = source
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90);

    return slug || fallback || "AI_Chat";
  }

  function formatDateForFilename(value) {
    if (!value) {
      return "";
    }

    const isoDate = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return isoDate ? isoDate[0] : "";
  }

  function buildPredictedFilename(item, platformFallback = "", options = {}) {
    const platform = makeSlug(item.platform || platformFallback || state.platform || "AI", "AI");
    const title = makeSlug(item.title || "AI Chat", "AI_Chat");
    const date = options.omitDate ? "" : formatDateForFilename(item.conversationTime);
    const prefix = date ? `${date}_` : "";
    return `${prefix}${platform}_${title}.md`;
  }

  function stripDownloadConflictSuffix(value) {
    return String(value || "").replace(/ \(\d+\)(\.md)$/i, "$1");
  }

  function canonicalExportKey(value) {
    const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!parts.length) {
      return "";
    }

    parts[parts.length - 1] = stripDownloadConflictSuffix(parts[parts.length - 1]);
    return parts.join("/").normalize("NFKC").toLowerCase();
  }

  function exportedFileKeys(file) {
    const keys = new Set();
    const relativePath = file && file.relativePath;
    const basename = file && file.basename;
    const platformFolder = file && file.platformFolder;

    for (const value of [
      relativePath,
      basename,
      platformFolder && basename ? `${platformFolder}/${basename}` : ""
    ]) {
      const key = canonicalExportKey(value);
      if (key) {
        keys.add(key);
      }
    }

    return Array.from(keys);
  }

  function platformKey(value) {
    return normalizeWhitespace(value).normalize("NFKC").toLowerCase();
  }

  function identityKey(platform, conversationId) {
    const cleanPlatform = platformKey(platform);
    const cleanId = normalizeWhitespace(conversationId).normalize("NFKC").toLowerCase();
    return cleanPlatform && cleanId ? `${cleanPlatform}:${cleanId}` : "";
  }

  function platformLabelFromUrl(urlLike) {
    try {
      const hostname = new URL(urlLike).hostname.toLowerCase();
      if (hostname === "chatgpt.com" || hostname === "chat.openai.com") {
        return "ChatGPT";
      }
      if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
        return "Claude";
      }
      if (hostname === "gemini.google.com") {
        return "Gemini";
      }
      if (hostname === "grok.com" || hostname.endsWith(".grok.com") || hostname === "grok.x.ai" || hostname === "x.com") {
        return "Grok";
      }
      if (hostname === "chat.deepseek.com" || hostname === "deepseek.com" || hostname.endsWith(".deepseek.com")) {
        return "DeepSeek";
      }
      if (hostname === "doubao.com" || hostname.endsWith(".doubao.com")) {
        return "Doubao";
      }
    } catch (_error) {
      // Keep the caller-provided platform fallback.
    }

    return "";
  }

  function normalizeSourceUrlForDedupe(urlLike) {
    try {
      const url = new URL(urlLike);
      url.hash = "";
      url.search = "";
      return url.href.replace(/\/$/, "").normalize("NFKC").toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function sourceUrlKey(platform, urlLike) {
    const cleanPlatform = platformKey(platform || platformLabelFromUrl(urlLike));
    const cleanUrl = normalizeSourceUrlForDedupe(urlLike);
    return cleanPlatform && cleanUrl ? `${cleanPlatform}:${cleanUrl}` : "";
  }

  function metadataPlatform(file) {
    const metadata = (file && file.metadata) || {};
    return metadata.platform || file.platformFolder || platformLabelFromUrl(metadata.sourceUrl || "");
  }

  function buildExportedFileIndex(files, root = EXPORTED_MARKDOWN_ROOT) {
    const identityKeys = new Set();
    const sourceUrlKeys = new Set();
    const filenameKeys = new Set();
    for (const file of files || []) {
      const metadata = (file && file.metadata) || {};
      const platform = metadataPlatform(file);
      const identity = identityKey(platform, metadata.conversationId);
      if (identity) {
        identityKeys.add(identity);
      }

      const source = sourceUrlKey(platform, metadata.sourceUrl);
      if (source) {
        sourceUrlKeys.add(source);
      }

      for (const key of exportedFileKeys(file)) {
        filenameKeys.add(key);
      }
    }

    return {
      root,
      files: files || [],
      identityKeys,
      sourceUrlKeys,
      filenameKeys
    };
  }

  async function loadExportedFileIndex() {
    const response = await chrome.runtime.sendMessage({ type: "LIST_EXPORTED_MARKDOWN_FILES" });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "无法读取已导出的文件记录。");
    }

    exportedFileIndex = buildExportedFileIndex(response.files || [], response.root || EXPORTED_MARKDOWN_ROOT);
    return exportedFileIndex;
  }

  function candidateExportKeys(item, platformFallback = "") {
    const platform = item.platform || platformFallback || state.platform || "AI";
    const filenames = new Set([
      item.filename || "",
      buildPredictedFilename(item, platform),
      buildPredictedFilename(item, platform, { omitDate: true })
    ].filter(Boolean));
    const keys = new Set();

    for (const filename of filenames) {
      for (const value of [
        filename,
        `${platform}/${filename}`
      ]) {
        const key = canonicalExportKey(value);
        if (key) {
          keys.add(key);
        }
      }
    }

    return Array.from(keys);
  }

  function exportedFileRecordFor(item, platformFallback = "") {
    const platform = item.platform || platformFallback || state.platform || "";
    const identity = identityKey(platform, item.conversationId);
    if (identity && exportedFileIndex.identityKeys.has(identity)) {
      return { key: identity, rule: "conversation_id" };
    }

    const source = sourceUrlKey(platform, item.sourceUrl || item.url);
    if (source && exportedFileIndex.sourceUrlKeys.has(source)) {
      return { key: source, rule: "source_url" };
    }

    for (const key of candidateExportKeys(item, platformFallback)) {
      if (exportedFileIndex.filenameKeys.has(key)) {
        return { key, rule: "filename" };
      }
    }

    return null;
  }

  function rememberExportedFileCandidate(item, platformFallback = "") {
    const platform = item.platform || platformFallback || state.platform || "";
    const identity = identityKey(platform, item.conversationId);
    if (identity) {
      exportedFileIndex.identityKeys.add(identity);
    }

    const source = sourceUrlKey(platform, item.sourceUrl || item.url);
    if (source) {
      exportedFileIndex.sourceUrlKeys.add(source);
    }

    for (const key of candidateExportKeys(item, platformFallback)) {
      exportedFileIndex.filenameKeys.add(key);
    }
  }

  function registryIdentity(item) {
    return item && (item.conversationId || item.url || "");
  }

  function registryKey(item, platformFallback = "") {
    const platform = item && (item.platform || platformFallback || state.platform || "");
    const identity = registryIdentity(item);
    return platform && identity ? `${platform}:${identity}` : "";
  }

  function registryRecordFor(item, platformFallback = "") {
    const key = registryKey(item, platformFallback);
    return key ? exportRegistry.items[key] : null;
  }

  function rememberExportedItem(item, result = {}) {
    const key = registryKey(item, result.platform || item.platform || state.platform);
    if (!key) {
      return false;
    }

    exportRegistry.items[key] = {
      platform: result.platform || item.platform || state.platform || "",
      conversationId: item.conversationId || result.conversationId || "",
      url: item.url || "",
      title: item.title || result.title || "",
      conversationTime: item.conversationTime || result.conversationTime || "",
      rawDateText: item.rawDateText || "",
      filename: result.filename || item.filename || "",
      messageCount: result.messageCount || item.messageCount || 0,
      backedUpAt: result.backedUpAt || new Date().toISOString()
    };
    return true;
  }

  async function migrateSucceededStateToRegistry() {
    let changed = false;
    for (const item of state.items || []) {
      if (item.status === "succeeded" && !registryRecordFor(item)) {
        changed = rememberExportedItem(item) || changed;
      }
    }

    if (changed) {
      await saveRegistry();
    }
  }

  function registryCount() {
    return Object.keys(exportRegistry.items || {}).length;
  }

  function counts() {
    const total = state.items.length;
    const queued = state.items.filter((item) => item.status === "queued").length;
    const succeeded = state.items.filter((item) => item.status === "succeeded").length;
    const skipped = state.items.filter((item) => item.status === "skipped").length;
    const failed = state.items.filter((item) => item.status === "failed").length;
    return { total, queued, succeeded, skipped, failed, registry: registryCount() };
  }

  function render() {
    const summary = counts();
    totalCountElement.textContent = `总数 ${summary.total}`;
    queuedCountElement.textContent = `待导出 ${summary.queued}`;
    successCountElement.textContent = `成功 ${summary.succeeded}`;
    skippedCountElement.textContent = `跳过 ${summary.skipped}`;
    failedCountElement.textContent = `失败 ${summary.failed}`;
    registryCountElement.textContent = `兼容记录 ${summary.registry}`;
    exportButton.disabled = running || !state.items.length;
    cancelButton.disabled = !running;
    clearRegistryButton.disabled = running || (!summary.registry && !state.items.length);

    queueElement.textContent = "";
    const fragment = document.createDocumentFragment();

    state.items.forEach((item, index) => {
      const row = document.createElement("li");
      row.className = item.status || "queued";

      const pill = document.createElement("span");
      pill.className = "status-pill";
      pill.textContent = statusLabel(item.status);

      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title || `未命名聊天 ${index + 1}`;

      const url = document.createElement("div");
      url.className = "url";
      if (item.url) {
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = item.url;
        link.title = item.url;
        url.append(link);
      }
      body.append(title, url);

      const meta = document.createElement("span");
      meta.className = "meta";
      if (item.status === "failed") {
        meta.textContent = item.error || "导出失败";
      } else if (item.status === "skipped") {
        meta.textContent = "已存在于导出目录";
      } else if (item.status === "succeeded") {
        meta.textContent = `${item.messageCount || 0} 条消息`;
      } else {
        meta.textContent = item.conversationId || item.platform || "";
      }

      row.append(pill, body, meta);
      fragment.append(row);
    });

    queueElement.append(fragment);
  }

  function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => window.clearTimeout(timer));
    });
  }

  async function ensureContentScript(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES
    });
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: MAIN_WORLD_FILES,
        world: "MAIN"
      });
    } catch (_error) {
      // Ignored if unsupported or already injected
    }
  }

  async function sendTabMessage(tabId, message, timeoutMs = 60000) {
    await ensureContentScript(tabId);
    return withTimeout(chrome.tabs.sendMessage(tabId, message), timeoutMs, message.type);
  }

  async function waitForTabComplete(tabId, timeoutMs = 60000) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current && current.status === "complete") {
      return;
    }

    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("页面加载超时"));
      }, timeoutMs);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") {
          return;
        }

        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function getSourceTab() {
    if (!sourceTabId) {
      throw new Error("缺少来源标签页。请从 ChatGPT、Claude、Gemini、Grok、DeepSeek 或豆包页面重新打开批量导出。");
    }

    const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
    if (!tab || !tab.id || !tab.url) {
      throw new Error("来源标签页已关闭。请重新打开平台页面后再试。");
    }

    return tab;
  }

  function mergeDiscovered(conversations, platform, sourceUrl) {
    const previous = new Map(state.items.map((item) => [item.url, item]));
    state.platform = platform || state.platform;
    state.sourceUrl = sourceUrl || state.sourceUrl;
    let skippedExistingFiles = 0;
    state.items = conversations.reduce((items, item) => {
      const old = previous.get(item.url);
      const candidate = {
        ...old,
        ...item,
        conversationTime: item.conversationTime || (old && old.conversationTime) || "",
        filename: item.filename || (old && old.filename) || ""
      };
      const exportedFile = state.forceReexportExistingFiles
        ? null
        : exportedFileRecordFor(candidate, item.platform || platform);
      if (exportedFile) {
        skippedExistingFiles += 1;
        return items;
      }

      const merged = {
        ...item,
        platform: item.platform || platform,
        status: "queued",
        filename: old && old.filename,
        messageCount: old && old.messageCount,
        conversationTime: item.conversationTime || (old && old.conversationTime) || "",
        rawDateText: item.rawDateText || (old && old.rawDateText) || "",
        title: item.title || (old && old.title) || "",
        error: ""
      };

      if (old && old.status === "succeeded" && !registryRecordFor(merged, item.platform || platform)) {
        rememberExportedItem(merged, old);
      }

      items.push(merged);
      return items;
    }, []);

    return {
      discovered: conversations.length,
      skippedExistingFiles,
      queued: state.items.length
    };
  }

  async function discoverHistory() {
    running = true;
    cancelRequested = false;
    discoverButton.disabled = true;
    exportButton.disabled = true;
    setStatus("正在扫描历史列表，会自动向下滚动直到没有新聊天...");
    render();

    try {
      const tab = await getSourceTab();
      await loadRegistry();
      await loadExportedFileIndex();
      sourceElement.textContent = tab.url;
      await waitForTabComplete(tab.id);
      const result = await sendTabMessage(tab.id, {
        type: "DISCOVER_HISTORY",
        options: {
          maxRounds: 220,
          idleLimit: 8,
          geminiPreloadSidebar: false,
          geminiSearchMaxRounds: 120,
          geminiSearchIdleLimit: 5,
          geminiSearchRoundDelayMs: 220
        }
      }, 240000);

      if (!result || !result.ok) {
        throw new Error((result && result.error) || "扫描失败。");
      }

      const summary = mergeDiscovered(result.conversations || [], result.platform, result.url || tab.url);
      await saveState();
      await saveRegistry();
      if (state.forceReexportExistingFiles) {
        setStatus(`扫描完成，发现 ${summary.discovered} 条聊天。已开启重新导出模式，本轮保留全部聊天，待导出 ${summary.queued} 条。`);
      } else {
        setStatus(`扫描完成，发现 ${summary.discovered} 条聊天；已按 ${exportedFileIndex.root} 去重 ${summary.skippedExistingFiles} 条，本轮待导出 ${summary.queued} 条。`);
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error));
    } finally {
      running = false;
      discoverButton.disabled = false;
      render();
    }
  }

  function platformIdForItem(item = {}) {
    const platform = String(item.platform || state.platform || "").toLowerCase();
    if (platform === "deepseek") {
      return "deepseek";
    }

    try {
      const hostname = new URL(item.url || "").hostname.toLowerCase();
      if (hostname === "chat.deepseek.com" || hostname === "deepseek.com" || hostname.endsWith(".deepseek.com")) {
        return "deepseek";
      }
    } catch (_error) {
      // Keep the platform label fallback.
    }

    return platform;
  }

  function needsActiveWorkTab(item) {
    return platformIdForItem(item) === "deepseek";
  }

  async function waitForDeepSeekWorkTabAwake(tabId, timeoutMs = 30000) {
    const startedAt = Date.now();
    let reloaded = false;

    while (Date.now() - startedAt < timeoutMs) {
      const current = await chrome.tabs.get(tabId).catch(() => null);
      const title = current && current.title ? current.title : "";

      if (current && current.status === "complete" && !/睡眠|sleep/i.test(title)) {
        return;
      }

      if (!reloaded && /睡眠|sleep/i.test(title)) {
        reloaded = true;
        await chrome.tabs.reload(tabId).catch(() => null);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }

  async function createOrNavigateWorkTab(workTabId, item) {
    const url = item.url;
    const active = needsActiveWorkTab(item);
    if (!workTabId) {
      const tab = await chrome.tabs.create({ url, active });
      await waitForTabComplete(tab.id);
      if (active) {
        await waitForDeepSeekWorkTabAwake(tab.id);
      }
      return tab.id;
    }

    await chrome.tabs.update(workTabId, { url, active });
    await waitForTabComplete(workTabId);
    if (active) {
      await waitForDeepSeekWorkTabAwake(workTabId);
    }
    return workTabId;
  }

  async function downloadMarkdown(result, platform) {
    const download = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_MARKDOWN",
      filename: result.filename,
      markdown: result.markdown,
      folder: `AI Chat Exports/${platform || result.platform || "AI"}`
    });

    if (!download || !download.ok) {
      throw new Error((download && download.error) || "下载失败。");
    }

    return download;
  }

  async function markExported(item, result) {
    if (rememberExportedItem(item, result)) {
      await saveRegistry();
    }
  }

  async function exportCurrentFromTab(tabId, item) {
    const platform = item.platform || state.platform || "";
    const isDeepSeek = platformIdForItem(item) === "deepseek";
    try {
      await sendTabMessage(tabId, {
        type: "PREPARE_FOR_EXPORT",
        options: isDeepSeek
          ? { initialWaitMs: 2200, maxRounds: 140, stableLimit: 9, roundDelayMs: 360, finalWaitMs: 1000 }
          : { maxRounds: 110, stableLimit: 7 }
      }, isDeepSeek ? 150000 : 90000);
    } catch (error) {
      if (!isDeepSeek) {
        throw error;
      }
      // DeepSeek can keep a tab briefly suspended; the API fallback can still export if the signed-in page is awake enough.
    }

    const useHistoryTimeOverride = String(platform).toLowerCase() !== "grok";
    const result = await sendTabMessage(tabId, {
      type: "EXPORT_CURRENT_CHAT",
      overrides: {
        title: item.title || "",
        conversationTime: useHistoryTimeOverride ? item.conversationTime || "" : "",
        conversationId: item.conversationId || ""
      }
    }, 60000);
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "导出失败。");
    }

    const finalCandidate = {
      ...item,
      platform: result.platform || item.platform || state.platform,
      filename: result.filename,
      conversationTime: result.conversationTime || item.conversationTime || ""
    };
    if (!state.forceReexportExistingFiles && exportedFileRecordFor(finalCandidate, finalCandidate.platform)) {
      return {
        ...result,
        skippedExistingFile: true
      };
    }

    await downloadMarkdown(result, item.platform || state.platform);
    rememberExportedFileCandidate(finalCandidate, finalCandidate.platform);
    return result;
  }

  async function exportCurrentFromTabWithRetry(tabId, item) {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await exportCurrentFromTab(tabId, item);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      }
    }

    throw lastError;
  }

  async function exportQueue() {
    if (!state.items.length) {
      setStatus("队列为空，请先扫描历史列表。");
      return;
    }

    running = true;
    cancelRequested = false;
    let workTabId = null;

    try {
      await loadRegistry();
      await loadExportedFileIndex();
      discoverButton.disabled = true;
      exportButton.disabled = true;
      cancelButton.disabled = false;

      for (let index = 0; index < state.items.length; index += 1) {
        if (cancelRequested) {
          setStatus("已取消，保留当前进度。");
          break;
        }

        const item = state.items[index];
        if (item.status === "succeeded" || item.status === "skipped") {
          continue;
        }

        item.status = "running";
        item.error = "";
        setStatus(`正在导出 ${index + 1}/${state.items.length}: ${item.title || item.url}`);
        render();
        await saveState();

        try {
          workTabId = await createOrNavigateWorkTab(workTabId, item);
          const exported = await exportCurrentFromTabWithRetry(workTabId, item);
          item.status = exported.skippedExistingFile ? "skipped" : "succeeded";
          item.filename = exported.filename;
          item.messageCount = exported.messageCount;
          item.platform = exported.platform || item.platform;
          item.conversationTime = item.conversationTime || exported.conversationTime || "";
          if (!exported.skippedExistingFile) {
            await markExported(item, exported);
          }
        } catch (error) {
          item.status = "failed";
          item.error = error && error.message ? error.message : String(error);
        }

        render();
        await saveState();
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }

      const summary = counts();
      if (!cancelRequested) {
        setStatus(`导出完成：成功 ${summary.succeeded}，跳过 ${summary.skipped}，失败 ${summary.failed}。`);
        state.forceReexportExistingFiles = false;
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error));
    } finally {
      running = false;
      discoverButton.disabled = false;
      cancelButton.disabled = true;
      if (workTabId) {
        await chrome.tabs.remove(workTabId).catch(() => null);
      }
      render();
      await saveState();
    }
  }

  async function clearState() {
    if (running) {
      return;
    }

    state = {
      sourceTabId,
      sourceUrl: "",
      platform: "",
      items: [],
      forceReexportExistingFiles: false,
      updatedAt: ""
    };
    await chrome.storage.local.remove(STORAGE_KEY);
    setStatus("已清空本次队列状态，兼容记录仍保留。");
    render();
  }

  async function clearRegistry() {
    if (running) {
      return;
    }

    if (!window.confirm("确定清空兼容记录并允许当前队列全部重新导出吗？已存在的导出文件不会被删除，重新下载时浏览器可能生成带序号的新文件。")) {
      return;
    }

    exportRegistry = { version: 1, items: {} };
    await chrome.storage.local.remove(REGISTRY_KEY);
    state.items = state.items.map((item) => ({
      ...item,
      status: "queued",
      filename: "",
      messageCount: 0,
      error: ""
    }));
    state.forceReexportExistingFiles = true;
    await saveState();
    setStatus("已清空兼容记录。当前队列已全部改为待导出，下一次开始导出会重新下载所有聊天。");
    render();
  }

  discoverButton.addEventListener("click", () => {
    discoverHistory();
  });

  exportButton.addEventListener("click", () => {
    exportQueue();
  });

  cancelButton.addEventListener("click", () => {
    cancelRequested = true;
    setStatus("正在取消，当前聊天处理完后会停止...");
  });

  clearButton.addEventListener("click", () => {
    clearState();
  });

  clearRegistryButton.addEventListener("click", () => {
    clearRegistry();
  });

  async function initialize() {
    await loadState();
    await loadRegistry();
    await migrateSucceededStateToRegistry();
    const tab = await getSourceTab();
    sourceElement.textContent = tab.url;
    state.sourceUrl = state.sourceUrl || tab.url;
    await saveState();
    render();
  }

  initialize().catch((error) => {
    discoverButton.disabled = true;
    exportButton.disabled = true;
    setStatus(error && error.message ? error.message : String(error));
  });
})();
