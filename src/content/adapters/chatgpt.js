(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;
  const utils = namespace.PlatformUtils;

  let sessionPromise = null;
  let accountIdPromise = null;

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      const match = url.pathname.match(/^\/(?:share|c|g\/[A-Za-z0-9_-]+\/c)\/([A-Za-z0-9_-]+)/i);
      return match ? match[1] : "";
    } catch (_error) {
      return "";
    }
  }

  function apiBase() {
    return `${global.location.origin}/backend-api`;
  }

  function sessionUrl() {
    return `${global.location.origin}/api/auth/session`;
  }

  function getCookie(name) {
    const match = String(global.document && global.document.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function fetchJson(url, options = {}) {
    const response = await global.fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`ChatGPT API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async function getAccessToken() {
    if (!sessionPromise) {
      sessionPromise = fetchJson(sessionUrl()).catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }

    const session = await sessionPromise;
    return session && session.accessToken ? session.accessToken : "";
  }

  async function getTeamAccountId(accessToken) {
    const workspaceId = getCookie("_account");
    if (!workspaceId || !accessToken) {
      return "";
    }

    if (!accountIdPromise) {
      accountIdPromise = fetchJson(`${apiBase()}/accounts/check/v4-2023-04-27`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Authorization": `Bearer ${accessToken}`
        }
      }).catch((error) => {
        accountIdPromise = null;
        throw error;
      });
    }

    const data = await accountIdPromise;
    return data && data.accounts && data.accounts[workspaceId] && data.accounts[workspaceId].account
      ? data.accounts[workspaceId].account.account_id || ""
      : "";
  }

  async function fetchConversation(conversationId) {
    const accessToken = await getAccessToken();
    const accountId = await getTeamAccountId(accessToken).catch(() => "");
    const headers = accessToken
      ? {
        Authorization: `Bearer ${accessToken}`,
        "X-Authorization": `Bearer ${accessToken}`,
        ...(accountId ? { "Chatgpt-Account-Id": accountId } : {})
      }
      : {};

    return fetchJson(`${apiBase()}/conversation/${encodeURIComponent(conversationId)}`, { headers });
  }

  function nodePath(mapping, startNodeId) {
    const output = [];
    let currentNodeId = startNodeId;
    const seen = new Set();

    while (currentNodeId && mapping && mapping[currentNodeId] && !seen.has(currentNodeId)) {
      seen.add(currentNodeId);
      const node = mapping[currentNodeId];

      if (node.parent === undefined) {
        break;
      }

      const message = node.message;
      if (
        message &&
        message.author &&
        message.author.role !== "system" &&
        message.content &&
        message.content.content_type !== "model_editable_context" &&
        message.content.content_type !== "user_editable_context"
      ) {
        output.unshift(node);
      }

      currentNodeId = node.parent;
    }

    return output;
  }

  function mergeContinuationNodes(nodes) {
    const output = [];

    for (const node of nodes || []) {
      const previous = output[output.length - 1];
      const previousMessage = previous && previous.message;
      const message = node && node.message;

      if (
        previousMessage &&
        message &&
        previousMessage.author &&
        message.author &&
        previousMessage.author.role === "assistant" &&
        message.author.role === "assistant" &&
        previousMessage.recipient === "all" &&
        message.recipient === "all" &&
        previousMessage.content &&
        message.content &&
        previousMessage.content.content_type === "text" &&
        message.content.content_type === "text" &&
        Array.isArray(previousMessage.content.parts) &&
        Array.isArray(message.content.parts)
      ) {
        previousMessage.content.parts[previousMessage.content.parts.length - 1] =
          `${previousMessage.content.parts[previousMessage.content.parts.length - 1] || ""}${message.content.parts[0] || ""}`;
        previousMessage.content.parts.push(...message.content.parts.slice(1));
        continue;
      }

      output.push(node);
    }

    return output;
  }

  function partToMarkdown(part) {
    if (typeof part === "string") {
      return part;
    }

    if (!part || typeof part !== "object") {
      return "";
    }

    if (typeof part.text === "string") {
      return part.text;
    }

    if (part.content_type === "image_asset_pointer") {
      return part.asset_pointer ? `[image: ${part.asset_pointer}]` : "[image]";
    }

    return "";
  }

  function contentToMarkdown(content) {
    if (!content || typeof content !== "object") {
      return "";
    }

    if (Array.isArray(content.parts)) {
      return content.parts.map(partToMarkdown).filter(Boolean).join("\n\n").trim();
    }

    if (typeof content.text === "string") {
      return content.text.trim();
    }

    if (typeof content.result === "string") {
      return content.result.trim();
    }

    return "";
  }

  function roleFromMessage(message) {
    const role = message && message.author && message.author.role;
    if (role === "assistant" || role === "user" || role === "system") {
      return role;
    }

    return "";
  }

  function parseConversation(rawConversation, sourceUrl) {
    const mapping = rawConversation && rawConversation.mapping;
    const startNodeId = rawConversation && (
      rawConversation.current_node ||
      Object.values(mapping || {}).find((node) => node && (!node.children || node.children.length === 0))?.id
    );
    const nodes = mergeContinuationNodes(nodePath(mapping, startNodeId));
    const messages = nodes
      .map((node) => {
        const message = node.message;
        if (!message || !message.content || (message.recipient && message.recipient !== "all")) {
          return null;
        }

        const role = roleFromMessage(message);
        if (!role || role === "system") {
          return null;
        }

        const content = contentToMarkdown(message.content);
        if (!content) {
          return null;
        }

        return {
          role,
          content,
          markdown: content,
          time: common.readTimeCandidate(message.create_time || message.update_time)
        };
      })
      .filter(Boolean);

    const conversationTime =
      common.readTimeCandidate(rawConversation && (rawConversation.create_time || rawConversation.update_time)) ||
      (messages.find((message) => message.time) || {}).time ||
      "";
    const firstQuestion = (messages.find((message) => message.role === "user") || {}).content || "";
    const source = sourceUrl || (global.location && global.location.href) || "";
    const title = utils.truncate(rawConversation && rawConversation.title || utils.firstMeaningfulLine(firstQuestion), 120) || "ChatGPT Chat";

    return {
      platform: "ChatGPT",
      sourceUrl: source,
      title,
      conversationId: rawConversation && rawConversation.id || conversationIdFromUrl(source),
      conversationTime,
      messages
    };
  }

  async function extract() {
    const conversationId = conversationIdFromUrl(global.location.href);
    if (!conversationId) {
      return {
        platform: "ChatGPT",
        sourceUrl: global.location.href,
        title: utils.stripPlatformFromTitle(global.document.title || "", "ChatGPT") || "ChatGPT Chat",
        conversationId: "",
        conversationTime: "",
        messages: []
      };
    }

    const rawConversation = await fetchConversation(conversationId);
    return parseConversation({ id: conversationId, ...rawConversation }, global.location.href);
  }

  namespace.ChatGPTAdapter = {
    conversationIdFromUrl,
    extract,
    parseConversation
  };
})(globalThis);
