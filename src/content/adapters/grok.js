(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;
  const cache = namespace.StructuredConversationCache;

  function firstValue(obj, keys) {
    if (!obj || typeof obj !== "object") {
      return "";
    }

    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
        return obj[key];
      }
    }

    return "";
  }

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike, global.location && global.location.href);
      const match = url.pathname.match(/\/(?:c|chat)\/([A-Za-z0-9-]{8,})/i) ||
        url.pathname.match(/\/rest\/app-chat\/conversations\/([A-Za-z0-9-]{8,})/i);
      if (match) {
        return match[1];
      }

      return url.pathname
        .split("/")
        .filter(Boolean)
        .reverse()
        .find((part) => /[A-Za-z0-9-]{20,}/.test(part)) || "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeRole(value) {
    const text = String(value || "").toLowerCase();
    if (/^(human|user|client|customer|prompt)$/.test(text)) {
      return "user";
    }
    if (/^(assistant|model|bot|grok|ai)$/.test(text)) {
      return "assistant";
    }
    if (/^system$/.test(text)) {
      return "system";
    }

    return "";
  }

  function createTimeFromObject(obj) {
    return common.readTimeCandidate(firstValue(obj, [
      "createTime",
      "createdAt",
      "created_at",
      "create_time",
      "insertedAt",
      "inserted_at",
      "conversationTime",
      "conversation_time",
      "timestamp",
      "time",
      "date"
    ]));
  }

  function parseJsonString(value) {
    if (typeof value !== "string") {
      return null;
    }

    const text = value.trim();
    if (!/^[\[{]/.test(text)) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function textFromValue(value, depth = 0) {
    if (value === undefined || value === null || depth > 8) {
      return "";
    }

    if (typeof value === "string") {
      const parsed = parseJsonString(value);
      if (parsed !== null) {
        return textFromValue(parsed, depth + 1);
      }
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value).trim();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => textFromValue(item, depth + 1))
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (typeof value !== "object") {
      return "";
    }

    const direct = firstValue(value, [
      "message",
      "text",
      "markdown",
      "content",
      "body",
      "value",
      "response",
      "prompt",
      "answer",
      "parts",
      "fragments",
      "content_block",
      "contentBlock"
    ]);

    return direct !== "" ? textFromValue(direct, depth + 1) : "";
  }

  function normalizeMessage(response) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      return null;
    }

    const role = normalizeRole(firstValue(response, [
      "sender",
      "role",
      "author",
      "from",
      "creator",
      "type"
    ]));
    const content = textFromValue(response);

    if (!role || !content) {
      return null;
    }

    return {
      role,
      content,
      markdown: content,
      time: createTimeFromObject(response)
    };
  }

  function earliestMessageTime(messages) {
    return (messages || [])
      .map((message) => message && message.time)
      .filter(Boolean)
      .sort()[0] || "";
  }

  function responseIdFromNode(node) {
    return String(firstValue(node, [
      "responseId",
      "response_id",
      "id"
    ]) || "");
  }

  function normalizeResponses(responses) {
    return (Array.isArray(responses) ? responses : [])
      .filter((response) => response && !response.partial)
      .sort((a, b) => {
        const left = createTimeFromObject(a);
        const right = createTimeFromObject(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
  }

  function structuredConversationFromResponses(conversationId, responses, sourceUrl, meta = {}) {
    const messages = normalizeResponses(responses).map(normalizeMessage).filter(Boolean);
    const conversationTime =
      createTimeFromObject(meta) ||
      earliestMessageTime(messages) ||
      "";

    if (!conversationId || (!conversationTime && !messages.length)) {
      return null;
    }

    return {
      platform: "Grok",
      sourceUrl,
      title: String(firstValue(meta, ["title", "name", "conversationTitle", "chatTitle"]) || ""),
      conversationId,
      conversationTime,
      messages
    };
  }

  function responsesFromPayload(data) {
    if (!data || typeof data !== "object") {
      return [];
    }

    return Array.isArray(data.responses)
      ? data.responses
      : Array.isArray(data.data && data.data.responses)
        ? data.data.responses
        : Array.isArray(data.conversation && data.conversation.responses)
          ? data.conversation.responses
          : [];
  }

  async function fetchJson(url, init = {}) {
    if (!global.fetch) {
      return null;
    }

    const response = await global.fetch(url, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers || {})
      }
    });

    if (!response || !response.ok) {
      return null;
    }

    return response.json();
  }

  async function fetchConversationMeta(conversationId) {
    try {
      const list = await fetchJson("/rest/app-chat/conversations");
      const conversations = Array.isArray(list && list.conversations) ? list.conversations : [];
      return conversations.find((item) => {
        return String(firstValue(item, ["conversationId", "conversation_id", "id"]) || "") === conversationId;
      }) || {};
    } catch (_error) {
      return {};
    }
  }

  async function fetchStructuredConversation(sourceUrl) {
    const conversationId = conversationIdFromUrl(sourceUrl);
    if (!conversationId || !global.fetch) {
      return null;
    }

    const meta = await fetchConversationMeta(conversationId);

    try {
      const nodeData = await fetchJson(`/rest/app-chat/conversations/${encodeURIComponent(conversationId)}/response-node?includeThreads=true`);
      const responseNodes = Array.isArray(nodeData && nodeData.responseNodes) ? nodeData.responseNodes : [];
      const responseIds = responseNodes.map(responseIdFromNode).filter(Boolean);

      if (responseIds.length) {
        const loaded = await fetchJson(`/rest/app-chat/conversations/${encodeURIComponent(conversationId)}/load-responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responseIds })
        });
        const structured = structuredConversationFromResponses(conversationId, responsesFromPayload(loaded), sourceUrl, meta);
        if (structured) {
          return structured;
        }
      }

      const fromNodes = structuredConversationFromResponses(conversationId, responseNodes, sourceUrl, meta);
      if (fromNodes) {
        return fromNodes;
      }
    } catch (_error) {
      // Keep trying the direct conversation endpoint below.
    }

    try {
      const direct = await fetchJson(`/rest/app-chat/conversations/${encodeURIComponent(conversationId)}`);
      return structuredConversationFromResponses(conversationId, responsesFromPayload(direct), sourceUrl, direct || meta);
    } catch (_error) {
      return null;
    }
  }

  namespace.GrokAdapter = {
    async extract() {
      const conversation = common.extractWithConfig({
        platformLabel: "Grok",
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
              "[data-testid='message-bubble-user']",
              "[data-testid='human-message']",
              "[data-testid*='user' i][data-testid*='message' i]",
              "[data-testid*='message' i][data-testid*='user' i]",
              "[data-author='user']",
              "[data-role='user']",
              "[class*='user-message']",
              "[class*='human-message']",
              ".user-message"
            ],
            contentSelectors: [
              ".prose",
              ".markdown",
              "[class*='prose']",
              "[class*='markdown']",
              "[data-testid*='markdown' i]",
              "[data-testid*='response-content' i]",
              "[data-testid='message-content']",
              ".message-content"
            ]
          },
          {
            role: "assistant",
            selectors: [
              ".response-content-markdown",
              "[class*='response-content-markdown']",
              ".response-content-markdown h1",
              ".response-content-markdown h2",
              ".response-content-markdown h3",
              ".response-content-markdown h4",
              ".response-content-markdown h5",
              ".response-content-markdown h6",
              ".response-content-markdown p",
              "[data-testid='assistant-message']",
              "[data-testid='message-bubble-assistant']",
              "[data-testid='model-message']",
              "[data-testid='grok-message']",
              "[data-testid*='assistant' i][data-testid*='message' i]",
              "[data-testid*='grok' i][data-testid*='message' i]",
              "[data-testid*='model' i][data-testid*='message' i]",
              "[data-testid*='response' i]",
              "[data-testid*='answer' i]",
              "[data-author='assistant']",
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
              "[class*='assistant-message']",
              "[class*='model-message']",
              "[class*='grok-message']",
              "[class*='markdown']",
              "[class*='prose']",
              ".assistant-message",
              ".model-response"
            ],
            expandClosestSelectors: [
              ".response-content-markdown",
              "[class*='response-content-markdown']",
              "[data-testid='assistant-message']",
              "[data-testid='message-bubble-assistant']",
              "[data-testid='model-message']",
              "[data-testid='grok-message']",
              "[data-testid*='assistant' i][data-testid*='message' i]",
              "[data-testid*='grok' i][data-testid*='message' i]",
              "[data-testid*='model' i][data-testid*='message' i]",
              "[data-testid*='response' i]",
              "[data-testid*='answer' i]",
              "[class*='assistant-message']",
              "[class*='model-message']",
              "[class*='grok-message']",
              ".assistant-message",
              ".model-response",
              ".message-content",
              ".markdown",
              ".prose",
              "[class*='markdown']",
              "[class*='prose']",
              "article"
            ],
            excludeClosestSelectors: [
              "[data-testid='user-message']",
              "[data-testid='message-bubble-user']",
              "[data-testid='human-message']",
              "[data-testid*='user' i][data-testid*='message' i]",
              "[data-author='user']",
              "[data-role='user']",
              "[class*='user-message']",
              "[class*='human-message']",
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
              ".prose",
              ".markdown",
              "[class*='prose']",
              "[class*='markdown']",
              "[data-testid*='markdown' i]",
              "[data-testid*='response-content' i]",
              "[data-testid='message-content']",
              ".message-content"
            ]
          }
        ],
        fallbackMessageSelectors: [
          ".response-content-markdown",
          "[class*='response-content-markdown']",
          "[data-testid*='message' i]",
          "[data-testid*='response' i]",
          "[data-testid*='answer' i]",
          "ul",
          "ol",
          "li",
          "pre",
          "pre code",
          "[data-testid*='code' i]",
          "[data-test-id*='code' i]",
          "[class*='code-block']",
          "[class*='codeBlock']",
          "[class*='message-bubble']",
          "[class*='messageBubble']",
          "[class*='chat-message']",
          "[class*='assistant-message']",
          "[class*='user-message']",
          "[class*='markdown']",
          "[class*='prose']",
          "article"
        ],
        fallbackExpandClosestSelectors: [
          ".response-content-markdown",
          "[class*='response-content-markdown']",
          "[data-testid='assistant-message']",
          "[data-testid='message-bubble-assistant']",
          "[data-testid='model-message']",
          "[data-testid='grok-message']",
          "[data-testid*='assistant' i][data-testid*='message' i]",
          "[data-testid*='grok' i][data-testid*='message' i]",
          "[data-testid*='model' i][data-testid*='message' i]",
          "[data-testid*='response' i]",
          "[data-testid*='answer' i]",
          "[class*='assistant-message']",
          "[class*='model-message']",
          "[class*='grok-message']",
          ".assistant-message",
          ".model-response",
          ".message-content",
          ".markdown",
          ".prose",
          "[class*='markdown']",
          "[class*='prose']",
          "article"
        ],
        fallbackExcludeClosestSelectors: [
          "[data-testid='user-message']",
          "[data-testid='message-bubble-user']",
          "[data-testid='human-message']",
          "[data-testid*='user' i][data-testid*='message' i]",
          "[data-author='user']",
          "[data-role='user']",
          "[class*='user-message']",
          "[class*='human-message']",
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
        alternatingFallbackRoles: true,
        mergeAdjacentSameRole: true,
        dropAssistantEchoesOfUser: true,
        allowDocumentTime: false,
        allowScriptTime: false,
        allowVisibleHistoryTime: false
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
            conversationTime: merged.conversationTime || structured.conversationTime
          };
        }
      } catch (_error) {
        // Keep the DOM-derived export if the signed-in API fallback is unavailable.
      }

      return conversation;
    }
  };
})(globalThis);
