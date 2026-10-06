// Resizes the master logo (assets/logo.png, 512×512) into the extension icon sizes.
// Uses macOS `sips`, so no image dependencies are needed.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'assets/logo.png');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const out = resolve(outDir, `icon-${size}.png`);
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' });
  console.log(`icons/icon-${size}.png`);
}
