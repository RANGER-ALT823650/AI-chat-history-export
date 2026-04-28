# AI Chat Markdown Exporter

这是一个兼容 Chrome / Edge 的浏览器扩展，用于把当前 ChatGPT、Claude、Gemini、Grok、DeepSeek 或豆包聊天导出为 Markdown，方便后续做 RAG 索引。

## 导出内容

- 平台名称：`ChatGPT`、`Claude`、`Gemini`、`Grok`、`DeepSeek` 或 `Doubao`
- 来源 URL
- 会话标题
- 能从 URL 推导时的会话 ID
- 页面数据、DOM 元数据或平台会话 API 暴露的真实会话/消息时间
- User / Assistant 消息，保留为 Markdown
- KaTeX、MathJax、SVG 节点中可用的数学可访问文本

扩展会刻意避免写入导出时间。

## 支持平台

- ChatGPT：`https://chatgpt.com/*`、`https://chat.openai.com/*`
- Claude：`https://claude.ai/*`
- Gemini：`https://gemini.google.com/*`
- Grok：`https://grok.com/*`、`https://x.com/i/grok*`、`https://grok.x.ai/*`
- DeepSeek：`https://chat.deepseek.com/*`
- 豆包：`https://*.doubao.com/*`

## 在 Chrome 或 Edge 中加载

1. 运行 `npm run verify`。
2. 打开 Chrome 或 Edge 的扩展管理页面。
3. 开启开发者模式。
4. 从生成的 `dist/` 文件夹加载未打包扩展。

   ```bash
   npm run build
   ```

5. 打开 ChatGPT、Claude、Gemini、Grok、DeepSeek 或豆包的聊天页面。
6. 点击扩展图标。
7. 点击 `导出当前聊天为 Markdown`。

下载文件会保存到浏览器 Downloads 目录下的 `AI Chat Exports/` 文件夹。

## 批量导出账号历史

批量导出器复用当前聊天导出逻辑，不调用官方归档导出。ChatGPT 导出会使用登录态网页端同源的会话 API，因此在接口返回时可以保留消息创建时间。

1. 打开已登录的 ChatGPT、Claude、Gemini、Grok、DeepSeek 或豆包页面。
2. 点击扩展图标。
3. 点击 `批量导出账号历史`。
4. 在批量控制台点击 `扫描历史列表`。
5. 确认发现的队列后，点击 `开始导出`。

平台说明：

- ChatGPT：逐个打开聊天后，从结构化会话 JSON 导出；网页 API 返回时会保留会话和每条消息的创建时间。
- Claude、Grok、DeepSeek、豆包：扩展会尽量拦截登录态网页应用的会话响应，保存在短期内存结构化缓存中，并用它增强 DOM 导出结果，以保留真实会话和消息时间。
- Gemini：扫描器会直接打开 Gemini 搜索列表，用每条搜索结果右侧可见日期作为 `conversation_time`；近期登录态网页历史响应也会作为时间戳兜底。单条聊天导出会在保存当前聊天前，用临时后台标签页执行同样的查找。若可见日期不可用，Gemini 仍可回退到已拦截的会话响应，同时继续忽略导出时间。
- Claude：扫描器会先尝试打开侧边栏搜索/历史列表，再持续滚动，直到没有新聊天链接出现。标题和可见列表日期会作为导出的会话标题/时间。
- Grok：扫描器会先尝试点击侧边栏的 `查看全部` / `View all` 历史按钮，再滚动历史列表页。
- DeepSeek 和豆包：扫描器使用可见侧边栏/搜索历史链接；当前聊天导出则使用 DOM 抽取，并在网页应用暴露会话数据时用结构化 API 信息增强结果。
- 导出范围仅限当前账号可在网页 UI 中加载的聊天。已删除、私密、隐藏或受账号策略限制的聊天无法通过这个浏览器驱动流程导出。
- 长聊天会逐个打开，并在导出前滚动页面，让较早的 DOM 内容有机会加载。
- 后续批量扫描会把发现的聊天与 `/Users/mayifan/Downloads/AI Chat Exports` 下已有 Markdown 文件对比，只把去重后的剩余项放入本轮导出队列。去重优先使用 Markdown 元数据里的 `platform + conversation_id`，其次使用 `platform + source_url`，最后才回退到文件名匹配。
- 成功导出仍会写入本地兼容记录，用于进度显示和兼容旧扩展状态；跨轮去重不再依赖该记录。
- 同一批队列再次运行时，会跳过已经标记为 `成功` 或 `已跳过` 的行；失败行可以重试。
- `清空本次队列` 会保留兼容记录。`清空兼容记录` 会重置兼容记录，把当前队列全部改为 `待导出`，并允许下一次开始导出时重新下载所有聊天，即使已有匹配文件。

批量下载会保存到对应平台文件夹，例如：

```text
AI Chat Exports/Claude/
AI Chat Exports/Gemini/
AI Chat Exports/Grok/
AI Chat Exports/ChatGPT/
AI Chat Exports/DeepSeek/
AI Chat Exports/Doubao/
```

## 文件名规则

如果能取得真实会话时间：

```text
2026-04-08_Claude_环路积分符号怎么理解.md
```

如果无法取得真实会话时间：

```text
Claude_环路积分符号怎么理解.md
```

扩展永远不会把导出时间用作文件名日期。

## 验收清单

每个平台都建议检查：

1. 打开一个已有会话。
2. 导出该会话。
3. 确认文件名可读，且不是 `untitled`。
4. 确认 YAML front matter 和可见 Metadata 区域都有 `platform`。
5. 确认只有当平台暴露真实聊天/消息时间时，才出现 `conversation_time`。
6. 确认没有 `exported_at` 或其他导出时间字段。
7. 确认每轮 User / Assistant 共用同一个轮次编号，例如 `Message 1 - User` 后接 `Message 1 - Assistant`，再接 `Message 2 - User` 和 `Message 2 - Assistant`。

如果某个平台仍然导出失败，请停留在失败的聊天页面，并在弹窗里点击 `下载页面调试快照`。快照会保存到：

```text
/Users/mayifan/Downloads/AI Chat Export Debug
```

快照只包含页面选择器和文本样本，方便调整适配器，不需要分享完整聊天记录。

每个平台各导出一个聊天后，运行：

```bash
npm run check:exports
```

默认检查目录为：

```text
/Users/mayifan/Downloads/AI Chat Exports
```

也可以传入自定义导出目录：

```bash
node scripts/check-exported-files.mjs "/path/to/export/folder"
```

## 开发

```bash
npm run test
npm run build
npm run verify
npm run check:exports
```

项目没有外部 npm 依赖。
