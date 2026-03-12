import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import * as vscode from 'vscode';
import * as path from 'path';
import { AntigravityBridge } from './engine-bridge';
import { authMiddleware, setupHandlers } from './handlers';
import { AntigravitySDK } from 'antigravity-sdk';
import { TelegramBridgeManager } from './bridge-logic';

/**
 * TelegramBotManager - Orchestrates the lifecycle of the Telegram Bot within VS Code.
 * 
 * It reads configuration from VS Code settings and manages the grammy runner.
 */
export class TelegramBotManager {
    private bot: Bot | null = null;
    private runner: any = null;
    private bridge: AntigravityBridge | null = null;
    private bridgeManager: TelegramBridgeManager | null = null;

    constructor(private readonly sdk: AntigravitySDK, private readonly output: vscode.OutputChannel) {}

    /**
     * Starts the bot if enabled in settings. 
     * If already running, it will stop and restart to apply new settings.
     */
    async start() {
        if (this.isRunning()) {
            await this.stop();
        }

        const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
        const enabled = config.get<boolean>('enabled');
        const token = config.get<string>('botToken');

        if (!enabled) {
            this.log('Telegram bot is disabled in settings.');
            return;
        }

        if (!token) {
            this.log('Telegram bot token is missing. Please configure it in VS Code settings.');
            return;
        }

        try {
            this.bot = new Bot(token);
            this.bridge = new AntigravityBridge(this.sdk);

            // Initialize the High-Reliability Queue Bridge
            const bridgePath = config.get<string>('bridgePath') || '/config/gravity-claw/telegram_bridge';
            this.bridgeManager = new TelegramBridgeManager(this.bot, bridgePath, this.output);
            await this.bridgeManager.start();

            // Auth Middleware
            this.bot.use(authMiddleware);

            // Setup command and message handlers
            setupHandlers(this.bot, this.bridge, this);

            // Start Monitoring for agent responses
            this.bridge.startMonitoring(
                (chatId, text) => {
                    this.bot?.api.sendMessage(chatId, text).catch(e => this.log(`Failed to send response: ${e.message}`));
                },
                (msg) => this.log(msg)
            );

            // Global Error Handler
            this.bot.catch((err) => {
                this.log(`Bot Error: ${err.message}`);
            });

            // Start polling using the grammy runner (non-blocking)
            this.runner = run(this.bot);
            this.log('Telegram bot started and polling for messages...');
        } catch (err: any) {
            this.log(`Failed to start Telegram bot: ${err.message}`);
        }
    }

    /**
     * Stops the bot runner.
     */
    async stop() {
        if (this.bridgeManager) {
            this.bridgeManager.stop();
            this.bridgeManager = null;
        }

        if (this.runner && this.runner.isRunning()) {
            await this.runner.stop();
            this.log('Telegram bot stopped.');
        }
        this.bot = null;
        this.runner = null;
    }

    /**
     * Checks if the bot is currently running.
     */
    isRunning(): boolean {
        return !!(this.runner && this.runner.isRunning());
    }

    public getBridgeMetrics() {
        return this.bridgeManager?.getStatusMetircs();
    }

    /**
     * Sends a lifecycle notification (Start/Stop) to the configured users.
     */
    public async notifyLifecycle(message: string) {
        const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
        const allowedIds = config.get<number[]>('allowedUserIds', []);
        
        if (this.bot && allowedIds.length > 0) {
            try {
                // Notify the first allowed user (usually the developer)
                await this.bot.api.sendMessage(allowedIds[0], message, { parse_mode: 'Markdown' });
            } catch (err: any) {
                this.log(`Failed to send lifecycle notification: ${err.message}`);
            }
        }
    }

    /**
     * Focuses the output channel for the user.
     */
    showLogs() {
        this.output.show(true);
    }

    public log(msg: string) {
        const ts = new Date().toISOString().substring(11, 19);
        this.output.appendLine(`[telegram] [${ts}] ${msg}`);
    }
}

let botManager: TelegramBotManager | null = null;

/**
 * Entry point for the extension to initialize the Telegram bot.
 */
export async function initializeTelegramBot(sdk: AntigravitySDK, context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    botManager = new TelegramBotManager(sdk, output);
    
    // Initial start
    await botManager.start();

    // Listen for configuration changes (e.g. token update or toggle enabled)
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration('better-antigravity.telegram')) {
            output.appendLine('[telegram] Configuration changed, restarting bot...');
            await botManager?.start();
        }
    }));

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => botManager?.stop()
    });

    return botManager;
}
