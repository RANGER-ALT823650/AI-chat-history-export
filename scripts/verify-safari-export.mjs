import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "dist", "safari-export-check");
const exportedRoot = "/Users/mayifan/Library/Mobile Documents/iCloud~md~obsidian/Documents/同步/10_Raw/AI Chat History";
const filename = "Safari_export_validation.md";
const markdown = `---
status: raw
needs_media: false
platform: "Safari"
source_url: "https://chatgpt.com/c/safari-export-validation"
conversation_title: "Safari export validation"
conversation_id: "safari-export-validation"
---

# Safari export validation

## Metadata

- Needs media: false
- Platform: Safari
- Source URL: https://chatgpt.com/c/safari-export-validation
- Conversation ID: safari-export-validation

## Message 1 - User

Verify Safari export.

## Message 1 - Assistant

Safari export file written.
`;

function decodeDataUrl(url) {
  const text = String(url || "");
  const commaIndex = text.indexOf(",");
  assert.ok(text.startsWith("data:") && commaIndex > 0, "download URL is not a data URL");

  const metadata = text.slice(5, commaIndex).toLowerCase();
  const payload = text.slice(commaIndex + 1);
  return metadata.includes(";base64")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
}

function safeOutputPath(relativePath) {
  const outputPath = resolve(outputRoot, String(relativePath || "").replace(/^\/+/, ""));
  const root = resolve(outputRoot);
  assert.ok(outputPath === root || outputPath.startsWith(`${root}/`), "download path escaped the verification root");
  return outputPath;
}

await rm(outputRoot, { recursive: true, force: true });

let listener = null;
let capturedNativeMessage = null;
const browser = {
  runtime: {
    lastError: null,
    getURL(path) {
      return `safari-web-extension://test/${path}`;
    },
    async sendNativeMessage(message, callback) {
      if (callback) {
        throw new TypeError("browser.runtime.sendNativeMessage does not accept callbacks");
      }

      capturedNativeMessage = message;
      assert.equal(message.type, "SAVE_MARKDOWN_FILE");
      const outputPath = safeOutputPath(message.relativePath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from(message.textBase64, "base64").toString("utf8"), "utf8");
      return {
        ok: true,
        path: outputPath,
        relativePath: message.relativePath
      };
    },
    onMessage: {
      addListener(callback) {
        listener = callback;
      }
    }
  }
};

const context = {
  URL,
  console,
  TextDecoder,
  TextEncoder,
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  browser,
  fetch: async () => ({
    ok: true,
    json: async () => ({ version: 1, files: [] })
  })
};
context.globalThis = context;
vm.createContext(context);

const source = await readFile(join(projectRoot, "src", "background.js"), "utf8");
vm.runInContext(source, context, { filename: "src/background.js" });

assert.equal(typeof listener, "function", "background listener was not registered");

const response = await new Promise((resolveResponse) => {
  listener({
    type: "DOWNLOAD_MARKDOWN",
    filename,
    markdown,
    folder: `${exportedRoot}/Safari`,
    conflictAction: "overwrite"
  }, {}, resolveResponse);
});

assert.equal(response.ok, true, response.error || "download failed");
assert.equal(response.relativePath, `Safari/${filename}`);
assert.equal(capturedNativeMessage.relativePath, `Safari/${filename}`);
assert.equal(capturedNativeMessage.conflictAction, "overwrite");

const outputPath = safeOutputPath(capturedNativeMessage.relativePath);
const exported = await readFile(outputPath, "utf8");
assert.equal(exported, markdown);
assert.match(exported, /^status:\s*raw$/m);
assert.match(exported, /^needs_media:\s*false$/m);
assert.match(exported, /## Message 1 - User/);
assert.match(exported, /## Message 1 - Assistant/);

console.log(`Verified Safari-style export file at ${outputPath}`);
