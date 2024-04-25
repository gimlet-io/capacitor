import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: 'build',
  },
  base: '/',
  plugins: [react()],
  server: {
    open: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9000',
      },
    },
  },
})
