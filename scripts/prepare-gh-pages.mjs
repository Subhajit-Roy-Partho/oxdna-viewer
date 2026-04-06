import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, ".gh-pages-dist");

const fileEntries = [
  "index.html",
  "renderer.js",
  "favicon.png",
  "file-format.md",
  "test.html",
];

const directoryEntries = [
  "css",
  "dist",
  "examples",
  "favicons",
  "img",
  "mif",
  path.join("ts", "lib"),
];

async function copyEntry(relativePath) {
  const source = path.join(rootDir, relativePath);
  const destination = path.join(outputDir, relativePath);
  const sourceStats = await stat(source);

  if (sourceStats.isDirectory()) {
    await cp(source, destination, { recursive: true });
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const relativePath of [...fileEntries, ...directoryEntries]) {
  await copyEntry(relativePath);
}

await writeFile(path.join(outputDir, ".nojekyll"), "");
