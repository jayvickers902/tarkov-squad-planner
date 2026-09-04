import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // createClient() reaches these two packages on every page load even though
      // the app never uses Supabase Storage or Edge Functions. Aliasing them to
      // throwing stubs keeps them (and storage-js's own iceberg-js dependency)
      // out of the entry chunk. See build/supabase-storage-stub.js.
      // The companion has its own vite.config.js and is unaffected.
      { find: /^@supabase\/storage-js$/, replacement: fileURLToPath(new URL('./build/supabase-storage-stub.js', import.meta.url)) },
      { find: /^@supabase\/functions-js$/, replacement: fileURLToPath(new URL('./build/supabase-functions-stub.js', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    exclude: ['**/node_modules/**', 'companion/**'],
    server: {
      deps: {
        // Vitest externalises node_modules and loads them through native Node
        // ESM, which skips the resolve.alias above. Without this the suite would
        // run against the real Storage and Functions clients while the build
        // ships the stubs - a module graph the tests never actually exercise.
        inline: ['@supabase/storage-js', '@supabase/functions-js'],
      },
    },
  },
})
