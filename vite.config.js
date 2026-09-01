import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    // The companion is a separate Vite package with its own dependency graph
    // and test setup. Keeping its specs out of the website project prevents
    // cross-package jsdom state and duplicate React test roots.
    exclude: ['companion/**', 'node_modules/**'],
  },
})
