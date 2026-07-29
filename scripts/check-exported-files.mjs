import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const allowPartial = args.includes("--allow-partial");
const targetArg = args.find((arg) => arg !== "--allow-partial");

const targetDir = targetArg
  ? resolve(targetArg)
  : join(homedir(), "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents", "同步", "10_Raw", "AI Chat History");

const requiredPlatforms = new Set(["ChatGPT", "Claude", "Gemini", "Grok"]);

async function listMarkdownFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }

    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(root, fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function readPlatform(markdown) {
  const yaml = markdown.match(/^---\n([\s\S]*?)\n---/);
  const frontMatter = yaml ? yaml[1] : "";
  const platform = frontMatter.match(/^platform:\s*["']?([^"'\n]+)["']?/m);
  return platform ? platform[1].trim() : "";
}

function isReferenceExample(filename, markdown) {
  if (/^(范例_|example[_-])/i.test(filename)) {
    return true;
  }

  return !/^---\n/.test(markdown) && /范例|example/i.test(filename);
}

function validateFile(filename, markdown) {
  const errors = [];
  const platform = readPlatform(markdown);

  if (!platform) {
    errors.push("missing YAML platform");
  }

  if (/^untitled(?: \(\d+\))?\.md$/i.test(filename)) {
    errors.push("filename is still untitled");
  }

  if (!/^---\n/.test(markdown)) {
    errors.push("missing YAML front matter");
  }

  if (!/^status:\s*raw\s*$/m.test(markdown)) {
    errors.push("missing raw status");
  }

  if (!/source_url:\s*["']?https?:\/\//.test(markdown)) {
    errors.push("missing source_url");
  }

  if (!/^needs_media:\s*(?:true|false)\s*$/m.test(markdown)) {
    errors.push("missing needs_media boolean");
  }

  if (!/## Metadata/.test(markdown)) {
    errors.push("missing visible Metadata section");
  }

  if (!/^- Needs media: (?:true|false)\s*$/m.test(markdown)) {
    errors.push("missing visible Needs media metadata");
  }

  if (!/## Message \d+ - User/.test(markdown)) {
    errors.push("missing User turn headings");
  }

  if (!/## Message \d+ - Assistant/.test(markdown)) {
    errors.push("missing Assistant turn headings");
  }

  if (!/## Message 1 - User/.test(markdown) || !/## Message 1 - Assistant/.test(markdown)) {
    errors.push("first user/assistant exchange is not numbered as Message 1");
  }

  if (/exported_at|export_time|exported time/i.test(markdown)) {
    errors.push("contains export-time metadata");
  }

  if (/^(copy to clipboard|copy code|copy table|复制代码|复制表格|复制到剪贴板)$/im.test(markdown)) {
    errors.push("contains copied UI chrome text");
  }

  if (/^(python|c|c\+\+|cpp|javascript|typescript|bash|shell|json|sql)\s*\n```/im.test(markdown)) {
    errors.push("contains standalone code language label before a fence");
  }

  return { platform, errors };
}

const info = await stat(targetDir).catch(() => null);
if (!info || !info.isDirectory()) {
  console.error(`Export directory not found: ${targetDir}`);
  process.exit(1);
}

const files = await listMarkdownFiles(targetDir);
if (!files.length) {
  console.error(`No Markdown files found in: ${targetDir}`);
  process.exit(1);
}

const seenPlatforms = new Set();
let failureCount = 0;

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const displayPath = relative(targetDir, file).replace(/\\/g, "/");
  const fileBasename = basename(file);
  if (isReferenceExample(fileBasename, markdown)) {
    console.log(`SKIP ${displayPath}: reference example`);
    continue;
  }

  const result = validateFile(fileBasename, markdown);

  if (result.platform) {
    seenPlatforms.add(result.platform);
  }

  if (result.errors.length) {
    failureCount += 1;
    console.error(`FAIL ${displayPath}: ${result.errors.join(", ")}`);
  } else {
    console.log(`PASS ${displayPath}: ${result.platform}`);
  }
}

const missingPlatforms = allowPartial ? [] : Array.from(requiredPlatforms).filter((platform) => !seenPlatforms.has(platform));
if (missingPlatforms.length) {
  failureCount += 1;
  console.error(`Missing platform exports: ${missingPlatforms.join(", ")}`);
}

if (failureCount) {
  process.exit(1);
}

console.log("All exported Markdown files look RAG-ready.");
