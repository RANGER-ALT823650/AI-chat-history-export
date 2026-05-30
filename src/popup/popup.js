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
    "src/content/adapters/qwen.js",
    "src/content/adapters/claude.js",
    "src/content/history-discovery.js",
    "src/content/content.js"
  ];
  const MAIN_WORLD_FILES = [
    "src/content/api-interceptor.js"
  ];
  const EXPORT_REGISTRY_KEY = "aiChatExporterExportRegistry";
  const MAIN_WORLD_SCRIPT_ID = "ai-chat-exporter-main-world-interceptor";
  const SUPPORTED_MATCHES = [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://grok.com/*",
    "https://*.grok.com/*",
    "https://x.com/i/grok*",
    "https://grok.x.ai/*",
    "https://chat.deepseek.com/*",
    "https://deepseek.com/*",
    "https://*.deepseek.com/*",
    "https://doubao.com/*",
    "https://*.doubao.com/*",
    "https://qwen.ai/*",
    "https://*.qwen.ai/*",
    "https://qwenlm.ai/*",
    "https://*.qwenlm.ai/*",
    "https://qianwen.com/*",
    "https://*.qianwen.com/*",
    "https://tongyi.aliyun.com/*",
    "https://qianwen.aliyun.com/*"
  ];
  const exportPath = window.AIChatExporterExportPath;

  const platformElement = document.getElementById("platform");
  const pathElement = document.getElementById("exportPath");
  const choosePathButton = document.getElementById("choosePathButton");
  const defaultPathButton = document.getElementById("defaultPathButton");
  const statusElement = document.getElementById("status");
  const exportButton = document.getElementById("exportButton");
  const batchButton = document.getElementById("batchButton");
  const debugButton = document.getElementById("debugButton");
  let exportDirectoryReady = false;

  function detectPlatform(urlLike) {
    try {
      const url = new URL(urlLike);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase();

      if (host === "chatgpt.com" || host === "chat.openai.com") {
        return "ChatGPT";
      }

      if (host === "claude.ai" || host.endsWith(".claude.ai")) {
        return "Claude";
      }

      if (host === "gemini.google.com") {
        return "Gemini";
      }

      if (host === "grok.com" || host.endsWith(".grok.com") || host === "grok.x.ai" || (host === "x.com" && path.startsWith("/i/grok"))) {
        return "Grok";
      }

      if (host === "chat.deepseek.com" || host === "deepseek.com" || host.endsWith(".deepseek.com")) {
        return "DeepSeek";
      }

      if (host === "doubao.com" || host.endsWith(".doubao.com")) {
        return "Doubao";
      }

      if (
        host === "qwen.ai" ||
        host.endsWith(".qwen.ai") ||
        host === "qwenlm.ai" ||
        host.endsWith(".qwenlm.ai") ||
        host === "qianwen.com" ||
        host.endsWith(".qianwen.com") ||
        host === "tongyi.aliyun.com" ||
        host === "qianwen.aliyun.com"
      ) {
        return "Qwen";
      }
    } catch (_error) {
      return "";
    }

    return "";
  }

  async function refreshExportPathStatus() {
    if (!exportPath || !exportPath.isSupported()) {
      pathElement.textContent = "导出目录：当前浏览器不支持自动下载，请使用新版 Chrome 或 Edge。";
      choosePathButton.disabled = true;
      defaultPathButton.disabled = true;
      return false;
    }

    const label = await exportPath.exportRootLabel();
    const hasDirectory = await exportPath.hasExportDirectory();
    exportDirectoryReady = hasDirectory;
    pathElement.textContent = hasDirectory
      ? `导出目录：${label}`
      : `导出目录：${label}（自定义目录权限不可用，请重新选择）`;
    choosePathButton.disabled = !exportPath.canPickExportDirectory || !exportPath.canPickExportDirectory();
    defaultPathButton.disabled = false;
    return hasDirectory;
  }

  async function ensureExportDirectory(options = {}) {
    if (!exportPath || !exportPath.isSupported()) {
      throw new Error("当前浏览器不支持自动下载，请使用新版 Chrome 或 Edge。");
    }

    const ready = options.requestPermission === false
      ? await exportPath.hasExportDirectory()
      : await exportPath.requestExportDirectoryAccess();
    if (!ready) {
      exportDirectoryReady = false;
      await refreshExportPathStatus();
      throw new Error("导出目录权限未授权，请点击“自定义导出目录”重新选择或改用默认下载目录。");
    }
  }

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      return url.pathname
        .split("/")
        .filter(Boolean)
        .reverse()
        .find((part) => /[A-Za-z0-9_-]{8,}/.test(part)) || "";
    } catch (_error) {
      return "";
    }
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => window.clearTimeout(timer));
    });
  }

  async function waitForTabComplete(tabId, timeoutMs = 60000, requireNextCompletion = false) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!requireNextCompletion && current && current.status === "complete") {
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

  async function hasMainWorldInterceptor(tabId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => Boolean(window.__AI_CHAT_EXPORTER_API_INTERCEPTOR__)
      });
      return Boolean(result && result.result);
    } catch (_error) {
      return false;
    }
  }

  async function registerMainWorldInterceptorForFutureLoads() {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [MAIN_WORLD_SCRIPT_ID] });
    } catch (_error) {
      // Ignore missing registrations and browsers without dynamic script support.
    }

    try {
      await chrome.scripting.registerContentScripts([
        {
          id: MAIN_WORLD_SCRIPT_ID,
          matches: SUPPORTED_MATCHES,
          js: MAIN_WORLD_FILES,
          runAt: "document_start",
          world: "MAIN"
        }
      ]);
    } catch (_error) {
      // Static manifest injection and direct executeScript remain as fallbacks.
    }
  }

  async function sendExportMessage(tabId, overrides = {}) {
    return chrome.tabs.sendMessage(tabId, { type: "EXPORT_CURRENT_CHAT", overrides });
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
      // Some browsers do not support explicit MAIN-world injection. Static
      // manifest injection still covers normal page loads.
    }
  }

  async function sendTabMessage(tabId, message, timeoutMs = 60000) {
    await ensureContentScript(tabId);
    return withTimeout(chrome.tabs.sendMessage(tabId, message), timeoutMs, message.type);
  }

  function metadataFromConversations(conversations, conversationId) {
    if (!conversationId) {
      return null;
    }

    return (conversations || []).find((item) => {
      return item && item.conversationId === conversationId && item.conversationTime;
    }) || null;
  }

  async function cachedGeminiMetadata(tab) {
    const conversationId = conversationIdFromUrl(tab && tab.url);
    if (!conversationId) {
      return null;
    }

    const stored = await chrome.storage.local.get(EXPORT_REGISTRY_KEY).catch(() => ({}));
    const registry = stored && stored[EXPORT_REGISTRY_KEY];
    const items = registry && registry.items && typeof registry.items === "object"
      ? Object.values(registry.items)
      : [];
    return metadataFromConversations(items, conversationId);
  }

  async function discoverGeminiMetadata(tab) {
    const conversationId = conversationIdFromUrl(tab && tab.url);
    if (!conversationId || !tab.url) {
      return null;
    }

    const cached = await cachedGeminiMetadata(tab);
    if (cached) {
      return cached;
    }

    statusElement.textContent = "正在从 Gemini 搜索历史读取聊天日期...";
    let workTabId = null;

    try {
      const workTab = await chrome.tabs.create({ url: tab.url, active: false });
      workTabId = workTab && workTab.id;
      if (!workTabId) {
        return null;
      }

      await waitForTabComplete(workTabId, 60000);
      const result = await sendTabMessage(workTabId, {
        type: "DISCOVER_HISTORY",
        options: {
          targetUrl: tab.url,
          targetConversationId: conversationId,
          maxRounds: 220,
          idleLimit: 8,
          geminiPreloadSidebar: false,
          geminiSearchMaxRounds: 120,
          geminiSearchIdleLimit: 4,
          geminiSearchRoundDelayMs: 220
        }
      }, 240000);

      if (!result || !result.ok) {
        return null;
      }

      return metadataFromConversations(result.conversations || [], conversationId);
    } catch (_error) {
      return null;
    } finally {
      if (workTabId) {
        await chrome.tabs.remove(workTabId).catch(() => null);
      }
    }
  }

  async function exportCurrentChat() {
    const tab = await activeTab();
    if (!tab || !tab.id) {
      throw new Error("没有找到当前标签页。");
    }

    const platform = tab.url ? detectPlatform(tab.url) : "";
    await ensureContentScript(tab.id);

    let overrides = {};
    if (platform === "Gemini") {
      const metadata = await discoverGeminiMetadata(tab);
      overrides = metadata
        ? {
          title: metadata.title || "",
          conversationTime: metadata.conversationTime || "",
          conversationId: metadata.conversationId || conversationIdFromUrl(tab.url)
        }
        : {
          conversationId: conversationIdFromUrl(tab.url)
        };
      statusElement.textContent = "正在读取聊天内容...";
    }

    try {
      return await sendExportMessage(tab.id, overrides);
    } catch (_error) {
      await ensureContentScript(tab.id);
      return sendExportMessage(tab.id, overrides);
    }
  }

  async function debugCurrentPage() {
    const tab = await activeTab();
    if (!tab || !tab.id) {
      throw new Error("没有找到当前标签页。");
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "DEBUG_CURRENT_PAGE" });
    } catch (_error) {
      await ensureContentScript(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "DEBUG_CURRENT_PAGE" });
    }
  }

  async function openBatchPage() {
    const tab = await activeTab();
    if (!tab || !tab.id) {
      throw new Error("没有找到当前标签页。");
    }

    const url = chrome.runtime.getURL(`src/batch/batch.html?sourceTabId=${tab.id}`);
    await chrome.tabs.create({ url });
  }

  async function initialize() {
    const tab = await activeTab();
    const platform = tab && tab.url ? detectPlatform(tab.url) : "";

    if (!platform) {
      platformElement.textContent = "当前页面暂不支持。请打开 ChatGPT、Claude、Gemini、Grok、DeepSeek、豆包或千问的聊天页。";
      exportButton.disabled = true;
      batchButton.disabled = true;
      debugButton.disabled = true;
      await refreshExportPathStatus();
      return;
    }

    platformElement.textContent = `当前平台：${platform}`;
    exportButton.disabled = false;
    batchButton.disabled = false;
    debugButton.disabled = false;
    await refreshExportPathStatus();
  }

  choosePathButton.addEventListener("click", async () => {
    choosePathButton.disabled = true;
    statusElement.textContent = "请选择 Markdown 导出目录...";

    try {
      await exportPath.pickExportDirectory();
      await refreshExportPathStatus();
      statusElement.textContent = "导出目录已保存。";
    } catch (error) {
      statusElement.textContent = error && error.message ? error.message : String(error);
    } finally {
      choosePathButton.disabled = false;
    }
  });

  defaultPathButton.addEventListener("click", async () => {
    defaultPathButton.disabled = true;
    statusElement.textContent = "正在切换到浏览器默认下载目录...";

    try {
      await exportPath.useDefaultDownloadDirectory();
      await refreshExportPathStatus();
      statusElement.textContent = "已切换为浏览器默认下载目录。";
    } catch (error) {
      statusElement.textContent = error && error.message ? error.message : String(error);
    } finally {
      defaultPathButton.disabled = false;
    }
  });

  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    statusElement.textContent = "正在准备导出目录...";

    try {
      await ensureExportDirectory();
      statusElement.textContent = "正在读取聊天内容...";
      const result = await exportCurrentChat();
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "导出失败。");
      }

      const written = await exportPath.writeMarkdownFile({
        platform: result.platform || "AI",
        filename: result.filename,
        markdown: result.markdown,
        conflictAction: "uniquify",
        title: result.title || "",
        sourceUrl: result.sourceUrl || "",
        conversationId: result.conversationId || "",
        conversationTime: result.conversationTime || "",
        messageCount: result.messageCount || 0
      });

      if (!written || !written.ok) {
        throw new Error((written && written.error) || "写入 Markdown 失败。");
      }

      const timeNote = result.hasConversationTime ? "已写入聊天时间。" : "页面未提供聊天时间，已按要求省略。";
      statusElement.textContent = `已导出 ${result.messageCount} 条消息到 ${written.relativePath}。${timeNote}`;
    } catch (error) {
      statusElement.textContent = error && error.message ? error.message : String(error);
    } finally {
      exportButton.disabled = false;
    }
  });

  batchButton.addEventListener("click", async () => {
    batchButton.disabled = true;
    statusElement.textContent = "正在打开批量导出控制台...";

    try {
      await openBatchPage();
      window.close();
    } catch (error) {
      statusElement.textContent = error && error.message ? error.message : String(error);
      batchButton.disabled = false;
    }
  });

  debugButton.addEventListener("click", async () => {
    debugButton.disabled = true;
    statusElement.textContent = "正在生成页面调试快照...";

    try {
      const result = await debugCurrentPage();
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "生成调试快照失败。");
      }

      const download = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_TEXT",
        filename: result.filename,
        text: result.text,
        mimeType: "application/json",
        folder: "AI Chat Export Debug"
      });

      if (!download || !download.ok) {
        throw new Error((download && download.error) || "下载调试快照失败。");
      }

      statusElement.textContent = "已下载页面调试快照。";
    } catch (error) {
      statusElement.textContent = error && error.message ? error.message : String(error);
    } finally {
      debugButton.disabled = false;
    }
  });

  initialize().catch((error) => {
    platformElement.textContent = error && error.message ? error.message : String(error);
    exportButton.disabled = true;
    batchButton.disabled = true;
    debugButton.disabled = true;
  });
})();
