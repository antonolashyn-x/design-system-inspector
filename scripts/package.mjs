// Zips the built extension (dist/) into release/design-system-inspector-v<version>.zip.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'manifest.json'))) throw new Error('dist/ is missing — run `npm run build` first');

const { version } = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outDir = resolve(root, 'release');
const out = resolve(outDir, `design-system-inspector-v${version}.zip`);
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.DS_Store', '*/.DS_Store'], { cwd: dist, stdio: 'inherit' });
console.log(`Packed ${out}`);
