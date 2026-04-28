(function () {
  "use strict";

  if (window.__AI_CHAT_EXPORTER_API_INTERCEPTOR__) {
    return;
  }
  window.__AI_CHAT_EXPORTER_API_INTERCEPTOR__ = true;

  var MESSAGE_TYPE = "AI_CHAT_EXPORTER_TIMESTAMP";
  var STRUCTURED_MESSAGE_TYPE = "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION";
  var GEMINI_DEBUG_MESSAGE_TYPE = "AI_CHAT_EXPORTER_GEMINI_DEBUG";
  var replayQueue = [];
  var replayTimer = null;

  function scheduleReplay() {
    if (replayTimer || replayQueue.length === 0) {
      return;
    }

    replayTimer = window.setTimeout(function () {
      replayTimer = null;
      replayQueue = replayQueue.filter(function (item) {
        try {
          window.postMessage(item.payload, "*");
        } catch (_error) {
          // Ignore replay errors.
        }

        item.attempts += 1;
        return item.attempts < 6 && Date.now() - item.createdAt < 15000;
      });
      scheduleReplay();
    }, 800);
  }

  function postMessageWithReplay(payload) {
    try {
      window.postMessage(payload, "*");
    } catch (_error) {
      // Silently ignore postMessage errors.
    }

    replayQueue.push({
      payload: payload,
      attempts: 0,
      createdAt: Date.now()
    });

    if (replayQueue.length > 200) {
      replayQueue.splice(0, replayQueue.length - 200);
    }

    scheduleReplay();
  }

  function postTimestamp(conversationId, timestamp, platform, extra) {
    if (!conversationId || !timestamp) {
      return;
    }

    postMessageWithReplay({
      type: MESSAGE_TYPE,
      conversationId: String(conversationId),
      timestamp: String(timestamp),
      platform: platform || "",
      title: (extra && extra.title) || "",
      updatedAt: (extra && extra.updatedAt) || ""
    });
  }

  function postStructuredConversation(conversation) {
    if (
      !conversation ||
      !conversation.conversationId ||
      !conversation.platform ||
      !conversation.messages ||
      conversation.messages.length === 0
    ) {
      return;
    }

    postMessageWithReplay({
      type: STRUCTURED_MESSAGE_TYPE,
      conversation: conversation
    });
  }

  function postGeminiDebugEvidence(evidence) {
    if (!evidence || !evidence.ids || !evidence.ids.length) {
      return;
    }

    postMessageWithReplay({
      type: GEMINI_DEBUG_MESSAGE_TYPE,
      evidence: evidence
    });
  }

  // ---------------------------------------------------------------------------
  // Timestamp normalization
  // ---------------------------------------------------------------------------

  function normalizeTimestamp(value) {
    if (!value) {
      return "";
    }

    var str = String(value).trim();

    // Unix seconds (10 digits)
    if (/^\d{10}$/.test(str)) {
      return new Date(Number(str) * 1000).toISOString();
    }

    // Unix milliseconds (13 digits)
    if (/^\d{13}$/.test(str)) {
      return new Date(Number(str)).toISOString();
    }

    // Unix microseconds (16 digits)
    if (/^\d{16}$/.test(str)) {
      return new Date(Number(str) / 1000).toISOString();
    }

    // Numeric that looks timestamp-ish (seconds or ms)
    if (/^\d+(\.\d+)?$/.test(str)) {
      var num = Number(str);
      if (num > 1e15) {
        return new Date(num / 1000).toISOString();
      }
      if (num > 1e12) {
        return new Date(num).toISOString();
      }
      if (num > 1e9) {
        return new Date(num * 1000).toISOString();
      }
      return "";
    }

    // ISO 8601 or similar
    var isoMatch = str.match(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/);
    if (isoMatch) {
      var d = new Date(isoMatch[0]);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }

    return "";
  }

  function plausibleYear(iso) {
    var m = String(iso || "").match(/^(\d{4})/);
    if (!m) {
      return false;
    }
    var year = Number(m[1]);
    var currentYear = new Date().getFullYear();
    return year >= 2020 && year <= currentYear + 1;
  }

  function validTimestamp(value) {
    var ts = normalizeTimestamp(value);
    return ts && plausibleYear(ts) ? ts : "";
  }

  // ---------------------------------------------------------------------------
  // Deep object scanning — scan any JSON for timestamp fields
  // ---------------------------------------------------------------------------

  var TIME_KEYS = /^(created[_-]?at|create[_-]?time|updated[_-]?at|update[_-]?time|inserted[_-]?at|timestamp|start[_-]?time|conversation[_-]?time|date[_-]?created|creation[_-]?time|born[_-]?at)$/i;
  var ID_KEYS = /^(id|conversation[_-]?id|chat[_-]?id|uuid|thread[_-]?id|convo[_-]?id)$/i;
  var TITLE_KEYS = /^(title|name|summary|topic|subject|conversation[_-]?title|chat[_-]?title|display[_-]?name)$/i;
  var UPDATED_KEYS = /^(updated[_-]?at|update[_-]?time|modified[_-]?at|last[_-]?modified|last[_-]?updated|last[_-]?message[_-]?at)$/i;

  function normalizedRole(value) {
    var text = "";
    if (typeof value === "string") {
      text = value;
    } else if (value && typeof value === "object") {
      text = value.role || value.type || value.name || value.id || "";
    }

    text = String(text || "").toLowerCase();
    if (/user|human|you|client|customer|prompt/.test(text)) {
      return "user";
    }
    if (/assistant|model|bot|claude|gemini|grok|deepseek|doubao|chatgpt|ai/.test(text)) {
      return "assistant";
    }
    if (/system/.test(text)) {
      return "system";
    }

    return "";
  }

  function firstValue(obj, keys) {
    if (!obj || typeof obj !== "object") {
      return "";
    }

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }

    return "";
  }

  function isReasoningContentObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    var marker = [
      firstValue(value, ["type", "content_type", "contentType", "kind", "name", "category"]),
      firstValue(value, ["title", "label", "display_name", "displayName"])
    ].filter(Boolean).join(" ").toLowerCase();

    return (
      /(?:^|[\s_-])(?:think|thinking|reasoning|cot|chain-of-thought|chain_of_thought)(?:[\s_-]|$)/.test(marker) ||
      /模型思考|思考过程|深度思考/.test(marker)
    );
  }

  function textFromContent(value, depth) {
    if (value === undefined || value === null || depth > 8) {
      return "";
    }

    if (typeof value === "string" || typeof value === "number") {
      return String(value).trim();
    }

    if (Array.isArray(value)) {
      return value
        .map(function (item) { return textFromContent(item, depth + 1); })
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (typeof value !== "object") {
      return "";
    }

    if (isReasoningContentObject(value)) {
      return "";
    }

    if (value.content && value.content.parts) {
      return textFromContent(value.content.parts, depth + 1);
    }

    if (value.parts) {
      return textFromContent(value.parts, depth + 1);
    }

    var direct = firstValue(value, [
      "text",
      "markdown",
      "body",
      "content",
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
    ]);

    if (direct !== "") {
      return textFromContent(direct, depth + 1);
    }

    return "";
  }

  function messageTime(obj) {
    return validTimestamp(firstValue(obj, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "timestamp",
      "time",
      "date",
      "updated_at",
      "updatedAt",
      "update_time",
      "updateTime"
    ]));
  }

  function normalizeMessageObject(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return null;
    }

    var author = firstValue(obj, ["author", "sender", "sender_type", "from", "role", "type", "creator"]);
    var role = normalizedRole(author) || normalizedRole(obj.role);
    var content = textFromContent(firstValue(obj, [
      "content",
      "text",
      "markdown",
      "body",
      "message",
      "value",
      "response",
      "prompt",
      "answer"
    ]), 0);

    if (!role || !content) {
      return null;
    }

    return {
      role: role,
      content: content,
      markdown: content,
      time: messageTime(obj)
    };
  }

  function candidateConversationId(obj) {
    var value = firstValue(obj, [
      "uuid",
      "conversation_uuid",
      "conversationUuid",
      "conversation_id",
      "conversationId",
      "chat_id",
      "chatId",
      "thread_id",
      "threadId",
      "id"
    ]);

    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }

  function candidateTitle(obj) {
    var value = firstValue(obj, [
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

    return typeof value === "string" ? value : "";
  }

  function candidateConversationTime(obj) {
    return validTimestamp(firstValue(obj, [
      "created_at",
      "createdAt",
      "create_time",
      "createTime",
      "conversation_time",
      "conversationTime",
      "inserted_at",
      "insertedAt",
      "timestamp",
      "updated_at",
      "updatedAt"
    ]));
  }

  function roleDiversity(messages) {
    var hasUser = false;
    var hasAssistant = false;
    for (var i = 0; i < messages.length; i++) {
      hasUser = hasUser || messages[i].role === "user";
      hasAssistant = hasAssistant || messages[i].role === "assistant";
    }
    return hasUser && hasAssistant;
  }

  function firstMessageTime(messages) {
    return (messages || []).map(function (message) { return message.time; }).find(Boolean) || "";
  }

  function earliestMessageTime(messages) {
    return (messages || [])
      .map(function (message) { return message && message.time; })
      .filter(Boolean)
      .sort()[0] || "";
  }

  function timeFromKeys(obj, keys) {
    return validTimestamp(firstValue(obj, keys));
  }

  function parseJsonString(value) {
    if (typeof value !== "string") {
      return null;
    }

    var text = value.trim();
    if (!/^[\[{]/.test(text)) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function textFromContentValue(value, depth) {
    if (typeof value === "string") {
      var parsed = parseJsonString(value);
      if (parsed !== null) {
        return textFromContentValue(parsed, depth + 1);
      }
    }

    return textFromContent(value, depth);
  }

  function contentFromKeys(obj, keys) {
    if (!obj || typeof obj !== "object") {
      return "";
    }

    for (var i = 0; i < keys.length; i++) {
      var value = obj[keys[i]];
      if (value === undefined || value === null) {
        continue;
      }

      var text = textFromContentValue(value, 0);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function scanStructuredConversations(value, platform, inherited, depth) {
    if (!value || typeof value !== "object" || depth > 12) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 1000) {
        return;
      }

      var messages = value.map(normalizeMessageObject).filter(Boolean);
      if (messages.length >= 2 && roleDiversity(messages) && inherited && inherited.conversationId) {
        var messageConversationTime = firstMessageTime(messages);
        postStructuredConversation({
          platform: platform,
          conversationId: inherited.conversationId,
          title: inherited.title || "",
          conversationTime: platform === "Doubao"
            ? messageConversationTime
            : (inherited.conversationTime || messageConversationTime || ""),
          messages: messages
        });
      }

      for (var i = 0; i < value.length; i++) {
        scanStructuredConversations(value[i], platform, inherited, depth + 1);
      }
      return;
    }

    var context = {
      conversationId: candidateConversationId(value) || (inherited && inherited.conversationId) || "",
      title: candidateTitle(value) || (inherited && inherited.title) || "",
      conversationTime: platform === "Doubao"
        ? ((inherited && inherited.conversationTime) || "")
        : (candidateConversationTime(value) || (inherited && inherited.conversationTime) || "")
    };

    if (platform !== "Doubao" && context.conversationId && context.conversationTime) {
      postTimestamp(context.conversationId, context.conversationTime, platform, {
        title: context.title
      });
    }

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      var child = value[keys[j]];
      if (child && typeof child === "object") {
        scanStructuredConversations(child, platform, context, depth + 1);
      }
    }
  }

  function extractFromObject(obj, platform) {
    if (!obj || typeof obj !== "object") {
      return;
    }

    // Avoid huge arrays
    if (Array.isArray(obj) && obj.length > 500) {
      return;
    }

    var id = "";
    var timestamp = "";
    var title = "";
    var updatedAt = "";

    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = obj[key];

      if (typeof value === "string" || typeof value === "number") {
        if (ID_KEYS.test(key) && !id) {
          id = String(value);
        }
        if (TIME_KEYS.test(key) && !timestamp) {
          timestamp = validTimestamp(value);
        }
        if (TITLE_KEYS.test(key) && !title && typeof value === "string") {
          title = value;
        }
        if (UPDATED_KEYS.test(key) && !updatedAt) {
          updatedAt = validTimestamp(value);
        }
      }
    }

    if (id && timestamp) {
      postTimestamp(id, timestamp, platform, { title: title, updatedAt: updatedAt });
    }

    // Recurse into nested objects/arrays
    for (var j = 0; j < keys.length; j++) {
      var child = obj[keys[j]];
      if (child && typeof child === "object") {
        extractFromObject(child, platform);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Platform-specific parsers
  // ---------------------------------------------------------------------------

  function detectPlatform(url) {
    if (/chatgpt\.com|chat\.openai\.com/i.test(url)) {
      return "chatgpt";
    }
    if (/claude\.ai/i.test(url)) {
      return "claude";
    }
    if (/gemini\.google\.com/i.test(url)) {
      return "gemini";
    }
    if (/grok\.com|grok\.x\.ai|x\.com\/i\/grok/i.test(url)) {
      return "grok";
    }
    if (/deepseek\.com/i.test(url)) {
      return "deepseek";
    }
    if (/doubao\.com/i.test(url)) {
      return "doubao";
    }
    return "";
  }

  // ChatGPT: intercept backend-api conversation responses.
  function isChatGPTConversationEndpoint(url) {
    return /\/backend-api\/(?:conversation|conversations)(?:\/|[?]|$)/i.test(url) ||
           /\/backend-api\/gizmos\/[^/]+\/conversations(?:[?]|$)/i.test(url);
  }

  function parseChatGPTResponse(data) {
    if (!data) {
      return;
    }

    if (data.id && (data.create_time || data.update_time)) {
      postTimestamp(data.id, data.create_time || data.update_time, "ChatGPT", {
        title: data.title || "",
        updatedAt: validTimestamp(data.update_time)
      });
    }

    if (data.mapping && typeof data.mapping === "object" && data.id) {
      var earliest = "";
      var nodes = Object.keys(data.mapping);
      for (var i = 0; i < nodes.length; i++) {
        var message = data.mapping[nodes[i]] && data.mapping[nodes[i]].message;
        var ts = message && validTimestamp(message.create_time || message.update_time);
        if (ts && (!earliest || ts < earliest)) {
          earliest = ts;
        }
      }

      if (earliest) {
        postTimestamp(data.id, earliest, "ChatGPT", {
          title: data.title || "",
          updatedAt: validTimestamp(data.update_time)
        });
      }
    }

    if (Array.isArray(data)) {
      for (var j = 0; j < data.length; j++) {
        parseChatGPTResponse(data[j]);
      }
      return;
    }

    var items = data.items || data.conversations || data.data || data.results;
    if (Array.isArray(items)) {
      for (var k = 0; k < items.length; k++) {
        parseChatGPTResponse(items[k]);
      }
    }

    extractFromObject(data, "ChatGPT");
  }

  // Claude: intercept /api/organizations/.../chat_conversations
  function isClaudeConversationEndpoint(url) {
    return /\/api\/organizations\/[^/]+\/chat_conversations/i.test(url);
  }

  function parseClaudeResponse(data) {
    if (!data) {
      return;
    }

    // Single conversation object
    if (data.uuid && (data.created_at || data.updated_at)) {
      postTimestamp(data.uuid, data.created_at || data.updated_at, "Claude", {
        title: data.name || data.title || "",
        updatedAt: validTimestamp(data.updated_at)
      });
    }

    // Array of conversations (list endpoint)
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        parseClaudeResponse(data[i]);
      }
      return;
    }

    // Nested response with items/conversations array
    var items = data.conversations || data.items || data.data || data.results || data.chats;
    if (Array.isArray(items)) {
      for (var j = 0; j < items.length; j++) {
        parseClaudeResponse(items[j]);
      }
    }

    scanStructuredConversations(data, "Claude", {}, 0);

    // Generic deep scan as fallback
    extractFromObject(data, "Claude");
  }

  // Grok: intercept conversation-related endpoints
  function isGrokConversationEndpoint(url) {
    return /\/(rest|api)\/.*(conversation|chat|history|thread)/i.test(url) ||
           /\/c\/[a-f0-9-]{30,}/i.test(url);
  }

  var GROK_CREATE_TIME_KEYS = [
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
  ];
  var GROK_CONTENT_KEYS = [
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
  ];

  function grokConversationIdFromUrl(sourceUrl) {
    try {
      var currentUrl = (window.location && window.location.href) || "https://grok.com/";
      var url = new URL(sourceUrl || currentUrl, currentUrl);
      var match = url.pathname.match(/\/(?:c|chat)\/([A-Za-z0-9-]{8,})/i) ||
        url.pathname.match(/\/rest\/app-chat\/conversations\/([A-Za-z0-9-]{8,})/i);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function grokConversationId(obj) {
    var value = firstValue(obj, [
      "conversationId",
      "conversation_id",
      "chatId",
      "chat_id",
      "threadId",
      "thread_id",
      "id"
    ]);

    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }

  function grokRole(value) {
    var text = String(value || "").toLowerCase();
    if (/^(human|user|client|customer|prompt)$/.test(text)) {
      return "user";
    }
    if (/^(assistant|model|bot|grok|ai)$/.test(text)) {
      return "assistant";
    }
    if (/^system$/.test(text)) {
      return "system";
    }

    return normalizedRole(value);
  }

  function grokCreateTime(obj) {
    return timeFromKeys(obj, GROK_CREATE_TIME_KEYS);
  }

  function normalizeGrokMessage(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return null;
    }

    var role = grokRole(firstValue(obj, [
      "sender",
      "role",
      "author",
      "from",
      "creator",
      "type"
    ]));
    var content = contentFromKeys(obj, GROK_CONTENT_KEYS);

    if (!role || !content) {
      return null;
    }

    return {
      role: role,
      content: content,
      markdown: content,
      time: grokCreateTime(obj)
    };
  }

  function scanGrokConversations(value, inherited, depth) {
    if (!value || typeof value !== "object" || depth > 12) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 1000) {
        return;
      }

      var messages = value.map(normalizeGrokMessage).filter(Boolean);
      if (messages.length >= 2 && roleDiversity(messages)) {
        var conversationId = (inherited && inherited.conversationId) || "";
        if (!conversationId) {
          conversationId = value.map(grokConversationId).find(Boolean) || "";
        }

        if (conversationId) {
          var conversationTime = (inherited && inherited.conversationTime) || earliestMessageTime(messages) || "";
          if (conversationTime) {
            postTimestamp(conversationId, conversationTime, "Grok", {
              title: (inherited && inherited.title) || ""
            });
          }
          postStructuredConversation({
            platform: "Grok",
            conversationId: conversationId,
            title: (inherited && inherited.title) || "",
            conversationTime: conversationTime,
            messages: messages
          });
        }
      }

      for (var i = 0; i < value.length; i++) {
        scanGrokConversations(value[i], inherited, depth + 1);
      }
      return;
    }

    var context = {
      conversationId: grokConversationId(value) || (inherited && inherited.conversationId) || "",
      title: candidateTitle(value) || (inherited && inherited.title) || "",
      conversationTime: grokCreateTime(value) || (inherited && inherited.conversationTime) || ""
    };

    if (context.conversationId && context.conversationTime) {
      postTimestamp(context.conversationId, context.conversationTime, "Grok", {
        title: context.title
      });
    }

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      var child = value[keys[j]];
      if (child && typeof child === "object") {
        scanGrokConversations(child, context, depth + 1);
      }
    }
  }

  function parseGrokResponse(data, sourceUrl) {
    scanGrokConversations(data, {
      conversationId: grokConversationIdFromUrl(sourceUrl || ((window.location && window.location.href) || ""))
    }, 0);
  }

  function isGenericConversationEndpoint(url) {
    return /\/(api|rest|web-api|samantha|alice|bot|conversation|chat|im|agent)\//i.test(url) &&
           /(conversation|conversation_id|conversationId|chat|history|message|thread|session|chain|samantha|alice|bot)/i.test(url);
  }

  function parseGenericConversationResponse(data, platformLabel) {
    scanStructuredConversations(data, platformLabel, {}, 0);
    if (platformLabel !== "Doubao") {
      extractFromObject(data, platformLabel);
    }
  }

  // DeepSeek: current conversation payloads arrive from
  // /api/v0/chat/history_messages with data.biz_data.chat_session and
  // data.biz_data.chat_messages. Only inserted/created message times are
  // accepted here; updated_at is a list-sort time, not the chat start time.
  var MESSAGE_CREATE_TIME_KEYS = [
    "inserted_at",
    "insertedAt",
    "created_at",
    "createdAt",
    "create_time",
    "createTime",
    "server_create_time",
    "serverCreateTime",
    "create_timestamp",
    "createTimestamp",
    "timestamp",
    "time",
    "date"
  ];
  var CONVERSATION_CREATE_TIME_KEYS = [
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
  ];
  var STRUCTURED_CONTENT_KEYS = [
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
    "textBlock",
    "data"
  ];

  function deepSeekConversationTime(obj) {
    return timeFromKeys(obj, CONVERSATION_CREATE_TIME_KEYS);
  }

  function deepSeekMessageTime(obj) {
    return timeFromKeys(obj, MESSAGE_CREATE_TIME_KEYS);
  }

  function normalizeDeepSeekMessage(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return null;
    }

    var role = normalizedRole(firstValue(obj, [
      "role",
      "sender",
      "sender_type",
      "senderType",
      "from",
      "author",
      "type",
      "creator"
    ]));
    var content = contentFromKeys(obj, STRUCTURED_CONTENT_KEYS);

    if (!role || !content) {
      return null;
    }

    return {
      role: role,
      content: content,
      markdown: content,
      time: deepSeekMessageTime(obj)
    };
  }

  function scanDeepSeekConversations(value, inherited, depth) {
    if (!value || typeof value !== "object" || depth > 12) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 1000) {
        return;
      }

      var messages = value.map(normalizeDeepSeekMessage).filter(Boolean);
      if (messages.length >= 2 && roleDiversity(messages)) {
        var conversationId = (inherited && inherited.conversationId) || "";
        if (!conversationId) {
          conversationId = value.map(candidateConversationId).find(Boolean) || "";
        }

        if (conversationId) {
          var conversationTime = (inherited && inherited.conversationTime) || earliestMessageTime(messages) || "";
          if (conversationTime) {
            postTimestamp(conversationId, conversationTime, "DeepSeek", {
              title: (inherited && inherited.title) || ""
            });
          }
          postStructuredConversation({
            platform: "DeepSeek",
            conversationId: conversationId,
            title: (inherited && inherited.title) || "",
            conversationTime: conversationTime,
            messages: messages
          });
        }
      }

      for (var i = 0; i < value.length; i++) {
        scanDeepSeekConversations(value[i], inherited, depth + 1);
      }
      return;
    }

    var session = value.chat_session || value.chatSession || value.session || value.conversation || null;
    var sessionContext = inherited || {};
    if (session && typeof session === "object" && !Array.isArray(session)) {
      sessionContext = {
        conversationId: candidateConversationId(session) || (inherited && inherited.conversationId) || "",
        title: candidateTitle(session) || (inherited && inherited.title) || "",
        conversationTime: deepSeekConversationTime(session) || (inherited && inherited.conversationTime) || ""
      };
    }

    var context = {
      conversationId: candidateConversationId(value) || sessionContext.conversationId || "",
      title: candidateTitle(value) || sessionContext.title || "",
      conversationTime: deepSeekConversationTime(value) || sessionContext.conversationTime || ""
    };

    if (context.conversationId && context.conversationTime) {
      postTimestamp(context.conversationId, context.conversationTime, "DeepSeek", {
        title: context.title
      });
    }

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      var child = value[keys[j]];
      if (child && typeof child === "object") {
        scanDeepSeekConversations(child, context, depth + 1);
      }
    }
  }

  function parseDeepSeekResponse(data) {
    scanDeepSeekConversations(data, {}, 0);
  }

  // Doubao: /im/chain/single carries actual message records. The app also
  // calls conversation-info endpoints with server/list timestamps; those are
  // intentionally ignored unless the message objects themselves have times.
  function doubaoRole(value) {
    if (value === 1 || value === "1") {
      return "user";
    }
    if (value === 2 || value === "2") {
      return "assistant";
    }
    if (value === 3 || value === "3") {
      return "system";
    }

    var text = String(value || "").toLowerCase();
    if (/human|user|customer|prompt/.test(text)) {
      return "user";
    }
    if (/aibot|assistant|bot|doubao|model|ai/.test(text)) {
      return "assistant";
    }
    if (/system/.test(text)) {
      return "system";
    }

    return normalizedRole(value);
  }

  function doubaoConversationId(obj) {
    var value = firstValue(obj, [
      "conversation_id",
      "conversationId",
      "local_conversation_id",
      "localConversationId",
      "section_id",
      "sectionId",
      "chat_id",
      "chatId",
      "thread_id",
      "threadId",
      "id"
    ]);

    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }

  function doubaoMessageTime(obj) {
    return timeFromKeys(obj, MESSAGE_CREATE_TIME_KEYS);
  }

  function doubaoDirectContent(obj) {
    if (!obj || typeof obj !== "object") {
      return "";
    }

    for (var i = 0; i < STRUCTURED_CONTENT_KEYS.length; i++) {
      var key = STRUCTURED_CONTENT_KEYS[i];
      var value = obj[key];
      if (value === undefined || value === null) {
        continue;
      }

      if (/^(message|msg|payload|item|entity|data)$/i.test(key) && typeof value === "object" && !Array.isArray(value)) {
        continue;
      }

      var text = textFromContentValue(value, 0);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function isDoubaoMessageLike(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return false;
    }

    return Boolean(
      firstValue(obj, ["user_type", "userType", "sender_type", "senderType", "role", "sender", "from", "author"]) !== "" ||
      doubaoDirectContent(obj) ||
      doubaoMessageTime(obj)
    );
  }

  function unwrapDoubaoMessage(obj, depth) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 4) {
      return obj;
    }

    if (isDoubaoMessageLike(obj)) {
      return obj;
    }

    var wrapperKeys = [
      "message",
      "msg",
      "chat_message",
      "chatMessage",
      "message_info",
      "messageInfo",
      "message_detail",
      "messageDetail",
      "payload",
      "item",
      "entity"
    ];
    for (var i = 0; i < wrapperKeys.length; i++) {
      var child = obj[wrapperKeys[i]];
      if (child && typeof child === "object" && !Array.isArray(child)) {
        var unwrapped = unwrapDoubaoMessage(child, depth + 1);
        if (isDoubaoMessageLike(unwrapped)) {
          return unwrapped;
        }
      }
    }

    return obj;
  }

  function normalizeDoubaoMessage(obj) {
    var source = unwrapDoubaoMessage(obj, 0);
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return null;
    }

    var role = doubaoRole(firstValue(source, [
      "user_type",
      "userType",
      "sender_type",
      "senderType",
      "role",
      "sender",
      "from",
      "author",
      "type",
      "creator"
    ]));
    var content = contentFromKeys(source, STRUCTURED_CONTENT_KEYS);

    if (!role || !content) {
      return null;
    }

    return {
      role: role,
      content: content,
      markdown: content,
      time: doubaoMessageTime(source)
    };
  }

  function scanDoubaoConversations(value, inherited, depth) {
    if (!value || typeof value !== "object" || depth > 12) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 1000) {
        return;
      }

      var messages = value.map(normalizeDoubaoMessage).filter(Boolean);
      if (messages.length >= 2 && roleDiversity(messages)) {
        var conversationId = (inherited && inherited.conversationId) || "";
        if (!conversationId) {
          conversationId = value.map(function (item) {
            return doubaoConversationId(unwrapDoubaoMessage(item, 0));
          }).find(Boolean) || "";
        }

        if (conversationId) {
          var messageConversationTime = earliestMessageTime(messages);
          if (messageConversationTime) {
            postTimestamp(conversationId, messageConversationTime, "Doubao", {
              title: (inherited && inherited.title) || ""
            });
          }
          postStructuredConversation({
            platform: "Doubao",
            conversationId: conversationId,
            title: (inherited && inherited.title) || "",
            conversationTime: messageConversationTime,
            messages: messages
          });
        }
      }

      for (var i = 0; i < value.length; i++) {
        scanDoubaoConversations(value[i], inherited, depth + 1);
      }
      return;
    }

    var context = {
      conversationId: doubaoConversationId(value) || (inherited && inherited.conversationId) || "",
      title: candidateTitle(value) || (inherited && inherited.title) || ""
    };

    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      var child = value[keys[j]];
      if (child && typeof child === "object") {
        scanDoubaoConversations(child, context, depth + 1);
      }
    }
  }

  function parseDoubaoResponse(data) {
    scanDoubaoConversations(data, {}, 0);
  }

  // Gemini: intercept batchexecute responses
  function isGeminiEndpoint(url) {
    return /batchexecute/i.test(url) ||
           /\/data\//i.test(url) ||
           /BardChat/i.test(url);
  }

  function normalizeGeminiConversationId(value) {
    if (typeof value !== "string") {
      return "";
    }

    var text = String(value || "").trim();
    if (text.indexOf("c_") === 0) {
      text = text.slice(2);
    }

    return /^[a-f0-9]{8,}$/i.test(text) ? text : "";
  }

  function geminiTimestampFromPair(value) {
    if (!Array.isArray(value) || typeof value[0] !== "number") {
      return "";
    }

    var seconds = value[0];
    var nanos = typeof value[1] === "number" ? value[1] : 0;
    if (seconds < 1e9 || seconds > 3e9 || nanos < 0 || nanos >= 1e9) {
      return "";
    }

    return validTimestamp(Math.round(seconds * 1000 + nanos / 1000000));
  }

  function collectGeminiResponseTexts(value, output, depth) {
    if (!value || depth > 16) {
      return;
    }

    if (!Array.isArray(value)) {
      return;
    }

    if (
      typeof value[0] === "string" &&
      /^rc_/i.test(value[0]) &&
      Array.isArray(value[1]) &&
      typeof value[1][0] === "string"
    ) {
      output.push(value[1][0]);
      return;
    }

    for (var i = 0; i < value.length; i++) {
      collectGeminiResponseTexts(value[i], output, depth + 1);
    }
  }

  function geminiUserTextFromTurn(turn) {
    var payload = turn && turn[2];
    if (
      Array.isArray(payload) &&
      Array.isArray(payload[0]) &&
      typeof payload[0][0] === "string"
    ) {
      return payload[0][0].trim();
    }

    return "";
  }

  function geminiAssistantTextFromTurn(turn) {
    var texts = [];
    collectGeminiResponseTexts(turn && turn[3], texts, 0);
    return texts.filter(Boolean).join("\n\n").trim();
  }

  function maybeGeminiConversationTurn(value) {
    if (!Array.isArray(value) || value.length < 5) {
      return null;
    }

    var conversationId = "";
    if (Array.isArray(value[0])) {
      conversationId = normalizeGeminiConversationId(value[0][0]);
    }
    if (!conversationId && Array.isArray(value[1])) {
      conversationId = normalizeGeminiConversationId(value[1][0]);
    }

    var time = geminiTimestampFromPair(value[4]);
    var userText = geminiUserTextFromTurn(value);
    var assistantText = geminiAssistantTextFromTurn(value);

    if (!conversationId || !time || (!userText && !assistantText)) {
      return null;
    }

    return {
      conversationId: conversationId,
      time: time,
      userText: userText,
      assistantText: assistantText
    };
  }

  function extractGeminiTurns(value, output, depth) {
    if (!Array.isArray(value) || depth > 12) {
      return;
    }

    var turn = maybeGeminiConversationTurn(value);
    if (turn) {
      output.push(turn);
      return;
    }

    for (var i = 0; i < value.length; i++) {
      extractGeminiTurns(value[i], output, depth + 1);
    }
  }

  function postGeminiStructuredConversationFromTurns(turns) {
    if (!turns || !turns.length) {
      return;
    }

    var byConversation = {};
    for (var i = 0; i < turns.length; i++) {
      var turn = turns[i];
      if (!byConversation[turn.conversationId]) {
        byConversation[turn.conversationId] = [];
      }
      byConversation[turn.conversationId].push(turn);
    }

    var ids = Object.keys(byConversation);
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      var ordered = byConversation[id].slice().sort(function (a, b) {
        return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      });
      var messages = [];

      for (var k = 0; k < ordered.length; k++) {
        var item = ordered[k];
        if (item.userText) {
          messages.push({
            role: "user",
            content: item.userText,
            markdown: item.userText,
            time: item.time
          });
        }
        if (item.assistantText) {
          messages.push({
            role: "assistant",
            content: item.assistantText,
            markdown: item.assistantText,
            time: item.time
          });
        }
      }

      if (messages.length) {
        postTimestamp(id, ordered[0].time, "Gemini", {});
        postStructuredConversation({
          platform: "Gemini",
          conversationId: id,
          title: "",
          conversationTime: ordered[0].time,
          messages: messages
        });
      }
    }
  }

  function scanGeminiHistoryList(value, depth) {
    if (!Array.isArray(value) || depth > 12) {
      return;
    }

    var conversationId = normalizeGeminiConversationId(value[0]);
    var title = typeof value[1] === "string" ? value[1] : "";
    var timestamp = geminiTimestampFromPair(value[5]);
    if (conversationId && timestamp) {
      postTimestamp(conversationId, timestamp, "Gemini", { title: title });
    }

    for (var i = 0; i < value.length; i++) {
      scanGeminiHistoryList(value[i], depth + 1);
    }
  }

  function parseGeminiStructuredData(value) {
    if (!Array.isArray(value)) {
      return;
    }

    var turns = [];
    extractGeminiTurns(value, turns, 0);
    postGeminiStructuredConversationFromTurns(turns);
    scanGeminiHistoryList(value, 0);
  }

  function parseGeminiRpcEnvelope(value) {
    if (!Array.isArray(value)) {
      return;
    }

    if (
      value[0] === "wrb.fr" &&
      typeof value[1] === "string" &&
      typeof value[2] === "string"
    ) {
      try {
        var inner = JSON.parse(value[2]);
        parseGeminiStructuredData(inner);
        scanStructuredConversations(inner, "Gemini", {}, 0);
        parseGeminiArrayForTimestamps(inner, 0);
      } catch (_e) {
        // Some Gemini RPC payloads are opaque tokens, not JSON arrays.
      }
      return;
    }

    for (var i = 0; i < value.length; i++) {
      parseGeminiRpcEnvelope(value[i]);
    }
  }

  function parseGeminiArrayForTimestamps(arr, depth) {
    if (!Array.isArray(arr) || depth > 12) {
      return;
    }

    // Look for timestamp-like patterns in nested arrays
    // Gemini often has arrays like [seconds, nanoseconds] or just a ms timestamp
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];

      if (Array.isArray(item)) {
        parseGeminiArrayForTimestamps(item, depth + 1);
        continue;
      }

      if (item && typeof item === "object" && !Array.isArray(item)) {
        scanStructuredConversations(item, "Gemini", {}, 0);
        extractFromObject(item, "Gemini");
      }
    }

    // Heuristic: look for [conversationId, ..., [timestamp, ...], ...]
    // Gemini conversation IDs are typically hex strings like "af8945075c126cfc"
    for (var j = 0; j < arr.length; j++) {
      var normalizedId = normalizeGeminiConversationId(arr[j]);
      if (normalizedId) {
        // Found a potential conversation ID, look for nearby timestamps
        var foundTs = findNearbyTimestamp(arr);
        if (foundTs) {
          postTimestamp(normalizedId, foundTs, "Gemini", {});
        }
      }
    }
  }

  function findNearbyTimestamp(arr) {
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (typeof item === "number") {
        var ts = validTimestamp(item);
        if (ts) {
          return ts;
        }
      }
      if (Array.isArray(item) && item.length >= 1 && item.length <= 3) {
        // Could be [seconds, nanos] or [milliseconds]
        if (typeof item[0] === "number") {
          var ts2 = validTimestamp(item[0]);
          if (ts2) {
            return ts2;
          }
        }
      }
    }
    return "";
  }

  function parseGeminiResponse(text) {
    // Gemini batchexecute returns data in a specific format:
    // )]}\'\n followed by JSON lines
    var cleaned = String(text || "");
    cleaned = cleaned.replace(/^\)\]\}'\s*\n?/, "");

    // Try to find JSON arrays in the response
    var jsonPattern = /\[[\s\S]*?\](?=\s*\n|$)/g;
    var match;
    var attempts = 0;

    while ((match = jsonPattern.exec(cleaned)) !== null && attempts < 20) {
      attempts++;
      try {
        var parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          scanStructuredConversations(parsed, "Gemini", {}, 0);
          parseGeminiArrayForTimestamps(parsed, 0);
        }
      } catch (_e) {
        // Not valid JSON, skip
      }
    }

    // Also try line-by-line parsing
    var lines = cleaned.split("\n");
    for (var i = 0; i < lines.length && i < 50; i++) {
      var line = lines[i].trim();
      if (!line || /^\d+$/.test(line)) {
        continue;
      }
      try {
        var lineData = JSON.parse(line);
        if (Array.isArray(lineData)) {
          parseGeminiRpcEnvelope(lineData);
          parseGeminiStructuredData(lineData);
          scanStructuredConversations(lineData, "Gemini", {}, 0);
          parseGeminiArrayForTimestamps(lineData, 0);
        } else if (lineData && typeof lineData === "object") {
          scanStructuredConversations(lineData, "Gemini", {}, 0);
          extractFromObject(lineData, "Gemini");
        }
      } catch (_e2) {
        // Not JSON, skip
      }
    }
  }

  function geminiRpcIdFromUrl(urlLike) {
    try {
      var url = new URL(urlLike, (window.location && window.location.href) || "https://gemini.google.com/");
      return url.searchParams.get("rpcids") || "";
    } catch (_error) {
      return "";
    }
  }

  function safeGeminiUrlLabel(urlLike) {
    try {
      var url = new URL(urlLike, (window.location && window.location.href) || "https://gemini.google.com/");
      var label = url.origin + url.pathname;
      var rpcid = url.searchParams.get("rpcids");
      var rt = url.searchParams.get("rt");
      var parts = [];
      if (rpcid) {
        parts.push("rpcids=" + rpcid);
      }
      if (rt) {
        parts.push("rt=" + rt);
      }
      return parts.length ? label + "?" + parts.join("&") : label;
    } catch (_error) {
      return String(urlLike || "").slice(0, 240);
    }
  }

  function geminiTimestampPairsInText(text) {
    var output = [];
    var match;
    var pairPattern = /\[\s*(1[6-9]\d{8}|2\d{9})\s*,\s*(\d{1,9})\s*\]/g;
    while ((match = pairPattern.exec(text)) !== null && output.length < 300) {
      var timestamp = geminiTimestampFromPair([Number(match[1]), Number(match[2])]);
      if (timestamp) {
        output.push({
          index: match.index,
          timestamp: timestamp,
          shape: "[seconds,nanos]"
        });
      }
    }

    var msPattern = /\b(1[6-9]\d{11}|2\d{12})\b/g;
    while ((match = msPattern.exec(text)) !== null && output.length < 300) {
      var msTimestamp = validTimestamp(match[1]);
      if (msTimestamp) {
        output.push({
          index: match.index,
          timestamp: msTimestamp,
          shape: "milliseconds"
        });
      }
    }

    return output;
  }

  function postGeminiDebugEvidenceFromText(text, sourceUrl, sourceKind) {
    var body = String(text || "");
    if (!body) {
      return;
    }

    var idPattern = /(^|[^A-Za-z0-9_])(?:c_)?([a-f0-9]{8,})(?=[^A-Za-z0-9_]|$)/ig;
    var ids = {};
    var match;
    while ((match = idPattern.exec(body)) !== null) {
      var conversationId = normalizeGeminiConversationId(match[2]);
      if (!conversationId) {
        continue;
      }

      if (!ids[conversationId]) {
        ids[conversationId] = {
          conversationId: conversationId,
          hitCount: 0,
          hitIndexes: []
        };
      }

      ids[conversationId].hitCount += 1;
      if (ids[conversationId].hitIndexes.length < 8) {
        ids[conversationId].hitIndexes.push(match.index + match[1].length);
      }
    }

    var idKeys = Object.keys(ids);
    if (!idKeys.length) {
      return;
    }

    var timestamps = geminiTimestampPairsInText(body);
    var idEvidence = idKeys.slice(0, 40).map(function (conversationId) {
      var item = ids[conversationId];
      var candidates = [];

      for (var i = 0; i < item.hitIndexes.length; i++) {
        var hitIndex = item.hitIndexes[i];
        var nearby = timestamps
          .map(function (candidate) {
            return {
              timestamp: candidate.timestamp,
              shape: candidate.shape,
              distanceFromConversationIdChars: Math.abs(candidate.index - hitIndex)
            };
          })
          .filter(function (candidate) {
            return candidate.distanceFromConversationIdChars <= 12000;
          });

        candidates = candidates.concat(nearby);
      }

      var seenCandidates = {};
      candidates = candidates
        .sort(function (a, b) {
          return a.distanceFromConversationIdChars - b.distanceFromConversationIdChars ||
            (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
        })
        .filter(function (candidate) {
          var key = candidate.timestamp + ":" + candidate.shape + ":" + candidate.distanceFromConversationIdChars;
          if (seenCandidates[key]) {
            return false;
          }
          seenCandidates[key] = true;
          return true;
        })
        .slice(0, 12);

      return {
        conversationId: conversationId,
        hitCount: item.hitCount,
        timestampCandidates: candidates
      };
    });

    postGeminiDebugEvidence({
      platform: "Gemini",
      capturedAt: new Date().toISOString(),
      source: sourceKind || "",
      rpcid: geminiRpcIdFromUrl(sourceUrl),
      url: safeGeminiUrlLabel(sourceUrl),
      responseLength: body.length,
      timestampCandidateCount: timestamps.length,
      ids: idEvidence
    });
  }

  function processJsonPayload(platform, data, sourceUrl) {
    if (!platform || data === undefined || data === null) {
      return;
    }

    if (platform === "chatgpt") {
      parseChatGPTResponse(data);
      return;
    }

    if (platform === "claude") {
      parseClaudeResponse(data);
      return;
    }

    if (platform === "grok") {
      parseGrokResponse(data, sourceUrl);
      return;
    }

    if (platform === "deepseek") {
      parseDeepSeekResponse(data);
      return;
    }

    if (platform === "doubao") {
      parseDoubaoResponse(data);
      return;
    }

    if (platform === "gemini") {
      try {
        postGeminiDebugEvidenceFromText(JSON.stringify(data), sourceUrl || window.location.href, "json");
      } catch (_error) {
        // Debug evidence is best-effort only.
      }
      scanStructuredConversations(data, "Gemini", {}, 0);
      if (Array.isArray(data)) {
        parseGeminiArrayForTimestamps(data, 0);
      } else if (typeof data === "object") {
        extractFromObject(data, "Gemini");
      }
    }
  }

  function processTextPayload(platform, text, sourceUrl) {
    if (!platform || !text) {
      return;
    }

    if (platform === "gemini") {
      postGeminiDebugEvidenceFromText(text, sourceUrl || window.location.href, "text");
      parseGeminiResponse(text);
      return;
    }

    try {
      processJsonPayload(platform, JSON.parse(text), sourceUrl);
    } catch (_error) {
      // Not JSON, ignore.
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch interceptor
  // ---------------------------------------------------------------------------

  var originalFetch = window.fetch;

  window.fetch = function () {
    var args = arguments;
    var url = "";

    try {
      if (typeof args[0] === "string") {
        url = args[0];
      } else if (args[0] && typeof args[0] === "object" && args[0].url) {
        url = args[0].url;
      } else if (args[0] && args[0] instanceof Request) {
        url = args[0].url;
      }
    } catch (_e) {
      url = "";
    }

    var platform = detectPlatform(url || window.location.href);

    var shouldIntercept = (
      (platform === "chatgpt" && isChatGPTConversationEndpoint(url)) ||
      (platform === "claude" && isClaudeConversationEndpoint(url)) ||
      (platform === "grok" && isGrokConversationEndpoint(url)) ||
      (platform === "gemini" && isGeminiEndpoint(url)) ||
      (platform === "deepseek" && isGenericConversationEndpoint(url)) ||
      (platform === "doubao" && isGenericConversationEndpoint(url))
    );

    if (!shouldIntercept) {
      return originalFetch.apply(this, args);
    }

    return originalFetch.apply(this, args).then(function (response) {
      try {
        var cloned = response.clone();
        var contentType = (response.headers && response.headers.get("content-type")) || "";

        if (/json/i.test(contentType)) {
          cloned.json().then(function (data) {
            try {
              processJsonPayload(platform, data, url);
            } catch (_e2) {
              // Parsing error, ignore
            }
          }).catch(function () {});
        } else {
          cloned.text().then(function (text) {
            try {
              processTextPayload(platform, text, url);
            } catch (_e3) {
              // Parsing error, ignore
            }
          }).catch(function () {});
        }
      } catch (_e5) {
        // Clone or processing error, ignore
      }

      return response;
    });
  };

  // ---------------------------------------------------------------------------
  // XMLHttpRequest interceptor (fallback for platforms using XHR)
  // ---------------------------------------------------------------------------

  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aiExporterUrl = url || "";
    this.__aiExporterPlatform = detectPlatform(url || window.location.href);
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var url = xhr.__aiExporterUrl || "";
    var platform = xhr.__aiExporterPlatform || "";

    var shouldIntercept = (
      (platform === "chatgpt" && isChatGPTConversationEndpoint(url)) ||
      (platform === "claude" && isClaudeConversationEndpoint(url)) ||
      (platform === "grok" && isGrokConversationEndpoint(url)) ||
      (platform === "gemini" && isGeminiEndpoint(url)) ||
      (platform === "deepseek" && isGenericConversationEndpoint(url)) ||
      (platform === "doubao" && isGenericConversationEndpoint(url))
    );

    if (shouldIntercept) {
      xhr.addEventListener("load", function () {
        try {
          var text = xhr.responseText || "";
          if (!text) {
            return;
          }

          processTextPayload(platform, text, url);
        } catch (_e2) {
          // Error processing response, ignore
        }
      });
    }

    return originalXHRSend.apply(this, arguments);
  };

  // ---------------------------------------------------------------------------
  // Also scan existing framework bootstrap JSON (available at page load)
  // ---------------------------------------------------------------------------

  function scanNextData() {
    try {
      var nextDataEl = document.getElementById("__NEXT_DATA__");
      if (nextDataEl && nextDataEl.textContent) {
        var data = JSON.parse(nextDataEl.textContent);
        processJsonPayload(detectPlatform(window.location.href), data);
      }
    } catch (_e) {
      // Not available or not parseable
    }
  }

  // ---------------------------------------------------------------------------
  // Scan AF_initDataCallback for Gemini (available at page load)
  // ---------------------------------------------------------------------------

  function scanGeminiInitData() {
    try {
      var scripts = document.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || "";
        if (text.indexOf("AF_initDataCallback") === -1) {
          continue;
        }

        // Extract data from AF_initDataCallback({key: ..., data: [...]})
        var dataMatches = text.match(/AF_initDataCallback\(\s*\{[^}]*data:\s*(\[[\s\S]*?\])\s*\}\s*\)/g);
        if (!dataMatches) {
          continue;
        }

        for (var j = 0; j < dataMatches.length; j++) {
          var m = dataMatches[j].match(/data:\s*(\[[\s\S]*?\])\s*\}\s*\)/);
          if (m && m[1]) {
            try {
              var arr = JSON.parse(m[1]);
              if (Array.isArray(arr)) {
                processJsonPayload("gemini", arr);
              }
            } catch (_e2) {
              // Malformed, skip
            }
          }
        }
      }
    } catch (_e) {
      // Error scanning, ignore
    }
  }

  // Run initial scans when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      scanNextData();
      scanGeminiInitData();
    });
  } else {
    scanNextData();
    scanGeminiInitData();
  }
})();
