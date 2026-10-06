import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the sidebar UI and the background service worker. Static files in
// /public (manifest.json, icons, help.html) are copied as-is into dist/.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { sidebar: 'sidebar.html', background: 'src/background.ts' },
      output: {
        // The manifest references the service worker by a fixed name.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
