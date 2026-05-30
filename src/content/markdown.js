(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const utils = namespace.PlatformUtils;

  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "BR",
    "DETAILS",
    "DIV",
    "DL",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TR",
    "UL"
  ]);

  const SKIP_TAGS = new Set([
    "BUTTON",
    "CANVAS",
    "IFRAME",
    "INPUT",
    "NOSCRIPT",
    "SCRIPT",
    "SELECT",
    "STYLE",
    "SVG",
    "TEXTAREA"
  ]);

  const UI_CHROME_TEXT = new Set([
    "copy",
    "copy code",
    "copy table",
    "copy to clipboard",
    "copied",
    "copied to clipboard",
    "复制",
    "复制代码",
    "复制表格",
    "复制到剪贴板",
    "已复制"
  ]);

  const CODE_LANGUAGE_LABELS = new Map([
    ["bash", "bash"],
    ["c", "c"],
    ["c#", "csharp"],
    ["c++", "cpp"],
    ["cpp", "cpp"],
    ["csharp", "csharp"],
    ["css", "css"],
    ["go", "go"],
    ["html", "html"],
    ["java", "java"],
    ["javascript", "javascript"],
    ["js", "javascript"],
    ["json", "json"],
    ["kotlin", "kotlin"],
    ["markdown", "markdown"],
    ["md", "markdown"],
    ["mermaid", "mermaid"],
    ["php", "php"],
    ["plaintext", "text"],
    ["py", "python"],
    ["python", "python"],
    ["r", "r"],
    ["ruby", "ruby"],
    ["rust", "rust"],
    ["shell", "bash"],
    ["sh", "bash"],
    ["sql", "sql"],
    ["swift", "swift"],
    ["text", "text"],
    ["ts", "typescript"],
    ["typescript", "typescript"],
    ["xml", "xml"],
    ["yaml", "yaml"],
    ["yml", "yaml"],
    ["zsh", "bash"]
  ]);

  const UNRESOLVED_MEDIA_PATTERNS = [
    /\[(?:image|img|media|file|attachment):[^\]]*]/i
  ];

  const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/g;

  const TEX_SYMBOLS = new Map([
    ["\\oint", "∮"],
    ["\\int", "∫"],
    ["\\pi", "π"],
    ["\\theta", "θ"],
    ["\\Theta", "Θ"],
    ["\\epsilon", "ε"],
    ["\\varepsilon", "ε"],
    ["\\alpha", "α"],
    ["\\beta", "β"],
    ["\\gamma", "γ"],
    ["\\delta", "δ"],
    ["\\Delta", "Δ"],
    ["\\lambda", "λ"],
    ["\\mu", "μ"],
    ["\\sum", "∑"],
    ["\\prod", "∏"],
    ["\\sqrt", "√"],
    ["\\cdot", "·"],
    ["\\times", "×"],
    ["\\div", "÷"],
    ["\\leq", "≤"],
    ["\\geq", "≥"],
    ["\\neq", "≠"],
    ["\\approx", "≈"],
    ["\\pm", "±"],
    ["\\to", "→"],
    ["\\rightarrow", "→"],
    ["\\leftarrow", "←"]
  ]);

  function escapeYaml(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
  }

  function escapeMarkdownTableCell(value) {
    return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  }

  function compactMarkdown(value) {
    const codeFences = [];
    const placeholderPrefix = "\u0000AI_CHAT_EXPORTER_CODE_FENCE_";
    const protectedValue = String(value || "").replace(/```[\s\S]*?```/g, (match) => {
      const placeholder = `${placeholderPrefix}${codeFences.length}\u0000`;
      codeFences.push(match.replace(/[ \t]+\n/g, "\n").replace(/\n+$/g, ""));
      return placeholder;
    });

    let compacted = protectedValue
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    codeFences.forEach((fence, index) => {
      compacted = compacted.replace(`${placeholderPrefix}${index}\u0000`, fence);
    });

    return compacted;
  }

  function normalizedElementText(element) {
    if (!element) {
      return "";
    }

    return utils.normalizeWhitespace(element.innerText || element.textContent || accessibleText(element) || "");
  }

  function normalizedChromeText(value) {
    return utils.normalizeWhitespace(value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function isUiChromeText(value) {
    const clean = normalizedChromeText(value);
    if (!clean) {
      return false;
    }

    return UI_CHROME_TEXT.has(clean) || UI_CHROME_TEXT.has(clean.toLowerCase());
  }

  function textWithoutChromeLabels(value) {
    let clean = normalizedChromeText(value);
    for (const label of UI_CHROME_TEXT.values()) {
      clean = clean.replace(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
    }

    return normalizedChromeText(clean);
  }

  function normalizeCodeLanguageLabel(value) {
    let clean = textWithoutChromeLabels(value)
      .replace(/^language\s*[:：-]?\s*/i, "")
      .replace(/^lang\s*[:：-]?\s*/i, "")
      .trim()
      .toLowerCase();

    if (!clean) {
      return "";
    }

    clean = clean.replace(/^```/, "").replace(/```$/, "").trim();
    return CODE_LANGUAGE_LABELS.get(clean) || "";
  }

  function normalizeMathText(value) {
    let clean = String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) {
      return "";
    }

    for (const [tex, symbol] of TEX_SYMBOLS.entries()) {
      clean = clean.replaceAll(tex, symbol);
    }

    return clean
      .replace(/\\left|\\right/g, "")
      .replace(/\{\s*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isMathLikeText(value) {
    const clean = String(value || "");
    return /[∮∫πθΘεαβγδΔλμ∑∏√≤≥≠≈±→←∞∂∇·×÷]/.test(clean) || /\\[A-Za-z]+/.test(clean);
  }

  function hasMathIdentity(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const className = String(element.className || "").toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();

    return (
      tagName === "math" ||
      tagName.startsWith("mjx-") ||
      className.includes("katex") ||
      className.includes("mathjax") ||
      className.includes("math") ||
      role === "math"
    );
  }

  function queryText(element, selectors) {
    for (const selector of selectors) {
      const found = element.querySelector && element.querySelector(selector);
      if (found) {
        const text = normalizeMathText(found.textContent || found.getAttribute("aria-label") || found.getAttribute("alttext"));
        if (text) {
          return text;
        }
      }
    }

    return "";
  }

  function mathText(element) {
    if (!element || element.nodeType !== 1) {
      return "";
    }

    const attrText = normalizeMathText(
      element.getAttribute("data-latex") ||
        element.getAttribute("data-tex") ||
        element.getAttribute("data-math") ||
        element.getAttribute("data-expression") ||
        element.getAttribute("alttext")
    );
    if (attrText) {
      return attrText;
    }

    const accessible = normalizeMathText(accessibleText(element));
    if (accessible && (hasMathIdentity(element) || isMathLikeText(accessible))) {
      return accessible;
    }

    if (!hasMathIdentity(element)) {
      return "";
    }

    const annotation = queryText(element, [
      "annotation[encoding='application/x-tex']",
      "annotation[encoding='application/x-latex']",
      "annotation",
      ".katex-mathml annotation",
      ".MJX_Assistive_MathML math",
      "mjx-assistive-mml math"
    ]);
    if (annotation) {
      return annotation;
    }

    const text = normalizeMathText(element.textContent || "");
    return text && isMathLikeText(text) ? text : "";
  }

  function isSkippableElement(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    const reasoningTokens = [
      element.className,
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-role"),
      element.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    if (
      reasoningTokens.includes("ds-think-content") ||
      /(?:^|[\s_-])(?:think|thinking|reasoning|cot|chain-of-thought)(?:[\s_-]|$)/.test(reasoningTokens) ||
      /模型思考|思考过程|深度思考/.test(reasoningTokens)
    ) {
      return true;
    }

    if (isUiChromeText(normalizedElementText(element))) {
      return true;
    }

    if (SKIP_TAGS.has(element.tagName)) {
      return true;
    }

    const role = (element.getAttribute("role") || "").toLowerCase();
    if (role === "button" || role === "navigation" || role === "menu") {
      return true;
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return true;
    }

    const hidden = element.getAttribute("hidden");
    return hidden !== null;
  }

  function accessibleText(element) {
    if (!element || element.nodeType !== 1) {
      return "";
    }

    const explicit = element.getAttribute("aria-label") || element.getAttribute("title");
    if (explicit) {
      return explicit.trim();
    }

    const title = element.querySelector && element.querySelector("title");
    if (title && title.textContent) {
      return title.textContent.trim();
    }

    return "";
  }

  function childrenToMarkdown(element, context) {
    const childNodes = Array.from(element.childNodes || []);
    return childNodes
      .map((child, index) => nodeToMarkdown(child, { ...context, parent: element, siblings: childNodes, index }))
      .filter(Boolean)
      .join("");
  }

  function textNodeToMarkdown(node) {
    return String(node.nodeValue || "").replace(/\s+/g, " ");
  }

  function inlineChildren(element, context) {
    return compactMarkdown(childrenToMarkdown(element, context)).replace(/\n+/g, " ");
  }

  function wrapInline(element, context, marker) {
    const body = inlineChildren(element, context);
    return body ? `${marker}${body}${marker}` : "";
  }

  function listToMarkdown(element, context) {
    const ordered = element.tagName === "OL";
    const start = Number(element.getAttribute && element.getAttribute("start")) || 1;
    const items = Array.from(element.children || []).filter((child) => child.tagName === "LI");

    return items
      .map((item, index) => {
        const marker = ordered ? `${start + index}. ` : "- ";
        const body = compactMarkdown(childrenToMarkdown(item, { ...context, inList: true }));
        const indented = body.replace(/\n/g, "\n  ");
        return `${marker}${indented}`;
      })
      .join("\n") + "\n\n";
  }

  function tableToMarkdown(table, context) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const cells = rows.map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) =>
        escapeMarkdownTableCell(inlineChildren(cell, { ...context, inTable: true }))
      )
    ).filter((row) => row.length > 0);

    if (!cells.length) {
      return "";
    }

    const width = Math.max(...cells.map((row) => row.length));
    const normalized = cells.map((row) => {
      const copy = row.slice();
      while (copy.length < width) {
        copy.push("");
      }
      return copy;
    });

    const header = normalized[0];
    const separator = header.map(() => ":---");
    const body = normalized.slice(1);
    const lines = [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`);

    return `${lines.join("\n")}\n\n`;
  }

  function blockquoteToMarkdown(element, context) {
    const body = compactMarkdown(childrenToMarkdown(element, context));
    if (!body) {
      return "";
    }

    return body
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n") + "\n\n";
  }

  function codeLanguage(element) {
    const className = element.className || "";
    const match = String(className).match(/(?:language-|lang-)([A-Za-z0-9_-]+)/);
    return match ? match[1] : "";
  }

  function codeBlockLanguage(element) {
    const selfLanguage = codeLanguage(element);
    if (selfLanguage) {
      return selfLanguage;
    }

    const codeChild = element.querySelector && (
      element.querySelector("code[class*='language-'], code[class*='lang-']") ||
      element.querySelector("code")
    );
    if (codeChild) {
      return codeLanguage(codeChild);
    }

    const label = element.getAttribute && (
      element.getAttribute("data-language") ||
      element.getAttribute("data-lang") ||
      element.getAttribute("aria-label")
    );
    const normalized = normalizeCodeLanguageLabel(label);
    if (normalized) {
      return normalized;
    }

    const labelMatch = String(label || "").match(/\b([A-Za-z0-9_+#.-]+)\b/);
    return labelMatch ? (CODE_LANGUAGE_LABELS.get(labelMatch[1].toLowerCase()) || labelMatch[1]) : "";
  }

  function isCodeBlockElement(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    const tagName = element.tagName;
    const className = String(element.className || "").toLowerCase();
    const testId = String((element.getAttribute && (element.getAttribute("data-testid") || element.getAttribute("data-test-id"))) || "").toLowerCase();

    if (tagName === "PRE") {
      return true;
    }

    if (tagName === "CODE" && String(element.textContent || "").includes("\n")) {
      return true;
    }

    return (
      className.includes("code-block") ||
      className.includes("codeblock") ||
      className.includes("code-block") ||
      testId.includes("code-block") ||
      testId.includes("codeblock")
    );
  }

  function nearestElementSibling(context, direction, limit = 4) {
    const siblings = context && context.siblings;
    if (!siblings || typeof context.index !== "number") {
      return null;
    }

    let seen = 0;
    for (let index = context.index + direction; index >= 0 && index < siblings.length && seen < limit; index += direction) {
      const sibling = siblings[index];
      if (!sibling || (sibling.nodeType === 3 && !String(sibling.nodeValue || "").trim())) {
        continue;
      }

      seen += 1;
      if (sibling.nodeType !== 1) {
        return null;
      }

      return sibling;
    }

    return null;
  }

  function nearbyCodeBlock(context, direction) {
    const siblings = context && context.siblings;
    if (!siblings || typeof context.index !== "number") {
      return false;
    }

    let seen = 0;
    for (let index = context.index + direction; index >= 0 && index < siblings.length && seen < 4; index += direction) {
      const sibling = siblings[index];
      if (!sibling || (sibling.nodeType === 3 && !String(sibling.nodeValue || "").trim())) {
        continue;
      }

      seen += 1;
      if (sibling.nodeType !== 1) {
        return false;
      }

      if (isCodeBlockElement(sibling)) {
        return true;
      }

      if (isUiChromeText(normalizedElementText(sibling)) || normalizeCodeLanguageLabel(normalizedElementText(sibling))) {
        continue;
      }

      return false;
    }

    return false;
  }

  function languageFromNearbyLabel(context) {
    for (const direction of [-1, 1]) {
      let siblingContext = context;
      for (let depth = 0; depth < 4; depth += 1) {
        const sibling = nearestElementSibling(siblingContext, direction, 1);
        if (!sibling) {
          break;
        }

        const language = normalizeCodeLanguageLabel(normalizedElementText(sibling));
        if (language) {
          return language;
        }

        if (!isUiChromeText(normalizedElementText(sibling))) {
          break;
        }

        siblingContext = { ...siblingContext, index: siblingContext.index + direction };
      }
    }

    return "";
  }

  function languageFromOwnChrome(element, codeElement) {
    const children = Array.from(element.children || []);
    for (const child of children) {
      if (child === codeElement || (child.contains && child.contains(codeElement))) {
        continue;
      }

      if (child.querySelector && child.querySelector("pre, code")) {
        continue;
      }

      const language = normalizeCodeLanguageLabel(normalizedElementText(child));
      if (language) {
        return language;
      }
    }

    return "";
  }

  function inferLanguageFromCode(code) {
    const clean = String(code || "");
    if (/^\s*(#include\b|int\s+main\s*\(|void\s+\w+\s*\(|int\s+\w+\s*\(|printf\s*\(|scanf\s*\()/m.test(clean)) {
      return "c";
    }

    if (/^\s*(def|class|import|from)\s+\w+/m.test(clean) || /^\s*print\s*\(/m.test(clean)) {
      return "python";
    }

    if (/^\s*(npm|pnpm|yarn|pip|python3?|git|cd|mkdir|rm|cp|mv)\b/m.test(clean)) {
      return "bash";
    }

    return "";
  }

  function readCodeText(element) {
    return String((element && (element.innerText || element.textContent)) || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/\n+$/, "");
  }

  function codeBlockToMarkdown(element, context = {}) {
    const codeElement = element.tagName === "CODE"
      ? element
      : (element.querySelector && element.querySelector("pre code, code")) || element;
    const code = readCodeText(codeElement);
    const language =
      codeBlockLanguage(codeElement) ||
      codeBlockLanguage(element) ||
      languageFromOwnChrome(element, codeElement) ||
      languageFromNearbyLabel(context) ||
      inferLanguageFromCode(code);
    return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
  }

  function isStandaloneCodeLanguageLabel(element, context) {
    if (!element || element.nodeType !== 1 || element.tagName === "PRE" || element.tagName === "CODE") {
      return false;
    }

    if (element.querySelector && element.querySelector("pre, code")) {
      return false;
    }

    const language = normalizeCodeLanguageLabel(normalizedElementText(element));
    if (!language) {
      return false;
    }

    return nearbyCodeBlock(context, 1) || nearbyCodeBlock(context, -1);
  }

  function nodeToMarkdown(node, context = {}) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return textNodeToMarkdown(node);
    }

    if (node.nodeType !== 1) {
      return "";
    }

    const element = node;
    const math = mathText(element);
    if (math) {
      return math;
    }

    if (isSkippableElement(element)) {
      return "";
    }

    const tagName = element.tagName;

    if (tagName === "BR") {
      return "\n";
    }

    if (tagName === "HR") {
      return "-----\n\n";
    }

    if (isStandaloneCodeLanguageLabel(element, context)) {
      return "";
    }

    const fallbackText = accessibleText(element);

    if (tagName === "STRONG" || tagName === "B") {
      return wrapInline(element, context, "**");
    }

    if (tagName === "EM" || tagName === "I") {
      return wrapInline(element, context, "*");
    }

    if (tagName === "DEL" || tagName === "S") {
      return wrapInline(element, context, "~~");
    }

    if (/^H[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1));
      const text = inlineChildren(element, context) || fallbackText;
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }

    if (tagName === "P") {
      const body = compactMarkdown(childrenToMarkdown(element, context));
      return body ? `${body}\n\n` : "";
    }

    if (isCodeBlockElement(element)) {
      return codeBlockToMarkdown(element, context);
    }

    if (tagName === "CODE") {
      const text = element.innerText || element.textContent || "";
      if (context.inPre) {
        return text;
      }
      return text.includes("\n") ? text : `\`${text.trim()}\``;
    }

    if (tagName === "A") {
      const href = element.getAttribute("href");
      const text = inlineChildren(element, context) || href || "";
      if (!href || href.startsWith("javascript:") || href === text) {
        return text;
      }
      return `[${text}](${href})`;
    }

    if (tagName === "UL" || tagName === "OL") {
      return listToMarkdown(element, context);
    }

    if (tagName === "BLOCKQUOTE") {
      return blockquoteToMarkdown(element, context);
    }

    if (tagName === "TABLE") {
      return tableToMarkdown(element, context);
    }

    const body = childrenToMarkdown(element, context);
    if (!compactMarkdown(body) && fallbackText) {
      return BLOCK_TAGS.has(tagName) ? `${fallbackText}\n\n` : fallbackText;
    }

    if (!BLOCK_TAGS.has(tagName)) {
      return body;
    }

    return compactMarkdown(body) ? `${compactMarkdown(body)}\n\n` : "";
  }

  function htmlToMarkdown(element) {
    if (!element) {
      return "";
    }

    return compactMarkdown(nodeToMarkdown(element));
  }

  function buildFrontMatter(conversation) {
    const fields = [
      ["status", "raw", "plain"],
      ["needs_media", conversationNeedsMedia(conversation), "boolean"],
      ["platform", conversation.platform],
      ["source_url", conversation.sourceUrl],
      ["conversation_title", conversation.title],
      ["conversation_time", conversation.conversationTime],
      ["conversation_id", conversation.conversationId]
    ].filter(([, value, type]) => type === "boolean" || value);

    if (!fields.length) {
      return "";
    }

    const lines = fields.map(([key, value, type]) => {
      if (type === "plain") {
        return `${key}: ${value}`;
      }
      if (type === "boolean") {
        return `${key}: ${value ? "true" : "false"}`;
      }
      return `${key}: "${escapeYaml(value)}"`;
    });
    return `---\n${lines.join("\n")}\n---\n\n`;
  }

  function buildMetadataSection(conversation) {
    const rows = [
      ["Needs media", conversationNeedsMedia(conversation) ? "true" : "false"],
      ["Platform", conversation.platform],
      ["Source URL", conversation.sourceUrl],
      ["Conversation time", conversation.conversationTime],
      ["Conversation ID", conversation.conversationId]
    ].filter(([, value]) => value);

    if (!rows.length) {
      return "";
    }

    return `## Metadata\n\n${rows.map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n`;
  }

  function booleanOverride(value) {
    if (value === true || value === false) {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }

    return null;
  }

  function attachmentHasLocalMedia(attachment) {
    if (!attachment || typeof attachment !== "object") {
      return false;
    }

    if (attachment.exported === true || attachment.downloaded === true) {
      return true;
    }

    return Boolean(
      attachment.localPath ||
      attachment.local_path ||
      attachment.relativePath ||
      attachment.relative_path ||
      attachment.path
    );
  }

  function attachmentNeedsMedia(attachment) {
    const override = booleanOverride(attachment && attachment.needsMedia);
    if (override !== null) {
      return override;
    }

    const type = String(
      (attachment && (attachment.type || attachment.kind || attachment.mimeType || attachment.mime_type)) || ""
    ).toLowerCase();
    const looksLikeMedia = /image|video|audio|file|attachment|pdf|spreadsheet|document/.test(type);

    return looksLikeMedia && !attachmentHasLocalMedia(attachment);
  }

  function textNeedsMedia(value) {
    const text = String(value || "");
    if (UNRESOLVED_MEDIA_PATTERNS.some((pattern) => pattern.test(text))) {
      return true;
    }

    MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
    let match;
    while ((match = MARKDOWN_IMAGE_PATTERN.exec(text))) {
      if (!isLocalMediaReference(match[1])) {
        return true;
      }
    }

    return false;
  }

  function isLocalMediaReference(value) {
    const href = String(value || "").trim().replace(/^<|>$/g, "");
    if (!href) {
      return false;
    }

    return !/^(?:https?:|blob:|file-service:|attachment:)/i.test(href);
  }

  function messageNeedsMedia(message) {
    const override = booleanOverride(message && message.needsMedia);
    if (override !== null) {
      return override;
    }

    const attachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    if (attachments.some(attachmentNeedsMedia)) {
      return true;
    }

    return textNeedsMedia((message && (message.markdown || message.content)) || "");
  }

  function conversationNeedsMedia(conversation) {
    const override = booleanOverride(conversation && conversation.needsMedia);
    if (override !== null) {
      return override;
    }

    const attachments = Array.isArray(conversation && conversation.attachments) ? conversation.attachments : [];
    if (attachments.some(attachmentNeedsMedia)) {
      return true;
    }

    return ((conversation && conversation.messages) || []).some(messageNeedsMedia);
  }

  function normalizeRole(role) {
    if (role === "assistant") {
      return "Assistant";
    }
    if (role === "system") {
      return "System";
    }
    return "User";
  }

  function messagesWithTurnNumbers(messages) {
    let turnNumber = 0;
    let activeTurnNumber = 0;

    return (messages || []).map((message) => {
      if (message.role === "user") {
        turnNumber += 1;
        activeTurnNumber = turnNumber;
      } else if (!activeTurnNumber) {
        turnNumber += 1;
        activeTurnNumber = turnNumber;
      }

      return {
        ...message,
        turnNumber: activeTurnNumber
      };
    });
  }

  function buildMessages(conversation) {
    return messagesWithTurnNumbers(conversation.messages)
      .map((message) => {
        const heading = `## Message ${message.turnNumber} - ${normalizeRole(message.role)}`;
        const time = message.time ? `\n\n_Time: ${message.time}_` : "";
        const body = compactMarkdown(message.markdown || message.content || "");
        return `${heading}${time}\n\n${body}`;
      })
      .join("\n\n");
  }

  function conversationDisplayTitle(conversation) {
    const platform = conversation.platform || "";
    const title = utils.truncate(conversation.title, 140);
    if (title && !utils.isGenericConversationTitle(title, platform)) {
      return title;
    }

    const firstUserMessage = (conversation.messages || []).find((message) => message.role === "user");
    const firstMessage = firstUserMessage || (conversation.messages || [])[0] || {};
    const fallback = utils.truncate(utils.firstMeaningfulLine(firstMessage.content || firstMessage.markdown || ""), 140);
    return fallback || title || "AI Chat";
  }

  function withDisplayTitle(conversation) {
    return {
      ...conversation,
      title: conversationDisplayTitle(conversation)
    };
  }

  function buildMarkdown(conversation) {
    const displayConversation = withDisplayTitle(conversation);
    const title = displayConversation.title;
    const frontMatter = buildFrontMatter(displayConversation);
    const metadata = buildMetadataSection(displayConversation);
    const messages = buildMessages(displayConversation);

    return compactMarkdown(`${frontMatter}# ${title}\n\n${metadata}${messages}`) + "\n";
  }

  function buildFilename(conversation) {
    const platform = utils.makeSlug(conversation.platform || "AI", "AI");
    const title = utils.makeSlug(conversationDisplayTitle(conversation), "AI_Chat");
    const date = utils.formatDateForFilename(conversation.conversationTime);
    const prefix = date ? `${date}_` : "";
    return `${prefix}${platform}_${title}.md`;
  }

  namespace.Markdown = {
    buildFilename,
    buildMarkdown,
    compactMarkdown,
    htmlToMarkdown
  };
})(globalThis);
