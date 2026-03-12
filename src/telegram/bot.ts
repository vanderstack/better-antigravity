import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import * as vscode from 'vscode';
import * as path from 'path';
import { AntigravityBridge } from './engine-bridge';
import { authMiddleware, setupHandlers } from './handlers';
import { AntigravitySDK } from 'antigravity-sdk';
import { TelegramBridgeManager } from './bridge-logic';
import { TracingManager } from '../tracing';

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
    private tracing: TracingManager | null = null;
    private progressMessages: Map<number, number> = new Map(); // chatId -> messageId data
    private volatileShortIdMap: Map<number, Map<number, string>> = new Map(); // chatId -> (shortId -> cascadeId)

    constructor(
        private readonly sdk: AntigravitySDK,
        private readonly output: vscode.OutputChannel,
        tracing?: TracingManager
    ) {
        this.tracing = tracing || null;
    }

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
            const bridgePath = config.get<string>('bridgePath') || '/config/gravity-claw/telegram_bridge';
            this.bridge = new AntigravityBridge(this.sdk, bridgePath, this.tracing || undefined);

            // Initialize the High-Reliability Queue Bridge
            this.bridgeManager = new TelegramBridgeManager(this.bot, bridgePath, this.output);
            await this.bridgeManager.start();

            // Auth Middleware
            this.bot.use(authMiddleware);

            // Setup command and message handlers
            setupHandlers(this.bot, this.bridge, this);

            // Start Monitoring for agent responses and status updates
            this.bridge.startMonitoring(
                (chatId, text) => {
                    // Cleanup progress message if it exists
                    this.clearProgressMessage(chatId);
                    this.bot?.api.sendMessage(chatId, text).catch(e => this.log(`Failed to send response: ${e.message}`));
                },
                (chatId, title) => {
                    this.handleStatusUpdate(chatId, title);
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

    /**
     * Updates/Sends a progress message and keeps the typing indicator alive.
     */
    private async handleStatusUpdate(chatId: number, title: string) {
        try {
            // 1. Keep typing indicator alive
            this.bot?.api.sendChatAction(chatId, 'typing').catch(() => {});

            const progressText = `_⏳ ${title}_`;

            // 2. Manage the progress message (Single message that gets edited)
            if (this.progressMessages.has(chatId)) {
                const msgId = this.progressMessages.get(chatId)!;
                try {
                    await this.bot?.api.editMessageText(chatId, msgId, progressText, { parse_mode: 'Markdown' });
                } catch (err: any) {
                    // If message was deleted or can't be edited, just send a new one
                    if (err.description?.includes("message is not modified")) return;
                    const newMsg = await this.bot?.api.sendMessage(chatId, progressText, { parse_mode: 'Markdown' });
                    if (newMsg) this.progressMessages.set(chatId, newMsg.message_id);
                }
            } else {
                const newMsg = await this.bot?.api.sendMessage(chatId, progressText, { parse_mode: 'Markdown' });
                if (newMsg) this.progressMessages.set(chatId, newMsg.message_id);
            }
        } catch (err: any) {
            this.log(`Error in handleStatusUpdate: ${err.message}`);
        }
    }

    /**
     * Stores a volatile mapping of short IDs to cascade IDs for a chat.
     */
    public setSessionMap(chatId: number, idMap: Map<number, string>) {
        this.volatileShortIdMap.set(chatId, idMap);
    }

    /**
     * Retrieves a cascade ID from the volatile map.
     */
    public getSessionFromMap(chatId: number, shortId: number): string | undefined {
        return this.volatileShortIdMap.get(chatId)?.get(shortId);
    }

    /**
     * Deletes the progress message for a chat.
     */
    private async clearProgressMessage(chatId: number) {
        if (this.progressMessages.has(chatId)) {
            const msgId = this.progressMessages.get(chatId)!;
            this.progressMessages.delete(chatId);
            try {
                await this.bot?.api.deleteMessage(chatId, msgId);
            } catch {
                // Ignore errors if message already deleted
            }
        }
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
export async function initializeTelegramBot(sdk: AntigravitySDK, context: vscode.ExtensionContext, output: vscode.OutputChannel, tracing?: TracingManager) {
    botManager = new TelegramBotManager(sdk, output, tracing);
    
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
