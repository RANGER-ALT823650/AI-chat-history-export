(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;
  const cache = namespace.StructuredConversationCache;

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      const match = url.pathname.match(/\/chat\/([A-Za-z0-9-]{8,})/i);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeRole(value) {
    const role = String(value || "").toLowerCase();
    if (role === "human" || role === "user") {
      return "user";
    }
    if (role === "assistant") {
      return "assistant";
    }
    return "";
  }

  function messageTime(message) {
    if (!message || typeof message !== "object") {
      return "";
    }

    return common.readTimeCandidate(
      message.created_at ||
      message.updated_at ||
      message.create_time ||
      message.update_time ||
      message.timestamp
    );
  }

  function textFromContent(content, depth = 0) {
    if (content === undefined || content === null || depth > 8) {
      return "";
    }

    if (typeof content === "string" || typeof content === "number") {
      return String(content).trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => textFromContent(item, depth + 1))
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (typeof content !== "object") {
      return "";
    }

    const direct = [
      content.text,
      content.markdown,
      content.body,
      content.content,
      content.message,
      content.value,
      content.response,
      content.prompt,
      content.answer,
      content.parts
    ].find((value) => value !== undefined && value !== null && value !== "");

    return direct !== undefined ? textFromContent(direct, depth + 1) : "";
  }

  function buildMessageTimeline(chatMessages) {
    return (Array.isArray(chatMessages) ? chatMessages : [])
      .map((message) => {
        const role = normalizeRole(message && (message.sender || message.role));
        const time = messageTime(message);
        return role && time ? { role, time } : null;
      })
      .filter(Boolean);
  }

  function annotateMessagesByRole(messages, timeline) {
    const source = timeline || [];
    if (!messages || !messages.length || !source.length) {
      return messages || [];
    }

    let cursor = 0;
    return messages.map((message) => {
      if (message.time) {
        return message;
      }

      for (let index = cursor; index < source.length; index += 1) {
        const candidate = source[index];
        if (candidate && candidate.role === message.role && candidate.time) {
          cursor = index + 1;
          return { ...message, time: candidate.time };
        }
      }

      return message;
    });
  }

  function structuredConversationFromApi(data, sourceUrl) {
    if (!data || typeof data !== "object") {
      return null;
    }

    const conversationId = String(data.uuid || conversationIdFromUrl(sourceUrl) || "");
    const chatMessages = Array.isArray(data.chat_messages) ? data.chat_messages : [];
    const messageTimeline = buildMessageTimeline(chatMessages);
    const messages = chatMessages
        .map((message) => {
          const role = normalizeRole(message && message.sender);
          const content = textFromContent(message && message.content);
          if (!role || !content) {
            return null;
          }

          return {
            role,
            content,
            markdown: content,
            time: messageTime(message)
          };
        })
        .filter(Boolean);
    const conversationTime =
      common.readTimeCandidate(data.created_at || data.updated_at) ||
      (messageTimeline.find((message) => message.time) || {}).time ||
      "";

    if (!conversationId || (!conversationTime && !messages.length && !messageTimeline.length)) {
      return null;
    }

    return {
      platform: "Claude",
      sourceUrl,
      title: String(data.name || data.title || ""),
      conversationId,
      conversationTime,
      messages,
      messageTimeline
    };
  }

  function resourceConversationUrl(conversationId) {
    if (!conversationId || !global.performance || !global.performance.getEntriesByType) {
      return "";
    }

    const resources = global.performance.getEntriesByType("resource") || [];
    const names = resources
      .map((entry) => entry && entry.name)
      .filter(Boolean)
      .reverse();

    return names.find((name) => name.includes(`/chat_conversations/${conversationId}`) && name.includes("rendering_mode=messages")) ||
      names.find((name) => name.includes(`/chat_conversations/${conversationId}`)) ||
      "";
  }

  async function fetchStructuredConversation(sourceUrl) {
    const conversationId = conversationIdFromUrl(sourceUrl);
    const endpoint = resourceConversationUrl(conversationId);
    if (!endpoint || !global.fetch) {
      return null;
    }

    const response = await global.fetch(endpoint, { credentials: "include" });
    if (!response || !response.ok) {
      return null;
    }

    return structuredConversationFromApi(await response.json(), sourceUrl);
  }

  namespace.ClaudeAdapter = {
    async extract() {
      const conversation = common.extractWithConfig({
        platformLabel: "Claude",
        rootSelector: "main",
        titleSelectors: [
          "[data-testid='conversation-title']",
          "[aria-current='page']",
          "h1"
        ],
        messageSelectors: [
          {
            role: "user",
            selectors: [
              "[data-testid='user-message']",
              "[data-testid*='user' i][data-testid*='message' i]",
              "[data-message-author-role='user']",
              "[data-author-role='user']",
              "[data-role='user']"
            ]
          },
          {
            role: "assistant",
            selectors: [
              "[data-testid='assistant-message']",
              "[data-testid='assistant-response']",
              "[data-testid='message-response']",
              "[data-testid='conversation-turn-assistant']",
              "[data-testid*='assistant' i][data-testid*='message' i]",
              "[data-testid*='assistant' i][data-testid*='response' i]",
              "[data-testid*='response' i]",
              "[data-message-author-role='assistant']",
              "[data-author-role='assistant']",
              "[data-role='assistant']",
              "ul",
              "ol",
              "li",
              "pre",
              "pre code",
              "[data-testid*='code' i]",
              "[data-test-id*='code' i]",
              "[class*='code-block']",
              "[class*='codeBlock']",
              "[class*='font-claude-message']",
              "[class*='font-claude-response-body']",
              "[class*='claude-message']",
              "[class*='assistant-message']",
              ".assistant-message",
              ".font-claude-message"
            ],
            expandClosestSelectors: [
              "[data-testid='assistant-message']",
              "[data-testid='assistant-response']",
              "[data-testid='message-response']",
              "[data-testid='conversation-turn-assistant']",
              "[data-testid*='assistant' i][data-testid*='message' i]",
              "[data-testid*='assistant' i][data-testid*='response' i]",
              "[class*='font-claude-message']",
              "[class*='claude-message']",
              "[class*='assistant-message']",
              ".font-claude-message",
              ".assistant-message",
              ".prose",
              "[class*='markdown']",
              "article"
            ],
            excludeClosestSelectors: [
              "[data-testid='user-message']",
              "[data-message-author-role='user']",
              "[data-author-role='user']",
              "[data-role='user']",
              "button",
              "nav",
              "header",
              "footer",
              "form",
              "textarea",
              "input",
              "select",
              "[role='button']",
              "[role='navigation']",
              "[role='menu']"
            ],
            contentSelectors: [
              ".message-content",
              ".font-claude-message",
              ".prose",
              "[data-testid='message-content']"
            ]
          }
        ],
        fallbackMessageSelectors: [
          "[data-testid='user-message']",
          "ul",
          "ol",
          "li",
          "pre",
          "pre code",
          "[data-testid*='code' i]",
          "[data-test-id*='code' i]",
          "[class*='code-block']",
          "[class*='codeBlock']",
          "[class*='font-claude-message']",
          "[class*='font-claude-response-body']",
          "[data-testid*='user' i][data-testid*='message' i]",
          "[data-testid*='assistant' i]",
          "[data-testid*='response' i]",
          "[data-message-author-role]",
          "[data-author-role]"
        ],
        allowLayoutRoleFallback: false,
        disableGenericExtraction: true,
        mergeAdjacentSameRole: true
      });

      const needsApiFallback =
        !conversation.conversationTime ||
        (conversation.messages || []).some((message) => !message.time);
      if (!needsApiFallback) {
        return conversation;
      }

      try {
        const structured = await fetchStructuredConversation(conversation.sourceUrl || global.location.href);
        if (structured && structured.messages && structured.messages.length && cache && cache.cacheConversation) {
          cache.cacheConversation(structured);
        }

        if (structured) {
          const merged = common.mergeStructuredConversation({
            ...conversation,
            conversationTime: conversation.conversationTime || structured.conversationTime
          });
          return {
            ...merged,
            conversationTime: merged.conversationTime || structured.conversationTime,
            messages: annotateMessagesByRole(merged.messages, structured.messageTimeline || structured.messages)
          };
        }
      } catch (_error) {
        // Ignore API fallback failures and keep the DOM-derived export.
      }

      return conversation;
    }
  };
})(globalThis);
