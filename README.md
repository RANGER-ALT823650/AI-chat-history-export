# AI Chat Markdown Exporter

Chrome / Edge compatible extension for exporting the current ChatGPT, Claude, Gemini, or Grok chat as Markdown for later RAG indexing.

## What It Exports

- Platform name: `ChatGPT`, `Claude`, `Gemini`, or `Grok`
- Source URL
- Conversation title
- Conversation ID when it can be derived from the URL
- Actual conversation/message time when exposed by page data, DOM metadata, or a platform conversation API
- User and assistant messages as Markdown
- Math accessibility text from KaTeX/MathJax/SVG nodes when available

The extension intentionally does not write export time.

## Supported Platforms

- ChatGPT: `https://chatgpt.com/*`, `https://chat.openai.com/*`
- Claude: `https://claude.ai/*`
- Gemini: `https://gemini.google.com/*`
- Grok: `https://grok.com/*`, `https://x.com/i/grok*`, `https://grok.x.ai/*`

## Load In Chrome Or Edge

1. Run `npm run verify`.
2. Open Chrome or Edge extensions page.
3. Enable developer mode.
4. Load the unpacked extension from the generated `dist/` folder.

   ```bash
   npm run build
   ```

5. Open a ChatGPT, Claude, Gemini, or Grok chat page.
6. Click the extension icon.
7. Click `导出当前聊天为 Markdown`.

Downloads are saved under the browser Downloads folder in `AI Chat Exports/`.

## Batch Export Account History

The batch exporter reuses the current-chat exporter. It does not call official archive exports. ChatGPT exports use the same signed-in web conversation API that the ChatGPT page uses so message creation times can be preserved.

1. Open a signed-in ChatGPT, Claude, Gemini, or Grok page.
2. Click the extension icon.
3. Click `批量导出账号历史`.
4. In the batch console, click `扫描历史列表`.
5. Confirm the discovered queue, then click `开始导出`.

Platform notes:

- ChatGPT: each opened chat is exported from structured conversation JSON, including conversation and per-message creation times when the web API returns them.
- Claude and Grok: the extension opportunistically intercepts the signed-in web app's conversation responses, keeps a short-lived in-memory structured cache, and uses it to enrich DOM exports with real conversation and message times.
- Gemini: the scanner first scrolls the left sidebar history to the bottom, then opens Gemini search and uses the visible right-side date in each search result as `conversation_time`. Single-chat export does the same lookup in a temporary background tab before saving the current chat.
- Claude: the scanner tries to open the sidebar search/history list first, then keeps scrolling until no new chat links appear. Titles and visible list dates are used as the exported conversation title/time.
- Grok: the scanner first tries to click the sidebar `查看全部` / `View all` history button, then scrolls the history list page.
- The export scope is the chats that the current account can load in the web UI. Deleted, private, hidden, or account-policy-restricted chats cannot be exported by this browser-driven flow.
- Long conversations are opened one by one and the page is scrolled before export so older DOM content has a chance to load.
- Successful exports are also written to a long-lived local backup registry keyed by platform plus conversation ID or URL. Future scans can skip already backed-up chats even after the source tab changes.
- `清空本次队列` keeps the backup registry. `清空备份记录` resets the cross-run skip registry.

Batch downloads are saved under platform folders such as:

```text
AI Chat Exports/Claude/
AI Chat Exports/Gemini/
AI Chat Exports/Grok/
AI Chat Exports/ChatGPT/
```

## Filename Rules

If an actual conversation time is visible:

```text
2026-04-08_Claude_环路积分符号怎么理解.md
```

If no actual conversation time is visible:

```text
Claude_环路积分符号怎么理解.md
```

The extension never uses export time as a filename date.

## Acceptance Checklist

For each platform:

1. Open one existing conversation.
2. Export it.
3. Confirm the file has a readable, non-`untitled` name.
4. Confirm `platform` is present in YAML front matter and the visible Metadata section.
5. Confirm `conversation_time` appears only when the platform exposes a real chat/message time.
6. Confirm no `exported_at` or export-time field appears.
7. Confirm each user/assistant exchange shares one turn number, for example `Message 1 - User` followed by `Message 1 - Assistant`, then `Message 2 - User` followed by `Message 2 - Assistant`.

If a platform still fails to export, click `下载页面调试快照` in the popup while staying on the failed chat page. The snapshot is saved under:

```text
/Users/mayifan/Downloads/AI Chat Export Debug
```

It contains selector/text samples from the page so the adapter can be adjusted without sharing the full chat transcript.

After exporting one chat from each platform, run:

```bash
npm run check:exports
```

By default it checks:

```text
/Users/mayifan/Downloads/AI Chat Exports
```

You can also pass a custom export folder:

```bash
node scripts/check-exported-files.mjs "/path/to/export/folder"
```

## Development

```bash
npm run test
npm run build
npm run verify
npm run check:exports
```

The project has no external npm dependencies.
