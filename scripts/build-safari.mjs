import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionDist = join(projectRoot, "dist");
const safariDist = join(projectRoot, "dist-safari");
const safariExtensionDist = join(safariDist, "web-extension");
const appName = "AI Chat Markdown Exporter Safari";
const bundleIdentifier = "com.mayifan.aichatmdexporter.safari";
const safariProjectRoot = join(safariDist, appName);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await import("./build.mjs");

await rm(safariDist, { recursive: true, force: true });
await mkdir(safariExtensionDist, { recursive: true });
await cp(extensionDist, safariExtensionDist, { recursive: true });

const manifestPath = join(safariExtensionDist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.permissions = Array.from(new Set([
  ...(manifest.permissions || []).filter((permission) => permission !== "downloads"),
  "nativeMessaging"
]));
for (const contentScript of manifest.content_scripts || []) {
  delete contentScript.world;
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await run("xcrun", [
  "safari-web-extension-converter",
  safariExtensionDist,
  "--project-location",
  safariDist,
  "--app-name",
  appName,
  "--bundle-identifier",
  bundleIdentifier,
  "--macos-only",
  "--copy-resources",
  "--no-open",
  "--no-prompt",
  "--force"
]);

await copyFile(
  join(projectRoot, "safari", "SafariWebExtensionHandler.swift"),
  join(safariProjectRoot, `${appName} Extension`, "SafariWebExtensionHandler.swift")
);

const projectPath = join(safariProjectRoot, `${appName}.xcodeproj`, "project.pbxproj");
const projectSource = await readFile(projectPath, "utf8");
const patchedProjectSource = projectSource
  .replace(/ENABLE_APP_SANDBOX = YES;/g, "ENABLE_APP_SANDBOX = NO;")
  .replace(
    /PRODUCT_BUNDLE_IDENTIFIER = "?com\.mayifan\.aichatmdexporter\.AI-Chat-Markdown-Exporter-Safari"?;/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};`
  )
  .replace(
    /PRODUCT_BUNDLE_IDENTIFIER = com\.mayifan\.aichatmdexporter\.safari\.Extension;/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier}.Extension;`
  );
await writeFile(projectPath, patchedProjectSource);

console.log(`Built Safari Web Extension project at ${safariDist}`);
