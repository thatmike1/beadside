import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = fileURLToPath(new URL('.', import.meta.url))

// root is ui/, /api goes to the beadside server (or `pnpm run mock`) on 1338, or to BD_BOARD_API
const api = process.env.BD_BOARD_API ?? 'http://127.0.0.1:1338'

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
