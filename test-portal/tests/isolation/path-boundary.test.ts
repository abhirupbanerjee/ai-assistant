import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const portalRoot = path.resolve(import.meta.dirname, "../..");
const ignoredDirectories = new Set([".git", ".next", "node_modules"]);
const textExtensions = new Set([
  ".css", ".dockerignore", ".env", ".example", ".html", ".js", ".json", ".jsx",
  ".md", ".mjs", ".ts", ".tsx", ".yaml", ".yml",
]);

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    assert.equal(metadata.isSymbolicLink(), false, `Symlinks are prohibited: ${absolutePath}`);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else files.push(absolutePath);
  }
  return files;
}

test("all portal files resolve inside the standalone root", async () => {
  for (const file of await walk(portalRoot)) {
    const resolved = await realpath(file);
    assert.ok(resolved.startsWith(`${portalRoot}${path.sep}`), `${file} escapes the portal root`);
  }
});

test("package dependencies cannot reference parent paths or workspaces", async () => {
  const manifest = JSON.parse(await readFile(path.join(portalRoot, "package.json"), "utf8")) as {
    workspaces?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(manifest.workspaces, undefined, "Portal package cannot declare workspaces");
  for (const [name, specifier] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    assert.doesNotMatch(specifier, /^(?:file|link|workspace):|\.\.[/\\]/, `${name} escapes portal root`);
  }
});

test("source imports and generated-output settings cannot escape the portal root", async () => {
  const relativeImport = /(?:from\s*|import\s*\(|require\s*\()\s*["'](\.{1,2}[/\\][^"']*)["']/g;
  const stablePathReference = /(?:^|["'`\s])(?:\.\.\/)+(?:src|services)(?:\/|["'`])/m;
  for (const file of await walk(portalRoot)) {
    const extension = path.extname(file);
    if (!textExtensions.has(extension) && !path.basename(file).startsWith(".env")) continue;
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(relativeImport)) {
      const resolvedImport = path.resolve(path.dirname(file), match[1]);
      assert.ok(
        resolvedImport === portalRoot || resolvedImport.startsWith(`${portalRoot}${path.sep}`),
        `${file} imports outside portal root: ${match[1]}`,
      );
    }
    assert.doesNotMatch(contents, stablePathReference, `${file} references a stable source path`);
  }

  const tsconfig = await readFile(path.join(portalRoot, "tsconfig.json"), "utf8");
  assert.doesNotMatch(tsconfig, /(?:outDir|declarationDir)\s*["']?\s*:\s*["']\.\./, "Generated output escapes portal root");
});

test("Docker copies only paths from the portal build context", async () => {
  const dockerfile = await readFile(path.join(portalRoot, "Dockerfile"), "utf8");
  for (const line of dockerfile.split("\n")) {
    const instruction = line.trim();
    if (!/^(COPY|ADD)\s/i.test(instruction)) continue;
    assert.doesNotMatch(instruction, /(?:^|\s)\.\.(?:\/|\s|$)/, `Docker source escapes context: ${line}`);
    if (!/^COPY\s+--from=/i.test(instruction)) {
      assert.doesNotMatch(instruction, /(?:^|\s)\//, `Docker source is absolute: ${line}`);
    }
  }
});
