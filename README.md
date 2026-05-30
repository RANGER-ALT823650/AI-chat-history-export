# AI Chat Markdown Exporter

一个兼容 Chrome / Edge 的浏览器扩展，用于把网页端 AI 聊天记录导出为适合 RAG、知识库和 Obsidian 归档的 Markdown。

## 支持平台

- ChatGPT：`https://chatgpt.com/*`、`https://chat.openai.com/*`
- Claude：`https://claude.ai/*`
- Gemini：`https://gemini.google.com/*`
- Grok：`https://grok.com/*`、`https://x.com/i/grok*`、`https://grok.x.ai/*`
- DeepSeek：`https://chat.deepseek.com/*`
- 豆包：`https://*.doubao.com/*`
- 千问 / Qwen：`https://qwen.ai/*`、`https://chat.qwen.ai/*`、`https://qianwen.com/*`、`https://tongyi.aliyun.com/*`

Qwen 官方入口可参考 [qwen.ai/qwenchat](https://qwen.ai/qwenchat)，扩展同时保留了通义千问常见旧域名和国内入口的匹配。

## 导出结果

每个 Markdown 文件包含：

- YAML front matter，包含 `status: raw`、`platform`、`source_url`、`conversation_title`、`conversation_id`、`needs_media`
- 能从页面、历史列表或网页 API 取得时的真实 `conversation_time`
- User / Assistant 消息正文，尽量保留标题、列表、代码块、表格、引用和数学内容
- 可见 Metadata 区域，方便人工检查和后续脚本处理

扩展不会写入 `exported_at` 之类的导出时间，避免把整理时间误当成聊天发生时间。

当前版本只导出文本和 Markdown 引用，不会把远程图片、附件或文件本体保存到本地。如果聊天中有未落盘媒体，`needs_media` 会标记为 `true`。

## 安装与加载

项目没有外部 npm 依赖。

```bash
npm run verify
npm run build
```

然后在浏览器中加载：

1. 打开 Chrome 或 Edge 的扩展管理页面。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择项目生成的 `dist/` 文件夹。
5. 打开任意已支持平台的聊天页面。
6. 点击扩展图标开始使用。

## 首次设置导出路径

首次使用时，扩展弹窗会显示“导出目录：未设置”。

1. 点击 `选择导出目录`。
2. 在系统目录选择器里选择你想保存 Markdown 的文件夹。
3. 授权写入权限。
4. 后续单条导出和批量导出会自动写入该目录。

扩展会在你选择的目录下按平台创建子文件夹，例如：

```text
你选择的目录/
  ChatGPT/
  Claude/
  Gemini/
  Grok/
  DeepSeek/
  Doubao/
  Qwen/
```

这个功能依赖 Chromium 的 File System Access API，因此请使用新版 Chrome 或 Edge。浏览器可能在重启或权限失效后再次要求授权，重新点击 `选择导出目录` 即可。

## 导出当前聊天

1. 打开一个已支持平台的具体聊天页面。
2. 点击扩展图标。
3. 如果还没有设置导出目录，先点击 `选择导出目录`。
4. 点击 `导出当前聊天为 Markdown`。
5. 成功后，文件会写入 `导出目录/平台名/文件名.md`。

文件名规则：

```text
2026-04-08_Claude_环路积分符号怎么理解.md
Claude_环路积分符号怎么理解.md
```

如果平台暴露了真实聊天时间，文件名前缀会使用聊天日期；否则省略日期。扩展不会用导出当天日期补位。

## 批量导出账号历史

批量导出器复用单条聊天导出逻辑，不调用官方归档导出。

1. 打开已登录的 ChatGPT、Claude、Gemini、Grok、DeepSeek、豆包或千问页面。
2. 点击扩展图标。
3. 点击 `批量导出账号历史`。
4. 在批量控制台确认或选择导出目录。
5. 点击 `扫描历史列表`。
6. 扫描完成后点击 `开始导出`。

批量导出说明：

- ChatGPT：逐个打开聊天后，优先从登录态网页端会话 API 读取结构化内容和消息时间。
- Claude、Grok、DeepSeek、豆包、千问：扩展会拦截网页应用暴露的会话响应，并结合 DOM 抽取结果导出。
- Gemini：会尝试从搜索/历史列表读取可见日期，单条导出时也会用临时后台标签页补全聊天日期。
- 长聊天会在导出前滚动页面，让较早消息有机会加载。
- 扫描会对比已导出记录，优先按 `platform + conversation_id` 去重，其次按 `platform + source_url`，最后按文件名。
- 如果之前导出的聊天后来新增了消息，批量导出会按消息数量尝试识别更新并覆盖旧文件名。
- `清空本次队列` 只清空当前批量状态。`清空兼容记录` 会重置导出记录，让下一轮允许重新导出全部聊天。

导出范围取决于网页端当前账号能够加载到的历史。已删除、隐藏、受账号策略限制或网页 UI 无法加载的聊天无法通过这个流程导出。

## 调试快照

如果某个平台导出失败：

1. 停留在失败的聊天页面。
2. 点击扩展图标。
3. 点击 `下载页面调试快照`。
4. 将生成的 JSON 用于调整适配器。

调试快照只包含页面选择器和文本样本，不会主动导出完整聊天 Markdown。

## 本地检查

检查某个导出目录下的 Markdown：

```bash
node scripts/check-exported-files.mjs "/path/to/export/folder"
```

也可以设置环境变量：

```bash
AI_CHAT_EXPORT_ROOT="/path/to/export/folder" npm run check:exports
```

更新本地已导出文件快照：

```bash
AI_CHAT_EXPORT_ROOT="/path/to/export/folder" npm run refresh:export-index
```

如果没有设置 `AI_CHAT_EXPORT_ROOT`，构建会生成一个空的 `src/exported-markdown-index.json`，不会把个人导出路径写进仓库。

## 开发命令

```bash
npm run test
npm run build
npm run verify
```

`npm run verify` 会先跑测试，再构建 `dist/`。
