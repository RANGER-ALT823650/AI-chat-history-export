(function (global) {
  "use strict";

  const namespace = (global.AIChatExporter = global.AIChatExporter || {});
  const common = namespace.AdapterCommon;

  namespace.GeminiAdapter = {
    extract() {
      return common.extractWithConfig({
        platformLabel: "Gemini",
        preferVisibleHistoryConversationTime: true,
        disableMessageTimeExtraction: true,
        allowMessageTimes: false,
        allowDocumentTime: false,
        allowScriptTime: false,
        rootSelector: "main",
        titleSelectors: [
          "[data-test-id='conversation-title']",
          "[data-testid='conversation-title']",
          ".conversation-title",
          "h1"
        ],
        messageSelectors: [
          {
            role: "user",
            selectors: [
              "user-query",
              "[data-test-id='user-query']",
              "[data-testid='user-query']",
              ".user-query",
              ".user-query-container"
            ],
            contentSelectors: [
              ".query-text",
              ".user-query-content",
              "[data-test-id='query-text']",
              "[data-testid='query-text']"
            ]
          },
          {
            role: "assistant",
            selectors: [
              "model-response",
              "[data-test-id='model-response']",
              "[data-testid='model-response']",
              ".model-response",
              ".model-response-container"
            ],
            contentSelectors: [
              ".model-response-text",
              ".response-content",
              ".markdown",
              "message-content",
              "[data-test-id='response-text']",
              "[data-testid='response-text']"
            ]
          }
        ]
      });
    }
  };
})(globalThis);
