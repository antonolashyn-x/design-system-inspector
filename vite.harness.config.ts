import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev harness: renders the extension UI next to a fixture page in an
// iframe, talking to the analyzer directly instead of through chrome.* APIs.
// Open http://localhost:5199/dev/harness.html
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: { port: 5199 },
});
