import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Bot } from 'grammy';
import * as chokidar from 'chokidar';

export interface QueuedMessage {
    chat_id?: number;
    text: string;
    parse_mode?: 'Markdown' | 'HTML';
    attachment_path?: string;
    attachment_encoding?: 'binary' | 'utf-8' | 'base64';
}

export class TelegramBridgeManager {
    private watcher: any = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private isProcessing = false;

    constructor(
        private readonly bot: Bot,
        private readonly baseDir: string,
        private readonly output: vscode.OutputChannel
    ) {
        this.ensureDirs();
    }

    private ensureDirs() {
        const dirs = ['outbox', 'pending', 'archive', 'attachments', 'error'];
        for (const dir of dirs) {
            const p = path.join(this.baseDir, dir);
            if (!fs.existsSync(p)) {
                fs.mkdirSync(p, { recursive: true });
            }
        }
    }

    public async start() {
        this.log('Starting Telegram Bridge Manager (Reliability Mode)...');
        
        // Initial sweep
        await this.scanOutbox();
        await this.scanPending();

        // 1. Chokidar Watcher
        this.watcher = chokidar.watch(path.join(this.baseDir, 'outbox'), {
            ignoreInitial: true,
            depth: 0,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });

        this.watcher.on('add', (filePath: string) => {
            if (filePath.endsWith('.json')) {
                this.scanOutbox();
            }
        });

        // 2. 1s Heartbeat Poll (Convergence)
        this.heartbeatInterval = setInterval(() => {
            this.scanOutbox();
            this.scanPending();
        }, 1000);

        // 3. Cleanup (Every 5 minutes for faster rotation)
        this.cleanupInterval = setInterval(() => this.cleanupArchive(), 300000);
        this.cleanupArchive(); // Initial cleanup
    }

    public stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.log('Telegram Bridge Manager stopped.');
    }

    private async scanOutbox() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const outboxPath = path.join(this.baseDir, 'outbox');
            if (!fs.existsSync(outboxPath)) return;
            
            const files = fs.readdirSync(outboxPath).filter(f => f.endsWith('.json'));

            if (files.length > 0) {
                this.log(`Found ${files.length} messages in outbox.`);
            }

            for (const file of files) {
                await this.processFile(file, 'outbox');
            }
        } catch (err: any) {
            this.log(`Error scanning outbox: ${err.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    private async scanPending() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const pendingPath = path.join(this.baseDir, 'pending');
            if (!fs.existsSync(pendingPath)) return;
            
            const files = fs.readdirSync(pendingPath).filter(f => f.endsWith('.json'));
            
            if (files.length > 0) {
                this.log(`Found ${files.length} orphaned messages in pending. Recovering...`);
            }

            for (const file of files) {
                await this.processFile(file, 'pending');
            }
        } catch (err: any) {
            this.log(`Error scanning pending: ${err.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    private async processFile(filename: string, source: 'outbox' | 'pending') {
        const outPath = path.join(this.baseDir, 'outbox', filename);
        const pendingPath = path.join(this.baseDir, 'pending', filename);

        try {
            if (source === 'outbox') {
                // Atomic move to pending
                if (!fs.existsSync(outPath)) return;
                fs.renameSync(outPath, pendingPath);
            }
            
            this.log(`Processing message: ${filename} (source: ${source})`);
            const content = fs.readFileSync(pendingPath, 'utf-8');
            const data: QueuedMessage = JSON.parse(content);

            // Default chat_id from config if not provided
            if (!data.chat_id) {
                const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
                const allowedIds = config.get<number[]>('allowedUserIds', []);
                if (allowedIds.length > 0) {
                    data.chat_id = allowedIds[0];
                }
            }

            if (!data.chat_id) {
                throw new Error('No chat_id provided and no allowedUserIds configured.');
            }

            // Send message with timeout
            const sendMessagePromise = this.bot.api.sendMessage(data.chat_id, data.text, {
                parse_mode: data.parse_mode || 'Markdown'
            });

            // 15 second timeout for Telegram API
            await Promise.race([
                sendMessagePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Telegram API Timeout')), 15000))
            ]);

            // Handle attachment
            if (data.attachment_path) {
                await this.handleAttachment(data);
            }

            // Move to archive
            const archivePath = path.join(this.baseDir, 'archive', filename);
            fs.renameSync(pendingPath, archivePath);
            this.log(`Message sent and archived: ${filename}`);

        } catch (err: any) {
            this.log(`Failed to process ${filename}: ${err.message}`);
            try {
                const errorPath = path.join(this.baseDir, 'error', filename);
                if (fs.existsSync(pendingPath)) {
                    fs.renameSync(pendingPath, errorPath);
                } else if (fs.existsSync(outPath)) {
                    fs.renameSync(outPath, errorPath);
                }
            } catch (moveErr) {
                this.log(`Critical: Could not move failed message to error folder: ${filename}`);
            }
        }
    }

    private async handleAttachment(data: QueuedMessage) {
        if (!data.attachment_path || !data.chat_id) return;

        let fullPath = data.attachment_path;
        // If relative, assume it's in the attachments folder
        if (!path.isAbsolute(fullPath)) {
            fullPath = path.join(this.baseDir, 'attachments', fullPath);
        }

        if (!fs.existsSync(fullPath)) {
            this.log(`Attachment not found: ${fullPath}`);
            return;
        }

        this.log(`Sending attachment: ${fullPath}`);
        
        try {
            // Check if we need to decode base64 first
            let fileToSend: string | Buffer = fullPath;
            if (data.attachment_encoding === 'base64') {
                const b64 = fs.readFileSync(fullPath, 'utf8');
                fileToSend = Buffer.from(b64, 'base64');
            }

            const { InputFile } = require('grammy');
            await this.bot.api.sendDocument(data.chat_id, new InputFile(fileToSend, path.basename(fullPath)));
            this.log(`Attachment sent: ${path.basename(fullPath)}`);
        } catch (err: any) {
            this.log(`Failed to send attachment: ${err.message}`);
        }
    }

    private cleanupArchive() {
        const threshold = 24 * 3600 * 1000; // 24 hours
        const now = Date.now();
        const archiveDir = path.join(this.baseDir, 'archive');

        try {
            if (!fs.existsSync(archiveDir)) return;
            const files = fs.readdirSync(archiveDir);
            let count = 0;
            for (const file of files) {
                const p = path.join(archiveDir, file);
                const stats = fs.statSync(p);
                if (now - stats.mtimeMs > threshold) {
                    fs.unlinkSync(p);
                    count++;
                }
            }
            if (count > 0) this.log(`Cleaned up ${count} messages from archive.`);
        } catch (err: any) {
            this.log(`Cleanup error: ${err.message}`);
        }
    }

    public getStatusMetircs() {
        try {
            const metrics = {
                outbox: fs.readdirSync(path.join(this.baseDir, 'outbox')).length,
                pending: fs.readdirSync(path.join(this.baseDir, 'pending')).length,
                archive: fs.readdirSync(path.join(this.baseDir, 'archive')).length,
                error: fs.readdirSync(path.join(this.baseDir, 'error')).length
            };
            return metrics;
        } catch {
            return { outbox: 0, pending: 0, archive: 0, error: 0 };
        }
    }

    private log(msg: string) {
        const ts = new Date().toISOString().substring(11, 19);
        this.output.appendLine(`[bridge] [${ts}] ${msg}`);
    }
}
