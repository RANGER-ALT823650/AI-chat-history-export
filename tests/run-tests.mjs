import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { conversations } from "./fixtures/conversations.mjs";

const projectRoot = new URL("..", import.meta.url).pathname;
const DOM_POSITION_PRECEDING = 2;
const DOM_POSITION_FOLLOWING = 4;
let testNodeOrder = 0;

async function loadBrowserCore() {
  const context = {
    URL,
    Node: {
      DOCUMENT_POSITION_PRECEDING: DOM_POSITION_PRECEDING,
      DOCUMENT_POSITION_FOLLOWING: DOM_POSITION_FOLLOWING
    },
    console,
    TextEncoder,
    btoa: (value) => Buffer.from(value, "binary").toString("base64")
  };
  context.globalThis = context;
  vm.createContext(context);

  for (const file of [
    "src/content/platform-utils.js",
    "src/content/structured-cache.js",
    "src/content/markdown.js",
    "src/content/adapters/common.js",
    "src/content/adapters/chatgpt.js",
    "src/content/adapters/grok.js",
    "src/content/adapters/deepseek.js",
    "src/content/adapters/doubao.js",
    "src/content/history-discovery.js"
  ]) {
    const source = await readFile(join(projectRoot, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  context.AIChatExporter.__testGlobal = context;
  return context.AIChatExporter;
}

async function loadAdapterConfig(adapterFile, adapterName) {
  const context = {
    AIChatExporter: {
      Markdown: {
        htmlToMarkdown() {
          return "";
        }
      },
      PlatformUtils: {
        firstMeaningfulLine: browserCore.PlatformUtils?.firstMeaningfulLine || ((value) => String(value || "")),
        normalizeWhitespace(value) {
          return String(value || "").trim();
        },
        stripPlatformFromTitle(title) {
          return String(title || "");
        },
        truncate(value) {
          return String(value || "");
        }
      },
      AdapterCommon: {
        extractWithConfig(config) {
          return config;
        },
        mergeAdjacentSameRoleMessages(messages) {
          return messages || [];
        },
        mergeStructuredConversation(conversation) {
          return conversation;
        }
      }
    },
    document: {
      title: "",
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    location: {
      href: "https://example.com/"
    }
  };
  context.globalThis = context;
  vm.createContext(context);

  const source = await readFile(join(projectRoot, adapterFile), "utf8");
  vm.runInContext(source, context, { filename: adapterFile });

  return context.AIChatExporter[adapterName].extract();
}

async function collectInterceptorMessages(url, payload, options = {}) {
  const posted = [];
  const contentType = options.contentType || "application/json";
  const textPayload = options.textPayload !== undefined
    ? options.textPayload
    : typeof payload === "string"
      ? payload
      : JSON.stringify(payload);
  const headers = { get: () => contentType };
  const response = {
    ok: true,
    headers,
    clone() {
      return {
        headers,
        json: () => Promise.resolve(payload),
        text: () => Promise.resolve(textPayload)
      };
    }
  };
  function XMLHttpRequestMock() {}
  XMLHttpRequestMock.prototype.open = function () {};
  XMLHttpRequestMock.prototype.send = function () {};

  const context = {
    URL,
    console,
    setTimeout,
    clearTimeout,
    Request: class RequestMock {},
    XMLHttpRequest: XMLHttpRequestMock,
    document: {
      readyState: "complete",
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    fetch: () => Promise.resolve(response),
    postMessage(message) {
      posted.push(message);
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  const source = await readFile(join(projectRoot, "src/content/api-interceptor.js"), "utf8");
  vm.runInContext(source, context, { filename: "src/content/api-interceptor.js" });
  await context.fetch(url);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return posted;
}

async function listExportedFilesWithHarness(downloadItems) {
  let listener = null;
  const context = {
    URL,
    console,
    TextDecoder,
    TextEncoder,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    chrome: {
      downloads: {
        search(_query, callback) {
          callback(downloadItems);
        }
      },
      runtime: {
        lastError: null,
        onMessage: {
          addListener(callback) {
            listener = callback;
          }
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);

  const source = await readFile(join(projectRoot, "src/background.js"), "utf8");
  vm.runInContext(source, context, { filename: "src/background.js" });

  return new Promise((resolve) => {
    listener({ type: "LIST_EXPORTED_MARKDOWN_FILES" }, {}, resolve);
  });
}

function markdownDownloadItem(relativePath, markdown) {
  return {
    id: 1,
    exists: true,
    filename: `/Users/mayifan/Downloads/AI Chat Exports/${relativePath}`,
    url: `data:text/markdown;charset=utf-8;base64,${Buffer.from(markdown, "utf8").toString("base64")}`
  };
}

const browserCore = await loadBrowserCore();
const { PlatformUtils, Markdown, AdapterCommon, BatchHistory } = browserCore;
const browserGlobal = browserCore.__testGlobal;
const geminiConfig = await loadAdapterConfig("src/content/adapters/gemini.js", "GeminiAdapter");
const grokConfig = await loadAdapterConfig("src/content/adapters/grok.js", "GrokAdapter");
const deepSeekConfig = await loadAdapterConfig("src/content/adapters/deepseek.js", "DeepSeekAdapter");
const doubaoConfig = await loadAdapterConfig("src/content/adapters/doubao.js", "DoubaoAdapter");

function textNode(value) {
  return {
    _order: testNodeOrder += 1,
    nodeType: 3,
    nodeValue: value,
    textContent: value,
    innerText: value,
    parentElement: null
  };
}

function element(tagName, attributes = {}, children = []) {
  const attributeMatch = (item, expression) => {
    const match = expression.match(/^([^\s~|^$*=\]]+)(?:\s*([*^$|~]?=)\s*(?:\"([^\"]*)\"|'([^']*)'|([^\]\s]+)))?(?:\s+(i))?$/i);
    if (!match) {
      return false;
    }

    const [, name, operator = "", rawDouble = "", rawSingle = "", rawBare = "", caseFlag = ""] = match;
    const actual = item.getAttribute ? item.getAttribute(name) : null;
    if (operator === "") {
      return actual !== null;
    }
    if (actual === null) {
      return false;
    }

    const expected = rawDouble || rawSingle || rawBare || "";
    const actualValue = caseFlag ? String(actual).toLowerCase() : String(actual);
    const expectedValue = caseFlag ? expected.toLowerCase() : expected;

    if (operator === "=") {
      return actualValue === expectedValue;
    }
    if (operator === "*=") {
      return actualValue.includes(expectedValue);
    }
    if (operator === "^=") {
      return actualValue.startsWith(expectedValue);
    }
    if (operator === "$=") {
      return actualValue.endsWith(expectedValue);
    }
    return false;
  };

  const matchesSelectorPart = (item, part) => {
    if (!part) {
      return false;
    }

    if (part.includes(" ")) {
      return false;
    }

    if (part.startsWith("annotation") && item.tagName === "ANNOTATION") {
      return true;
    }

    const tagMatch = part.match(/^[a-z][a-z0-9-]*/i);
    if (tagMatch && tagMatch[0].toUpperCase() !== item.tagName) {
      return false;
    }

    const classMatches = Array.from(part.matchAll(/\.([A-Za-z0-9_-]+)/g)).map((match) => match[1]);
    if (classMatches.length) {
      const classes = String(item.className || "").split(/\s+/).filter(Boolean);
      if (!classMatches.every((name) => classes.includes(name))) {
        return false;
      }
    }

    const attributeMatches = Array.from(part.matchAll(/\[([^\]]+)\]/g)).map((match) => match[1]);
    if (attributeMatches.length && !attributeMatches.every((expression) => attributeMatch(item, expression))) {
      return false;
    }

    const remainder = part
      .replace(/^[a-z][a-z0-9-]*/i, "")
      .replace(/\.([A-Za-z0-9_-]+)/g, "")
      .replace(/\[[^\]]+\]/g, "")
      .trim();
    return remainder === "";
  };

  const node = {
    _order: testNodeOrder += 1,
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    className: attributes.class || "",
    childNodes: children,
    children: children.filter((child) => child.nodeType === 1),
    parentElement: null,
    get textContent() {
      return children.map((child) => child.textContent || "").join("");
    },
    get innerText() {
      return this.textContent;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    matches(selector) {
      const selectorParts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
      return selectorParts.some((part) => matchesSelectorPart(this, part));
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches && current.matches(selector)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
    contains(candidate) {
      if (candidate === this) {
        return true;
      }

      return (this.childNodes || []).some((child) => child === candidate || (child.contains && child.contains(candidate)));
    },
    compareDocumentPosition(candidate) {
      return this._order < candidate._order ? DOM_POSITION_FOLLOWING : DOM_POSITION_PRECEDING;
    },
    getBoundingClientRect() {
      return {
        left: attributes.left || 0,
        width: attributes.width || 100,
        height: attributes.height || 20
      };
    },
    getClientRects() {
      const rect = this.getBoundingClientRect();
      return rect.width && rect.height ? [rect] : [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const output = [];
      const selectorParts = String(selector).split(",").map((part) => part.trim()).filter(Boolean);
      const walk = (item) => {
        if (!item || item.nodeType !== 1) {
          return;
        }

        if (selectorParts.some((part) => matchesSelectorPart(item, part))) {
          output.push(item);
        }

        for (const child of item.children || []) {
          walk(child);
        }
      };

      for (const child of children) {
        walk(child);
      }

      return output;
    }
  };

  for (const child of children) {
    if (child && typeof child === "object") {
      child.parentElement = node;
    }
  }

  return node;
}

async function extractClaudeWithHarness(options = {}) {
  const cached = [];
  const fetchCalls = [];
  const context = {
    URL,
    AIChatExporter: {
      AdapterCommon: {
        extractWithConfig() {
          return options.domConversation || {
            platform: "Claude",
            sourceUrl: options.location?.href || "https://claude.ai/chat/claude-api-fallback-123",
            title: "DOM Claude",
            conversationId: "claude-api-fallback-123",
            conversationTime: "",
            messages: [
              { role: "user", content: "DOM question" },
              { role: "assistant", content: "DOM answer" }
            ]
          };
        },
        readTimeCandidate: browserCore.AdapterCommon.readTimeCandidate,
        mergeStructuredConversation(conversation) {
          return conversation;
        }
      },
      StructuredConversationCache: {
        cacheConversation(conversation) {
          cached.push(conversation);
          return true;
        }
      }
    },
    performance: {
      getEntriesByType(type) {
        return type === "resource"
          ? [{
            name: options.resourceUrl || "https://claude.ai/api/organizations/org-123/chat_conversations/claude-api-fallback-123?tree=True&rendering_mode=messages"
          }]
          : [];
      }
    },
    fetch(url) {
      fetchCalls.push(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.apiResponse || {
          uuid: "claude-api-fallback-123",
          name: "Claude API fallback",
          created_at: "2026-04-12T06:38:27.489892Z",
          chat_messages: [
            {
              sender: "human",
              created_at: "2026-04-12T06:38:27.822929Z",
              content: [{ type: "text", text: "API question" }]
            },
            {
              sender: "assistant",
              created_at: "2026-04-12T06:38:51.802839Z",
              content: [{ type: "tool_use", name: "artifact_renderer" }]
            }
          ]
        })
      });
    },
    location: options.location || { href: "https://claude.ai/chat/claude-api-fallback-123" }
  };
  context.globalThis = context;
  vm.createContext(context);

  const source = await readFile(join(projectRoot, "src/content/adapters/claude.js"), "utf8");
  vm.runInContext(source, context, { filename: "src/content/adapters/claude.js" });

  return {
    result: await context.AIChatExporter.ClaudeAdapter.extract(),
    cached,
    fetchCalls
  };
}

function documentFrom(root, title = "Test Chat - Grok") {
  return {
    title,
    body: root,
    querySelector(selector) {
      if (root.matches && root.matches(selector)) {
        return root;
      }
      return root.querySelector(selector);
    },
    querySelectorAll(selector) {
      const output = [];
      if (root.matches && root.matches(selector)) {
        output.push(root);
      }
      return output.concat(root.querySelectorAll(selector));
    }
  };
}

assert.equal(PlatformUtils.detectPlatformFromUrl("https://gemini.google.com/app/123").id, "gemini");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://chatgpt.com/c/123456789").id, "chatgpt");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://chat.openai.com/c/123456789").id, "chatgpt");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://claude.ai/chat/123").id, "claude");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://grok.com/chat/123").id, "grok");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://x.com/i/grok").id, "grok");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://chat.deepseek.com/a/chat/s/123456789").id, "deepseek");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://www.doubao.com/chat/123456789").id, "doubao");
assert.equal(PlatformUtils.detectPlatformFromUrl("https://example.com"), null);
assert.equal(PlatformUtils.isGenericConversationTitle("与 Gemini 对话", "Gemini"), true);
assert.equal(PlatformUtils.isGenericConversationTitle("环路积分符号怎么理解", "Gemini"), false);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://chatgpt.com/c/abc123456789?model=gpt-4#bottom"),
  "https://chatgpt.com/c/abc123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://chatgpt.com/g/g-test/c/abc123456789?model=gpt-4"),
  "https://chatgpt.com/g/g-test/c/abc123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://claude.ai/chat/abc123456789?utm=1#bottom"),
  "https://claude.ai/chat/abc123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://gemini.google.com/app/abc123456789?hl=zh-CN"),
  "https://gemini.google.com/app/abc123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://grok.com/c/def123456789?ref=sidebar"),
  "https://grok.com/c/def123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://chat.deepseek.com/a/chat/s/deepseek123456789?foo=bar"),
  "https://chat.deepseek.com/a/chat/s/deepseek123456789"
);
assert.equal(
  BatchHistory.normalizeConversationUrl("https://www.doubao.com/chat/doubao123456789?enter_from=sidebar"),
  "https://www.doubao.com/chat/doubao123456789"
);
assert.equal(BatchHistory.normalizeConversationUrl("https://grok.com/share/not-account-history"), "");
assert.equal(BatchHistory.conversationIdFromUrl("https://claude.ai/chat/abc123456789"), "abc123456789");

const exportedFileList = await listExportedFilesWithHarness([
  markdownDownloadItem("Gemini/2026-03-19_Gemini_与_Gemini_对话.md", `---
platform: "Gemini"
source_url: "https://gemini.google.com/app/geminimetadata123?hl=zh-CN"
conversation_title: "真实 Gemini 标题"
conversation_time: "2026-03-19"
conversation_id: "geminimetadata123"
---

# 真实 Gemini 标题

## Metadata

- Platform: Gemini
- Source URL: https://gemini.google.com/app/geminimetadata123
- Conversation ID: geminimetadata123
`)
]);
assert.equal(exportedFileList.ok, true);
assert.equal(exportedFileList.files.length, 1);
assert.equal(exportedFileList.files[0].metadata.platform, "Gemini");
assert.equal(exportedFileList.files[0].metadata.sourceUrl, "https://gemini.google.com/app/geminimetadata123?hl=zh-CN");
assert.equal(exportedFileList.files[0].metadata.conversationId, "geminimetadata123");
assert.equal(exportedFileList.files[0].metadata.title, "真实 Gemini 标题");

assert.equal(geminiConfig.platformLabel, "Gemini");
assert.equal(geminiConfig.preferVisibleHistoryConversationTime, true);
assert.equal(geminiConfig.disableMessageTimeExtraction, true);
assert.equal(geminiConfig.allowDocumentTime, false);
assert.equal(geminiConfig.allowScriptTime, false);
assert.notEqual(geminiConfig.disableStructuredTimes, true);
assert.equal(grokConfig.allowVisibleHistoryTime, false);
assert.equal(grokConfig.allowDocumentTime, false);
assert.equal(grokConfig.allowScriptTime, false);
assert.equal(deepSeekConfig.platformLabel, "DeepSeek");
assert.equal(doubaoConfig.platformLabel, "Doubao");
assert.equal(BatchHistory.firstMatchDate("洗车店距离问题 2026年4月10日").date, "2026-04-10");
assert.equal(BatchHistory.firstMatchDate("Troubleshooting VMware Apr 9, 2026").date, "2026-04-09");
assert.equal(AdapterCommon.readTimeCandidate("1712591700"), "2024-04-08T15:55:00.000Z");
assert.equal(AdapterCommon.readTimeCandidate("1763197777.522"), "2025-11-15T09:09:37.522Z");
assert.equal(AdapterCommon.readTimeCandidate("1712591700000"), "2024-04-08T15:55:00.000Z");
assert.equal(AdapterCommon.readTimeCandidate("11611161"), "");
assert.equal(AdapterCommon.readTimeCandidate("6666666666000"), "");

const geminiHistoryLink = element("a", { href: "https://gemini.google.com/app/52c97c580942a141" }, [
  textNode("洗车店距离问题")
]);
const geminiHistoryRow = element("li", {}, [
  geminiHistoryLink,
  element("span", {}, [textNode("2026年4月10日")])
]);
const geminiHistoryMetadata = BatchHistory.extractHistoryMetadata(geminiHistoryLink);
assert.equal(geminiHistoryRow.contains(geminiHistoryLink), true);
assert.equal(geminiHistoryMetadata.title, "洗车店距离问题");
assert.equal(geminiHistoryMetadata.conversationTime, "2026-04-10");

const previousTimestampCache = browserCore.TimestampCache;
browserCore.TimestampCache = {
  getTimestamp(conversationId) {
    return conversationId === "geminicachetime123" ? "2026-04-16T10:00:00.000Z" : "";
  }
};
const geminiCachedTimeRoot = element("nav", {}, [
  element("a", { href: "https://gemini.google.com/app/geminicachetime123" }, [textNode("缓存时间兜底")])
]);
browserGlobal.document = documentFrom(geminiCachedTimeRoot, "Cached Time - Gemini");
browserGlobal.location = { href: "https://gemini.google.com/app/geminicachetime123" };
const geminiCachedTimeItems = BatchHistory.collectConversationLinks(browserGlobal.document, "gemini");
assert.equal(geminiCachedTimeItems.length, 1);
assert.equal(geminiCachedTimeItems[0].conversationTime, "2026-04-16T10:00:00.000Z");
browserCore.TimestampCache = previousTimestampCache;

testNodeOrder = 0;
const geminiSearchLink = element("a", { href: "https://gemini.google.com/app/62c97c580942a142" }, [
  textNode("运动文胸标志镜像问题")
]);
const geminiSearchRoot = element("main", {}, [
  element("div", { role: "listitem" }, [
    element("div", {}, [geminiSearchLink]),
    element("span", { left: 900 }, [textNode("4月7日")])
  ])
]);
browserGlobal.document = documentFrom(geminiSearchRoot, "搜索 - Gemini");
browserGlobal.location = { href: "https://gemini.google.com/search?hl=zh-CN" };
const geminiSearchItems = BatchHistory.collectConversationLinks(browserGlobal.document, "gemini");
assert.equal(geminiSearchItems.length, 1);
assert.equal(geminiSearchItems[0].title, "运动文胸标志镜像问题");
assert.equal(geminiSearchItems[0].conversationTime, BatchHistory.firstMatchDate("4月7日").date);

testNodeOrder = 0;
const geminiSidebarSearchLinks = element("conversations-list", { "data-testid": "all-conversations" }, [
  element("a", { href: "https://gemini.google.com/app/searchresult123456" }, [
    element("div", { class: "conversation-title" }, [textNode("真实搜索结果日期")])
  ]),
  element("a", { href: "https://gemini.google.com/app/searchresult234567" }, [
    element("div", { class: "conversation-title" }, [textNode("第二条搜索结果")])
  ])
]);
const geminiModernSearchRoot = element("main", {}, [
  geminiSidebarSearchLinks,
  element("div", { role: "listbox", class: "recent-conversations-container" }, [
    element("div", { role: "option", class: "conversation-container" }, [
      element("div", { class: "left-content-container" }, [
        element("div", { class: "title" }, [textNode("真实搜索结果日期")])
      ]),
      element("div", { class: "right-content-container date" }, [textNode("4月15日")])
    ]),
    element("div", { role: "option", class: "conversation-container" }, [
      element("div", { class: "left-content-container" }, [
        element("div", { class: "title" }, [textNode("第二条搜索结果")])
      ]),
      element("div", { class: "right-content-container date" }, [textNode("4月14日")])
    ])
  ])
]);
browserGlobal.document = documentFrom(geminiModernSearchRoot, "搜索 - Gemini");
browserGlobal.location = { href: "https://gemini.google.com/search?hl=zh-CN" };
const geminiModernSearchItems = BatchHistory.collectConversationLinks(browserGlobal.document, "gemini");
assert.equal(geminiModernSearchItems.length, 2);
assert.equal(geminiModernSearchItems[0].url, "https://gemini.google.com/app/searchresult123456");
assert.equal(geminiModernSearchItems[0].conversationId, "searchresult123456");
assert.equal(geminiModernSearchItems[0].conversationTime, BatchHistory.firstMatchDate("4月15日").date);
assert.equal(geminiModernSearchItems[0].rawDateText, "4月15日");

testNodeOrder = 0;
const historyFallbackRoot = element("main", {}, [
  element("nav", {}, [
    element("li", {}, [
      element("a", { href: "https://gemini.google.com/app/52c97c580942a141" }, [textNode("洗车店距离问题")]),
      element("span", {}, [textNode("2026年4月10日")])
    ])
  ]),
  element("div", { class: "user" }, [textNode("DOM question")]),
  element("div", { class: "assistant" }, [textNode("DOM answer")])
]);
browserGlobal.document = documentFrom(historyFallbackRoot, "History Date - Gemini");
browserGlobal.location = { href: "https://gemini.google.com/app/52c97c580942a141?hl=zh-CN" };
const historyFallbackConversation = AdapterCommon.extractWithConfig({
  platformLabel: "Gemini",
  visibleHistoryConversationTimeOnly: true,
  disableMessageTimeExtraction: true,
  disableStructuredTimes: true,
  rootSelector: "main",
  titleSelectors: [],
  messageSelectors: [
    { role: "user", selectors: [".user"] },
    { role: "assistant", selectors: [".assistant"] }
  ],
  disableGenericExtraction: true
});
assert.equal(historyFallbackConversation.conversationTime, "2026-04-10");

browserCore.StructuredConversationCache.cacheConversation({
  platform: "Gemini",
  conversationId: "geminioldtime123",
  title: "Gemini old API time",
  conversationTime: "2025-11-15T09:09:37.522Z",
  messages: [
    { role: "user", content: "Old API question", time: "2025-11-15T09:09:37.522Z" },
    { role: "assistant", content: "Old API answer", time: "2025-11-15T09:09:38.000Z" }
  ]
});
testNodeOrder = 0;
const geminiOldTimeRoot = element("main", {}, [
  element("div", { class: "user" }, [textNode("Visible Gemini question")]),
  element("div", { class: "assistant" }, [textNode("Visible Gemini answer")])
]);
browserGlobal.document = documentFrom(geminiOldTimeRoot, "Gemini old time fallback - Gemini");
browserGlobal.location = { href: "https://gemini.google.com/app/geminioldtime123" };
const geminiOldTimeFallback = AdapterCommon.extractWithConfig({
  platformLabel: "Gemini",
  preferVisibleHistoryConversationTime: true,
  disableMessageTimeExtraction: true,
  allowMessageTimes: false,
  allowDocumentTime: false,
  allowScriptTime: false,
  rootSelector: "main",
  titleSelectors: [],
  messageSelectors: [
    { role: "user", selectors: [".user"] },
    { role: "assistant", selectors: [".assistant"] }
  ],
  disableGenericExtraction: true
});
assert.equal(geminiOldTimeFallback.conversationTime, "2025-11-15T09:09:37.522Z");
assert.equal(geminiOldTimeFallback.messages[0].time, "2025-11-15T09:09:37.522Z");
assert.equal(geminiOldTimeFallback.messages[1].time, "2025-11-15T09:09:38.000Z");

browserCore.StructuredConversationCache.cacheConversation({
  platform: "Claude",
  conversationId: "claude-structured-123",
  title: "Structured Claude",
  conversationTime: "2026-04-11T08:00:00.000Z",
  messages: [
    { role: "user", content: "API question", time: "2026-04-11T08:00:01.000Z" },
    { role: "assistant", content: "API answer", time: "2026-04-11T08:00:02.000Z" }
  ]
});
testNodeOrder = 0;
const structuredMergeRoot = element("main", {}, [
  element("div", { class: "user" }, [textNode("DOM question keeps richer page text")]),
  element("div", { class: "assistant" }, [textNode("DOM answer keeps richer page text")])
]);
browserGlobal.document = documentFrom(structuredMergeRoot, "Structured Claude - Claude");
browserGlobal.location = { href: "https://claude.ai/chat/claude-structured-123" };
const structuredMergedConversation = AdapterCommon.extractWithConfig({
  platformLabel: "Claude",
  rootSelector: "main",
  titleSelectors: [],
  messageSelectors: [
    { role: "user", selectors: [".user"] },
    { role: "assistant", selectors: [".assistant"] }
  ],
  disableGenericExtraction: true
});
assert.equal(structuredMergedConversation.conversationTime, "2026-04-11T08:00:00.000Z");
assert.equal(structuredMergedConversation.messages[0].content, "DOM question keeps richer page text");
assert.equal(structuredMergedConversation.messages[0].time, "2026-04-11T08:00:01.000Z");
assert.equal(structuredMergedConversation.messages[1].time, "2026-04-11T08:00:02.000Z");

const claudeInterceptorMessages = await collectInterceptorMessages(
  "https://claude.ai/api/organizations/org-123/chat_conversations/claude-api-123",
  {
    uuid: "claude-api-123",
    name: "API Claude",
    created_at: "2026-04-11T08:00:00.000Z",
    chat_messages: [
      {
        sender: "human",
        created_at: "2026-04-11T08:00:01.000Z",
        content: [{ type: "text", text: "Question from API" }]
      },
      {
        sender: "assistant",
        created_at: "2026-04-11T08:00:02.000Z",
        content: [{ type: "text", text: "Answer from API" }]
      }
    ]
  }
);
const claudeStructuredMessage = claudeInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(claudeStructuredMessage.conversation.platform, "Claude");
assert.equal(claudeStructuredMessage.conversation.conversationId, "claude-api-123");
assert.equal(claudeStructuredMessage.conversation.conversationTime, "2026-04-11T08:00:00.000Z");
assert.equal(claudeStructuredMessage.conversation.messages[0].time, "2026-04-11T08:00:01.000Z");

const claudeTextInterceptorMessages = await collectInterceptorMessages(
  "https://claude.ai/api/organizations/org-123/chat_conversations/claude-api-text-123",
  {
    uuid: "claude-api-text-123",
    name: "API Claude Text",
    created_at: "2026-04-12T08:00:00.000Z",
    chat_messages: [
      {
        sender: "human",
        created_at: "2026-04-12T08:00:01.000Z",
        content: [{ type: "text", text: "Question from plain text body" }]
      },
      {
        sender: "assistant",
        created_at: "2026-04-12T08:00:02.000Z",
        content: [{ type: "text", text: "Answer from plain text body" }]
      }
    ]
  },
  {
    contentType: "text/plain"
  }
);
const claudeTextStructuredMessage = claudeTextInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(claudeTextStructuredMessage.conversation.platform, "Claude");
assert.equal(claudeTextStructuredMessage.conversation.conversationId, "claude-api-text-123");
assert.equal(claudeTextStructuredMessage.conversation.conversationTime, "2026-04-12T08:00:00.000Z");
assert.equal(claudeTextStructuredMessage.conversation.messages[1].time, "2026-04-12T08:00:02.000Z");

const claudeApiFallback = await extractClaudeWithHarness();
assert.equal(
  claudeApiFallback.fetchCalls[0],
  "https://claude.ai/api/organizations/org-123/chat_conversations/claude-api-fallback-123?tree=True&rendering_mode=messages"
);
assert.equal(claudeApiFallback.result.conversationTime, "2026-04-12T06:38:27.489892Z");
assert.equal(claudeApiFallback.result.messages[0].time, "2026-04-12T06:38:27.822929Z");
assert.equal(claudeApiFallback.result.messages[1].time, "2026-04-12T06:38:51.802839Z");
assert.equal(claudeApiFallback.cached[0].conversationTime, "2026-04-12T06:38:27.489892Z");

const grokInterceptorMessages = await collectInterceptorMessages(
  "https://grok.com/rest/app-chat/conversations/grok-api-123456789/load-responses",
  {
    responses: [
      {
        responseId: "grok-response-user-1",
        sender: "human",
        createTime: "2026-04-12T09:00:01.000Z",
        message: "Grok question"
      },
      {
        responseId: "grok-response-assistant-1",
        sender: "assistant",
        createTime: "2026-04-12T09:00:02.000Z",
        message: "Grok answer"
      }
    ]
  }
);
const grokStructuredMessage = grokInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(grokStructuredMessage.conversation.platform, "Grok");
assert.equal(grokStructuredMessage.conversation.conversationId, "grok-api-123456789");
assert.equal(grokStructuredMessage.conversation.conversationTime, "2026-04-12T09:00:01.000Z");
assert.equal(grokStructuredMessage.conversation.messages[0].time, "2026-04-12T09:00:01.000Z");

const grokUpdatedOnlyMessages = await collectInterceptorMessages(
  "https://grok.com/rest/app-chat/conversations",
  {
    conversations: [
      {
        conversationId: "grok-updated-only-123456789",
        title: "Updated only should not be chat time",
        updatedAt: "2026-04-20T08:00:00.000Z"
      }
    ]
  }
);
assert.equal(
  grokUpdatedOnlyMessages.some((message) => message.type === "AI_CHAT_EXPORTER_TIMESTAMP"),
  false
);

testNodeOrder = 0;
const grokApiFallbackRoot = element("main", {}, [
  element("div", { class: "message-bubble self-end" }, [textNode("Grok DOM question")]),
  element("div", { class: "message-bubble" }, [
    element("div", { class: "response-content-markdown markdown" }, [
      element("p", {}, [textNode("Grok DOM answer")])
    ])
  ])
]);
const grokFetchCalls = [];
browserGlobal.document = documentFrom(grokApiFallbackRoot, "Grok API fallback - Grok");
browserGlobal.location = { href: "https://grok.com/c/grok-adapter-123456789" };
browserGlobal.fetch = (url, init = {}) => {
  grokFetchCalls.push({ url, init });
  if (String(url) === "/rest/app-chat/conversations") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        conversations: [
          {
            conversationId: "grok-adapter-123456789",
            title: "Grok API fallback",
            updatedAt: "2026-04-20T08:00:00.000Z"
          }
        ]
      })
    });
  }

  if (String(url).includes("/response-node")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        responseNodes: [
          { responseId: "grok-adapter-user-1" },
          { responseId: "grok-adapter-assistant-1" }
        ]
      })
    });
  }

  if (String(url).includes("/load-responses")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        responses: [
          {
            responseId: "grok-adapter-user-1",
            sender: "human",
            createTime: "2026-04-12T09:30:01.000Z",
            message: "Grok API question"
          },
          {
            responseId: "grok-adapter-assistant-1",
            sender: "assistant",
            createTime: "2026-04-12T09:30:02.000Z",
            message: "Grok API answer"
          }
        ]
      })
    });
  }

  return Promise.resolve({ ok: false });
};
const grokApiFallbackConversation = await browserCore.GrokAdapter.extract();
assert.equal(grokApiFallbackConversation.conversationTime, "2026-04-12T09:30:01.000Z");
assert.equal(grokApiFallbackConversation.messages[0].time, "2026-04-12T09:30:01.000Z");
assert.equal(grokApiFallbackConversation.messages[1].time, "2026-04-12T09:30:02.000Z");
assert.ok(grokFetchCalls.some((call) => String(call.url).includes("/response-node")));
assert.ok(grokFetchCalls.some((call) => call.init.method === "POST" && String(call.url).includes("/load-responses")));
delete browserGlobal.fetch;

const deepSeekInterceptorMessages = await collectInterceptorMessages(
  "https://chat.deepseek.com/api/v0/chat_session/fetch",
  {
    conversation_id: "deepseek-api-123456789",
    title: "DeepSeek API",
    created_at: "2026-04-13T07:00:00.000Z",
    messages: [
      {
        role: "user",
        created_at: "2026-04-13T07:00:01.000Z",
        content: "DeepSeek question"
      },
      {
        role: "assistant",
        created_at: "2026-04-13T07:00:02.000Z",
        content: [
          { type: "reasoning", text: "DeepSeek hidden chain of thought" },
          { type: "text", text: "DeepSeek answer" }
        ]
      }
    ]
  }
);
const deepSeekStructuredMessage = deepSeekInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(deepSeekStructuredMessage.conversation.platform, "DeepSeek");
assert.equal(deepSeekStructuredMessage.conversation.conversationId, "deepseek-api-123456789");
assert.equal(deepSeekStructuredMessage.conversation.conversationTime, "2026-04-13T07:00:00.000Z");
assert.equal(deepSeekStructuredMessage.conversation.messages[1].time, "2026-04-13T07:00:02.000Z");
assert.equal(deepSeekStructuredMessage.conversation.messages[1].content, "DeepSeek answer");
assert.doesNotMatch(deepSeekStructuredMessage.conversation.messages[1].content, /hidden chain of thought/);

const deepSeekHistoryMessages = await collectInterceptorMessages(
  "https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=deepseek-history-123456789",
  {
    data: {
      biz_data: {
        chat_session: {
          id: "deepseek-history-123456789",
          title: "DeepSeek current API",
          updated_at: 1776999999
        },
        chat_messages: [
          {
            message_id: "deepseek-history-user-1",
            role: "USER",
            inserted_at: 1776064201,
            content: "DeepSeek history question"
          },
          {
            message_id: "deepseek-history-assistant-1",
            role: "ASSISTANT",
            inserted_at: 1776064202,
            fragments: [
              { type: "reasoning", text: "DeepSeek history hidden thinking" },
              { type: "TEXT", text: "DeepSeek history answer" }
            ]
          }
        ]
      }
    }
  }
);
const deepSeekHistoryStructured = deepSeekHistoryMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(deepSeekHistoryStructured.conversation.platform, "DeepSeek");
assert.equal(deepSeekHistoryStructured.conversation.conversationId, "deepseek-history-123456789");
assert.equal(deepSeekHistoryStructured.conversation.conversationTime, "2026-04-13T07:10:01.000Z");
assert.equal(deepSeekHistoryStructured.conversation.messages[0].time, "2026-04-13T07:10:01.000Z");
assert.equal(deepSeekHistoryStructured.conversation.messages[1].content, "DeepSeek history answer");
assert.doesNotMatch(deepSeekHistoryStructured.conversation.conversationTime, /2026-04-24/);
assert.doesNotMatch(deepSeekHistoryStructured.conversation.messages[1].content, /hidden thinking/);

const doubaoInterceptorMessages = await collectInterceptorMessages(
  "https://www.doubao.com/samantha/chat/conversation",
  {
    conversationId: "doubao-api-123456789",
    chatTitle: "Doubao API",
    createTime: "2026-04-14T08:00:00.000Z",
    data: {
      messages: [
        {
          sender: "user",
          createTime: "2026-04-14T08:00:01.000Z",
          text: "Doubao question"
        },
        {
          sender: "assistant",
          createTime: "2026-04-14T08:00:02.000Z",
          text: "Doubao answer"
        }
      ]
    }
  }
);
const doubaoStructuredMessage = doubaoInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(doubaoStructuredMessage.conversation.platform, "Doubao");
assert.equal(doubaoStructuredMessage.conversation.conversationId, "doubao-api-123456789");
assert.equal(doubaoStructuredMessage.conversation.conversationTime, "2026-04-14T08:00:01.000Z");
assert.equal(doubaoStructuredMessage.conversation.messages[0].time, "2026-04-14T08:00:01.000Z");

const doubaoImChainMessages = await collectInterceptorMessages(
  "https://www.doubao.com/im/chain/single",
  {
    cmd: 3100,
    downlink_body: {
      pull_singe_chain_downlink_body: {
        messages: [
          {
            conversation_id: "38413899923457538",
            message_id: "doubao-im-user-1",
            user_type: 1,
            create_time: 1776154201,
            content: JSON.stringify({ text: "Doubao IM question" })
          },
          {
            conversation_id: "38413899923457538",
            message_id: "doubao-im-assistant-1",
            user_type: 2,
            create_time: 1776154202,
            content: "",
            content_block: [
              {
                block_type: 10000,
                content: {
                  text_block: {
                    text: "Doubao IM answer"
                  }
                }
              }
            ]
          }
        ]
      }
    }
  }
);
const doubaoImStructured = doubaoImChainMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(doubaoImStructured.conversation.platform, "Doubao");
assert.equal(doubaoImStructured.conversation.conversationId, "38413899923457538");
assert.equal(doubaoImStructured.conversation.conversationTime, "2026-04-14T08:10:01.000Z");
assert.equal(doubaoImStructured.conversation.messages[1].content, "Doubao IM answer");

const doubaoServerTimeOnlyMessages = await collectInterceptorMessages(
  "https://www.doubao.com/samantha/chat/conversation",
  {
    conversationId: "doubao-server-time-123456789",
    chatTitle: "Doubao server time is not chat time",
    createTime: "2025-12-24T01:28:59.000Z",
    data: {
      messages: [
        { sender: "user", text: "Question without message time" },
        { sender: "assistant", text: "Answer without message time" }
      ]
    }
  }
);
assert.equal(
  doubaoServerTimeOnlyMessages.some((message) => message.type === "AI_CHAT_EXPORTER_TIMESTAMP"),
  false
);
const doubaoServerTimeStructured = doubaoServerTimeOnlyMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(doubaoServerTimeStructured.conversation.conversationTime, "");

browserCore.TimestampCache = {
  getTimestamp(conversationId) {
    return {
      "deepseek-time-123456789": "2026-04-15T09:00:00.000Z",
      "doubao-time-123456789": "2025-12-24T01:28:59.000Z"
    }[conversationId] || "";
  },
  getCacheEntry() {
    return null;
  }
};
browserCore.StructuredConversationCache.cacheConversation({
  platform: "Doubao",
  conversationId: "doubao-time-123456789",
  title: "Doubao structured time",
  conversationTime: "2026-04-15T10:00:00.000Z",
  messages: [
    { role: "user", content: "Doubao DOM question", time: "2026-04-15T10:00:00.000Z" },
    { role: "assistant", content: "Doubao DOM answer", time: "2026-04-15T10:00:01.000Z" }
  ]
});

testNodeOrder = 0;
const deepSeekDomRoot = element("main", {}, [
  element("div", { class: "ds-virtual-list-visible-items" }, [
    element("div", { "data-virtual-list-item-key": "1" }, [
      element("div", { class: "user-message" }, [textNode("DeepSeek DOM question")])
    ]),
    element("div", { "data-virtual-list-item-key": "2" }, [
      element("div", { class: "ds-message" }, [
        element("div", { class: "ds-think-content" }, [
          element("p", {}, [textNode("DeepSeek DOM hidden thinking")])
        ]),
        element("div", { class: "ds-markdown" }, [
          element("p", {}, [textNode("DeepSeek DOM final answer")])
        ])
      ])
    ])
  ])
]);
browserGlobal.document = documentFrom(deepSeekDomRoot, "DeepSeek DOM - DeepSeek");
browserGlobal.location = { href: "https://chat.deepseek.com/a/chat/s/deepseek-time-123456789" };
const deepSeekDomConversation = await browserCore.DeepSeekAdapter.extract();
const deepSeekDomMarkdown = Markdown.buildMarkdown(deepSeekDomConversation);
assert.equal(deepSeekDomConversation.conversationTime, "2026-04-15T09:00:00.000Z");
assert.equal(deepSeekDomConversation.messages[1].content, "DeepSeek DOM final answer");
assert.doesNotMatch(deepSeekDomMarkdown, /hidden thinking/);

testNodeOrder = 0;
const deepSeekFallbackRoot = element("main", {}, [
  element("div", { class: "ds-virtual-list-visible-items" }, [
    element("div", { "data-virtual-list-item-key": "1" }, [
      element("div", { class: "user-message" }, [textNode("Fallback DOM question")])
    ]),
    element("div", { "data-virtual-list-item-key": "2" }, [
      element("div", { class: "ds-message" }, [
        element("div", { class: "ds-markdown" }, [
          element("p", {}, [textNode("Fallback DOM answer")])
        ])
      ])
    ])
  ])
]);
const deepSeekFetchCalls = [];
browserGlobal.document = documentFrom(deepSeekFallbackRoot, "DeepSeek API fallback - DeepSeek");
browserGlobal.location = { href: "https://chat.deepseek.com/a/chat/s/deepseek-fallback-123456789" };
browserGlobal.performance = {
  getEntriesByType(type) {
    return type === "resource"
      ? [{ name: "https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=deepseek-fallback-123456789" }]
      : [];
  }
};
browserGlobal.localStorage = {
  getItem(key) {
    return key === "userToken" ? JSON.stringify({ value: "deepseek-test-token" }) : null;
  }
};
browserGlobal.fetch = (url, init = {}) => {
  deepSeekFetchCalls.push({ url, init });
  if (init.method || !String(url || "").includes("deepseek-fallback-123456789")) {
    return Promise.resolve({ ok: false });
  }

  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      data: {
        biz_data: {
          chat_session: {
            id: "deepseek-fallback-123456789",
            title: "DeepSeek API fallback",
            updated_at: 1776250803
          },
          chat_messages: [
            { message_id: "fallback-user-1", role: "USER", inserted_at: 1776250801, content: "Fallback API question" },
            { message_id: "fallback-assistant-1", role: "ASSISTANT", inserted_at: 1776250802, fragments: [{ type: "TEXT", text: "Fallback API answer" }] }
          ]
        }
      }
    })
  });
};
browserCore.TimestampCache = {
  getTimestamp() {
    return "";
  },
  getCacheEntry() {
    return null;
  }
};
const deepSeekFallbackConversation = await browserCore.DeepSeekAdapter.extract();
assert.equal(deepSeekFallbackConversation.conversationTime, "2026-04-15T11:00:01.000Z");
assert.equal(deepSeekFallbackConversation.messages[0].time, "2026-04-15T11:00:01.000Z");
assert.ok(deepSeekFetchCalls.some((call) => !call.init.method && String(call.url).includes("/api/v0/chat/history_messages")));
assert.ok(!deepSeekFetchCalls.some((call) => call.init && call.init.method === "POST" && String(call.url).includes("/api/v0/chat/history_messages")));
assert.ok(deepSeekFetchCalls.some((call) => call.init.headers && call.init.headers.Authorization === "Bearer deepseek-test-token"));
delete browserGlobal.fetch;
delete browserGlobal.performance;
delete browserGlobal.localStorage;

testNodeOrder = 0;
const doubaoDomRoot = element("main", {}, [
  element("div", { class: "inter-H_fm37" }, [
    element("div", { class: "container-user" }, [textNode("Doubao DOM question")]),
    element("div", { class: "container-assistant" }, [
      element("div", { class: "flow-markdown-body" }, [
        element("p", {}, [textNode("Doubao DOM answer")])
      ])
    ])
  ])
]);
browserGlobal.document = documentFrom(doubaoDomRoot, "Doubao DOM - Doubao");
browserGlobal.location = { href: "https://www.doubao.com/chat/doubao-time-123456789" };
const doubaoDomConversation = await browserCore.DoubaoAdapter.extract();
assert.equal(doubaoDomConversation.conversationTime, "2026-04-15T10:00:00.000Z");

testNodeOrder = 0;
const doubaoFallbackRoot = element("main", {}, [
  element("div", { class: "inter-H_fm37" }, [
    element("div", { class: "container-user" }, [textNode("Doubao fallback DOM question")]),
    element("div", { class: "container-assistant" }, [
      element("div", { class: "flow-markdown-body" }, [
        element("p", {}, [textNode("Doubao fallback DOM answer")])
      ])
    ])
  ])
]);
const doubaoFetchCalls = [];
browserGlobal.document = documentFrom(doubaoFallbackRoot, "Doubao API fallback - Doubao");
browserGlobal.location = { href: "https://www.doubao.com/chat/38421122577992706" };
browserGlobal.performance = {
  getEntriesByType(type) {
    return type === "resource"
      ? [{ name: "https://www.doubao.com/im/chain/recent_conv?version_code=20800&language=zh" }]
      : [];
  }
};
browserGlobal.fetch = (url, init = {}) => {
  doubaoFetchCalls.push({ url, init });
  if (init.method !== "POST" || !String(url || "").includes("/im/chain/recent_conv")) {
    return Promise.resolve({ ok: false });
  }

  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      cmd: 3200,
      status_code: 0,
      downlink_body: {
        pull_recent_conv_chain_downlink_body: {
          cells: [
            {
              conversation: {
                conversation_id: "38421122577992706",
                name: "Doubao API fallback",
                messages: [
                  {
                    conversation_id: "38421122577992706",
                    message_id: "doubao-fallback-user-1",
                    user_type: 1,
                    create_time: "1776347817",
                    content: JSON.stringify({ text: "Doubao API fallback question" })
                  },
                  {
                    conversation_id: "38421122577992706",
                    message_id: "doubao-fallback-assistant-1",
                    user_type: 2,
                    create_time: "1776347820",
                    content: "",
                    content_block: [
                      {
                        content: {
                          text_block: {
                            text: "Doubao API fallback answer"
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      }
    })
  });
};
const doubaoFallbackConversation = await browserCore.DoubaoAdapter.extract();
assert.equal(doubaoFallbackConversation.conversationTime, "2026-04-16T13:56:57.000Z");
assert.equal(doubaoFallbackConversation.messages[0].time, "2026-04-16T13:56:57.000Z");
assert.equal(doubaoFallbackConversation.messages[1].content, "Doubao fallback DOM answer");
assert.ok(doubaoFetchCalls.some((call) => call.init.method === "POST" && call.init.body && call.init.body.includes("\"cmd\":3200")));
delete browserGlobal.fetch;
delete browserGlobal.performance;

const geminiJsonInterceptorMessages = await collectInterceptorMessages(
  "https://gemini.google.com/_/BardChatUi/data/batchexecute",
  [
    "af8945075c126cfc",
    [1763197777522]
  ]
);
const geminiTimestampMessage = geminiJsonInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_TIMESTAMP");
assert.equal(geminiTimestampMessage.conversationId, "af8945075c126cfc");
assert.equal(geminiTimestampMessage.timestamp, "2025-11-15T09:09:37.522Z");

const geminiConversationRpc = [
  [
    [
      [
        ["c_abc123456789", "r_latest"],
        ["c_abc123456789", "r_prev", "rc_prev"],
        [["Second question"], 1, null, 1, "model", 0, null, null, false],
        [[["rc_second", ["Second answer"]]]],
        [1763197877, 500000000]
      ],
      [
        ["c_abc123456789", "r_prev"],
        null,
        [["First question"], 1, null, 1, "model", 0, null, null, false],
        [[["rc_first", ["First answer"]]]],
        [1763197777, 522000000]
      ]
    ],
    null,
    null,
    []
  ]
];
const geminiTextInterceptorMessages = await collectInterceptorMessages(
  "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb",
  [],
  {
    contentType: "text/plain",
    textPayload: `)]}'\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify(geminiConversationRpc), null, null]])}`
  }
);
const geminiStructuredMessage = geminiTextInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_STRUCTURED_CONVERSATION");
assert.equal(geminiStructuredMessage.conversation.platform, "Gemini");
assert.equal(geminiStructuredMessage.conversation.conversationId, "abc123456789");
assert.equal(geminiStructuredMessage.conversation.conversationTime, "2025-11-15T09:09:37.522Z");
assert.deepEqual(
  Array.from(geminiStructuredMessage.conversation.messages, (message) => `${message.role}:${message.content}:${message.time}`),
  [
    "user:First question:2025-11-15T09:09:37.522Z",
    "assistant:First answer:2025-11-15T09:09:37.522Z",
    "user:Second question:2025-11-15T09:11:17.500Z",
    "assistant:Second answer:2025-11-15T09:11:17.500Z"
  ]
);
const geminiDebugMessage = geminiTextInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_GEMINI_DEBUG");
const geminiDebugEvidence = geminiDebugMessage.evidence.ids.find((item) => item.conversationId === "abc123456789");
assert.equal(geminiDebugMessage.evidence.platform, "Gemini");
assert.equal(geminiDebugMessage.evidence.rpcid, "hNvQHb");
assert.ok(geminiDebugEvidence.hitCount >= 1);
assert.ok(geminiDebugEvidence.timestampCandidates.some((candidate) => candidate.timestamp === "2025-11-15T09:09:37.522Z"));

const geminiHistoryRpc = [
  null,
  "token",
  [
    ["c_abc123456789", "Gemini title", null, null, null, [1763197777, 522000000], null, null, null, 1]
  ]
];
const geminiHistoryInterceptorMessages = await collectInterceptorMessages(
  "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc",
  [],
  {
    contentType: "text/plain",
    textPayload: `)]}'\n${JSON.stringify([["wrb.fr", "MaZiqc", JSON.stringify(geminiHistoryRpc), null, null]])}`
  }
);
const geminiHistoryTimestampMessage = geminiHistoryInterceptorMessages.find((message) => message.type === "AI_CHAT_EXPORTER_TIMESTAMP");
assert.equal(geminiHistoryTimestampMessage.conversationId, "abc123456789");
assert.equal(geminiHistoryTimestampMessage.timestamp, "2025-11-15T09:09:37.522Z");
assert.equal(geminiHistoryTimestampMessage.title, "Gemini title");

const chatgptConversation = browserCore.ChatGPTAdapter.parseConversation({
  id: "chatgpt123456789",
  title: "3D打印自行车可行性",
  create_time: 1763197777.522,
  update_time: 1763197863.317,
  current_node: "assistant-1",
  mapping: {
    root: {
      id: "root",
      parent: undefined,
      children: ["user-1"]
    },
    "user-1": {
      id: "user-1",
      parent: "root",
      children: ["assistant-1"],
      message: {
        author: { role: "user" },
        recipient: "all",
        create_time: 1763197777.522,
        content: {
          content_type: "text",
          parts: ["我想用3d打印再加上后期组装来制作一辆自行车，可行吗"]
        }
      }
    },
    "assistant-1": {
      id: "assistant-1",
      parent: "user-1",
      children: [],
      message: {
        author: { role: "assistant" },
        recipient: "all",
        create_time: 1763197778.974,
        content: {
          content_type: "text",
          parts: ["从技术上讲，**3D打印 + 后期组装制作一辆自行车**是可行的。"]
        }
      }
    }
  }
}, "https://chatgpt.com/c/chatgpt123456789");
const chatgptMarkdown = Markdown.buildMarkdown(chatgptConversation);
const chatgptFilename = Markdown.buildFilename(chatgptConversation);
assert.equal(chatgptConversation.platform, "ChatGPT");
assert.equal(chatgptConversation.conversationId, "chatgpt123456789");
assert.equal(chatgptConversation.conversationTime, "2025-11-15T09:09:37.522Z");
assert.equal(chatgptConversation.messages[0].time, "2025-11-15T09:09:37.522Z");
assert.match(chatgptMarkdown, /platform: "ChatGPT"/);
assert.match(chatgptMarkdown, /conversation_time: "2025-11-15T09:09:37\.522Z"/);
assert.match(chatgptMarkdown, /_Time: 2025-11-15T09:09:37\.522Z_/);
assert.equal(chatgptFilename, "2025-11-15_ChatGPT_3D打印自行车可行性.md");

const genericGeminiConversation = {
  platform: "Gemini",
  sourceUrl: "https://gemini.google.com/app/geminigenerictitle123",
  title: "与 Gemini 对话",
  conversationId: "geminigenerictitle123",
  conversationTime: "2026-03-19T08:00:00.000Z",
  messages: [
    { role: "user", content: "环路积分符号怎么理解？" },
    { role: "assistant", content: "它表示沿封闭路径积分。" }
  ]
};
const genericGeminiMarkdown = Markdown.buildMarkdown(genericGeminiConversation);
assert.equal(Markdown.buildFilename(genericGeminiConversation), "2026-03-19_Gemini_环路积分符号怎么理解.md");
assert.match(genericGeminiMarkdown, /^# 环路积分符号怎么理解？/m);
assert.doesNotMatch(genericGeminiMarkdown, /conversation_title: "与 Gemini 对话"/);

for (const conversation of conversations) {
  const body = Markdown.buildMarkdown(conversation);
  const filename = Markdown.buildFilename(conversation);

  assert.match(body, new RegExp(`platform: "${conversation.platform}"`));
  assert.match(body, /source_url: "/);
  assert.match(body, /conversation_title: "/);
  assert.match(body, /## Metadata/);
  assert.match(body, /## Message 1 - User/);
  assert.match(body, /## Message 1 - Assistant/);
  assert.doesNotMatch(body, /exported_at/i);
  assert.doesNotMatch(body, /export_time/i);
  assert.match(filename, /\.md$/);
  assert.doesNotMatch(filename, /[\\/:*?"<>|]/);

  if (conversation.conversationTime) {
    assert.match(body, /conversation_time: "/);
    assert.match(filename, /^\d{4}-\d{2}-\d{2}_/);
  } else {
    assert.doesNotMatch(body, /conversation_time:/);
    assert.doesNotMatch(filename, /^\d{4}-\d{2}-\d{2}_/);
  }
}

const noTimeMarkdown = Markdown.buildMarkdown({
  platform: "Claude",
  sourceUrl: "https://claude.ai/chat/no-time",
  title: "No visible time",
  messages: [
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer" }
  ]
});

assert.doesNotMatch(noTimeMarkdown, /conversation_time:/);
assert.doesNotMatch(noTimeMarkdown, /exported_at/i);

const twoTurnMarkdown = Markdown.buildMarkdown({
  platform: "Claude",
  sourceUrl: "https://claude.ai/chat/two-turns",
  title: "Two turns",
  messages: [
    { role: "user", content: "Question one" },
    { role: "assistant", content: "Answer one" },
    { role: "user", content: "Question two" },
    { role: "assistant", content: "Answer two" }
  ]
});
assert.match(twoTurnMarkdown, /## Message 1 - User/);
assert.match(twoTurnMarkdown, /## Message 1 - Assistant/);
assert.match(twoTurnMarkdown, /## Message 2 - User/);
assert.match(twoTurnMarkdown, /## Message 2 - Assistant/);
assert.doesNotMatch(twoTurnMarkdown, /## Message 3 -/);

const mergedClaudeFragments = AdapterCommon.mergeAdjacentSameRoleMessages([
  { role: "user", content: "python -m venv .venv 是在安装什么？" },
  { role: "assistant", content: "这是在设置一个 Python 虚拟环境。" },
  { role: "assistant", content: "虚拟环境部分：" },
  { role: "assistant", content: "```bash\npython -m venv .venv\nsource .venv/bin/activate\n```" },
  { role: "assistant", content: "虚拟环境的作用是让不同项目互不干扰。" },
  { role: "user", content: "逐行解释一下 build_chunks_from_lines。" },
  { role: "assistant", content: "`build_chunks_from_lines`" },
  { role: "assistant", content: "函数定义和参数：" }
]);
assert.equal(mergedClaudeFragments.length, 4);
assert.equal(mergedClaudeFragments[1].role, "assistant");
assert.match(mergedClaudeFragments[1].content, /虚拟环境部分/);
assert.match(mergedClaudeFragments[1].markdown, /```bash\npython -m venv \.venv\nsource \.venv\/bin\/activate\n```/);
assert.match(mergedClaudeFragments[1].content, /互不干扰/);

const codeBlock = element("pre", {}, [
  element("code", { class: "language-python" }, [textNode("print('hello')\nprint('world')")])
]);
assert.equal(Markdown.htmlToMarkdown(codeBlock), "```python\nprint('hello')\nprint('world')\n```");

const userMessageWithCode = element("div", { "data-testid": "user-message" }, [
  element("pre", {}, [
    element("code", { class: "language-python" }, [textNode("print('first')\nprint('second')")])
  ]),
  element("p", {}, [textNode("再逐行解释一下这段")])
]);
assert.equal(
  Markdown.htmlToMarkdown(userMessageWithCode),
  "```python\nprint('first')\nprint('second')\n```\n\n再逐行解释一下这段"
);

const assistantWithList = element("div", { class: "prose" }, [
  element("p", {}, [textNode("安装的库：")]),
  element("ul", {}, [
    element("li", {}, [textNode("sentence-transformers - 用于将文本转换成数字向量")]),
    element("li", {}, [textNode("faiss-cpu - 向量搜索库")])
  ])
]);
const assistantListMarkdown = Markdown.htmlToMarkdown(assistantWithList);
assert.match(assistantListMarkdown, /安装的库：/);
assert.match(assistantListMarkdown, /- sentence-transformers - 用于将文本转换成数字向量/);
assert.match(assistantListMarkdown, /- faiss-cpu - 向量搜索库/);

const grokMessageWithShortAndRichContent = element("div", { class: "assistant-message" }, [
  element("div", { class: "message-content" }, [
    element("p", {}, [textNode("初始化：m = 33, n = 66")]),
    element("p", {}, [textNode("输出：0")])
  ]),
  element("div", { class: "prose markdown" }, [
    element("h3", {}, [textNode("题18分析")]),
    element("p", {}, [textNode("程序段如下（根据图片转写，假设是C语言代码）：")]),
    element("pre", {}, [
      element("code", { class: "language-c" }, [textNode("int m = 33, n = 66;\nif (m < n) {\n    m = n - m;\n}")])
    ]),
    element("p", {}, [textNode("执行步骤：")]),
    element("ol", {}, [
      element("li", {}, [textNode("初始化：m = 33, n = 66")]),
      element("li", {}, [textNode("判断 m < n (33 < 66) 为真，进入if")])
    ]),
    element("p", {}, [textNode("所以，执行后输出结果是 0。")])
  ])
]);
const bestGrokContent = AdapterCommon.pickContentElement(grokMessageWithShortAndRichContent, [".message-content", ".prose", ".markdown"]);
assert.match(Markdown.htmlToMarkdown(bestGrokContent), /### 题18分析/);
assert.match(Markdown.htmlToMarkdown(bestGrokContent), /判断 m < n \(33 < 66\) 为真/);

const withoutGrokUserEcho = AdapterCommon.dropAssistantEchoesOfUser([
  { role: "user", content: "解一下" },
  { role: "assistant", content: "解一下" },
  { role: "assistant", content: "### 题18分析\n\n程序段如下" }
], { dropAssistantEchoesOfUser: true });
assert.deepEqual(
  withoutGrokUserEcho.map((message) => `${message.role}:${message.content}`),
  ["user:解一下", "assistant:### 题18分析\n\n程序段如下"]
);

const claudeLikeCodeBlock = element("div", {}, [
  element("button", {}, [textNode("Copy to clipboard")]),
  element("div", {}, [textNode("python")]),
  element("pre", {}, [
    element("code", {}, [textNode("s = \"  hello world  \"\nprint(s.strip())")])
  ])
]);
assert.equal(
  Markdown.htmlToMarkdown(claudeLikeCodeBlock),
  "```python\ns = \"  hello world  \"\nprint(s.strip())\n```"
);

const geminiLikeRichMarkdown = element("div", {}, [
  element("p", {}, [
    textNode("简单直接的回答是："),
    element("strong", {}, [textNode("C 语言支持递归调用，但不支持嵌套定义。")])
  ]),
  element("hr", {}, []),
  element("blockquote", {}, [
    element("p", {}, [
      element("strong", {}, [textNode("注意：")]),
      textNode(" 这不是标准 C。")
    ])
  ]),
  element("table", {}, [
    element("tr", {}, [
      element("th", {}, [textNode("特性")]),
      element("th", {}, [textNode("是否支持")])
    ]),
    element("tr", {}, [
      element("td", {}, [element("strong", {}, [textNode("递归调用")])]),
      element("td", {}, [element("strong", {}, [textNode("支持")])])
    ])
  ]),
  element("button", {}, [textNode("复制表格")])
]);
const geminiRichMarkdown = Markdown.htmlToMarkdown(geminiLikeRichMarkdown);
assert.match(geminiRichMarkdown, /\*\*C 语言支持递归调用，但不支持嵌套定义。\*\*/);
assert.match(geminiRichMarkdown, /-----/);
assert.match(geminiRichMarkdown, /> \*\*注意：\*\* 这不是标准 C。/);
assert.match(geminiRichMarkdown, /\| :--- \| :--- \|/);
assert.match(geminiRichMarkdown, /\| \*\*递归调用\*\* \| \*\*支持\*\* \|/);
assert.doesNotMatch(geminiRichMarkdown, /复制表格/);

const grokAssistantContainer = element("div", { class: "prose markdown" }, [
  element("h3", {}, [textNode("题18分析")]),
  element("p", {}, [textNode("程序段如下（根据图片转写，假设是C语言代码）：")]),
  element("pre", {}, [
    element("code", { class: "language-c" }, [textNode("int m = 33, n = 66;\nprintf(\"%d\", m);")])
  ]),
  element("p", {}, [textNode("执行步骤：")]),
  element("ol", {}, [
    element("li", {}, [textNode("初始化：m = 33, n = 66")]),
    element("li", {}, [textNode("判断 m < n 为真，进入if")])
  ]),
  element("p", {}, [textNode("选项（根据图片转写）：")]),
  element("ul", {}, [
    element("li", {}, [textNode("A. m=66, n=33")]),
    element("li", {}, [textNode("B. m=33, n=33")])
  ])
]);
const grokAssistantMarkdown = Markdown.htmlToMarkdown(grokAssistantContainer);
assert.match(grokAssistantMarkdown, /### 题18分析/);
assert.match(grokAssistantMarkdown, /程序段如下/);
assert.match(grokAssistantMarkdown, /```c\nint m = 33, n = 66;\nprintf\("%d", m\);\n```/);
assert.match(grokAssistantMarkdown, /1\. 初始化：m = 33, n = 66/);
assert.match(grokAssistantMarkdown, /2\. 判断 m < n 为真，进入if/);
assert.match(grokAssistantMarkdown, /- A\. m=66, n=33/);
assert.match(grokAssistantMarkdown, /- B\. m=33, n=33/);

const grokAssistantConfig = grokConfig.messageSelectors.find((definition) => definition.role === "assistant");
assert.equal(grokConfig.mergeAdjacentSameRole, true);
assert.ok(grokAssistantConfig.selectors.includes("pre"));
assert.ok(grokAssistantConfig.selectors.includes("ol"));
assert.ok(grokAssistantConfig.expandClosestSelectors.includes(".prose"));
assert.ok(grokAssistantConfig.expandClosestSelectors.includes("[class*='markdown']"));
assert.ok(grokConfig.fallbackMessageSelectors.includes("pre code"));
assert.ok(grokConfig.fallbackMessageSelectors.includes("li"));
assert.ok(grokConfig.fallbackExpandClosestSelectors.includes(".response-content-markdown"));
assert.ok(grokConfig.fallbackExpandClosestSelectors.includes("[class*='markdown']"));

testNodeOrder = 0;
const grokFallbackRichRoot = element("main", {}, [
  element("div", { class: "message-bubble self-end" }, [textNode("解一下")]),
  element("div", { class: "message-bubble" }, [
    element("div", { class: "response-content-markdown markdown" }, [
      element("h3", {}, [textNode("题18分析")]),
      element("p", {}, [textNode("程序段如下（根据图片转写，假设是C语言代码）：")]),
      element("pre", {}, [
        element("code", { class: "language-c" }, [
          textNode("int m = 33, n = 66;\nif (m < n) {\n    m = n - m;\n    n = m;\n}\nprintf(\"%d\", m);")
        ])
      ]),
      element("p", {}, [textNode("执行步骤：")]),
      element("ol", {}, [
        element("li", {}, [textNode("初始化：m = 33, n = 66")]),
        element("li", {}, [textNode("判断 m < n (33 < 66) 为真，进入if")])
      ])
    ])
  ])
]);
browserGlobal.document = documentFrom(grokFallbackRichRoot);
browserGlobal.location = { href: "https://grok.com/c/fallback-rich" };
browserGlobal.innerWidth = 1200;

const grokFallbackRichConversation = AdapterCommon.extractWithConfig({
  platformLabel: "Grok",
  rootSelector: "main",
  titleSelectors: [],
  messageSelectors: [],
  disableGenericExtraction: true,
  fallbackMessageSelectors: [".message-bubble", ".response-content-markdown", "pre", "ol", "li"],
  fallbackExpandClosestSelectors: [".response-content-markdown"],
  alternatingFallbackRoles: false,
  mergeAdjacentSameRole: true,
  dropAssistantEchoesOfUser: true
});
assert.equal(grokFallbackRichConversation.messages.length, 2);
assert.equal(grokFallbackRichConversation.messages[0].role, "user");
assert.equal(grokFallbackRichConversation.messages[0].content, "解一下");
assert.equal(grokFallbackRichConversation.messages[1].role, "assistant");
assert.match(grokFallbackRichConversation.messages[1].markdown, /### 题18分析/);
assert.match(grokFallbackRichConversation.messages[1].markdown, /程序段如下/);
assert.match(grokFallbackRichConversation.messages[1].markdown, /```c\nint m = 33, n = 66;\nif \(m < n\) \{\n    m = n - m;\n    n = m;\n\}\nprintf\("%d", m\);\n```/);
assert.match(grokFallbackRichConversation.messages[1].markdown, /1\. 初始化：m = 33, n = 66/);
assert.match(grokFallbackRichConversation.messages[1].markdown, /2\. 判断 m < n \(33 < 66\) 为真，进入if/);

const katexLike = element("p", {}, [
  textNode("符号 "),
  element("span", { class: "katex" }, [
    element("annotation", { encoding: "application/x-tex" }, [textNode("\\oint dl")])
  ]),
  textNode(" 是环路积分。")
]);
assert.equal(Markdown.htmlToMarkdown(katexLike), "符号 ∮ dl 是环路积分。");

const svgMath = element("p", {}, [
  textNode("普通积分 "),
  element("svg", { "aria-label": "∫" }, []),
  textNode(" 也要保留。")
]);
assert.equal(Markdown.htmlToMarkdown(svgMath), "普通积分 ∫ 也要保留。");

console.log("All tests passed.");
