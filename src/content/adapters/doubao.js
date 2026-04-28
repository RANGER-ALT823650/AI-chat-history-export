(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;
  const cache = namespace.StructuredConversationCache;
  const markdown = namespace.Markdown;
  const utils = namespace.PlatformUtils;

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      const param = [
        "conversation_id",
        "conversationId",
        "chat_id",
        "chatId",
        "thread_id",
        "threadId",
        "section_id",
        "sectionId",
        "id"
      ].map((key) => url.searchParams.get(key)).find((value) => value && /[A-Za-z0-9_-]{8,}/.test(value));
      if (param) {
        return param;
      }

      const match = url.pathname.match(/\/(?:chat|conversation|bot\/chat)\/([A-Za-z0-9_-]{8,})/i);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function textOf(element) {
    return utils.normalizeWhitespace((element && (element.innerText || element.textContent)) || "");
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return Boolean(textOf(element));
    }

    const rect = element.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 && Boolean(textOf(element));
  }

  function markdownOf(element) {
    return markdown.htmlToMarkdown(element) || textOf(element);
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

  function textFromContent(value, depth = 0) {
    if (value === undefined || value === null || depth > 8) {
      return "";
    }

    if (typeof value === "string") {
      const clean = value.trim();
      if (/^[\[{]/.test(clean)) {
        try {
          return textFromContent(JSON.parse(clean), depth + 1);
        } catch (_error) {
          // Treat non-JSON strings as plain message content.
        }
      }
      return clean;
    }

    if (typeof value === "number") {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => textFromContent(item, depth + 1))
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (typeof value !== "object") {
      return "";
    }

    const marker = String(firstValue(value, [
      "type",
      "content_type",
      "contentType",
      "kind",
      "name",
      "category",
      "title",
      "label"
    ])).toLowerCase();
    if (/think|thinking|reasoning|cot|chain-of-thought|chain_of_thought/.test(marker) || /模型思考|思考过程|深度思考/.test(marker)) {
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
      "content_block",
      "contentBlock",
      "content_blocks",
      "contentBlocks",
      "content_obj",
      "contentObj",
      "text_block",
      "textBlock",
      "data"
    ]);

    return direct !== "" ? textFromContent(direct, depth + 1) : "";
  }

  function messageRole(value) {
    if (value === 1 || value === "1") {
      return "user";
    }
    if (value === 2 || value === "2") {
      return "assistant";
    }
    if (value === 3 || value === "3") {
      return "system";
    }

    const text = String(value || "").toLowerCase();
    if (/human|user|prompt/.test(text)) {
      return "user";
    }
    if (/aibot|assistant|bot|model|doubao|ai/.test(text)) {
      return "assistant";
    }
    if (/system/.test(text)) {
      return "system";
    }

    return "";
  }

  function messageTime(message) {
    return common.readTimeCandidate(firstValue(message, [
      "create_time",
      "createTime",
      "created_at",
      "createdAt",
      "inserted_at",
      "insertedAt",
      "timestamp",
      "time",
      "date"
    ]));
  }

  function normalizeApiMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return null;
    }

    const role = messageRole(firstValue(message, [
      "user_type",
      "userType",
      "sender_type",
      "senderType",
      "role",
      "sender",
      "from",
      "author",
      "type"
    ]));
    const content = [
      "content",
      "text",
      "markdown",
      "body",
      "message",
      "content_block",
      "contentBlock",
      "content_blocks",
      "contentBlocks",
      "content_obj",
      "contentObj",
      "data"
    ].map((key) => textFromContent(message[key])).find(Boolean) || "";

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

  function roleDiversity(messages) {
    return (messages || []).some((message) => message.role === "user") &&
      (messages || []).some((message) => message.role === "assistant");
  }

  function earliestMessageTime(messages) {
    return (messages || []).map((message) => message.time).filter(Boolean).sort()[0] || "";
  }

  function recentConversationUrl(sourceUrl) {
    if (global.performance && global.performance.getEntriesByType) {
      const resource = (global.performance.getEntriesByType("resource") || [])
        .map((entry) => entry && entry.name)
        .filter(Boolean)
        .reverse()
        .find((name) => /\/im\/chain\/recent_conv(?:[?]|$)/i.test(name));
      if (resource) {
        return resource;
      }
    }

    try {
      return `${new URL(sourceUrl).origin}/im/chain/recent_conv`;
    } catch (_error) {
      return "";
    }
  }

  function recentConversationRequestBody() {
    return {
      cmd: 3200,
      uplink_body: {
        pull_recent_conv_chain_uplink_body: {
          api_version: 1,
          conv_version: 0,
          direction: 3,
          limit: 50,
          message_count_per_conv: 20,
          option: {
            not_need_message: false,
            need_complete_conversation: true,
            need_coco_conversation: true,
            need_coco_bot: true,
            need_pc_pin_chain: true,
            pc_pin_query_type: 1
          }
        }
      }
    };
  }

  async function fetchStructuredConversation(sourceUrl) {
    const conversationId = conversationIdFromUrl(sourceUrl);
    const url = recentConversationUrl(sourceUrl);
    if (!conversationId || !url || !global.fetch) {
      return null;
    }

    const response = await global.fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json; encoding=utf-8"
      },
      body: JSON.stringify(recentConversationRequestBody())
    });
    if (!response || !response.ok) {
      return null;
    }

    const data = await response.json();
    const body = data && data.downlink_body && data.downlink_body.pull_recent_conv_chain_downlink_body;
    const cells = body && Array.isArray(body.cells) ? body.cells : [];
    const cell = cells.find((item) => {
      const conversation = item && item.conversation;
      return conversation && String(conversation.conversation_id || "") === String(conversationId);
    });
    const conversation = cell && cell.conversation;
    const messages = ((conversation && conversation.messages) || []).map(normalizeApiMessage).filter(Boolean);
    if (!conversation || messages.length < 2 || !roleDiversity(messages)) {
      return null;
    }

    return {
      platform: "Doubao",
      sourceUrl,
      title: typeof conversation.name === "string" ? conversation.name : "",
      conversationId,
      conversationTime: earliestMessageTime(messages),
      messages
    };
  }

  function conversationTimeFromSources(conversationId, messages) {
    return common.extractConversationTime
      ? common.extractConversationTime({
        conversationId,
        messages,
        root: global.document.body,
        sourceUrl: global.location.href,
        allowTimestampCache: false,
        allowMessageTimes: false,
        allowDocumentTime: false,
        allowScriptTime: false
      })
      : "";
  }

  function extractMessageListMessages() {
    const root = global.document.querySelector(".inter-H_fm37");
    if (!root) {
      return [];
    }

    return Array.from(root.children || [])
      .filter((element) => isVisible(element) && /\bcontainer-/.test(String(element.className || "")))
      .map((element, index) => {
        const role = index % 2 === 0 ? "user" : "assistant";
        const contentElement = role === "assistant"
          ? element.querySelector(".flow-markdown-body, [class*='markdown'], [class*='mdbox']") || element
          : element;
        const content = markdownOf(contentElement);
        return content
          ? {
            role,
            content: textOf(contentElement),
            markdown: content,
            time: ""
          }
          : null;
      })
      .filter(Boolean);
  }

  function titleFromPage(messages) {
    const fromDocument = utils.stripPlatformFromTitle(global.document.title || "", "Doubao");
    const fromHeader = Array.from(global.document.querySelectorAll("main h1, header [class*='title'], [class*='conversation-title']"))
      .map(textOf)
      .find(Boolean) || "";
    const fromFirstQuestion = (messages.find((message) => message.role === "user") || {}).content || "";
    return utils.truncate(utils.stripPlatformFromTitle(fromHeader || fromDocument || utils.firstMeaningfulLine(fromFirstQuestion), "Doubao"), 120) || "Doubao Chat";
  }

  function extractWithDoubaoDom() {
    const messages = common.mergeAdjacentSameRoleMessages(extractMessageListMessages());
    if (!messages.length) {
      return null;
    }

    const conversationId = conversationIdFromUrl(global.location.href);
    return common.mergeStructuredConversation({
      platform: "Doubao",
      sourceUrl: global.location.href,
      title: titleFromPage(messages),
      conversationId,
      conversationTime: conversationTimeFromSources(conversationId, messages),
      messages
    });
  }

  namespace.DoubaoAdapter = {
    async extract() {
      const conversation = extractWithDoubaoDom() || common.extractWithConfig({
        platformLabel: "Doubao",
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
              "[class*='question']",
              "[class*='send-message']"
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
