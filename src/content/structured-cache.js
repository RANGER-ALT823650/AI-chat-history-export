(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});

  const MESSAGE_TYPE = "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION";
  const MAX_CACHE_SIZE = 80;
  const memoryCache = {};

  function keyFor(conversationId, platform) {
    return `${platform || ""}:${conversationId || ""}`;
  }

  function normalizeMessage(message) {
    if (!message || typeof message !== "object") {
      return null;
    }

    const role = message.role === "assistant" || message.role === "user" || message.role === "system"
      ? message.role
      : "";
    const content = String(message.markdown || message.content || "").trim();

    if (!role || !content) {
      return null;
    }

    return {
      role,
      content,
      markdown: String(message.markdown || content),
      time: String(message.time || "")
    };
  }

  function pruneCache() {
    const keys = Object.keys(memoryCache);
    if (keys.length <= MAX_CACHE_SIZE) {
      return;
    }

    keys
      .map((key) => ({ key, cachedAt: memoryCache[key].cachedAt || 0 }))
      .sort((a, b) => a.cachedAt - b.cachedAt)
      .slice(0, keys.length - MAX_CACHE_SIZE)
      .forEach((item) => {
        delete memoryCache[item.key];
      });
  }

  function cacheConversation(conversation) {
    if (!conversation || typeof conversation !== "object") {
      return false;
    }

    const conversationId = String(conversation.conversationId || conversation.id || "");
    const platform = String(conversation.platform || "");
    const messages = (conversation.messages || []).map(normalizeMessage).filter(Boolean);

    if (!conversationId || !platform || !messages.length) {
      return false;
    }

    const key = keyFor(conversationId, platform);
    const existing = memoryCache[key];
    const cached = {
      platform,
      sourceUrl: String(conversation.sourceUrl || (existing && existing.sourceUrl) || ""),
      title: String(conversation.title || (existing && existing.title) || ""),
      conversationId,
      conversationTime: String(conversation.conversationTime || (existing && existing.conversationTime) || ""),
      messages,
      cachedAt: Date.now()
    };

    if (existing && existing.messages && existing.messages.length > messages.length) {
      cached.messages = existing.messages;
    }

    memoryCache[key] = cached;
    pruneCache();
    return true;
  }

  function getConversation(conversationId, platform) {
    if (!conversationId || !platform) {
      return null;
    }

    return memoryCache[keyFor(String(conversationId), String(platform))] || null;
  }

  function latestConversation(platform) {
    const matches = Object.keys(memoryCache)
      .map((key) => memoryCache[key])
      .filter((entry) => entry && (!platform || entry.platform === platform))
      .sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));

    return matches[0] || null;
  }

  function handleMessage(event) {
    if (!event || !event.data || event.data.type !== MESSAGE_TYPE) {
      return;
    }

    cacheConversation(event.data.conversation);
  }

  if (global.addEventListener) {
    global.addEventListener("message", handleMessage);
  }

  namespace.StructuredConversationCache = {
    cacheConversation,
    getConversation,
    latestConversation
  };
})(globalThis);
