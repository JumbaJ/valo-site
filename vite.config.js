import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Two entries: the terminal, and the standalone turbo control at /unlock.html.
// The second is deliberately its own bundle — it shares localStorage with the
// main app (same origin) but nothing else, so neither can break the other.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        unlock: resolve(__dirname, 'unlock.html'),
      },
    },
  },
})
