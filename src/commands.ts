/**
 * Better Antigravity — VS Code command handlers.
 *
 * Each exported function is a command handler registered in extension.ts.
 *
 * @module commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { AntigravitySDK } from 'antigravity-sdk';
import { getWorkbenchDir, getBundleDir, getTargetFiles, isPatched, revertAll } from './auto-run';

/**
 * Show extension status in the output channel.
 */
export async function status(sdk: AntigravitySDK | null, botManager: any, output: vscode.OutputChannel): Promise<void> {
    const lines = [
        '=== Better Antigravity ===',
        '',
        `SDK:     ${sdk?.isInitialized ? `v${sdk.version}` : 'not initialized'}`,
        `LS:      ${sdk?.ls?.isReady ? `port ${sdk.ls.port} (CSRF: ${sdk.ls.hasCsrfToken ? 'found' : 'missing'})` : 'not ready'}`,
        `UI:      ${sdk?.integration.isInstalled() ? 'installed' : 'not installed'}`,
        `Titles:  ${sdk?.integration.titles.count ?? 0} custom`,
    ];

    if (sdk?.ls?.isReady) {
        try {
            output.appendLine('Testing LS connection...');
            await sdk.ls.getUserStatus();
            lines.splice(4, 0, `LS Auth: OK (Connection successful)`);
        } catch (err: any) {
            lines.splice(4, 0, `LS Auth: FAILED - ${err.message}`);
        }
    }

    if (botManager) {
        const metrics = botManager.getBridgeMetrics();
        if (metrics) {
            lines.push('', '--- Telegram Bridge ---');
            lines.push(`Outbox:  ${metrics.outbox}`);
            lines.push(`Pending: ${metrics.pending}`);
            lines.push(`Archive: ${metrics.archive} ${metrics.archive > 500 ? '⚠️ (Large)' : ''}`);
            lines.push(`Errors:  ${metrics.error} ${metrics.error > 0 ? '❌' : ''}`);
        }
    }

    const bundleDir = getBundleDir();
    if (bundleDir) {
        const files = getTargetFiles(bundleDir);
        for (const f of files) {
            const patched = await isPatched(f.path);
            lines.push(`AutoRun: ${f.label} = ${patched ? 'fixed' : 'not fixed'}`);
        }
    } else {
        lines.push('AutoRun: bundle directory not found');
    }

    output.appendLine(lines.join('\n'));
    output.show(true);
}

/**
 * Diagnostic probe for testing SDK capabilities.
 * This is designed to be hot-swapped for rapid iteration.
 */
export async function probeSDK(sdk: AntigravitySDK | null, output: vscode.OutputChannel): Promise<void> {
    if (!sdk) {
        output.appendLine('[probe] SDK not initialized.');
        return;
    }

    output.appendLine('=== SDK Probe Started ===');
    output.show(true);

    try {
        // Test 1: Check LS Readiness
        output.appendLine(`[probe] LS Ready: ${sdk.ls.isReady}`);
        if (sdk.ls.isReady) {
            output.appendLine(`[probe] LS Port: ${sdk.ls.port}`);
            output.appendLine(`[probe] LS CSRF: ${sdk.ls.hasCsrfToken}`);
        }

        // Test 2: List Cascades (Monitoring current state)
        const cascades = await sdk.ls.listCascades();
        const cascadeIds = Object.keys(cascades);
        output.appendLine(`[probe] Found ${cascadeIds.length} cascades.`);
        
        if (cascadeIds.length > 0) {
            const lastId = cascadeIds[0];
            output.appendLine(`[probe] Testing injection into cascade: ${lastId.substring(0, 8)}...`);
            
            // This is what we iterate on:
            // Attempt A: Direct ls.sendMessage
            const ok = await sdk.ls.sendMessage({
                cascadeId: lastId,
                text: "Probe: Can you hear me?"
            });
            output.appendLine(`[probe] ls.sendMessage result: ${ok}`);
        }

    } catch (err: any) {
        output.appendLine(`[probe] ERROR: ${err.message}`);
    }

    output.appendLine('=== SDK Probe Complete ===');
}

/**
 * Revert the auto-run fix and prompt for reload.
 *
 * Also clears V8 Code Cache to prevent stale cached patched code
 * from being loaded by Electron (which causes grey screen).
 */
export async function revertAutoRun(): Promise<void> {
    const dir = getBundleDir();
    if (!dir) {
        vscode.window.showErrorMessage('Bundle directory not found.');
        return;
    }

    const results = revertAll();
    const reverted = results.filter(r => r.status === 'reverted').length;

    if (reverted > 0) {
        // Clear V8 Code Cache — stale cache after revert causes grey screen
        let cacheBaseDir: string;
        if (process.platform === 'win32') {
            cacheBaseDir = path.join(process.env.APPDATA || '', 'Antigravity');
        } else if (process.platform === 'darwin') {
            cacheBaseDir = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Antigravity');
        } else {
            cacheBaseDir = path.join(process.env.HOME || '', '.config', 'Antigravity');
        }

        const cacheDirs = [
            path.join(cacheBaseDir, 'CachedData'),
            path.join(cacheBaseDir, 'GPUCache'),
            path.join(cacheBaseDir, 'Code Cache'),
        ];
        for (const d of cacheDirs) {
            try { await fsp.rm(d, { recursive: true, force: true }); } catch { /* may not exist */ }
        }

        const action = await vscode.window.showInformationMessage(
            `Auto-run fix reverted (${reverted} file(s)). Caches cleared. Reload to apply.`,
            'Reload Now',
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else {
        vscode.window.showInformationMessage('No backups found. Nothing to revert.');
    }
}

/**
 * Legacy Bridge: Test command to send a specific message to inbox.json.
 */
export async function sendMessageCommand(): Promise<void> {
    const text = await vscode.window.showInputBox({
        prompt: "Enter a message to send to the Antigravity Agent",
        placeHolder: "e.g., Explain the selected code"
    });
    
    if (text) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let inboxPath: string;
        if (workspaceFolders && workspaceFolders.length > 0) {
            inboxPath = path.join(workspaceFolders[0].uri.fsPath, 'inbox.json');
        } else {
            // Context is not available here easily, so use home dir as global fallback
            inboxPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.antigravity-inbox.json');
        }

        await fsp.writeFile(inboxPath, JSON.stringify({ text }));
        vscode.window.showInformationMessage(`Message written to ${inboxPath}`);
    }
}

/**
 * Legacy Bridge: Test command to say hello.
 */
export async function sayHelloCommand(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let inboxPath: string;
    if (workspaceFolders && workspaceFolders.length > 0) {
        inboxPath = path.join(workspaceFolders[0].uri.fsPath, 'inbox.json');
    } else {
        inboxPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.antigravity-inbox.json');
    }
    const text = "Hello from Better Antigravity Bridge!";
    await fsp.writeFile(inboxPath, JSON.stringify({ text }));
    vscode.window.showInformationMessage(`Hello message written to ${inboxPath}`);
}

/**
 * Commands for Telegram Bot Configuration
 */

export async function setTelegramToken(): Promise<void> {
    const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
    const currentToken = config.get<string>('botToken') || "";
    
    const token = await vscode.window.showInputBox({
        prompt: "Enter your Telegram Bot Token from @BotFather",
        value: currentToken,
        password: true
    });

    if (token !== undefined) {
        await config.update('botToken', token, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Telegram Bot Token ${token ? 'updated' : 'cleared'}.`);
    }
}

export async function toggleTelegramBot(): Promise<void> {
    const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
    const enabled = config.get<boolean>('enabled');
    
    await config.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Telegram Bot ${!enabled ? 'enabled' : 'disabled'}.`);
}

export async function addTelegramUser(): Promise<void> {
    const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
    const allowedUsers = config.get<string[]>('allowedUserIds') || [];
    
    const userId = await vscode.window.showInputBox({
        prompt: "Enter Telegram User ID to allow (e.g. 123456789)",
        placeHolder: "User ID"
    });

    if (userId && !allowedUsers.includes(userId)) {
        const newUsers = [...allowedUsers, userId];
        await config.update('allowedUserIds', newUsers, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`User ID ${userId} added to allowed list.`);
    } else if (userId) {
        vscode.window.showWarningMessage(`User ID ${userId} is already in the allowed list.`);
    }
}

export async function removeTelegramUser(): Promise<void> {
    const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
    const allowedUsers = config.get<string[]>('allowedUserIds') || [];
    
    if (allowedUsers.length === 0) {
        vscode.window.showInformationMessage("No users in the allowed list.");
        return;
    }

    const userId = await vscode.window.showQuickPick(allowedUsers, {
        placeHolder: "Select a Telegram User ID to remove"
    });

    if (userId) {
        const newUsers = allowedUsers.filter(id => id !== userId);
        await config.update('allowedUserIds', newUsers, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`User ID ${userId} removed from allowed list.`);
    }
}

export async function showTelegramLogs(manager: any): Promise<void> {
    if (manager) {
        manager.showLogs();
    } else {
        vscode.window.showWarningMessage("Telegram Bot manager not initialized.");
    }
}
