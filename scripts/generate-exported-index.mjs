import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname;
const targetArg = process.argv[2] || process.env.AI_CHAT_EXPORT_ROOT || "";
const targetRoot = targetArg ? resolve(targetArg) : "";
const outputPath = join(projectRoot, "src", "exported-markdown-index.json");

function unescapeMetadataValue(value) {
  let clean = String(value || "").trim();
  if ((clean.startsWith("\"") && clean.endsWith("\"")) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1);
  }

  return clean.replace(/\\"/g, "\"").replace(/\\\\/g, "\\").trim();
}

function metadataFieldName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function assignMetadataField(target, key, value) {
  const cleanValue = unescapeMetadataValue(value);
  if (!cleanValue) {
    return;
  }

  const normalizedKey = metadataFieldName(key);
  if (normalizedKey === "platform") {
    target.platform = target.platform || cleanValue;
  } else if (normalizedKey === "source_url") {
    target.sourceUrl = target.sourceUrl || cleanValue;
  } else if (normalizedKey === "conversation_id") {
    target.conversationId = target.conversationId || cleanValue;
  } else if (normalizedKey === "conversation_title") {
    target.title = target.title || cleanValue;
  } else if (normalizedKey === "needs_media") {
    target.needsMedia = target.needsMedia || cleanValue;
  }
}

function parseMarkdownMetadata(markdown) {
  const metadata = {
    platform: "",
    sourceUrl: "",
    conversationId: "",
    title: "",
    needsMedia: ""
  };

  const frontMatter = String(markdown || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontMatter) {
    for (const line of frontMatter[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (field) {
        assignMetadataField(metadata, field[1], field[2]);
      }
    }
  }

  const visibleMetadata = String(markdown || "").match(/(?:^|\r?\n)## Metadata\s*\r?\n+([\s\S]*?)(?=\r?\n## |\r?\n# |$)/i);
  if (visibleMetadata) {
    for (const line of visibleMetadata[1].split(/\r?\n/)) {
      const field = line.match(/^\s*-\s*([^:]+?)\s*:\s*(.*?)\s*$/);
      if (field) {
        assignMetadataField(metadata, field[1], field[2]);
      }
    }
  }

  return metadata;
}

async function listMarkdownFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
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

const markdownFiles = targetRoot ? await listMarkdownFiles(targetRoot) : [];
const files = [];

for (const filename of markdownFiles.sort()) {
  const markdown = await readFile(filename, "utf8").catch(() => "");
  const relativePath = relative(targetRoot, filename).replace(/\\/g, "/");
  const parts = relativePath.split("/").filter(Boolean);
  files.push({
    filename: filename.replace(/\\/g, "/"),
    relativePath,
    basename: basename(filename),
    platformFolder: parts.length > 1 ? parts[0] : "",
    metadata: parseMarkdownMetadata(markdown)
  });
}

const payload = {
  version: 1,
  root: targetRoot.replace(/\\/g, "/"),
  files
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
if (targetRoot) {
  console.log(`Indexed ${files.length} exported Markdown files at ${outputPath}`);
} else {
  console.log(`No export root configured; wrote an empty exported Markdown index at ${outputPath}`);
}
