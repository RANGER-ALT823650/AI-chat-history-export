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

## 首次安装

这个扩展目前不是 Chrome Web Store 商店插件，需要用“开发者模式”加载。新手建议先用方式 A，整个过程不需要命令行。

### 方式 A：下载源码后直接加载

1. 打开本项目 GitHub 页面。
2. 点击绿色 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 解压下载到本地的 ZIP 文件。
5. 找到解压后的项目文件夹，确认这个文件夹里面能直接看到 `manifest.json`、`src/`、`README.md`。
6. 打开 Chrome 或 Edge。
7. 在地址栏输入：

   ```text
   chrome://extensions
   ```

   Edge 用户也可以输入：

   ```text
   edge://extensions
   ```

8. 打开右上角的“开发者模式”。
9. 点击“加载已解压的扩展程序”。
10. 选择第 5 步确认过的项目文件夹。
11. 页面里出现 `AI Chat Markdown Exporter` 后，安装完成。

如果浏览器提示找不到清单文件，通常是选错了目录。请重新选择那个直接包含 `manifest.json` 的文件夹，而不是它的上一级目录。

### 方式 B：开发者构建后加载

如果你已经安装 Node.js，也可以先构建一个干净的 `dist/` 目录再加载：

```bash
npm run verify
npm run build
```

然后在 `chrome://extensions` 或 `edge://extensions` 里点击“加载已解压的扩展程序”，选择生成的 `dist/` 文件夹。

项目没有外部 npm 依赖，`npm run verify` 会先跑测试，再构建 `dist/`。

## 安装后第一次使用

1. 在浏览器右上角点击拼图形状的“扩展程序”按钮。
2. 找到 `AI Chat Markdown Exporter`。
3. 建议点击图钉，把它固定到工具栏。
4. 打开一个已支持平台的聊天页面，例如 ChatGPT、Claude、Gemini、Grok、DeepSeek、豆包或千问。
5. 点击工具栏里的扩展图标。
6. 直接点击 `导出当前聊天为 Markdown`。

默认情况下，扩展会把文件保存到浏览器当前设置的默认下载目录下：

```text
浏览器默认下载目录/
  ChatGPT/
  Claude/
  Gemini/
  Grok/
  DeepSeek/
  Doubao/
  Qwen/
```

如果你想改到其他文件夹，再点击 `自定义导出目录`，选择本地目录并允许写入。

## 导出路径设置

扩展有两种导出路径模式：

- 默认模式：写入浏览器默认下载目录，不需要首次选择目录。
- 自定义模式：点击 `自定义导出目录` 后，写入你选择的本地文件夹。

自定义模式会在你选择的目录下按平台创建子文件夹，例如：

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

自定义目录功能依赖 Chromium 的 File System Access API，因此请使用新版 Chrome 或 Edge。目录选择只会在你主动点击 `自定义导出目录` 时出现；后续导出不会主动弹出二次目录询问。若浏览器或系统让这个目录授权失效，扩展会提示你重新点击 `自定义导出目录` 授权。

默认下载目录由浏览器控制。你可以在 Chrome / Edge 的下载设置里修改默认下载位置，扩展会跟随浏览器设置，不会读取或显示系统里的绝对路径。

## 导出当前聊天

1. 打开一个已支持平台的具体聊天页面。
2. 点击扩展图标。
3. 点击 `导出当前聊天为 Markdown`。
4. 成功后，文件会写入默认下载目录或你自定义的导出目录。

默认模式下的路径类似：

```text
浏览器默认下载目录/
  Claude/
    2026-04-08_Claude_环路积分符号怎么理解.md
```

自定义模式下的路径类似：

```text
你选择的目录/
  Claude/
    2026-04-08_Claude_环路积分符号怎么理解.md
```

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
4. 如果要使用默认下载目录，直接点击 `扫描历史列表`。
5. 如果要导出到其他位置，先点击 `自定义导出目录`。
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
