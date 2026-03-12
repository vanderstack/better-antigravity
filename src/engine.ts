/**
 * Better Antigravity — Extension entry point.
 *
 * Thin orchestrator: wires up modules, no business logic here.
 *
 * @module extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AntigravitySDK, Logger, LogLevel } from 'antigravity-sdk';
import { autoApply, getWorkbenchDir } from './auto-run';
import { 
    status, 
    revertAutoRun, 
    sendMessageCommand, 
    sayHelloCommand,
    setTelegramToken,
    toggleTelegramBot,
    addTelegramUser,
    removeTelegramUser,
    showTelegramLogs
} from './commands';
import { initializeBridge } from './bridge';
import { initializeTelegramBot } from './telegram/bot';

let sdk: AntigravitySDK | null = null;
let botManager: any = null;
let output: vscode.OutputChannel;
let engineDisposables: vscode.Disposable[] = [];

function log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 19);
    output?.appendLine(`[${ts}] ${msg}`);
}

export async function start(context: vscode.ExtensionContext) {
    engineDisposables = [];
    output = vscode.window.createOutputChannel('Better Antigravity');
    engineDisposables.push(output);
    log('Engine starting...');

    // Set SDK Log Level to Info to see RPC calls in console
    Logger.setLevel(LogLevel.Info);

    // ── Commands ──────────────────────────────────────────────────────
    // ── Commands ──────────────────────────────────────────────────────
    engineDisposables.push(
        vscode.commands.registerCommand('better-antigravity.status', () => status(sdk, botManager, output)),
        vscode.commands.registerCommand('better-antigravity.revertAutoRun', revertAutoRun),
        vscode.commands.registerCommand('antigravity-bridge.sendMessage', sendMessageCommand),
        vscode.commands.registerCommand('antigravity-bridge.sayHello', sayHelloCommand),
        vscode.commands.registerCommand('better-antigravity.telegram.setToken', setTelegramToken),
        vscode.commands.registerCommand('better-antigravity.telegram.toggle', toggleTelegramBot),
        vscode.commands.registerCommand('better-antigravity.telegram.addUser', addTelegramUser),
        vscode.commands.registerCommand('better-antigravity.telegram.removeUser', removeTelegramUser),
        vscode.commands.registerCommand('better-antigravity.telegram.showLogs', () => showTelegramLogs(botManager)),
    );

    // ── Auto-Run Fix (async, non-blocking, no prompt) ─────────────────
    autoApply().then(fixResults => {
        for (const r of fixResults) {
            log(`[auto-run] ${r.label}: ${r.status}${r.bytesAdded ? ` (+${r.bytesAdded}b)` : ''}${r.error ? ` -- ${r.error}` : ''}`);
        }
    });

    // ── SDK Init ─────────────────────────────────────────────────────
    try {
        sdk = new AntigravitySDK(context);
        await sdk.initialize();
        log(`SDK v${sdk.version} initialized`);

        // Title proxy for chat rename
        sdk.integration.enableTitleProxy();

        // Legacy bridge file watcher
        initializeBridge(sdk, context, output);

        // Seamless install (handles first-time prompt + auto-reload on update)
        await sdk.integration.installSeamless(
            (cmd) => vscode.commands.executeCommand(cmd),
            (msg, ...items) => vscode.window.showInformationMessage(msg, ...items),
        );

        // Heartbeat (keeps renderer script alive)
        const hbTimer = setInterval(() => sdk?.integration.signalActive(), 30_000);
        engineDisposables.push({ dispose: () => clearInterval(hbTimer) });

        // Auto-repair (re-patch after AG updates)
        sdk.integration.enableAutoRepair();

        // Initialize Telegram Bot
        botManager = await initializeTelegramBot(sdk, context, output);

        const version = path.basename(path.dirname(__filename));
        await botManager.notifyLifecycle(`🚀 *Engine Started*\nVersion: \`${version}\``);

        log('Engine Active');
    } catch (err: any) {
        log(`SDK init failed: ${err.message}`);
        log('Running in degraded mode (auto-run fix only)');
        // ... (warning message omitted for brevity but preserved in file)
    }
}

export async function stop() {
    log('Engine stopping...');
    if (botManager) {
        const version = path.basename(path.dirname(__filename));
        await botManager.notifyLifecycle(`🛑 *Engine Stopping*\nVersion: \`${version}\``);
    }
    sdk?.dispose();
    sdk = null;
    
    for (const d of engineDisposables) {
        try { d.dispose(); } catch {}
    }
    engineDisposables = [];
}
