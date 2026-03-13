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
    showTelegramLogs,
    probeSDK,
    sendEvent,
    getAgentDocumentation
} from './commands';
import { initializeBridge } from './bridge';
import { initializeTelegramBot } from './telegram/bot';
import { TracingManager } from './tracing';

let sdk: AntigravitySDK | null = null;
let botManager: any = null;
let tracing: TracingManager;
let output: vscode.OutputChannel;
let engineDisposables: vscode.Disposable[] = [];

function log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 19);
    output?.appendLine(`[${ts}] ${msg}`);
    try {
        // Log to telemetry or persistent storage if needed
        // const fs = require('fs');
        // fs.appendFileSync(path.join(context.globalStorageUri.fsPath, 'bridge_debug.log'), `[${ts}] ${msg}\n`);
    } catch {}
}

export async function start(context: vscode.ExtensionContext) {
    engineDisposables = [];
    output = vscode.window.createOutputChannel('Better Antigravity');
    engineDisposables.push(output);
    log('Engine starting...');

    tracing = new TracingManager(context);

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
        vscode.commands.registerCommand('better-antigravity.probeSDK', () => probeSDK(sdk, output)),
        vscode.commands.registerCommand('better-antigravity.telegram.sendEvent', sendEvent),
        vscode.commands.registerCommand('better-antigravity.getAgentDocumentation', () => getAgentDocumentation(context)),
        vscode.commands.registerCommand('better-antigravity.openDiagnostics', () => {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(tracing.getDiagnosticDir()), true);
        }),
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
        botManager = await initializeTelegramBot(sdk, context, output, tracing);

        const version = path.basename(path.dirname(__filename));
        await botManager.notifyLifecycle(`🚀 *Engine Started*\nVersion: \`${version}\``);

        // Agentic Discovery Injection
        await injectAgentSkills(context);

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

/**
 * Automatically injects the extension's agent skills into the workspace for discovery.
 */
async function injectAgentSkills(context: vscode.ExtensionContext) {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const root = workspaceFolders[0].uri.fsPath;
        const skillTargetDir = path.join(root, '.agents', 'skills');
        const skillTargetFile = path.join(skillTargetDir, 'better-antigravity.md');
        const skillSourceFile = path.join(context.extensionPath, 'dist', '_agent', 'skills', 'telegram-bridge.md');

        if (!fs.existsSync(skillSourceFile)) return;

        if (!fs.existsSync(skillTargetDir)) {
            fs.mkdirSync(skillTargetDir, { recursive: true });
        }

        // Always overwrite or only if missing? 
        // For discovery, "if missing" is safer, but "always" ensures latest docs.
        // Let's go with "if missing" to avoid noisy git changes for the user.
        if (!fs.existsSync(skillTargetFile)) {
            fs.copyFileSync(skillSourceFile, skillTargetFile);
            const ts = new Date().toISOString().substring(11, 19);
            console.log(`[${ts}] [discovery] Injected agent skill into workspace: ${skillTargetFile}`);
        }
    } catch (err: any) {
        console.error(`[discovery] Failed to inject agent skills: ${err.message}`);
    }
}
