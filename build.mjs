import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'es2020',
    sourcemap: true,
    minify: false,
    // Resolve antigravity-sdk from monorepo sibling
    alias: {
        'antigravity-sdk': path.resolve('..', 'antigravity-sdk', 'dist', 'index.js'),
    },
};

// Ensure dist/ exists
if (!fs.existsSync('dist')) fs.mkdirSync('dist');

// Copy sql-wasm.wasm to dist/ (required by antigravity-sdk's StateBridge)
const wasmSearchPaths = [
    path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join('..', 'antigravity-sdk', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
];

let wasmCopied = false;
for (const wasmSrc of wasmSearchPaths) {
    if (fs.existsSync(wasmSrc)) {
        fs.copyFileSync(wasmSrc, path.join('dist', 'sql-wasm.wasm'));
        console.log(`Copied sql-wasm.wasm from ${wasmSrc}`);
        wasmCopied = true;
        break;
    }
}
if (!wasmCopied) {
    console.error('ERROR: sql-wasm.wasm not found. Run "npm install" first.');
    process.exit(1);
}

if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('Watching...');
} else {
    await esbuild.build(config);
    console.log('Build complete');
}
