import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';

let currentEngine: any = null;
let reloadCount = 0;
let isReloading = false; // Mutex to prevent overlapping reloads
const MAX_RELOADS = 20;

export async function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Better Antigravity (Host)');
    context.subscriptions.push(output);
    output.appendLine('Host activated. Monitoring for Engine reloads (Reliability Mode)...');

    const reloadsDir = path.join(context.extensionPath, 'dist', 'reloads');
    if (!fs.existsSync(reloadsDir)) fs.mkdirSync(reloadsDir, { recursive: true });

    const getLatestVersionDir = () => {
        try {
            const versions = fs.readdirSync(reloadsDir).filter(v => /^\d+$/.test(v)).sort((a,b) => Number(a) - Number(b));
            if (versions.length > 0) {
                return path.join(reloadsDir, versions[versions.length - 1]);
            }
        } catch {}
        return null;
    };

    // 1. Initial load: catch up to latest build on startup
    // We AWAIT this to ensure commands are registered before watchers start
    const latest = getLatestVersionDir();
    if (latest) {
        output.appendLine(`Initial activation: loading latest engine from ${path.basename(latest)}`);
        await reloadEngine(context, latest, output);
    }

    // 2. Robust Watcher using Chokidar
    const watcher = chokidar.watch(reloadsDir, {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        }
    });

    watcher.on('addDir', (dirPath) => {
        const basename = path.basename(dirPath);
        if (/^\d+$/.test(basename)) {
            output.appendLine(`[watcher] New version detected: ${basename}`);
            reloadEngine(context, dirPath, output);
        }
    });

    context.subscriptions.push({ dispose: () => watcher.close() });

    // 3. 5s Convergence Poll (Belt and Suspenders)
    const pollInterval = setInterval(() => {
        const latest = getLatestVersionDir();
        if (latest) {
            const enginePath = path.join(latest, 'engine.js');
            if (fs.existsSync(enginePath)) {
                reloadEngine(context, latest, output);
            }
        }
    }, 5000);

    context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });

    // 4. Force Reload command
    context.subscriptions.push(
        vscode.commands.registerCommand('better-antigravity.forceReload', () => {
            const latest = getLatestVersionDir();
            if (latest) {
                output.appendLine('Manual Force Reload requested.');
                reloadEngine(context, latest, output, true);
            } else {
                vscode.window.showErrorMessage('No Engine versions found to reload.');
            }
        })
    );
}

async function reloadEngine(context: vscode.ExtensionContext, engineDir: string, output: vscode.OutputChannel, force = false) {
    // Mutex check
    if (isReloading) return;
    
    const enginePath = path.join(engineDir, 'engine.js');
    if (!fs.existsSync(enginePath)) return;
    
    // Check if this engine is already loaded
    const normalizedPath = path.normalize(enginePath);
    if (!force && currentEngine && currentEngine._path === normalizedPath) {
        return;
    }

    isReloading = true;
    try {
        reloadCount++;
        output.appendLine(`--- Reload #${reloadCount} triggered at ${path.basename(engineDir)} ---`);

        // Memory Leak Counter
        if (reloadCount > MAX_RELOADS) {
            output.appendLine('CRITICAL: Max reload count reached. Window reload required.');
            vscode.commands.executeCommand('workbench.action.reloadWindow');
            return;
        }

        // Phase 1: Teardown
        if (currentEngine) {
            output.appendLine('Stopping previous engine...');
            try {
                await Promise.race([
                    currentEngine.stop ? currentEngine.stop() : Promise.resolve(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Teardown Timeout')), 2000))
                ]);
                output.appendLine('Previous engine stopped successfully.');
            } catch (err) {
                output.appendLine(`CRITICAL ERROR during teardown: ${err}. NUKING FROM ORBIT.`);
                vscode.commands.executeCommand('workbench.action.reloadWindow');
                return;
            }
        }

        // Phase 2: Cache Busting
        Object.keys(require.cache).forEach(key => {
            if (key.includes(path.normalize(context.extensionPath))) {
                delete require.cache[key];
            }
        });

        // Phase 3: Activation
        output.appendLine(`Loading engine module...`);
        const engine = require(enginePath);
        
        if (engine && typeof engine.start === 'function') {
            await engine.start(context);
            engine._path = normalizedPath;
            currentEngine = engine;
            output.appendLine(`✅ Engine v${path.basename(engineDir)} activated.`);
        } else {
            throw new Error('Engine module does not export a valid start() function.');
        }
    } catch (err) {
        output.appendLine(`CRITICAL ERROR during engine activation: ${err}. NUKING FROM ORBIT.`);
        // Note: We don't release the mutex here because the window will reload
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    } finally {
        isReloading = false;
    }
}

export function deactivate() {
    if (currentEngine && currentEngine.stop) {
        currentEngine.stop();
    }
}
