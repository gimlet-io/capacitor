/// <reference lib="deno.ns" />

import { join, dirname } from "https://deno.land/std/path/mod.ts";
import { ensureDir } from "https://deno.land/std/fs/mod.ts";
import { files } from "./embedded.ts";

// Get the directory of the current script
const __dirname = new URL(".", import.meta.url).pathname;

async function setupTempDir(): Promise<string> {
  const tempDir = join(Deno.makeTempDirSync(), "k8s-dashboard");
  await ensureDir(tempDir);
  
  // Write embedded files to temp directory
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(tempDir, relativePath);
    await ensureDir(dirname(filePath));
    const binaryContent = Uint8Array.from(atob(content as string), c => c.charCodeAt(0));
    await Deno.writeFile(filePath, binaryContent);
  }
  
  return tempDir;
}

async function startKubectlProxy(wwwDir: string) {
  const process = new Deno.Command("kubectl", {
    args: [
      "proxy",
      "--www=" + wwwDir,
      "--www-prefix=/",
      "--api-prefix=/k8s"
    ],
    stdout: "inherit",
    stderr: "inherit"
  });

  const child = process.spawn();
  
  // Handle process termination
  Deno.addSignalListener("SIGINT", () => {
    console.log("\nShutting down...");
    child.kill("SIGTERM");
    Deno.exit(0);
  });

  // Wait for the process to complete
  await child.status;
}

async function main() {
  try {
    console.log("Setting up temporary directory...");
    const tempDir = await setupTempDir();
    
    console.log("Starting kubectl proxy...");
    console.log(`Static files served from: ${tempDir}`);
    await startKubectlProxy(tempDir);
  } catch (error: unknown) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

// Run the application
if (import.meta.main) {
  main();
}
