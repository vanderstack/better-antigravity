import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

/**
 * Build the Host (Bootstrap Loader)
 * This is built once (or on every change to host.ts) and stays active.
 */
async function buildHost() {
    console.log('Building Host...');
    await esbuild.build({
        entryPoints: ['src/host.ts'],
        bundle: true,
        outfile: 'dist/extension.js',
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        target: 'es2020',
        sourcemap: true,
        minify: false,
    });
    console.log('Host build complete.');
}

/**
 * Build the Engine (Core Logic)
 * In watch mode, this builds into a new versioned directory every time.
 */
async function buildEngine() {
    const version = Date.now().toString();
    const stagingDir = path.join('dist', '.staging');
    const finalDir = path.join('dist', 'reloads', version);
    const outfile = path.join(stagingDir, 'engine.js');
    
    // Clean and prepare staging directory
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    console.log(`Building Engine v${version} (staging)...`);
    
    const config = {
        entryPoints: ['src/engine.ts'],
        bundle: true,
        outfile: outfile,
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        target: 'es2020',
        sourcemap: true,
        minify: false,
        alias: {
            'antigravity-sdk': path.resolve('..', 'antigravity-sdk'),
        },
    };

    try {
        await esbuild.build(config);
        console.log(`Engine v${version} build complete.`);

        // Copy dependencies (sql.js) to the staging directory
        const sqlFiles = ['sql-wasm.wasm', 'sql-wasm.js'];
        for (const sqlFile of sqlFiles) {
            const searchPaths = [
                path.join('node_modules', 'sql.js', 'dist', sqlFile),
                path.join('..', 'antigravity-sdk', 'node_modules', 'sql.js', 'dist', sqlFile),
            ];

            for (const src of searchPaths) {
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(stagingDir, sqlFile));
                    break;
                }
            }
        }

        // Finalize: Atomic move to watcher path
        if (!fs.existsSync(path.join('dist', 'reloads'))) fs.mkdirSync(path.join('dist', 'reloads'), { recursive: true });
        fs.renameSync(stagingDir, finalDir);
        console.log(`Engine v${version} is ready for hot-swap.`);
    } catch (err) {
        console.error('Build failed. Staging directory preserved for debugging or cleaned.');
        throw err;
    }
}

// Ensure dist exists
if (!fs.existsSync('dist')) fs.mkdirSync('dist');

await buildHost();
await buildEngine();
console.log('Full Build complete');

