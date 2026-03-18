import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'dist', 'vendor');

await mkdir(outdir, { recursive: true });

const common = {
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	logLevel: 'info',
};

await build({
	...common,
	entryPoints: [path.join(root, 'scripts', 'three-browser-entry.mjs')],
	outfile: path.join(outdir, 'three-compat.js'),
});

await build({
	...common,
	entryPoints: [path.join(root, 'scripts', 'three-worker-entry.mjs')],
	outfile: path.join(outdir, 'three-core-compat.js'),
});
