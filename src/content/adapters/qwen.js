(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;

  namespace.QwenAdapter = {
    async extract() {
      const conversation = common.extractWithConfig({
        platformLabel: "Qwen",
        rootSelector: "main, [role='main'], [class*='chat'], [class*='conversation'], [class*='message-list']",
        titleSelectors: [
          "[data-testid='conversation-title']",
          "[data-test-id='conversation-title']",
          "[class*='chat-title']",
          "[class*='conversation-title']",
          "[class*='session-title']",
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
              "[class*='query']"
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
              "[class*='markdown']",
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

      if (conversation && conversation.messages && conversation.messages.length) {
        return conversation;
      }

      const structured = namespace.StructuredConversationCache && namespace.StructuredConversationCache.latestConversation
        ? namespace.StructuredConversationCache.latestConversation("Qwen")
        : null;

      return structured || conversation || {
        platform: "Qwen",
        sourceUrl: global.location.href,
        title: "Qwen Chat",
        conversationId: "",
        messages: []
      };
    }
  };
})(globalThis);
