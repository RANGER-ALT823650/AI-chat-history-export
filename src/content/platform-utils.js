(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});

  const PLATFORM_LABELS = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    grok: "Grok",
    deepseek: "DeepSeek",
    doubao: "Doubao"
  };

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function detectPlatformFromUrl(urlLike) {
    let url;

    try {
      url = new URL(urlLike);
    } catch (_error) {
      return null;
    }

    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    if (hostname === "chatgpt.com" || hostname === "chat.openai.com") {
      return { id: "chatgpt", label: PLATFORM_LABELS.chatgpt };
    }

    if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
      return { id: "claude", label: PLATFORM_LABELS.claude };
    }

    if (hostname === "gemini.google.com") {
      return { id: "gemini", label: PLATFORM_LABELS.gemini };
    }

    if (
      hostname === "grok.com" ||
      hostname.endsWith(".grok.com") ||
      hostname === "grok.x.ai" ||
      (hostname === "x.com" && pathname.startsWith("/i/grok"))
    ) {
      return { id: "grok", label: PLATFORM_LABELS.grok };
    }

    if (hostname === "chat.deepseek.com" || hostname === "deepseek.com" || hostname.endsWith(".deepseek.com")) {
      return { id: "deepseek", label: PLATFORM_LABELS.deepseek };
    }

    if (hostname === "doubao.com" || hostname.endsWith(".doubao.com")) {
      return { id: "doubao", label: PLATFORM_LABELS.doubao };
    }

    return null;
  }

  function stripPlatformFromTitle(title, platformLabel) {
    let clean = normalizeWhitespace(title);
    if (!clean) {
      return "";
    }

    const labels = [platformLabel, "ChatGPT", "OpenAI", "Claude", "Gemini", "Grok", "DeepSeek", "Doubao", "豆包", "Google Gemini"];
    for (const label of labels) {
      clean = clean
        .replace(new RegExp(`\\s*[|-]\\s*${escapeRegExp(label)}\\s*$`, "i"), "")
        .replace(new RegExp(`^${escapeRegExp(label)}\\s*[|-]\\s*`, "i"), "");
    }

    return normalizeWhitespace(clean);
  }

  function isGenericConversationTitle(title, platformLabel = "") {
    const clean = normalizeWhitespace(title)
      .replace(/[_-]+/g, " ")
      .replace(/[「」"“”]/g, "")
      .trim();
    if (!clean) {
      return true;
    }

    const stripped = stripPlatformFromTitle(clean, platformLabel);
    const normalized = normalizeWhitespace(stripped || clean).toLowerCase();
    const compact = normalized.replace(/\s+/g, "");
    const labels = [platformLabel, "ChatGPT", "OpenAI", "Claude", "Gemini", "Grok", "DeepSeek", "Doubao", "豆包", "Google Gemini"]
      .map((label) => normalizeWhitespace(label).toLowerCase())
      .filter(Boolean);

    if (labels.includes(normalized) || labels.map((label) => label.replace(/\s+/g, "")).includes(compact)) {
      return true;
    }

    return [
      /^ai chat$/i,
      /^chat$/i,
      /^conversation$/i,
      /^new chat$/i,
      /^new conversation$/i,
      /^untitled(?: chat| conversation)?$/i,
      /^chat history$/i,
      /^conversation history$/i,
      /^recent(?: chats| conversations)?$/i,
      /^与\s*(?:google\s*)?gemini\s*对话$/i,
      /^和\s*(?:google\s*)?gemini\s*聊天$/i,
      /^新(建)?(聊天|对话)$/,
      /^未命名(聊天|对话)?$/,
      /^无标题(聊天|对话)?$/
    ].some((pattern) => pattern.test(stripped || clean));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (isoDate) {
      return isoDate[0];
    }

    return "";
  }

  function firstMeaningfulLine(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .find((line) => line.length > 0) || "";
  }

  namespace.PlatformUtils = {
    PLATFORM_LABELS,
    detectPlatformFromUrl,
    firstMeaningfulLine,
    formatDateForFilename,
    isGenericConversationTitle,
    makeSlug,
    normalizeWhitespace,
    stripPlatformFromTitle,
    truncate
  };
})(globalThis);
