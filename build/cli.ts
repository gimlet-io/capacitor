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

// Function to generate a random port number
function getRandomPort(): number {
  return Math.floor(Math.random() * (65535 - 1024) + 1024); // Random port between 1024 and 65535
}

async function startKubectlProxy(wwwDir: string) {
  const port = getRandomPort();
  const kubectlCommand = new Deno.Command('kubectl', {
    args: [
      'proxy',
      `--port=${port}`,
      `--www=${wwwDir}`,
      '--www-prefix=/',
      '--api-prefix=/k8s'
    ],
  });

  const process = kubectlCommand.spawn();
  
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) {
    Deno.addSignalListener(signal as Deno.Signal, () => {
      console.log(`Received ${signal}, stopping kubectl proxy...`);
      process.kill(signal as Deno.Signal);
      Deno.exit(0);
    });
  }

  // Wait for the process to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`kubectl proxy started on port ${port}`);
  
  // Launch the default browser with the correct URL
  const url = `http://127.0.0.1:${port}`;
  const os = Deno.build.os;
  let cmd: string[];

  switch (os) {
    case 'darwin':
      cmd = ['open', url];
      break;
    case 'linux':
      cmd = ['xdg-open', url];
      break;
    case 'windows':
      cmd = ['start', url];
      break;
    default:
      console.error(`Unsupported OS: ${os}`);
      return;
  }

  const browserProcess = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
  });
  browserProcess.spawn();

  // Wait for the process to exit
  const status = await process.status;
  if (!status.success) {
    console.error(`kubectl proxy exited with code ${status.code}`);
  }
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
