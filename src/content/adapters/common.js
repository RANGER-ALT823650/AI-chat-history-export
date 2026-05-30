(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const utils = namespace.PlatformUtils;
  const markdown = namespace.Markdown;

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (_error) {
      return [];
    }
  }

  function safeClosest(element, selector) {
    try {
      return element.closest(selector);
    } catch (_error) {
      return null;
    }
  }

  function safeMatches(element, selector) {
    try {
      return Boolean(element.matches && element.matches(selector));
    } catch (_error) {
      return false;
    }
  }

  function classText(element) {
    const value = element && element.className;
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    return value.baseVal || String(value);
  }

  function hasHiddenStyle(element) {
    let current = element;

    for (let depth = 0; current && depth < 6; depth += 1) {
      const style = global.getComputedStyle ? global.getComputedStyle(current) : null;
      if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
        return true;
      }

      if (current.getAttribute && (current.getAttribute("aria-hidden") === "true" || current.getAttribute("hidden") !== null)) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function hasVisibleBox(element) {
    if (!element || !element.getBoundingClientRect) {
      return true;
    }

    const rect = element.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return true;
    }

    const rects = element.getClientRects ? Array.from(element.getClientRects()) : [];
    if (rects.some((item) => item.width > 0 && item.height > 0)) {
      return true;
    }

    return Array.from(element.children || []).some((child) => hasVisibleBox(child));
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    if (hasHiddenStyle(element)) {
      return false;
    }

    return hasVisibleBox(element) || Boolean(textOf(element));
  }

  function textOf(element) {
    if (!element) {
      return "";
    }

    return utils.normalizeWhitespace(element.innerText || element.textContent || "");
  }

  function markdownOf(element) {
    const rich = markdown.htmlToMarkdown(element);
    return rich || textOf(element);
  }

  function findFirstBySelectors(root, selectors) {
    for (const selector of selectors || []) {
      if (safeMatches(root, selector) && isVisible(root) && textOf(root)) {
        return root;
      }

      const found = safeQueryAll(root, selector).find((element) => isVisible(element) && textOf(element));
      if (found) {
        return found;
      }
    }

    return null;
  }

  function contentStructureScore(markdownText) {
    const value = String(markdownText || "");
    const codeFenceCount = (value.match(/^```/gm) || []).length;
    const headingCount = (value.match(/^#{1,6}\s+/gm) || []).length;
    const listCount = (value.match(/^(?:\s*[-*]\s+|\s*\d+\.\s+)/gm) || []).length;
    const tableCount = (value.match(/^\|.+\|$/gm) || []).length;
    const quoteCount = (value.match(/^>\s+/gm) || []).length;
    const paragraphCount = value.split(/\n{2,}/).filter((part) => part.trim()).length;

    return (
      headingCount * 120 +
      codeFenceCount * 90 +
      listCount * 35 +
      tableCount * 25 +
      quoteCount * 25 +
      paragraphCount * 3
    );
  }

  function contentCandidateScore(element) {
    const rendered = markdownOf(element);
    const clean = utils.normalizeWhitespace(rendered);
    if (!clean) {
      return 0;
    }

    return clean.length + contentStructureScore(rendered);
  }

  function collectContentCandidates(root, selectors) {
    const candidates = [];

    for (const selector of selectors || []) {
      if (safeMatches(root, selector)) {
        candidates.push(root);
      }

      candidates.push(...safeQueryAll(root, selector));
    }

    return Array.from(new Set(candidates)).filter((element) => isVisible(element) && textOf(element));
  }

  function pickContentElement(messageElement, contentSelectors) {
    const candidates = collectContentCandidates(messageElement, contentSelectors);
    if (!candidates.length) {
      return messageElement;
    }

    return candidates
      .map((element, index) => ({ element, index, score: contentCandidateScore(element) }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0].element;
  }

  function shouldExcludeElement(element, selectors) {
    for (const selector of selectors || []) {
      const closest = safeClosest(element, selector);
      if (closest && closest !== element) {
        return true;
      }
    }

    return false;
  }

  function expandMessageElement(element, selectors, excludeSelectors) {
    for (const selector of selectors || []) {
      const closest = safeClosest(element, selector);
      if (!closest) {
        continue;
      }

      if (shouldExcludeElement(closest, excludeSelectors)) {
        continue;
      }

      return closest;
    }

    return element;
  }

  function roleTokens(element) {
    const values = [];
    let current = element;

    for (let depth = 0; current && depth < 5; depth += 1) {
      values.push(
        current.tagName,
        current.getAttribute && current.getAttribute("data-message-author-role"),
        current.getAttribute && current.getAttribute("data-author-role"),
        current.getAttribute && current.getAttribute("data-author"),
        current.getAttribute && current.getAttribute("data-role"),
        current.getAttribute && current.getAttribute("aria-label"),
        current.getAttribute && current.getAttribute("data-testid"),
        current.getAttribute && current.getAttribute("data-test-id"),
        classText(current)
      );
      current = current.parentElement;
    }

    return values.filter(Boolean).join(" ").toLowerCase();
  }

  function roleFromLayout(element) {
    const tokens = roleTokens(element);
    if (/\b(self-end|items-end|justify-end|ml-auto|float-right|right-\d|text-right)\b/.test(tokens)) {
      return "user";
    }

    if (/\b(self-start|items-start|justify-start|mr-auto|float-left|left-\d|text-left)\b/.test(tokens)) {
      return "assistant";
    }

    if (!element.getBoundingClientRect || !global.innerWidth) {
      return "";
    }

    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return "";
    }

    const center = rect.left + rect.width / 2;
    if (center > global.innerWidth * 0.62 && rect.width < global.innerWidth * 0.78) {
      return "user";
    }

    if (center < global.innerWidth * 0.58) {
      return "assistant";
    }

    return "";
  }

  function roleFromElement(element, options = {}) {
    const tokens = roleTokens(element);

    if (/\b(user|human|prompt|question)\b/.test(tokens) || tokens.includes("user-query")) {
      return "user";
    }

    if (
      /\b(assistant|model|answer|response|bot|claude|gemini|grok|deepseek|doubao|qwen|tongyi)\b/.test(tokens) ||
      /通义千问|千问/.test(tokens) ||
      tokens.includes("model-response") ||
      tokens.includes("font-claude")
    ) {
      return "assistant";
    }

    if (options.allowLayoutRole === false) {
      return "";
    }

    return roleFromLayout(element);
  }

  function hasPlausibleYear(value) {
    const match = String(value || "").match(/\b(\d{4})\b/);
    if (!match) {
      return true;
    }

    const year = Number(match[1]);
    const currentYear = new Date().getFullYear();
    return year >= 2000 && year <= currentYear + 1;
  }

  function readTimeCandidate(value) {
    const clean = utils.normalizeWhitespace(value);
    if (!clean) {
      return "";
    }

    if (/^\d{10}$/.test(clean)) {
      const iso = new Date(Number(clean) * 1000).toISOString();
      return hasPlausibleYear(iso) ? iso : "";
    }

    if (/^\d{13}$/.test(clean)) {
      const iso = new Date(Number(clean)).toISOString();
      return hasPlausibleYear(iso) ? iso : "";
    }

    if (/^\d+(\.\d+)?$/.test(clean)) {
      const number = Number(clean);
      let date = null;
      if (number > 1e15) {
        date = new Date(number / 1000);
      } else if (number > 1e12) {
        date = new Date(number);
      } else if (number > 1e9) {
        date = new Date(number * 1000);
      }

      const iso = date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
      return hasPlausibleYear(iso) ? iso : "";
    }

    const isoish = clean.match(/\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/);
    if (isoish && hasPlausibleYear(isoish[0])) {
      return isoish[0];
    }

    const readable = clean.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
    if (readable && hasPlausibleYear(readable[0])) {
      return readable[0];
    }

    const cnDate = clean.match(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}:\d{2})?/);
    if (cnDate && hasPlausibleYear(cnDate[0])) {
      return cnDate[0];
    }

    return "";
  }

  function extractTimeFromElement(element) {
    const candidates = [];
    const timeNode = safeQueryAll(element, "time[datetime], [datetime], [data-time], [data-timestamp], [aria-label]").find(Boolean);

    if (timeNode) {
      candidates.push(
        timeNode.getAttribute("datetime"),
        timeNode.getAttribute("data-time"),
        timeNode.getAttribute("data-timestamp"),
        timeNode.getAttribute("aria-label"),
        timeNode.textContent
      );
    }

    let ancestor = element;
    for (let depth = 0; ancestor && depth < 3; depth += 1) {
      candidates.push(
        ancestor.getAttribute && ancestor.getAttribute("datetime"),
        ancestor.getAttribute && ancestor.getAttribute("data-time"),
        ancestor.getAttribute && ancestor.getAttribute("data-timestamp"),
        ancestor.getAttribute && ancestor.getAttribute("aria-label")
      );
      ancestor = ancestor.parentElement;
    }

    for (const candidate of candidates) {
      const time = readTimeCandidate(candidate);
      if (time) {
        return time;
      }
    }

    return "";
  }

  function documentOrder(a, b) {
    if (a === b) {
      return 0;
    }

    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function normalizeForDedupe(value) {
    return utils.normalizeWhitespace(value)
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .trim();
  }

  function isContainedDuplicate(shorter, longer) {
    if (!shorter || !longer || shorter.length < 24) {
      return false;
    }

    if (longer.length < shorter.length + 24) {
      return false;
    }

    return longer.includes(shorter);
  }

  function dedupeMessages(messages) {
    const output = [];

    for (const message of messages) {
      const content = utils.normalizeWhitespace(message.content || message.markdown);
      const normalized = normalizeForDedupe(content);
      if (!content || content.length < 2) {
        continue;
      }

      const recentDuplicate = output.slice(-3).some((existing) => existing._normalized === normalized);
      const sameRoleDuplicate = output.some((existing) => existing.role === message.role && existing._normalized === normalized);
      if (recentDuplicate || sameRoleDuplicate) {
        continue;
      }

      output.push({ ...message, content, markdown: message.markdown || content, _normalized: normalized });
    }

    return output
      .filter((message, index) => {
        return !output.some((other, otherIndex) => {
          if (index === otherIndex || message.role !== other.role) {
            return false;
          }

          return isContainedDuplicate(message._normalized, other._normalized);
        });
      })
      .map(({ _normalized, ...message }) => message);
  }

  function mergeAdjacentSameRoleMessages(messages) {
    const merged = [];

    for (const message of messages || []) {
      const previous = merged[merged.length - 1];
      if (!previous || previous.role !== message.role) {
        merged.push({ ...message });
        continue;
      }

      const previousBody = previous.markdown || previous.content || "";
      const nextBody = message.markdown || message.content || "";
      previous.markdown = markdown.compactMarkdown(`${previousBody}\n\n${nextBody}`);
      previous.content = utils.normalizeWhitespace(`${previous.content || previousBody}\n\n${message.content || nextBody}`);
      previous.time = previous.time || message.time;
    }

    return dedupeMessages(merged);
  }

  function maybeMergeAdjacentSameRole(messages, config) {
    return config && config.mergeAdjacentSameRole ? mergeAdjacentSameRoleMessages(messages) : messages;
  }

  function matchingStructuredConversation(platformLabel, conversationId) {
    const cache = namespace.StructuredConversationCache;
    if (!cache) {
      return null;
    }

    if (conversationId && cache.getConversation) {
      const exact = cache.getConversation(conversationId, platformLabel);
      if (exact) {
        return exact;
      }
    }

    if (!conversationId && cache.latestConversation) {
      return cache.latestConversation(platformLabel);
    }

    return null;
  }

  function annotateTimesFromStructuredMessages(messages, structuredMessages) {
    const source = structuredMessages || [];
    if (!messages || !messages.length || !source.length) {
      return messages || [];
    }

    let cursor = 0;
    let matched = 0;
    const byRole = messages.map((message) => {
      if (message.time) {
        return message;
      }

      for (let index = cursor; index < source.length; index += 1) {
        const candidate = source[index];
        if (candidate && candidate.role === message.role && candidate.time) {
          cursor = index + 1;
          matched += 1;
          return { ...message, time: candidate.time };
        }
      }

      return message;
    });

    if (matched || source.length !== messages.length) {
      return byRole;
    }

    return messages.map((message, index) => {
      const candidate = source[index];
      if (!message.time && candidate && candidate.role === message.role && candidate.time) {
        return { ...message, time: candidate.time };
      }

      return message;
    });
  }

  function withoutMessageTimes(messages) {
    return (messages || []).map((message) => ({ ...message, time: "" }));
  }

  function mergeStructuredConversation(conversation, options = {}) {
    const structured = matchingStructuredConversation(conversation.platform, conversation.conversationId);
    if (!structured) {
      return conversation;
    }

    const structuredMessages = options.disableStructuredTimes
      ? withoutMessageTimes(structured.messages)
      : structured.messages;
    const structuredConversationTime = options.disableStructuredTimes ? "" : structured.conversationTime;

    if ((!conversation.messages || !conversation.messages.length) && structured.messages && structured.messages.length) {
      return {
        ...structured,
        sourceUrl: conversation.sourceUrl || structured.sourceUrl,
        title: conversation.title || structured.title,
        conversationTime: conversation.conversationTime || structuredConversationTime,
        messages: structuredMessages
      };
    }

    return {
      ...conversation,
      title: conversation.title || structured.title,
      conversationId: conversation.conversationId || structured.conversationId,
      conversationTime: conversation.conversationTime || structuredConversationTime,
      messages: options.disableStructuredTimes
        ? conversation.messages
        : annotateTimesFromStructuredMessages(conversation.messages, structuredMessages)
    };
  }

  function dropAssistantEchoesOfUser(messages, config) {
    if (!config || !config.dropAssistantEchoesOfUser) {
      return messages;
    }

    const userTexts = new Set(
      (messages || [])
        .filter((message) => message.role === "user")
        .map((message) => normalizeForDedupe(message.content || message.markdown))
        .filter(Boolean)
    );

    if (!userTexts.size) {
      return messages;
    }

    return (messages || []).filter((message) => {
      if (message.role !== "assistant") {
        return true;
      }

      const normalized = normalizeForDedupe(message.content || message.markdown);
      return !userTexts.has(normalized);
    });
  }

  function extractMessagesBySelectors(root, definitions, config) {
    const collected = [];

    for (const definition of definitions || []) {
      for (const selector of definition.selectors || []) {
        for (const element of safeQueryAll(root, selector)) {
          if (!isVisible(element)) {
            continue;
          }

          if (shouldExcludeElement(element, definition.excludeClosestSelectors)) {
            continue;
          }

          const messageElement = expandMessageElement(element, definition.expandClosestSelectors, definition.excludeClosestSelectors);
          const contentElement = pickContentElement(messageElement, definition.contentSelectors);
          const content = markdownOf(contentElement);
          if (!content) {
            continue;
          }

          collected.push({
            role: definition.role || roleFromElement(element),
            content,
            markdown: content,
            time: config.disableMessageTimeExtraction ? "" : extractTimeFromElement(element),
            element: messageElement
          });
        }
      }
    }

    const messages = dedupeMessages(collected.sort((a, b) => documentOrder(a.element, b.element))).map(({ element, ...message }) => message);
    return maybeMergeAdjacentSameRole(messages, config);
  }

  function extractGenericMessages(root, config = {}) {
    const selectors = [
      "[data-message-author-role]",
      "[data-author-role]",
      "[data-author]",
      "[data-role='user']",
      "[data-role='assistant']",
      "[data-testid*='user' i][data-testid*='message' i]",
      "[data-testid*='assistant' i][data-testid*='message' i]",
      "[data-testid*='model' i][data-testid*='response' i]",
      "user-query",
      "model-response"
    ];
    const elements = selectors.flatMap((selector) => safeQueryAll(root, selector));
    const unique = Array.from(new Set(elements));
    const messages = [];

    for (const element of unique.sort(documentOrder)) {
      if (!isVisible(element)) {
        continue;
      }

      const role = roleFromElement(element);
      if (!role) {
        continue;
      }

      const content = markdownOf(element);
      if (!content) {
        continue;
      }

      messages.push({
        role,
        content,
        markdown: content,
        time: config.disableMessageTimeExtraction ? "" : extractTimeFromElement(element)
      });
    }

    return dedupeMessages(messages);
  }

  function isInsideChrome(element) {
    return Boolean(safeClosest(element, "button, nav, header, footer, form, textarea, input, select, [role='button'], [role='navigation'], [role='menu']"));
  }

  function textLength(element) {
    return textOf(element).length;
  }

  function removeContainerDuplicates(elements) {
    const unique = Array.from(new Set(elements));
    const sorted = unique.sort((a, b) => {
      const byLength = textLength(a) - textLength(b);
      return byLength || documentOrder(a, b);
    });
    const accepted = [];

    for (const element of sorted) {
      const elementText = textOf(element);
      if (!elementText) {
        continue;
      }

      const containsAccepted = accepted.some((acceptedElement) => {
        if (!element.contains(acceptedElement)) {
          return false;
        }

        const acceptedText = textOf(acceptedElement);
        return acceptedText && elementText.includes(acceptedText);
      });

      if (!containsAccepted) {
        accepted.push(element);
      }
    }

    return accepted.sort(documentOrder);
  }

  function assignAlternatingRoles(messages) {
    let nextRole = "user";

    return messages.map((message) => {
      if (message.role) {
        nextRole = message.role === "user" ? "assistant" : "user";
        return message;
      }

      const assigned = { ...message, role: nextRole };
      nextRole = nextRole === "user" ? "assistant" : "user";
      return assigned;
    });
  }

  function extractFallbackMessages(root, config) {
    const selectors = config.fallbackMessageSelectors || [];
    if (!selectors.length) {
      return [];
    }

    const rawElements = selectors.flatMap((selector) => safeQueryAll(root, selector));
    const fallbackElements = config.fallbackExpandClosestSelectors && config.fallbackExpandClosestSelectors.length
      ? rawElements.map((element) => {
        const expanded = expandMessageElement(
          element,
          config.fallbackExpandClosestSelectors,
          config.fallbackExcludeClosestSelectors || []
        );

        const originalRole = roleFromElement(element);
        const expandedRole = roleFromElement(expanded);
        if (expanded !== element && originalRole && expandedRole && originalRole !== expandedRole) {
          return element;
        }

        return expanded;
      })
      : rawElements;
    const elements = removeContainerDuplicates(fallbackElements);
    const messages = [];

    for (const element of elements) {
      if (!isVisible(element) || isInsideChrome(element)) {
        continue;
      }

      const content = markdownOf(element);
      const clean = utils.normalizeWhitespace(content);
      if (!clean || clean.length < 2) {
        continue;
      }

      messages.push({
        role: roleFromElement(element, { allowLayoutRole: config.allowLayoutRoleFallback !== false }),
        content: clean,
        markdown: content,
        time: config.disableMessageTimeExtraction ? "" : extractTimeFromElement(element)
      });
    }

    const withFallbackRoles = config.alternatingFallbackRoles ? assignAlternatingRoles(messages) : messages;
    const deduped = dedupeMessages(withFallbackRoles).filter((message) => message.role);
    return maybeMergeAdjacentSameRole(deduped, config);
  }

  function scoreMessages(messages) {
    const userCount = messages.filter((message) => message.role === "user").length;
    const assistantCount = messages.filter((message) => message.role === "assistant").length;
    const hasUser = userCount > 0;
    const hasAssistant = assistantCount > 0;
    const pairedTurns = Math.min(userCount, assistantCount);
    const transitions = messages.reduce((count, message, index) => {
      if (index === 0) {
        return count;
      }

      return count + (message.role !== messages[index - 1].role ? 1 : 0);
    }, 0);
    const lengthSignal = Math.min(messages.length, pairedTurns ? pairedTurns * 2 + 2 : 3);
    const imbalancePenalty = pairedTurns
      ? Math.abs(userCount - assistantCount) * 2
      : Math.max(0, messages.length - 1) * 2;

    return (
      pairedTurns * 20 +
      transitions * 3 +
      lengthSignal +
      (hasUser ? 5 : 0) +
      (hasAssistant ? 5 : 0) -
      imbalancePenalty
    );
  }

  function chooseBestMessages(collections) {
    return collections
      .filter((messages) => messages && messages.length)
      .sort((a, b) => scoreMessages(b) - scoreMessages(a))[0] || [];
  }

  function deriveTitle(root, platformLabel, titleSelectors, messages) {
    const titleNode = findFirstBySelectors(root, titleSelectors || []);
    const fromNode = titleNode ? textOf(titleNode) : "";
    const fromDocument = utils.stripPlatformFromTitle(global.document.title || "", platformLabel);
    const fromFirstQuestion = (messages || []).find((message) => message.role === "user")?.content || "";
    const candidates = [
      fromNode,
      fromDocument,
      utils.firstMeaningfulLine(fromFirstQuestion)
    ]
      .map((value) => utils.truncate(utils.stripPlatformFromTitle(value, platformLabel), 120))
      .filter(Boolean);
    const specific = candidates.find((value) => !utils.isGenericConversationTitle(value, platformLabel));
    return specific || candidates[0] || `${platformLabel} Chat`;
  }

  function extractConversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      const candidates = url.pathname.split("/").filter(Boolean);
      return candidates.reverse().find((part) => /[A-Za-z0-9_-]{8,}/.test(part)) || "";
    } catch (_error) {
      return "";
    }
  }

  function earliestMessageTime(messages) {
    return (messages || []).map((message) => message.time).find(Boolean) || "";
  }

  function extractTimeFromDocument(root) {
    const selectors = [
      "time[datetime]",
      "[datetime]",
      "[data-created-at]",
      "[data-create-time]",
      "[data-time]",
      "[data-timestamp]",
      "meta[property='article:published_time']",
      "meta[name='date']"
    ];
    const candidates = [];

    for (const selector of selectors) {
      for (const element of safeQueryAll(root, selector)) {
        candidates.push(
          element.getAttribute("datetime"),
          element.getAttribute("data-created-at"),
          element.getAttribute("data-create-time"),
          element.getAttribute("data-time"),
          element.getAttribute("data-timestamp"),
          element.getAttribute("content"),
          element.textContent
        );
      }
    }

    for (const candidate of candidates) {
      const time = readTimeCandidate(candidate);
      if (time) {
        return time;
      }
    }

    return "";
  }

  function extractTimeFromScripts(conversationId) {
    return scriptTimeDiagnostics(conversationId).time;
  }

  function scriptTimeDiagnostics(conversationId) {
    const diagnostics = {
      time: "",
      scriptCount: 0,
      matchedScriptCount: 0,
      matches: []
    };

    if (!conversationId || conversationId.length < 8) {
      return diagnostics;
    }

    const scripts = safeQueryAll(global.document, "script");
    diagnostics.scriptCount = scripts.length;
    const keyPattern = "(?:createdAt|created_at|createTime|create_time|insertedAt|inserted_at|conversationTime|conversation_time|timestamp)";
    const valuePattern = "([0-9]{10,13}|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[^\"'\\\\\\s,}]+)?)";
    const regexes = [
      new RegExp(`${keyPattern}["']?\\s*[:=]\\s*["']?${valuePattern}`, "i"),
      new RegExp(`["']?${valuePattern}["']?\\s*[,}]`, "i")
    ];

    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes(conversationId)) {
        continue;
      }

      diagnostics.matchedScriptCount += 1;
      for (const regex of regexes) {
        const match = text.match(regex);
        const time = match ? readTimeCandidate(match[1]) : "";
        if (time) {
          diagnostics.time = diagnostics.time || time;
          break;
        }
      }

      if (diagnostics.matches.length < 3) {
        const compact = utils.normalizeWhitespace(text);
        const index = compact.indexOf(conversationId);
        const start = Math.max(0, index - 180);
        const end = Math.min(compact.length, index + 320);
        diagnostics.matches.push(compact.slice(start, end));
      }
    }

    return diagnostics;
  }

  function extractTimeFromCache(conversationId) {
    if (!conversationId) {
      return "";
    }

    var cache = namespace.TimestampCache;
    if (!cache || !cache.getTimestamp) {
      return "";
    }

    return cache.getTimestamp(conversationId) || "";
  }

  function extractTimeFromVisibleHistory(sourceUrl) {
    const history = namespace.BatchHistory;
    const platform = utils.detectPlatformFromUrl(sourceUrl);
    if (!history || !history.collectConversationLinks || !platform) {
      return "";
    }

    try {
      const normalizedUrl = history.normalizeConversationUrl
        ? history.normalizeConversationUrl(sourceUrl, platform.id)
        : sourceUrl;
      if (!normalizedUrl) {
        return "";
      }

      const items = history.collectConversationLinks(global.document, platform.id) || [];
      const match = items.find((item) => item && item.url === normalizedUrl && item.conversationTime);
      return match ? match.conversationTime : "";
    } catch (_error) {
      return "";
    }
  }

  function extractConversationTime(options = {}) {
    const conversationId = options.conversationId || "";
    const messages = options.messages || [];
    const root = options.root || global.document.body;
    const sourceUrl = options.sourceUrl || global.location.href;
    const visibleHistoryTime = extractTimeFromVisibleHistory(sourceUrl);
    const allowTimestampCache = options.allowTimestampCache !== false;
    const allowMessageTimes = options.allowMessageTimes !== false;
    const allowDocumentTime = options.allowDocumentTime !== false;
    const allowScriptTime = options.allowScriptTime !== false;
    const allowVisibleHistoryTime = options.allowVisibleHistoryTime !== false;

    if (options.visibleHistoryConversationTimeOnly) {
      return visibleHistoryTime;
    }

    return (
      (options.preferVisibleHistoryConversationTime ? visibleHistoryTime : "") ||
      (allowTimestampCache ? extractTimeFromCache(conversationId) : "") ||
      (allowMessageTimes ? earliestMessageTime(messages) : "") ||
      (allowDocumentTime ? extractTimeFromDocument(root) : "") ||
      (allowScriptTime ? extractTimeFromScripts(conversationId) : "") ||
      (allowVisibleHistoryTime ? visibleHistoryTime : "")
    );
  }

  function extractWithConfig(config) {
    const root = global.document.querySelector(config.rootSelector || "main") || global.document.body;
    const selectorMessages = extractMessagesBySelectors(root, config.messageSelectors, config);
    const genericMessages = config.disableGenericExtraction ? [] : maybeMergeAdjacentSameRole(extractGenericMessages(root, config), config);
    const fallbackMessages = extractFallbackMessages(root, config);
    const messages = dropAssistantEchoesOfUser(
      maybeMergeAdjacentSameRole(chooseBestMessages([selectorMessages, genericMessages, fallbackMessages]), config),
      config
    );
    const platformLabel = config.platformLabel;
    const title = deriveTitle(global.document, platformLabel, config.titleSelectors, messages);
    const conversationId = extractConversationIdFromUrl(global.location.href);
    const conversationTime = extractConversationTime({
      conversationId,
      messages,
      root,
      sourceUrl: global.location.href,
      visibleHistoryConversationTimeOnly: config.visibleHistoryConversationTimeOnly,
      preferVisibleHistoryConversationTime: config.preferVisibleHistoryConversationTime,
      allowTimestampCache: config.allowTimestampCache,
      allowMessageTimes: config.allowMessageTimes,
      allowDocumentTime: config.allowDocumentTime,
      allowScriptTime: config.allowScriptTime,
      allowVisibleHistoryTime: config.allowVisibleHistoryTime
    });

    return mergeStructuredConversation({
      platform: platformLabel,
      sourceUrl: global.location.href,
      title,
      conversationId,
      conversationTime,
      messages
    }, {
      disableStructuredTimes: Boolean(config.disableStructuredTimes)
    });
  }

  function collectDebugSnapshot(platformLabel, config = {}) {
    const root = global.document.querySelector(config.rootSelector || "main") || global.document.body;
    const conversationId = extractConversationIdFromUrl(global.location.href);
    const scriptDiagnostics = scriptTimeDiagnostics(conversationId);
    const timestampCache = namespace.TimestampCache;
    const cacheEntry = timestampCache && timestampCache.getCacheEntry
      ? timestampCache.getCacheEntry(conversationId)
      : null;
    const geminiDebugEvidence = platformLabel === "Gemini" && timestampCache && timestampCache.getGeminiDebugEvidence
      ? timestampCache.getGeminiDebugEvidence(conversationId).slice(-10)
      : [];
    const structuredCache = namespace.StructuredConversationCache;
    const structuredConversation = matchingStructuredConversation(platformLabel, conversationId);
    const latestStructuredConversation = structuredCache && structuredCache.latestConversation
      ? structuredCache.latestConversation(platformLabel)
      : null;
    const selectors = [
      ...(config.fallbackMessageSelectors || []),
      "[data-testid]",
      "[data-test-id]",
      "[data-message-author-role]",
      "[data-author-role]",
      "[data-role]",
      "[class*='message']",
      "[class*='response']",
      "[class*='prose']",
      "[class*='markdown']",
      "[class*='font-claude']",
      "[class*='font-user']",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "[data-testid*='code' i]",
      "[data-test-id*='code' i]",
      "[class*='code-block']",
      "[class*='codeBlock']",
      "time",
      "[datetime]",
      "[data-time]",
      "[data-timestamp]",
      "[data-created-at]"
    ];
    const describeAncestors = (element) => {
      const ancestors = [];
      let current = element.parentElement;

      for (let depth = 0; current && depth < 5; depth += 1) {
        ancestors.push({
          tag: current.tagName,
          dataTestId: current.getAttribute("data-testid") || current.getAttribute("data-test-id") || "",
          dataRole: current.getAttribute("data-role") || current.getAttribute("data-message-author-role") || current.getAttribute("data-author-role") || "",
          className: classText(current).slice(0, 180)
        });
        current = current.parentElement;
      }

      return ancestors;
    };
    const elements = removeContainerDuplicates(selectors.flatMap((selector) => safeQueryAll(root, selector)));
    const samples = elements
      .filter((element) => isVisible(element) && textOf(element))
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName,
        role: roleFromElement(element),
        dataTestId: element.getAttribute("data-testid") || element.getAttribute("data-test-id") || "",
        dataRole: element.getAttribute("data-role") || element.getAttribute("data-message-author-role") || element.getAttribute("data-author-role") || "",
        className: classText(element).slice(0, 240),
        time: extractTimeFromElement(element),
        ancestors: describeAncestors(element),
        text: textOf(element).slice(0, 500)
      }));

    return {
      platform: platformLabel,
      url: global.location.href,
      title: global.document.title,
      conversationId,
      timeFromDocument: extractTimeFromDocument(root),
      timeFromScripts: scriptDiagnostics.time,
      scriptCount: scriptDiagnostics.scriptCount,
      scriptMatchCount: scriptDiagnostics.matchedScriptCount,
      scriptMatches: scriptDiagnostics.matches,
      cachedTimestamp: (cacheEntry && cacheEntry.timestamp) || "",
      cachedUpdatedAt: (cacheEntry && cacheEntry.updatedAt) || "",
      cachedTitle: (cacheEntry && cacheEntry.title) || "",
      geminiDebugEvidence,
      structuredConversationId: (structuredConversation && structuredConversation.conversationId) || "",
      structuredConversationTime: (structuredConversation && structuredConversation.conversationTime) || "",
      structuredMessageCount: structuredConversation && structuredConversation.messages
        ? structuredConversation.messages.length
        : 0,
      latestStructuredConversationId: (latestStructuredConversation && latestStructuredConversation.conversationId) || "",
      latestStructuredConversationTime: (latestStructuredConversation && latestStructuredConversation.conversationTime) || "",
      latestStructuredMessageCount: latestStructuredConversation && latestStructuredConversation.messages
        ? latestStructuredConversation.messages.length
        : 0,
      generatedAtForDebugOnly: new Date().toISOString(),
      samples
    };
  }

  namespace.AdapterCommon = {
    collectDebugSnapshot,
    dropAssistantEchoesOfUser,
    extractConversationTime,
    extractWithConfig,
    mergeStructuredConversation,
    mergeAdjacentSameRoleMessages,
    pickContentElement,
    readTimeCandidate,
    safeClosest,
    safeQueryAll,
    textOf
  };
})(globalThis);
