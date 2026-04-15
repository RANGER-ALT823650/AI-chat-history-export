(function (global) {
  "use strict";

  if (global.__AI_CHAT_EXPORTER_CONTENT_LOADED__) {
    return;
  }
  global.__AI_CHAT_EXPORTER_CONTENT_LOADED__ = true;

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const utils = namespace.PlatformUtils;
  const markdown = namespace.Markdown;

  function currentAdapter() {
    const platform = utils.detectPlatformFromUrl(global.location.href);
    if (!platform) {
      return { platform: null, adapter: null };
    }

    const adapters = {
      chatgpt: namespace.ChatGPTAdapter,
      claude: namespace.ClaudeAdapter,
      gemini: namespace.GeminiAdapter,
      grok: namespace.GrokAdapter
    };

    return { platform, adapter: adapters[platform.id] || null };
  }

  function validateConversation(conversation) {
    const messages = conversation.messages || [];
    if (!messages.length) {
      return "没有识别到当前聊天内容。请确认聊天已加载完成后重试。";
    }

    const hasUser = messages.some((message) => message.role === "user");
    const hasAssistant = messages.some((message) => message.role === "assistant");
    if (!hasUser && !hasAssistant) {
      return "识别到了页面文本，但没有识别出 User / Assistant 消息角色。";
    }

    return "";
  }

  function applyConversationOverrides(conversation, overrides = {}) {
    const copy = { ...conversation };

    if (overrides.title && !copy.title) {
      copy.title = overrides.title;
    }

    if (overrides.conversationTime) {
      copy.conversationTime = overrides.conversationTime;
    }

    if (overrides.conversationId) {
      copy.conversationId = overrides.conversationId;
    }

    return copy;
  }

  async function exportCurrentChat(overrides = {}) {
    const { platform, adapter } = currentAdapter();
    if (!platform || !adapter) {
      return {
        ok: false,
        error: "当前页面不是已支持的 ChatGPT、Claude、Gemini 或 Grok 聊天页。"
      };
    }

    const conversation = applyConversationOverrides(await adapter.extract(), overrides);
    const validationError = validateConversation(conversation);
    if (validationError) {
      return { ok: false, error: validationError, platform: platform.label };
    }

    const filename = markdown.buildFilename(conversation);
    const body = markdown.buildMarkdown(conversation);

    return {
      ok: true,
      platform: platform.label,
      filename,
      markdown: body,
      messageCount: conversation.messages.length,
      conversationTime: conversation.conversationTime || "",
      hasConversationTime: Boolean(conversation.conversationTime)
    };
  }

  function debugCurrentPage() {
    const { platform } = currentAdapter();
    const platformLabel = platform ? platform.label : "Unknown";
    const snapshot = namespace.AdapterCommon.collectDebugSnapshot(platformLabel);

    return {
      ok: true,
      filename: `${platformLabel}_debug_snapshot.json`,
      text: JSON.stringify(snapshot, null, 2)
    };
  }

  const handlers = {
    EXPORT_CURRENT_CHAT: (message) => exportCurrentChat(message.overrides || {}),
    DEBUG_CURRENT_PAGE: debugCurrentPage,
    DISCOVER_HISTORY: (message) => {
      if (!namespace.BatchHistory || !namespace.BatchHistory.discoverHistory) {
        return { ok: false, error: "批量历史发现模块未加载。" };
      }

      return namespace.BatchHistory.discoverHistory(message.options || {});
    },
    PREPARE_FOR_EXPORT: (message) => {
      if (!namespace.BatchHistory || !namespace.BatchHistory.prepareCurrentConversation) {
        return { ok: false, error: "批量导出准备模块未加载。" };
      }

      return namespace.BatchHistory.prepareCurrentConversation(message.options || {});
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !handlers[message.type]) {
      return false;
    }

    Promise.resolve()
      .then(() => handlers[message.type](message))
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error)
        });
      });

    return true;
  });
})(globalThis);
