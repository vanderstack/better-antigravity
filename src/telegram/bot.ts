import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import * as vscode from 'vscode';
import * as path from 'path';
import { AntigravityBridge } from './engine-bridge';
import { authMiddleware, setupHandlers } from './handlers';
import { AntigravitySDK } from 'antigravity-sdk';
import { TracingManager } from '../tracing';
import { ReportingSaga } from './saga';
import { MetadataProjector } from './projector';
import { EventProcessor } from './event-processor';

/**
 * TelegramBotManager - Orchestrates the lifecycle of the Telegram Bot within VS Code.
 */
export class TelegramBotManager {
    private bot: Bot | null = null;
    private runner: any = null;
    private bridge: AntigravityBridge | null = null;
    private tracing: TracingManager | null = null;
    private saga: ReportingSaga | null = null;
    private projector: MetadataProjector | null = null;
    private processor: EventProcessor | null = null;
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

            // Auth Middleware
            this.bot.use(authMiddleware);

            // Setup command and message handlers
            setupHandlers(this.bot, this.bridge, this);

            // Initialize the Event Architecture
            this.projector = new MetadataProjector();
            this.projector.setStatePath(bridgePath);
            
            this.saga = new ReportingSaga(this.bot, this.bridge, this.projector, (msg) => this.log(msg));
            this.saga.setStatePath(bridgePath);

            this.processor = new EventProcessor(bridgePath, this.projector, this.saga, (msg) => this.log(msg));
            
            this.saga.start();
            this.processor.start(5000); // Decoupled Event Processing Cycle

            // Start Monitoring for agent responses and status updates
            this.bridge.startMonitoring(
                (chatId, text) => {
                    // NOTE: The Saga now handles final delivery once the turn settles.
                    // We still log the detection here for debugging.
                    this.log(`[bot] Bridge message detected for ${chatId}`);
                },
                (chatId, title) => {
                    // Legacy status update no longer needed, saga handles this via events
                    this.log(`[bot] Status event: ${title}`);
                    this.bot?.api.sendChatAction(chatId, 'typing').catch(() => {});
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
        if (this.processor) {
            // Final effort to deliver any pending system notifications
            await this.processor.flush();
            this.processor.stop();
            this.processor = null;
        }

        if (this.saga) {
            this.saga.stop();
            this.saga = null;
        }

        if (this.bridge) {
            this.bridge.stop();
            this.bridge = null;
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
        const bridgePath = vscode.workspace.getConfiguration('better-antigravity.telegram').get<string>('bridgePath') || '/config/gravity-claw/telegram_bridge';
        const fs = require('fs');
        const path = require('path');
        const count = (dir: string) => {
            const p = path.join(bridgePath, 'events', dir);
            return fs.existsSync(p) ? fs.readdirSync(p).length : 0;
        };
        return {
            inbox: count('inbox'),
            pending: count('pending'),
            archive: count('archive'),
            error: count('error')
        };
    }

    public getErrorFiles() {
        const bridgePath = vscode.workspace.getConfiguration('better-antigravity.telegram').get<string>('bridgePath') || '/config/gravity-claw/telegram_bridge';
        const fs = require('fs');
        const path = require('path');
        const errorDir = path.join(bridgePath, 'events', 'error');
        if (!fs.existsSync(errorDir)) return [];
        return fs.readdirSync(errorDir).filter((f: string) => f.endsWith('.json'));
    }

    public clearErrors() {
        const files = this.getErrorFiles();
        const bridgePath = vscode.workspace.getConfiguration('better-antigravity.telegram').get<string>('bridgePath') || '/config/gravity-claw/telegram_bridge';
        const fs = require('fs');
        const path = require('path');
        let count = 0;
        for (const file of files) {
            try {
                fs.unlinkSync(path.join(bridgePath, 'events', 'error', file));
                count++;
            } catch {}
        }
        return count;
    }

    /**
     * Sends a lifecycle notification (Start/Stop) to the configured users.
     */
    public async notifyLifecycle(message: string) {
        this.log(`[bot] Lifecycle notification: ${message}`);
        const bus = require('./events').BridgeEventBus.getInstance();
        bus.emitEvent({
            type: 'SYSTEM',
            timestamp: Date.now(),
            data: { status: 'LIFECYCLE', message }
        });

        // Critical: Flush immediately during lifecycle transitions
        if (this.processor) {
            await this.processor.flush();
        }
    }

    /**
     * Focuses the output channel for the user.
     */
    showLogs() {
        this.output.show(true);
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
        this.saga?.clearProgress(chatId);
    }

    public log(msg: string) {
        const ts = new Date().toISOString().substring(11, 19);
        this.output.appendLine(`[telegram] [${ts}] ${msg}`);
        try {
            const fs = require('fs');
            fs.appendFileSync('/config/gravity-claw/telegram_bridge_debug.log', `[${ts}] [telegram] ${msg}\n`);
        } catch {}
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
