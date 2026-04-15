(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const utils = namespace.PlatformUtils;

  const CONVERSATION_PATHS = {
    chatgpt: [/^\/c\/[^/]+/i, /^\/g\/[A-Za-z0-9_-]+\/c\/[^/]+/i],
    claude: [/^\/chat\/[^/]+/i, /\/chat\/[^/]+/i],
    gemini: [/^\/app\/[^/]+/i],
    grok: [/^\/chat\/[^/]+/i, /^\/c\/[^/]+/i]
  };
  const MONTHS = new Map([
    ["jan", 1],
    ["january", 1],
    ["feb", 2],
    ["february", 2],
    ["mar", 3],
    ["march", 3],
    ["apr", 4],
    ["april", 4],
    ["may", 5],
    ["jun", 6],
    ["june", 6],
    ["jul", 7],
    ["july", 7],
    ["aug", 8],
    ["august", 8],
    ["sep", 9],
    ["sept", 9],
    ["september", 9],
    ["oct", 10],
    ["october", 10],
    ["nov", 11],
    ["november", 11],
    ["dec", 12],
    ["december", 12]
  ]);

  function sleep(ms) {
    return new Promise((resolve) => global.setTimeout(resolve, ms));
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from((root || global.document).querySelectorAll(selector));
    } catch (_error) {
      return [];
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

  function textOf(element) {
    return utils.normalizeWhitespace(
      (element && (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title"))) || ""
    );
  }

  function hasVisibleBox(element) {
    if (!element || !element.getBoundingClientRect) {
      return true;
    }

    const rect = element.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    const style = global.getComputedStyle ? global.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
      return false;
    }

    if (element.getAttribute("aria-hidden") === "true" || element.getAttribute("hidden") !== null) {
      return false;
    }

    return hasVisibleBox(element);
  }

  function platformForUrl(url) {
    const platform = utils.detectPlatformFromUrl(url);
    return platform ? platform.id : "";
  }

  function normalizeConversationUrl(urlLike, platformId) {
    let url;

    try {
      url = new URL(urlLike, (global.location && global.location.href) || "https://example.com/");
    } catch (_error) {
      return "";
    }

    const detectedPlatform = platformForUrl(url.href);
    if (platformId && detectedPlatform !== platformId) {
      return "";
    }

    const platform = platformId || detectedPlatform;
    if (!platform || !CONVERSATION_PATHS[platform]) {
      return "";
    }

    if (!CONVERSATION_PATHS[platform].some((pattern) => pattern.test(url.pathname))) {
      return "";
    }

    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "");
  }

  function conversationIdFromUrl(urlLike) {
    try {
      const url = new URL(urlLike);
      return url.pathname
        .split("/")
        .filter(Boolean)
        .reverse()
        .find((part) => /[A-Za-z0-9_-]{8,}/.test(part)) || "";
    } catch (_error) {
      return "";
    }
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateFromParts(year, month, day) {
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    const currentYear = new Date().getFullYear();

    if (
      !Number.isFinite(date.getTime()) ||
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day) ||
      date.getFullYear() < 2000 ||
      date.getFullYear() > currentYear + 1
    ) {
      return "";
    }

    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function relativeDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return dateFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function inferYearForMonthDay(month, day) {
    const today = new Date();
    const thisYearDate = new Date(today.getFullYear(), Number(month) - 1, Number(day));

    if (!Number.isFinite(thisYearDate.getTime())) {
      return today.getFullYear();
    }

    return thisYearDate.getTime() > today.getTime() + 36 * 60 * 60 * 1000
      ? today.getFullYear() - 1
      : today.getFullYear();
  }

  function firstMatchDate(text) {
    const clean = utils.normalizeWhitespace(text);
    if (!clean) {
      return { date: "", raw: "" };
    }

    if (/(今天|今日|today)/i.test(clean)) {
      return { date: relativeDate(0), raw: clean.match(/今天|今日|today/i)[0] };
    }

    if (/(昨天|yesterday)/i.test(clean)) {
      return { date: relativeDate(1), raw: clean.match(/昨天|yesterday/i)[0] };
    }

    if (/前天/.test(clean)) {
      return { date: relativeDate(2), raw: "前天" };
    }

    let match = clean.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
    if (match) {
      return { date: dateFromParts(match[1], match[2], match[3]), raw: match[0] };
    }

    match = clean.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (match) {
      return { date: dateFromParts(match[1], match[2], match[3]), raw: match[0] };
    }

    match = clean.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/);
    if (match) {
      const month = MONTHS.get(match[1].toLowerCase());
      if (month) {
        const year = match[3] || inferYearForMonthDay(month, match[2]);
        return { date: dateFromParts(year, month, match[2]), raw: match[0] };
      }
    }

    match = clean.match(/\b(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (match) {
      const year = inferYearForMonthDay(match[1], match[2]);
      return { date: dateFromParts(year, match[1], match[2]), raw: match[0] };
    }

    match = clean.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}|\d{2}))?\b/);
    if (match) {
      const year = match[3]
        ? (match[3].length === 2 ? `20${match[3]}` : match[3])
        : inferYearForMonthDay(match[1], match[2]);
      return { date: dateFromParts(year, match[1], match[2]), raw: match[0] };
    }

    return { date: "", raw: "" };
  }

  function stripDateText(value, dateRaw) {
    let clean = utils.normalizeWhitespace(value);
    if (dateRaw) {
      clean = clean.replace(dateRaw, " ");
    }

    return clean
      .replace(/\b(今天|今日|昨天|前天|today|yesterday)\b/ig, " ")
      .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
      .replace(/\b20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")
      .replace(/\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,\s*20\d{2})?\b/g, " ")
      .replace(/\b\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")
      .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-](?:20\d{2}|\d{2}))?\b/g, " ");
  }

  function cleanTitle(value, dateRaw = "") {
    const clean = stripDateText(value, dateRaw)
      .replace(/\b(new chat|new conversation|chat history|conversation history|recent|pinned|more options|open chat|ChatGPT)\b/ig, " ")
      .replace(/\b(与\s*Gemini\s*对话|new conversation)\b/ig, " ")
      .replace(/(更多选项|打开聊天|新对话|最近|已固定|历史记录|查看全部)/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return utils.truncate(clean, 120);
  }

  function titleQuality(value) {
    const clean = utils.normalizeWhitespace(value);
    if (!clean) {
      return 0;
    }

    if (/^(ChatGPT|Claude|Gemini|Grok|Chat|Conversation|与\s*Gemini\s*对话|New conversation)$/i.test(clean)) {
      return 1;
    }

    return Math.min(clean.length, 120);
  }

  function textParts(element) {
    const parts = [];
    const visit = (node) => {
      if (!node || node.nodeType !== 1 || !isVisible(node)) {
        return;
      }

      const children = Array.from(node.children || []).filter((child) => child.nodeType === 1 && isVisible(child));
      if (!children.length) {
        const text = textOf(node);
        if (text) {
          parts.push(text);
        }
        return;
      }

      for (const child of children) {
        visit(child);
      }
    };

    visit(element);
    return parts;
  }

  function countConversationLinksInElement(element, platformId) {
    const links = safeQueryAll(element, "a[href]");
    let count = 0;

    for (const link of links) {
      const href = link.getAttribute("href");
      if (href && normalizeConversationUrl(href, platformId)) {
        count += 1;
        if (count > 1) {
          return count;
        }
      }
    }

    return count;
  }

  function currentPlatformId() {
    const platform = utils.detectPlatformFromUrl((global.location && global.location.href) || "");
    return platform ? platform.id : "";
  }

  function historyItemContainer(link) {
    let current = link;
    let fallback = link;
    const platformId = currentPlatformId();

    for (let depth = 0; current && depth < 8; depth += 1) {
      const tag = current.tagName;
      const role = (current.getAttribute && current.getAttribute("role")) || "";
      const linkCount = countConversationLinksInElement(current, platformId);
      const currentText = textOf(current);
      const hasDateText = Boolean(firstMatchDate(currentText).date);
      const compactSingleLinkBlock = linkCount <= 1 && currentText && currentText.length <= 240;

      if (
        compactSingleLinkBlock &&
        (/^(LI|ARTICLE|DIV)$/.test(tag) || /^(listitem|menuitem|option|row)$/i.test(role) || hasDateText)
      ) {
        fallback = current;
      }

      if (linkCount > 1) {
        break;
      }

      current = current.parentElement;
    }

    return fallback;
  }

  function findSectionDateHeader(link) {
    let current = link.parentElement;
    const platformId = currentPlatformId();

    for (let depth = 0; current && depth < 10; depth += 1) {
      const linkCount = countConversationLinksInElement(current, platformId);
      if (linkCount > 1) {
        const candidates = Array.from(current.children || []);
        for (const child of candidates) {
          if (countConversationLinksInElement(child, platformId) > 0) {
            continue;
          }

          const childText = textOf(child);
          if (childText && childText.length <= 40) {
            const dateInfo = firstMatchDate(childText);
            if (dateInfo.date) {
              return dateInfo;
            }
          }
        }

        const prev = current.previousElementSibling;
        if (prev) {
          const prevText = textOf(prev);
          if (prevText && prevText.length <= 40) {
            const dateInfo = firstMatchDate(prevText);
            if (dateInfo.date) {
              return dateInfo;
            }
          }
        }
      }

      current = current.parentElement;
    }

    return { date: "", raw: "" };
  }

  function extractHistoryMetadata(link) {
    const container = historyItemContainer(link);
    const containerText = textOf(container);
    const dateCandidate = firstMatchDate(containerText);
    const sectionDate = dateCandidate.date ? dateCandidate : findSectionDateHeader(link);

    const linkCandidates = [
      link.getAttribute("aria-label"),
      link.getAttribute("title"),
      ...textParts(link),
      textOf(link)
    ]
      .map((value) => cleanTitle(value, sectionDate.raw))
      .filter(Boolean);

    const containerCandidates = containerText.length <= 200
      ? [
        ...textParts(container),
        containerText
      ]
        .map((value) => cleanTitle(value, sectionDate.raw))
        .filter(Boolean)
      : [];

    const allCandidates = [...linkCandidates, ...containerCandidates];

    const title = allCandidates
      .sort((a, b) => titleQuality(b) - titleQuality(a))[0] || "";

    return {
      title,
      conversationTime: sectionDate.date,
      rawDateText: sectionDate.raw
    };
  }

  function collectConversationLinks(root = global.document, platformId) {
    const links = safeQueryAll(root, "a[href]");
    const items = [];
    const seen = new Set();

    for (const link of links) {
      if (!isVisible(link)) {
        continue;
      }

      const normalizedUrl = normalizeConversationUrl(link.getAttribute("href"), platformId);
      if (!normalizedUrl || seen.has(normalizedUrl)) {
        continue;
      }

      seen.add(normalizedUrl);
      const metadata = extractHistoryMetadata(link);
      items.push({
        platform: utils.detectPlatformFromUrl(normalizedUrl)?.label || "",
        title: metadata.title,
        conversationTime: metadata.conversationTime,
        rawDateText: metadata.rawDateText,
        url: normalizedUrl,
        conversationId: conversationIdFromUrl(normalizedUrl)
      });
    }

    return items;
  }

  function scrollableElements() {
    const roots = [
      global.document.scrollingElement,
      global.document.body,
      ...safeQueryAll(global.document, [
        "aside",
        "nav",
        "main",
        "section",
        "div",
        "[role='navigation']",
        "[role='main']",
        "[data-radix-scroll-area-viewport]"
      ].join(","))
    ].filter(Boolean);

    return Array.from(new Set(roots)).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      return (element.scrollHeight || 0) > (element.clientHeight || 0) + 80;
    });
  }

  function historyContainerScore(element, platformId) {
    const tokens = [
      element.tagName,
      element.getAttribute && element.getAttribute("role"),
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("data-testid"),
      classText(element)
    ].filter(Boolean).join(" ").toLowerCase();
    const linkCount = collectConversationLinks(element, platformId).length;
    const range = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
    const navBonus = /\b(nav|aside|sidebar|history|conversation|thread|recent|chat)\b/.test(tokens) ? 500 : 0;

    return linkCount * 1000 + navBonus + Math.min(range, 3000);
  }

  function sortedHistoryContainers(platformId) {
    return scrollableElements()
      .map((element) => ({ element, score: historyContainerScore(element, platformId) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.element);
  }

  function dispatchScroll(element) {
    try {
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 700 }));
    } catch (_error) {
      // Some synthetic events can fail on locked-down pages; direct scrollTop still works.
    }
  }

  function scrollDown(element) {
    const before = element.scrollTop || 0;
    const step = Math.max(360, Math.floor((element.clientHeight || 500) * 0.85));
    const maxScrollTop = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
    element.scrollTop = Math.min(maxScrollTop, before + step);
    dispatchScroll(element);
    return Math.abs((element.scrollTop || 0) - before) > 2;
  }

  function resetScroll(containers) {
    for (const container of containers) {
      container.scrollTop = 0;
      dispatchScroll(container);
    }
  }

  function buttonText(element) {
    return utils.normalizeWhitespace(
      textOf(element) ||
      (element && (element.getAttribute("aria-label") || element.getAttribute("title"))) ||
      ""
    );
  }

  function clickableElements() {
    return safeQueryAll(global.document, "button, [role='button'], a[href]");
  }

  async function clickMatchingButton(pattern) {
    const candidates = clickableElements().filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const text = buttonText(element);
      return text && text.length <= 80 && pattern.test(text);
    });

    const target = candidates[0];
    if (!target) {
      return false;
    }

    target.click();
    await sleep(900);
    return true;
  }

  async function maybeOpenGrokHistory(platformId) {
    if (platformId !== "grok") {
      return false;
    }

    return clickMatchingButton(/查看全部|查看所有|全部历史|see all|view all|show all|all chats|chat history/i);
  }

  async function loadGeminiSidebarHistory(platformId, options = {}) {
    if (platformId !== "gemini") {
      return false;
    }

    let containers = sortedHistoryContainers(platformId);
    if (!containers.length) {
      return false;
    }

    resetScroll(containers);
    await sleep(options.sidebarInitialWaitMs || 450);

    let idleRounds = 0;
    let previousCount = collectConversationLinks(global.document, platformId).length;
    const maxRounds = options.sidebarMaxRounds || 220;
    const idleLimit = options.sidebarIdleLimit || 8;

    for (let round = 0; round < maxRounds; round += 1) {
      containers = sortedHistoryContainers(platformId);
      const moved = containers.map(scrollDown).some(Boolean);
      await sleep(options.sidebarRoundDelayMs || 320);

      const currentCount = collectConversationLinks(global.document, platformId).length;
      if (!moved && currentCount === previousCount) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      previousCount = currentCount;
      if (idleRounds >= idleLimit) {
        break;
      }
    }

    return true;
  }

  async function maybeOpenSearchHistory(platformId) {
    if (platformId !== "chatgpt" && platformId !== "claude" && platformId !== "gemini") {
      return false;
    }

    return clickMatchingButton(/搜索聊天|搜索|search chats|search conversations|search/i);
  }

  async function maybeClickLoadMore() {
    return clickMatchingButton(/显示更多|加载更多|查看更多|show more|load more/i);
  }

  function mergeLinks(target, links) {
    let added = 0;

    for (const item of links) {
      if (target.has(item.url)) {
        const existing = target.get(item.url);
        existing.title = existing.title || item.title;
        existing.conversationId = existing.conversationId || item.conversationId;
        existing.conversationTime = existing.conversationTime || item.conversationTime;
        existing.rawDateText = existing.rawDateText || item.rawDateText;
        continue;
      }

      target.set(item.url, item);
      added += 1;
    }

    return added;
  }

  function discoveryTarget(options, platformId) {
    const targetUrl = options.targetUrl && normalizeConversationUrl(options.targetUrl, platformId);
    const targetConversationId = options.targetConversationId || (targetUrl ? conversationIdFromUrl(targetUrl) : "");
    return {
      url: targetUrl || "",
      conversationId: targetConversationId || ""
    };
  }

  function targetMatch(seen, target, requireTime = true) {
    if (!target || (!target.url && !target.conversationId)) {
      return null;
    }

    for (const item of seen.values()) {
      if (!item) {
        continue;
      }

      const matchesUrl = target.url && item.url === target.url;
      const matchesId = target.conversationId && item.conversationId === target.conversationId;
      if ((matchesUrl || matchesId) && (!requireTime || item.conversationTime)) {
        return item;
      }
    }

    return null;
  }

  async function discoverHistory(options = {}) {
    const platform = utils.detectPlatformFromUrl(global.location.href);
    if (!platform) {
      return { ok: false, error: "当前页面不是已支持的平台。", conversations: [] };
    }

    const isGemini = platform.id === "gemini";
    const target = discoveryTarget(options, platform.id);

    if (isGemini) {
      await loadGeminiSidebarHistory(platform.id, options);
    }

    if (!(await maybeOpenGrokHistory(platform.id))) {
      await maybeOpenSearchHistory(platform.id);
    }
    await sleep(options.initialWaitMs || 800);

    let containers = sortedHistoryContainers(platform.id);
    resetScroll(containers);
    await sleep(350);

    const seen = new Map();
    let idleRounds = 0;
    const maxRounds = isGemini
      ? (options.geminiSearchMaxRounds || 120)
      : (options.maxRounds || 180);
    const idleLimit = isGemini
      ? (options.geminiSearchIdleLimit || options.idleLimit || 5)
      : (options.idleLimit || 7);
    const roundDelayMs = isGemini
      ? (options.geminiSearchRoundDelayMs || options.roundDelayMs || 220)
      : (options.roundDelayMs || 360);

    for (let round = 0; round < maxRounds; round += 1) {
      const beforeCount = seen.size;
      mergeLinks(seen, collectConversationLinks(global.document, platform.id));
      if (targetMatch(seen, target)) {
        break;
      }
      await maybeClickLoadMore();

      containers = sortedHistoryContainers(platform.id);
      const moved = containers.map(scrollDown).some(Boolean);
      await sleep(roundDelayMs);
      mergeLinks(seen, collectConversationLinks(global.document, platform.id));
      if (targetMatch(seen, target)) {
        break;
      }

      if (seen.size === beforeCount && !moved) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      if (idleRounds >= idleLimit) {
        break;
      }
    }

    return {
      ok: true,
      platform: platform.label,
      url: global.location.href,
      count: seen.size,
      conversations: Array.from(seen.values())
    };
  }

  function messageLikeCount(root = global.document) {
    const selectors = [
      "[data-testid*='message' i]",
      "[data-test-id*='message' i]",
      "[data-message-author-role]",
      "[data-author-role]",
      "[data-testid^='conversation-turn-']",
      "user-query",
      "model-response",
      ".response-content-markdown",
      ".font-claude-message",
      ".assistant-message",
      ".user-message",
      "article"
    ];

    return safeQueryAll(root, selectors.join(","))
      .filter((element) => isVisible(element) && textOf(element))
      .length;
  }

  function messageContainerScore(element) {
    const tokens = [
      element.tagName,
      element.getAttribute && element.getAttribute("role"),
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("data-testid"),
      classText(element)
    ].filter(Boolean).join(" ").toLowerCase();
    const count = messageLikeCount(element);
    const range = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
    const mainBonus = /\b(main|chat|conversation|message|thread|scroll)\b/.test(tokens) ? 500 : 0;

    return count * 1000 + mainBonus + Math.min(range, 3000);
  }

  function sortedMessageContainers() {
    return scrollableElements()
      .map((element) => ({ element, score: messageContainerScore(element) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.element);
  }

  async function prepareCurrentConversation(options = {}) {
    await sleep(options.initialWaitMs || 900);

    let containers = sortedMessageContainers();
    if (!containers.length && global.document.scrollingElement) {
      containers = [global.document.scrollingElement];
    }

    resetScroll(containers);
    await sleep(500);

    let stableRounds = 0;
    let previousCount = 0;
    const maxRounds = options.maxRounds || 90;
    const stableLimit = options.stableLimit || 6;

    for (let round = 0; round < maxRounds; round += 1) {
      const beforeCount = messageLikeCount(global.document);
      const moved = containers.map(scrollDown).some(Boolean);
      await sleep(options.roundDelayMs || 280);
      const afterCount = messageLikeCount(global.document);

      if (!moved && afterCount === beforeCount && afterCount === previousCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      previousCount = afterCount;
      if (stableRounds >= stableLimit) {
        break;
      }
    }

    await sleep(options.finalWaitMs || 600);

    return {
      ok: true,
      messageElementCount: messageLikeCount(global.document)
    };
  }

  namespace.BatchHistory = {
    collectConversationLinks,
    conversationIdFromUrl,
    discoverHistory,
    extractHistoryMetadata,
    firstMatchDate,
    normalizeConversationUrl,
    prepareCurrentConversation
  };
})(globalThis);
