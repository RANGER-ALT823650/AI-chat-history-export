# Markdown Schema

The exporter writes RAG-friendly Markdown with two metadata surfaces:

1. YAML front matter for machine parsing.
2. A visible `## Metadata` section for chunkers that ignore front matter.

The extension does not write export time. It only writes `conversation_time` when the source page, a short-lived structured API cache, or a platform conversation API exposes an actual conversation or message time.
Message bodies are serialized to stay close to each platform's native "copy Markdown" output: headings, emphasis, blockquotes, horizontal rules, lists, tables, and fenced code blocks are preserved, while UI-only labels such as copy buttons are omitted.

```md
---
status: raw
needs_media: false
platform: "ChatGPT"
source_url: "https://chatgpt.com/c/..."
conversation_title: "Example title"
conversation_time: "2026-04-08T21:15:00+08:00"
conversation_id: "..."
---

# Example title

## Metadata

- Needs media: false
- Platform: ChatGPT
- Source URL: https://chatgpt.com/c/...
- Conversation time: 2026-04-08T21:15:00+08:00
- Conversation ID: ...

## User 1

Question text.

## Assistant 2

Answer text.
```

If no actual conversation time is available, both `conversation_time` lines are omitted.

`status: raw` is always written as the first YAML field so downstream vault workflows can identify freshly exported, unprocessed notes.

`needs_media` is always written. It is `true` when the exported conversation still references unresolved images, files, or media placeholders; it is `false` when no media is needed or media references are already local relative paths.
