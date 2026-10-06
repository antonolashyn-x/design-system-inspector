import { defineConfig } from 'vite';

// The content script is injected with chrome.scripting.executeScript, which
// requires a classic (non-module) script — so it is bundled as a single IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content/index.ts',
      formats: ['iife'],
      name: 'DesignSystemInspector',
      fileName: () => 'content.js',
    },
  },
});
