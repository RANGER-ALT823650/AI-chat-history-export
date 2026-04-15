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
    "src/content/adapters/claude.js",
    "src/content/history-discovery.js",
    "src/content/content.js"
  ];
  const MAIN_WORLD_FILES = [
    "src/content/api-interceptor.js"
  ];
  const STORAGE_KEY = "aiChatExporterBatchState";
  const REGISTRY_KEY = "aiChatExporterExportRegistry";
  const params = new URLSearchParams(window.location.search);
  const sourceTabId = Number(params.get("sourceTabId"));

  const sourceElement = document.getElementById("source");
  const statusElement = document.getElementById("status");
  const discoverButton = document.getElementById("discoverButton");
  const exportButton = document.getElementById("exportButton");
  const cancelButton = document.getElementById("cancelButton");
  const clearButton = document.getElementById("clearButton");
  const clearRegistryButton = document.getElementById("clearRegistryButton");
  const skipSucceededElement = document.getElementById("skipSucceeded");
  const queueElement = document.getElementById("queue");
  const totalCountElement = document.getElementById("totalCount");
  const queuedCountElement = document.getElementById("queuedCount");
  const successCountElement = document.getElementById("successCount");
  const failedCountElement = document.getElementById("failedCount");
  const registryCountElement = document.getElementById("registryCount");

  let state = {
    sourceTabId,
    sourceUrl: "",
    platform: "",
    items: [],
    updatedAt: ""
  };
  let exportRegistry = {
    version: 1,
    items: {}
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
    const queued = state.items.filter((item) => item.status === "queued" || item.status === "skipped").length;
    const succeeded = state.items.filter((item) => item.status === "succeeded").length;
    const failed = state.items.filter((item) => item.status === "failed").length;
    return { total, queued, succeeded, failed, registry: registryCount() };
  }

  function render() {
    const summary = counts();
    totalCountElement.textContent = `总数 ${summary.total}`;
    queuedCountElement.textContent = `待导出 ${summary.queued}`;
    successCountElement.textContent = `成功 ${summary.succeeded}`;
    failedCountElement.textContent = `失败 ${summary.failed}`;
    registryCountElement.textContent = `备份记录 ${summary.registry}`;
    exportButton.disabled = running || !state.items.length;
    cancelButton.disabled = !running;
    clearRegistryButton.disabled = running || !summary.registry;

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
      url.textContent = item.url;
      body.append(title, url);

      const meta = document.createElement("span");
      meta.className = "meta";
      if (item.status === "failed") {
        meta.textContent = item.error || "导出失败";
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
      throw new Error("缺少来源标签页。请从 ChatGPT、Claude、Gemini 或 Grok 页面重新打开批量导出。");
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
    state.items = conversations.map((item) => {
      const old = previous.get(item.url);
      const registryRecord = registryRecordFor(item, item.platform || platform);
      const exported = registryRecord || (old && old.status === "succeeded" ? old : null);
      const merged = {
        ...item,
        platform: item.platform || platform,
        status: exported ? "succeeded" : "queued",
        filename: exported && exported.filename,
        messageCount: exported && exported.messageCount,
        conversationTime: item.conversationTime || (exported && exported.conversationTime) || "",
        rawDateText: item.rawDateText || (exported && exported.rawDateText) || "",
        title: item.title || (exported && exported.title) || "",
        error: ""
      };

      if (old && old.status === "succeeded" && !registryRecord) {
        rememberExportedItem(merged, old);
      }

      return merged;
    });
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
      sourceElement.textContent = tab.url;
      await waitForTabComplete(tab.id);
      const result = await sendTabMessage(tab.id, {
        type: "DISCOVER_HISTORY",
        options: {
          maxRounds: 220,
          idleLimit: 8,
          geminiSearchMaxRounds: 120,
          geminiSearchIdleLimit: 5,
          geminiSearchRoundDelayMs: 220
        }
      }, 240000);

      if (!result || !result.ok) {
        throw new Error((result && result.error) || "扫描失败。");
      }

      mergeDiscovered(result.conversations || [], result.platform, result.url || tab.url);
      await saveState();
      await saveRegistry();
      setStatus(`扫描完成，发现 ${state.items.length} 条聊天。确认数量后可以开始导出。`);
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error));
    } finally {
      running = false;
      discoverButton.disabled = false;
      render();
    }
  }

  async function createOrNavigateWorkTab(workTabId, url) {
    if (!workTabId) {
      const tab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(tab.id);
      return tab.id;
    }

    await chrome.tabs.update(workTabId, { url });
    await waitForTabComplete(workTabId);
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
    await sendTabMessage(tabId, {
      type: "PREPARE_FOR_EXPORT",
      options: { maxRounds: 110, stableLimit: 7 }
    }, 90000);

    const result = await sendTabMessage(tabId, {
      type: "EXPORT_CURRENT_CHAT",
      overrides: {
        title: item.title || "",
        conversationTime: item.conversationTime || "",
        conversationId: item.conversationId || ""
      }
    }, 60000);
    if (!result || !result.ok) {
      throw new Error((result && result.error) || "导出失败。");
    }

    await downloadMarkdown(result, item.platform || state.platform);
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
    await loadRegistry();
    discoverButton.disabled = true;
    exportButton.disabled = true;
    cancelButton.disabled = false;
    let workTabId = null;

    try {
      for (let index = 0; index < state.items.length; index += 1) {
        if (cancelRequested) {
          setStatus("已取消，保留当前进度。");
          break;
        }

        const item = state.items[index];
        if (skipSucceededElement.checked && (item.status === "succeeded" || registryRecordFor(item, item.platform || state.platform))) {
          item.status = "succeeded";
          continue;
        }

        item.status = "running";
        item.error = "";
        setStatus(`正在导出 ${index + 1}/${state.items.length}: ${item.title || item.url}`);
        render();
        await saveState();

        try {
          workTabId = await createOrNavigateWorkTab(workTabId, item.url);
          const exported = await exportCurrentFromTabWithRetry(workTabId, item);
          item.status = "succeeded";
          item.filename = exported.filename;
          item.messageCount = exported.messageCount;
          item.platform = exported.platform || item.platform;
          item.conversationTime = item.conversationTime || exported.conversationTime || "";
          await markExported(item, exported);
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
        setStatus(`导出完成：成功 ${summary.succeeded}，失败 ${summary.failed}。`);
      }
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
      updatedAt: ""
    };
    await chrome.storage.local.remove(STORAGE_KEY);
    setStatus("已清空本次队列状态，长期备份记录仍保留。");
    render();
  }

  async function clearRegistry() {
    if (running) {
      return;
    }

    if (!window.confirm("确定清空长期备份记录吗？之后每周备份将无法自动跳过旧聊天，直到重新导出并写入记录。")) {
      return;
    }

    exportRegistry = { version: 1, items: {} };
    await chrome.storage.local.remove(REGISTRY_KEY);
    state.items = state.items.map((item) => ({
      ...item,
      status: item.status === "succeeded" ? "queued" : item.status,
      filename: "",
      messageCount: 0
    }));
    await saveState();
    setStatus("已清空长期备份记录。当前队列里的旧成功项已改为待导出。");
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
