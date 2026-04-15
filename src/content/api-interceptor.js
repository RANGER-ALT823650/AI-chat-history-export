(function () {
  "use strict";

  if (window.__AI_CHAT_EXPORTER_API_INTERCEPTOR__) {
    return;
  }
  window.__AI_CHAT_EXPORTER_API_INTERCEPTOR__ = true;

  var MESSAGE_TYPE = "AI_CHAT_EXPORTER_TIMESTAMP";
  var STRUCTURED_MESSAGE_TYPE = "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION";
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
    if (/assistant|model|bot|claude|gemini|grok|chatgpt|ai/.test(text)) {
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
      "answer"
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
        postStructuredConversation({
          platform: platform,
          conversationId: inherited.conversationId,
          title: inherited.title || "",
          conversationTime: inherited.conversationTime || (messages.find(function (message) { return message.time; }) || {}).time || "",
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
      conversationTime: candidateConversationTime(value) || (inherited && inherited.conversationTime) || ""
    };

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

  function parseGrokResponse(data) {
    scanStructuredConversations(data, "Grok", {}, 0);
    extractFromObject(data, "Grok");
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

  function processJsonPayload(platform, data) {
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
      parseGrokResponse(data);
      return;
    }

    if (platform === "gemini") {
      scanStructuredConversations(data, "Gemini", {}, 0);
      if (Array.isArray(data)) {
        parseGeminiArrayForTimestamps(data, 0);
      } else if (typeof data === "object") {
        extractFromObject(data, "Gemini");
      }
    }
  }

  function processTextPayload(platform, text) {
    if (!platform || !text) {
      return;
    }

    if (platform === "gemini") {
      parseGeminiResponse(text);
      return;
    }

    try {
      processJsonPayload(platform, JSON.parse(text));
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
      (platform === "gemini" && isGeminiEndpoint(url))
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
              processJsonPayload(platform, data);
            } catch (_e2) {
              // Parsing error, ignore
            }
          }).catch(function () {});
        } else {
          cloned.text().then(function (text) {
            try {
              processTextPayload(platform, text);
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
      (platform === "gemini" && isGeminiEndpoint(url))
    );

    if (shouldIntercept) {
      xhr.addEventListener("load", function () {
        try {
          var text = xhr.responseText || "";
          if (!text) {
            return;
          }

          processTextPayload(platform, text);
        } catch (_e2) {
          // Error processing response, ignore
        }
      });
    }

    return originalXHRSend.apply(this, arguments);
  };

  // ---------------------------------------------------------------------------
  // Also scan existing __NEXT_DATA__ for Claude (available at page load)
  // ---------------------------------------------------------------------------

  function scanNextData() {
    try {
      var nextDataEl = document.getElementById("__NEXT_DATA__");
      if (nextDataEl && nextDataEl.textContent) {
        var data = JSON.parse(nextDataEl.textContent);
        parseClaudeResponse(data);
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
