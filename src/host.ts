import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let currentEngine: any = null;
let reloadCount = 0;
const MAX_RELOADS = 20;

export async function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Better Antigravity (Host)');
    context.subscriptions.push(output);
    output.appendLine('Host activated. Monitoring for Engine reloads...');

    const reloadsDir = path.join(context.extensionPath, 'dist', 'reloads');
    if (!fs.existsSync(reloadsDir)) fs.mkdirSync(reloadsDir, { recursive: true });

    // Watch for new versioned directories (atomic moves)
    const watcher = fs.watch(reloadsDir, (event, filename) => {
        if (event === 'rename' && filename) {
            const fullDir = path.join(reloadsDir, filename);
            
            // Re-verify it is a directory and not a transient file
            setTimeout(() => {
                if (fs.existsSync(fullDir) && fs.lstatSync(fullDir).isDirectory()) {
                    const enginePath = path.join(fullDir, 'engine.js');
                    if (fs.existsSync(enginePath)) {
                        reloadEngine(context, fullDir, output);
                    }
                }
            }, 100); // Tiny delay to ensure move is finalized by OS
        }
    });

    context.subscriptions.push({ dispose: () => watcher.close() });


    // Register Force Reload command
    context.subscriptions.push(
        vscode.commands.registerCommand('better-antigravity.forceReload', () => {
            const currentVersions = fs.readdirSync(reloadsDir).filter(v => /^\d+$/.test(v)).sort((a,b) => Number(a) - Number(b));
            if (currentVersions.length > 0) {
                const latest = path.join(reloadsDir, currentVersions[currentVersions.length - 1]);
                output.appendLine('Manual Force Reload requested.');
                reloadEngine(context, latest, output, true); // Force flag true
            } else {
                vscode.window.showErrorMessage('No Engine versions found to reload.');
            }
        })
    );

    // Initial load: find the latest versioned directory
    const versions = fs.readdirSync(reloadsDir).filter(v => /^\d+$/.test(v)).sort((a,b) => Number(a) - Number(b));
    if (versions.length > 0) {
        const latest = path.join(reloadsDir, versions[versions.length - 1]);
        reloadEngine(context, latest, output);
    }
}

async function reloadEngine(context: vscode.ExtensionContext, engineDir: string, output: vscode.OutputChannel, force = false) {
    const enginePath = path.join(engineDir, 'engine.js');
    
    // Check if this engine is already loaded to avoid redundant reloads
    // (fs.watch can be noisy)
    const normalizedPath = path.normalize(enginePath);
    if (!force && currentEngine && currentEngine._path === normalizedPath) {
        return;
    }

    reloadCount++;
    output.appendLine(`--- Reload #${reloadCount} detected at ${engineDir} ---`);

    // Requirement 6: Memory Leak Counter
    if (reloadCount > MAX_RELOADS) {
        output.appendLine('CRITICAL: Max reload count reached. Window reload required for memory cleanup.');
        vscode.commands.executeCommand('workbench.action.reloadWindow');
        return;
    }

    // Phase 1: Teardown with Strict Timeout (Requirement 4)
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
            // Requirement 5: Nuke from orbit fallback
            vscode.commands.executeCommand('workbench.action.reloadWindow');
            return;
        }
    }

    // Phase 2: Cache Busting (Requirement 2 byproduct - paths change, but we also clear for good measure)
    // Node.js caches by absolute path.
    Object.keys(require.cache).forEach(key => {
        if (key.includes(path.normalize(context.extensionPath))) {
            delete require.cache[key];
        }
    });

    // Phase 3: Activation
    try {
        output.appendLine(`Loading engine from ${enginePath}...`);
        const engine = require(enginePath);
        
        if (engine && typeof engine.start === 'function') {
            await engine.start(context);
            engine._path = normalizedPath;
            currentEngine = engine;
            output.appendLine('✅ Engine successfully activated.');
        } else {
            throw new Error('Engine module does not export a valid start() function.');
        }
    } catch (err) {
        output.appendLine(`CRITICAL ERROR during engine activation: ${err}. NUKING FROM ORBIT.`);
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export function deactivate() {
    if (currentEngine && currentEngine.stop) {
        currentEngine.stop();
    }
}
