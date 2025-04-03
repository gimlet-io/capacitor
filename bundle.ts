import * as esbuild from "npm:esbuild@0.20.2";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";
import { solidPlugin } from "npm:esbuild-plugin-solid";

const result = await esbuild.build({
  plugins: [solidPlugin(), ...denoPlugins()],
  entryPoints: ["src/app.tsx"],
  outdir: "public/js",
  bundle: true,
  format: "esm",
  platform: "browser",
//   minify: true,
});

console.log(result)
esbuild.stop();
console.log("Done")
