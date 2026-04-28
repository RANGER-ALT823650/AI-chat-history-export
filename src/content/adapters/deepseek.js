(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;
  const cache = namespace.StructuredConversationCache;
  const markdown = namespace.Markdown;
  const utils = namespace.PlatformUtils;
  const capturedMessages = new Map();
  let captureSequence = 0;
  let capturedConversationId = "";

  function safeQueryAll(root, selector) {
    try {
      return Array.from((root || global.document).querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      const param = [
        "conversation_id",
        "conversationId",
        "chat_session_id",
        "chatSessionId",
        "chat_id",
        "chatId",
        "thread_id",
        "threadId",
        "id"
      ].map((key) => url.searchParams.get(key)).find((value) => value && /[A-Za-z0-9_-]{8,}/.test(value));
      if (param) {
        return param;
      }

      const match = url.pathname.match(/\/(?:a\/chat\/s|chat|c)\/([A-Za-z0-9_-]{8,})/i);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function visibleText(element) {
    return utils.normalizeWhitespace((element && (element.innerText || element.textContent)) || "");
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return Boolean(visibleText(element));
    }

    const rect = element.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 && Boolean(visibleText(element));
  }

  function markdownOf(element) {
    return markdown.htmlToMarkdown(element) || visibleText(element);
  }

  function firstValue(obj, keys) {
    if (!obj || typeof obj !== "object") {
      return "";
    }

    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }

    return "";
  }

  function normalizeRole(value) {
    const text = String(value || "").toLowerCase();
    if (/user|human|prompt|question/.test(text)) {
      return "user";
    }
    if (/assistant|model|bot|deepseek|answer|response/.test(text)) {
      return "assistant";
    }
    if (/system/.test(text)) {
      return "system";
    }
    return "";
  }

  function isReasoningContentObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const marker = [
      firstValue(value, ["type", "content_type", "contentType", "kind", "name", "category"]),
      firstValue(value, ["title", "label", "display_name", "displayName"])
    ].filter(Boolean).join(" ").toLowerCase();

    return (
      /(?:^|[\s_-])(?:think|thinking|reasoning|cot|chain-of-thought|chain_of_thought)(?:[\s_-]|$)/.test(marker) ||
      /模型思考|思考过程|深度思考/.test(marker)
    );
  }

  function textFromContent(value, depth = 0) {
    if (value === undefined || value === null || depth > 8) {
      return "";
    }

    if (typeof value === "string" || typeof value === "number") {
      if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
        try {
          return textFromContent(JSON.parse(value), depth + 1);
        } catch (_error) {
          // Treat non-JSON strings as plain message content.
        }
      }
      return String(value).trim();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => textFromContent(item, depth + 1))
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (typeof value !== "object" || isReasoningContentObject(value)) {
      return "";
    }

    const direct = firstValue(value, [
      "text",
      "markdown",
      "body",
      "content",
      "message",
      "value",
      "response",
      "prompt",
      "answer",
      "parts",
      "fragments",
      "content_block",
      "contentBlock",
      "content_blocks",
      "contentBlocks",
      "content_blocks_v2",
      "contentBlocksV2",
      "content_obj",
      "contentObj",
      "text_block",
      "textBlock"
    ]);

    return direct !== "" ? textFromContent(direct, depth + 1) : "";
  }

  function messageTime(message) {
    if (!message || typeof message !== "object") {
      return "";
    }

    return common.readTimeCandidate(firstValue(message, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "inserted_at",
      "insertedAt",
      "timestamp",
      "time",
      "date"
    ]));
  }

  function normalizeMessageObject(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return null;
    }

    const role = normalizeRole(firstValue(message, ["role", "sender", "sender_type", "from", "author", "type", "creator"]));
    const content = textFromContent(firstValue(message, [
      "content",
      "text",
      "markdown",
      "body",
      "message",
      "value",
      "response",
      "prompt",
      "answer",
      "fragments",
      "parts",
      "content_block",
      "contentBlock",
      "content_blocks",
      "contentBlocks",
      "content_blocks_v2",
      "contentBlocksV2",
      "content_obj",
      "contentObj",
      "text_block",
      "textBlock"
    ]));

    if (!role || !content) {
      return null;
    }

    return {
      role,
      content,
      markdown: content,
      time: messageTime(message)
    };
  }

  function candidateConversationId(value) {
    const id = firstValue(value, [
      "uuid",
      "conversation_uuid",
      "conversationUuid",
      "conversation_id",
      "conversationId",
      "chat_session_id",
      "chatSessionId",
      "chat_id",
      "chatId",
      "thread_id",
      "threadId",
      "session_id",
      "sessionId",
      "id"
    ]);

    return typeof id === "string" || typeof id === "number" ? String(id) : "";
  }

  function candidateTitle(value) {
    const title = firstValue(value, [
      "title",
      "name",
      "summary",
      "topic",
      "subject",
      "conversation_title",
      "conversationTitle",
      "chat_title",
      "chatTitle"
    ]);

    return typeof title === "string" ? title : "";
  }

  function candidateConversationTime(value) {
    return common.readTimeCandidate(firstValue(value, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "inserted_at",
      "insertedAt",
      "conversation_time",
      "conversationTime",
      "date_created",
      "dateCreated",
      "creation_time",
      "creationTime",
      "born_at",
      "bornAt"
    ]));
  }

  function roleDiversity(messages) {
    return (messages || []).some((message) => message.role === "user") &&
      (messages || []).some((message) => message.role === "assistant");
  }

  function firstMessageTime(messages) {
    return (messages || []).map((message) => message.time).find(Boolean) || "";
  }

  function scanStructuredConversations(value, inherited, output, depth = 0) {
    if (!value || typeof value !== "object" || depth > 12) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 1000) {
        return;
      }

      const messages = value.map(normalizeMessageObject).filter(Boolean);
      if (messages.length >= 2 && roleDiversity(messages) && inherited.conversationId) {
        output.push({
          platform: "DeepSeek",
          sourceUrl: inherited.sourceUrl || global.location.href,
          title: inherited.title || "",
          conversationId: inherited.conversationId,
          conversationTime: inherited.conversationTime || firstMessageTime(messages) || "",
          messages
        });
      }

      for (const item of value) {
        scanStructuredConversations(item, inherited, output, depth + 1);
      }
      return;
    }

    const context = {
      sourceUrl: inherited.sourceUrl || global.location.href,
      conversationId: candidateConversationId(value) || inherited.conversationId || "",
      title: candidateTitle(value) || inherited.title || "",
      conversationTime: candidateConversationTime(value) || inherited.conversationTime || ""
    };

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object") {
        scanStructuredConversations(child, context, output, depth + 1);
      }
    }
  }

  function structuredConversationFromApi(data, sourceUrl) {
    const conversationId = conversationIdFromUrl(sourceUrl);
    const candidates = [];
    scanStructuredConversations(data, {
      sourceUrl,
      conversationId,
      title: "",
      conversationTime: ""
    }, candidates, 0);

    const exact = candidates
      .filter((candidate) => !conversationId || candidate.conversationId === conversationId)
      .sort((a, b) => {
        const timedMessages = (messages) => messages.filter((message) => message.time).length;
        return (timedMessages(b.messages) - timedMessages(a.messages)) ||
          (b.messages.length - a.messages.length);
      })[0];

    return exact || null;
  }

  function resourceConversationUrls(conversationId, sourceUrl) {
    const urls = [];
    if (global.performance && global.performance.getEntriesByType) {
      const names = (global.performance.getEntriesByType("resource") || [])
        .map((entry) => entry && entry.name)
        .filter(Boolean)
        .reverse();

      urls.push(...names.filter((name) =>
        /\/api\/.*(?:chat_session|conversation|message|history)/i.test(name) &&
        (!conversationId || name.includes(conversationId))
      ));
      urls.push(...names.filter((name) => /\/api\/.*chat_session/i.test(name)));
    }

    try {
      const origin = new URL(sourceUrl).origin;
      urls.push(`${origin}/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(conversationId)}`);
      urls.push(`${origin}/api/v0/chat_session/fetch`);
    } catch (_error) {
      // Keep the performance-derived candidates only.
    }

    return Array.from(new Set(urls));
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };

    try {
      const stored = global.localStorage && global.localStorage.getItem("userToken");
      const token = stored ? JSON.parse(stored).value : "";
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (_error) {
      // The page token is an optimization for signed-in API fallback.
    }

    return headers;
  }

  async function fetchJsonAttempt(url, conversationId, postKey) {
    const init = {
      credentials: "include",
      headers: authHeaders()
    };

    if (postKey) {
      init.method = "POST";
      init.headers = authHeaders({ "content-type": "application/json" });
      init.body = JSON.stringify({ [postKey]: conversationId });
    }

    const response = await global.fetch(url, init);
    if (!response || !response.ok) {
      return null;
    }

    return response.json();
  }

  async function fetchStructuredConversation(sourceUrl) {
    const conversationId = conversationIdFromUrl(sourceUrl);
    if (!conversationId || !global.fetch) {
      return null;
    }

    const urls = resourceConversationUrls(conversationId, sourceUrl);
    const postKeys = ["chat_session_id", "conversation_id", "id"];

    for (const url of urls) {
      const queryHasConversationId = /[?&](?:chat_session_id|conversation_id|id)=/i.test(url);
      const attempts = queryHasConversationId || /\/history_messages(?:[?]|$)/i.test(url)
        ? [() => fetchJsonAttempt(url, conversationId, "")]
        : [
          () => fetchJsonAttempt(url, conversationId, ""),
          ...postKeys.map((key) => () => fetchJsonAttempt(url, conversationId, key))
        ];

      for (const attempt of attempts) {
        try {
          const structured = structuredConversationFromApi(await attempt(), sourceUrl);
          if (structured && structured.messages && structured.messages.length) {
            return structured;
          }
        } catch (_error) {
          // Try the next URL/body shape.
        }
      }
    }

    return null;
  }

  function conversationTimeFromSources(conversationId, messages) {
    return common.extractConversationTime
      ? common.extractConversationTime({
        conversationId,
        messages,
        root: global.document.body,
        sourceUrl: global.location.href,
        allowDocumentTime: false,
        allowScriptTime: false
      })
      : "";
  }

  function extractVirtualListMessages() {
    const root = global.document.querySelector(".ds-virtual-list-visible-items");
    if (!root) {
      return [];
    }

    return Array.from(root.children || [])
      .filter(isVisible)
      .map((element, index) => {
        const hasAssistantAnswer = Boolean(element.querySelector(".ds-markdown, [class*='ds-markdown']"));
        const hasOnlyThinking = !hasAssistantAnswer && Boolean(element.querySelector(".ds-think-content, [class*='think-content'], [class*='reasoning']"));
        if (hasOnlyThinking) {
          return null;
        }

        const assistantElement = hasAssistantAnswer
          ? element.querySelector(".ds-message") || element
          : null;
        const role = assistantElement ? "assistant" : "user";
        const contentElement = assistantElement || element;
        const content = markdownOf(contentElement);
        const plainContent = utils.normalizeWhitespace(content);
        return content
          ? {
            key: element.getAttribute("data-virtual-list-item-key") || `${role}:${utils.normalizeWhitespace(content).slice(0, 160)}`,
            order: Number(element.getAttribute("data-virtual-list-item-key")) || captureSequence + index,
            role,
            content: plainContent,
            markdown: content,
            time: ""
          }
          : null;
      })
      .filter(Boolean);
  }

  function captureVisibleMessages() {
    const currentConversationId = conversationIdFromUrl(global.location.href);
    if (currentConversationId && capturedConversationId && currentConversationId !== capturedConversationId) {
      capturedMessages.clear();
      captureSequence = 0;
    }
    capturedConversationId = currentConversationId || capturedConversationId;

    const messages = extractVirtualListMessages();
    for (const message of messages) {
      if (!capturedMessages.has(message.key)) {
        capturedMessages.set(message.key, {
          ...message,
          sequence: captureSequence += 1
        });
      }
    }

    return capturedMessages.size;
  }

  function cachedMessages() {
    return Array.from(capturedMessages.values())
      .sort((a, b) => (a.order - b.order) || (a.sequence - b.sequence))
      .map(({ key, order, sequence, ...message }) => message);
  }

  function titleFromPage(messages) {
    const titleNode = safeQueryAll(global.document, [
      "[class*='chat-title']",
      "[class*='conversation-title']",
      "[aria-current='page']",
      "h1"
    ].join(",")).find((element) => isVisible(element) && visibleText(element));
    const fromNode = titleNode ? visibleText(titleNode) : "";
    const fromDocument = utils.stripPlatformFromTitle(global.document.title || "", "DeepSeek");
    const fromFirstQuestion = (messages.find((message) => message.role === "user") || {}).content || "";
    return utils.truncate(utils.stripPlatformFromTitle(fromNode || fromDocument || utils.firstMeaningfulLine(fromFirstQuestion), "DeepSeek"), 120) || "DeepSeek Chat";
  }

  function extractWithDeepSeekDom() {
    captureVisibleMessages();
    const captured = cachedMessages();
    const visible = extractVirtualListMessages().map(({ key, order, ...message }) => message);
    const sourceMessages = captured.length >= visible.length ? captured : visible;
    const messages = common.mergeAdjacentSameRoleMessages(sourceMessages);
    if (!messages.length) {
      return null;
    }

    const conversationId = conversationIdFromUrl(global.location.href);
    return common.mergeStructuredConversation({
      platform: "DeepSeek",
      sourceUrl: global.location.href,
      title: titleFromPage(messages),
      conversationId,
      conversationTime: conversationTimeFromSources(conversationId, messages),
      messages
    });
  }

  namespace.DeepSeekAdapter = {
    captureVisibleMessages,
    async extract() {
      const conversation = extractWithDeepSeekDom() || common.extractWithConfig({
        platformLabel: "DeepSeek",
        rootSelector: "main, [role='main'], .chat-container, [class*='chat']",
        titleSelectors: [
          "[data-testid='conversation-title']",
          "[data-test-id='conversation-title']",
          "[class*='chat-title']",
          "[class*='conversation-title']",
          "[aria-current='page']",
          "h1"
        ],
        messageSelectors: [
          {
            role: "user",
            selectors: [
              "[data-testid='user-message']",
              "[data-test-id='user-message']",
              "[data-message-author-role='user']",
              "[data-author-role='user']",
              "[data-author='user']",
              "[data-role='user']",
              "[data-role='human']",
              "[class*='user-message']",
              "[class*='human-message']",
              "[class*='message-user']",
              "[class*='userMessage']",
              "[class*='question']"
            ],
            contentSelectors: [
              ".prose",
              ".markdown",
              "[class*='prose']",
              "[class*='markdown']",
              "[data-testid='message-content']",
              "[data-test-id='message-content']",
              "[class*='message-content']",
              "[class*='content']"
            ]
          },
          {
            role: "assistant",
            selectors: [
              "[data-testid='assistant-message']",
              "[data-test-id='assistant-message']",
              "[data-testid='model-message']",
              "[data-test-id='model-message']",
              "[data-message-author-role='assistant']",
              "[data-author-role='assistant']",
              "[data-author='assistant']",
              "[data-role='assistant']",
              "[data-role='model']",
              "[data-role='bot']",
              "[class*='assistant-message']",
              "[class*='model-message']",
              "[class*='message-assistant']",
              "[class*='assistantMessage']",
              "[class*='response']",
              "[class*='answer']",
              "[class*='ds-markdown']",
              ".markdown",
              ".prose"
            ],
            expandClosestSelectors: [
              "[data-testid='assistant-message']",
              "[data-test-id='assistant-message']",
              "[data-testid='model-message']",
              "[data-test-id='model-message']",
              "[data-message-author-role='assistant']",
              "[data-author-role='assistant']",
              "[data-author='assistant']",
              "[data-role='assistant']",
              "[data-role='model']",
              "[data-role='bot']",
              "[class*='assistant-message']",
              "[class*='model-message']",
              "[class*='message-assistant']",
              "[class*='assistantMessage']",
              "[class*='response']",
              "[class*='answer']",
              "[class*='markdown']",
              "[class*='prose']",
              "article"
            ],
            excludeClosestSelectors: [
              "[data-testid='user-message']",
              "[data-test-id='user-message']",
              "[data-message-author-role='user']",
              "[data-author-role='user']",
              "[data-author='user']",
              "[data-role='user']",
              "[data-role='human']",
              "[class*='user-message']",
              "[class*='human-message']",
              "[class*='message-user']",
              "[class*='userMessage']",
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
              "[class*='ds-markdown']",
              "[data-testid*='markdown' i]",
              "[data-test-id*='markdown' i]",
              "[data-testid='message-content']",
              "[data-test-id='message-content']",
              "[class*='message-content']",
              "[class*='content']"
            ]
          }
        ],
        fallbackMessageSelectors: [
          "[data-testid*='message' i]",
          "[data-test-id*='message' i]",
          "[data-message-author-role]",
          "[data-author-role]",
          "[data-author]",
          "[data-role]",
          "[class*='message']",
          "[class*='response']",
          "[class*='answer']",
          "[class*='markdown']",
          "[class*='prose']",
          "[class*='ds-markdown']",
          "article"
        ],
        fallbackExpandClosestSelectors: [
          "[data-testid*='message' i]",
          "[data-test-id*='message' i]",
          "[data-message-author-role]",
          "[data-author-role]",
          "[data-author]",
          "[data-role]",
          "[class*='message']",
          "[class*='response']",
          "[class*='answer']",
          "[class*='markdown']",
          "[class*='prose']",
          "[class*='ds-markdown']",
          "article"
        ],
        fallbackExcludeClosestSelectors: [
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
        dropAssistantEchoesOfUser: true
      });

      if (conversation && conversation.platformLabel === "DeepSeek" && !conversation.platform) {
        return conversation;
      }

      if (!conversation || !conversation.messages || !conversation.messages.length) {
        const structured = await fetchStructuredConversation(global.location.href).catch(() => null);
        return structured || {
          platform: "DeepSeek",
          sourceUrl: global.location.href,
          title: "DeepSeek Chat",
          conversationId: conversationIdFromUrl(global.location.href),
          messages: []
        };
      }

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
