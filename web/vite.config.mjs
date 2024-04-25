import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import eslint from 'vite-plugin-eslint'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: 'build',
  },
  base: '/',
  plugins: [react(), eslint()],
  server: {
    open: true,
    port: 3000,
    proxy: {
      "/": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
