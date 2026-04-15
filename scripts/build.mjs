import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname;
const dist = join(projectRoot, "dist");
const ignoredNames = new Set([".DS_Store"]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ["manifest.json", "src", "README.md", "docs"]) {
  await cp(join(projectRoot, entry), join(dist, entry), {
    recursive: true,
    filter: (source) => !ignoredNames.has(source.split("/").pop())
  });
}

console.log(`Built extension at ${dist}`);
