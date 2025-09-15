import * as esbuild from "npm:esbuild@0.25.9";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";
import { solidPlugin } from "npm:esbuild-plugin-solid@0.6.0";

// Utility to compute short hex from ArrayBuffer
function toShortHex(input: ArrayBuffer): string {
    const bytes = new Uint8Array(input);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8);
}

async function hashAndRenameCss(): Promise<string | null> {
    const cssDir = "bundle/styles";
    const baseName = "main.css";
    const basePath = `${cssDir}/${baseName}`;

    try {
        const cssContent = await Deno.readFile(basePath);
        const digest = await crypto.subtle.digest("SHA-256", cssContent);
        const shortHash = toShortHex(digest);
        const hashedName = `main-${shortHash}.css`;
        const hashedPath = `${cssDir}/${hashedName}`;

        // Write/overwrite hashed file
        await Deno.writeFile(hashedPath, cssContent);

        // Cleanup old hashed CSS assets except current one
        for await (const entry of Deno.readDir(cssDir)) {
            if (!entry.isFile) continue;
            if (entry.name.startsWith("main-") && entry.name.endsWith(".css") && entry.name !== hashedName) {
                try { await Deno.remove(`${cssDir}/${entry.name}`); } catch (_) { /* ignore */ }
            }
        }

        // Remove the non-hashed source CSS from bundle
        try { await Deno.remove(basePath); } catch (_) { /* ignore */ }

        return hashedName;
    } catch (_) {
        // If CSS not found, skip gracefully
        return null;
    }
}

function findHashedJsFromMetafile(metafile: esbuild.Metafile | undefined): string | null {
    if (!metafile) return null;
    const outputs = metafile.outputs ?? {};
    const jsOutputs = Object.keys(outputs).filter((p) => p.startsWith("bundle/js/") && p.endsWith(".js"));
    // Prefer app-*.js, fallback to first js output
    const appOutput = jsOutputs.find((p) => /\bapp-[a-f0-9]{8}\.js$/.test(p)) || jsOutputs[0];
    if (!appOutput) return null;
    return appOutput.replace("bundle/js/", "");
}

async function rewriteIndexHtml({ jsFileName, cssFileName }: { jsFileName: string | null; cssFileName: string | null }): Promise<void> {
    const indexPath = "bundle/index.html";
    let html = await Deno.readTextFile(indexPath);

    if (jsFileName) {
        html = html.replace(/src="js\/[^"]+\.js"/g, `src="js/${jsFileName}"`);
    }

    if (cssFileName) {
        html = html.replace(/href="styles\/[^"]+\.css"/g, `href="styles/${cssFileName}"`);
    }

    await Deno.writeTextFile(indexPath, html);
}

// Ensure bundle/ exists and copy static assets from public/ to bundle/
async function copyDir(src: string, dest: string): Promise<void> {
    await Deno.mkdir(dest, { recursive: true });
    for await (const entry of Deno.readDir(src)) {
        const srcPath = `${src}/${entry.name}`;
        const destPath = `${dest}/${entry.name}`;
        if (entry.isDirectory) {
            await copyDir(srcPath, destPath);
        } else if (entry.isFile) {
            const data = await Deno.readFile(srcPath);
            await Deno.writeFile(destPath, data);
        }
    }
}

// Clean and prepare bundle directory
try { await Deno.remove("bundle", { recursive: true }); } catch (_) { /* ignore */ }
await Deno.mkdir("bundle", { recursive: true });
await copyDir("public", "bundle");

// Build with hashed JS filenames into bundle/
const buildResult = await esbuild.build({
    plugins: [solidPlugin(), ...denoPlugins()],
    entryPoints: ["src/app.tsx"],
    outdir: "bundle/js",
    bundle: true,
    format: "esm",
    platform: "browser",
    entryNames: "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    metafile: true,
    write: true
});

const jsFileName = findHashedJsFromMetafile(buildResult.metafile);

// Remove old JS assets in bundle/ except current hash
if (jsFileName) {
    for await (const entry of Deno.readDir("bundle/js")) {
        if (!entry.isFile) continue;
        const matchesOldAppPattern = (/^app-[a-f0-9]{8}\.js$/).test(entry.name) && entry.name !== jsFileName;
        const matchesLegacyAppName = entry.name === "app.js"; // clean legacy un-hashed build
        if (matchesOldAppPattern || matchesLegacyAppName) {
            try { await Deno.remove(`bundle/js/${entry.name}`); } catch (_) { /* ignore */ }
        }
    }
}

// Hash and rename CSS, then rewrite index.html to point to hashed assets
const cssFileName = await hashAndRenameCss();
await rewriteIndexHtml({ jsFileName, cssFileName });

esbuild.stop();
console.log("Build complete to bundle/ with hashed assets:", { jsFileName, cssFileName });
