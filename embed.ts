/// <reference lib="deno.ns" />

import { join, dirname } from "https://deno.land/std/path/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";

const __dirname = new URL(".", import.meta.url).pathname;

// Create a temp build directory
const buildDir = join(__dirname, "build");
await ensureDir(buildDir);

// Create a new file that embeds our public directory as a base64 string
const publicDir = join(__dirname, "public");
const files: Record<string, string> = {};

async function embedFiles(dir: string, basePath: string = "") {
  for await (const entry of Deno.readDir(dir)) {
    const fullPath = join(dir, entry.name);
    const relativePath = join(basePath, entry.name);
    
    if (entry.isFile) {
      console.log("Embedding " + relativePath);
      const content = await Deno.readFile(fullPath);
      const base64 = btoa(String.fromCharCode(...content));
      files[relativePath] = base64;
    } else if (entry.isDirectory) {
      await embedFiles(fullPath, relativePath);
    }
  }
}

// Recursively read all files in the public directory
await embedFiles(publicDir);

// Create the embedded.ts file
const embeddedContent = `
// This file is auto-generated. Do not edit.
export const files = ${JSON.stringify(files, null, 2)};
`;

await Deno.writeTextFile(join(buildDir, "embedded.ts"), embeddedContent);

console.log("Embedding completed!");
