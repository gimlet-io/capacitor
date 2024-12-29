import { defineConfig } from "vite";
import eslint from 'vite-plugin-eslint'

export default defineConfig({
  plugins: [eslint()],
  esbuild: {
    jsx: "transform",
    jsxFactory: "m",
    jsxFragment: "'['",
  },
});
