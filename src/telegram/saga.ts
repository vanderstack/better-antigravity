import { BridgeEvent, BridgeEventBus } from './events';
import { MetadataProjector, SessionMetadata } from './projector';
import { Bot } from 'grammy';
import { AntigravityBridge } from './engine-bridge';

export class ReportingSaga {
    private bus: BridgeEventBus;
    private lastUpdate: Map<number, number> = new Map(); // chatId -> timestamp
    private progressMessages: Map<number, number> = new Map(); // chatId -> msgId
    private updateScheduled: Map<number, boolean> = new Map();
    private statePath: string | null = null;

    constructor(
        private readonly bot: Bot,
        private readonly bridge: AntigravityBridge,
        private readonly projector: MetadataProjector,
        private readonly log: (msg: string) => void
    ) {
        this.bus = BridgeEventBus.getInstance();
    }

    public setStatePath(p: string) {
        const path = require('path');
        this.statePath = path.join(p, 'saga_state.json');
        this.load();
    }

    private save() {
        if (!this.statePath) return;
        try {
            const fs = require('fs');
            const state = {
                progressMessages: Array.from(this.progressMessages.entries()),
                lastUpdate: Array.from(this.lastUpdate.entries())
            };
            fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
        } catch {}
    }

    private load() {
        if (!this.statePath) return;
        try {
            const fs = require('fs');
            if (fs.existsSync(this.statePath)) {
                const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
                if (data.progressMessages) this.progressMessages = new Map(data.progressMessages);
                if (data.lastUpdate) this.lastUpdate = new Map(data.lastUpdate);
            }
        } catch {}
    }

    private eventListener: ((event: BridgeEvent) => void) | null = null;

    public start() {
        this.eventListener = (event: BridgeEvent) => {
            const session = this.projector.processEvent(event);
            if (session) {
                this.scheduleUpdate(session);
            }

            // Handle explicit outbound requests
            if (event.type === 'OUTBOUND_MESSAGE') {
                this.handleOutboundMessage(event);
            }

            // Handle turn resets (User Sent Message)
            if (event.type === 'USER_MESSAGE') {
                this.clearProgress(event.chatId!);
            }

            // Handle lifecycle/system events
            if (event.type === 'SYSTEM') {
                this.handleSystemEvent(event);
            }

            // Handle Heartbeat (Temporal logic for settling)
            if (event.type === 'HEARTBEAT') {
                this.checkSettling();
                this.scheduleUpdate();
            }
        };
        this.bus.on('event', this.eventListener);
        this.log('Reporting Saga started.');
    }

    private async handleSystemEvent(event: BridgeEvent) {
        let targetChatIds: number[] = [];
        if (event.chatId) {
            targetChatIds = [event.chatId];
        } else {
            // Broadcast to admins
            const config = require('vscode').workspace.getConfiguration('better-antigravity.telegram');
            const allowedIds = config.get('allowedUserIds') || [];
            if (Array.isArray(allowedIds)) {
                targetChatIds = allowedIds.map(id => Number(id));
            }
        }

        const message = event.data.message || event.data.status;
        if (!message) return;

        for (const chatId of targetChatIds) {
            try {
                await this.bot.api.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } catch (err: any) {
                this.log(`[saga] Failed to send system notification to ${chatId}: ${err.message}`);
            }
        }
    }

    private async handleOutboundMessage(event: BridgeEvent) {
        let { text, chatId, parse_mode, attachment_path } = event.data;
        let targetChatId = chatId || event.chatId;

        if (!targetChatId) {
            const config = require('vscode').workspace.getConfiguration('better-antigravity.telegram');
            const allowedIds = config.get('allowedUserIds') || [];
            if (Array.isArray(allowedIds) && allowedIds.length > 0) {
                targetChatId = Number(allowedIds[0]);
            }
        }

        if (!targetChatId) {
            this.log(`[saga] Outbound Error: No chatId for message "${text.substring(0, 20)}..."`);
            return;
        }

        try {
            this.log(`[saga] Dispatching outbound message to ${targetChatId}`);
            
            // 1. Send Text
            await this.bot.api.sendMessage(targetChatId, text, {
                parse_mode: parse_mode || 'HTML'
            });

            // 2. Send Attachment if present
            if (attachment_path) {
                const fs = require('fs');
                const path = require('path');
                // Support both absolute and bridge-relative paths
                let fullPath = attachment_path;
                if (!path.isAbsolute(fullPath)) {
                    fullPath = path.join('/config/gravity-claw/telegram_bridge/attachments', attachment_path);
                }

                if (fs.existsSync(fullPath)) {
                    const { InputFile } = require('grammy');
                    await this.bot.api.sendDocument(targetChatId, new InputFile(fs.readFileSync(fullPath), path.basename(fullPath)));
                } else {
                    this.log(`[saga] Attachment not found: ${fullPath}`);
                }
            }
        } catch (err: any) {
            this.log(`[saga] Outbound Failed: ${err.message}`);
            this.bus.emitEvent({
                type: 'ERROR',
                timestamp: Date.now(),
                data: { error: err.message, originalEvent: event }
            });
        }
    }

    public stop() {
        if (this.eventListener) {
            this.bus.removeListener('event', this.eventListener);
            this.eventListener = null;
        }
        this.updateScheduled.clear();
        this.log('Reporting Saga stopped.');
    }

    private scheduleUpdate(session?: SessionMetadata) {
        if (!session) {
            // Update all active progress trackers
            for (const chatId of this.progressMessages.keys()) {
                const s = this.projector.getAllSessions().find(s => s.chatId === chatId);
                if (s) this.scheduleUpdate(s);
            }
            return;
        }

        if (this.updateScheduled.get(session.chatId)) return;

        const now = Date.now();
        const last = this.lastUpdate.get(session.chatId) || 0;
        const wait = Math.max(0, 2500 - (now - last)); // 2.5s debounce

        this.updateScheduled.set(session.chatId, true);
        this.log(`[saga] Scheduling update for chat ${session.chatId} in ${wait}ms`);

        setTimeout(() => {
            this.updateScheduled.delete(session.chatId);
            this.performUpdate(session.chatId, session.sessionId);
        }, wait);
    }

    private async performUpdate(chatId: number, sessionId: string) {
        const session = this.projector.getSession(sessionId);
        if (!session) {
            this.log(`[saga] Error: Session ${sessionId} not found in projector during update.`);
            return;
        }

        const isFinished = session.status === 'SETTLED' || session.status === 'GATHERING';
        const now = isFinished && session.endTime ? session.endTime : Date.now();
        const duration = Math.floor((now - session.startTime) / 1000);
        
        const emoji = session.status === 'THINKING' ? '💭' : 
                      session.status === 'PROCESSING' ? '⚙️' : 
                      session.status === 'REPLYING' ? '✍️' : 
                      session.status === 'GATHERING' ? '🔍' :
                      session.status === 'SETTLED' ? '✅' : '⏳';
        
        this.log(`[saga] Performing UI update for chat ${chatId} (Status: ${session.status}, Task: ${session.currentTask})`);
        
        // Escape task title to prevent Telegram 400 Bad Request
        const safeTask = (session.currentTask || 'Initializing...')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        let statusText = `${emoji} <b>Task Status</b>\n\n`;
        statusText += `<b>Task:</b> <code>${safeTask}</code>\n`;
        statusText += `<b>Progress:</b> ${session.stepCount} steps\n`;
        statusText += `<b>Messages:</b> ${session.messagesDetected}\n`;
        statusText += `<b>Active:</b> ${duration}s\n`;

        try {
            if (this.progressMessages.has(chatId)) {
                const msgId = this.progressMessages.get(chatId)!;
                await this.bot.api.editMessageText(chatId, msgId, statusText, { parse_mode: 'HTML' });
            } else {
                const msg = await this.bot.api.sendMessage(chatId, statusText, { parse_mode: 'HTML' });
                this.progressMessages.set(chatId, msg.message_id);
            }
            this.lastUpdate.set(chatId, Date.now());
            this.save();
        } catch (err: any) {
            if (err.description?.includes("message is not modified")) return;
            this.log(`Saga Update Error: ${err.message}`);
            // If message was deleted by user, clear it from map to resend next time
            if (err.description?.includes("message to edit not found") || err.description?.includes("chat not found")) {
                this.progressMessages.delete(chatId);
            }
        }
    }

    private async checkSettling() {
        const sessions = this.projector.getAllSessions();
        const now = Date.now();

        for (const session of sessions) {
            // Check for idleness: No real activity for 5 seconds
            const isIdle = (now - session.lastActivityTimestamp > 5000);
            
            // Only start settling if we are in an active state and have been idle
            const isActive = ['THINKING', 'PROCESSING', 'REPLYING'].includes(session.status);

            if (isActive && isIdle) {
                this.log(`[saga] Turn settled for session ${session.sessionId.substring(0, 8)}. Gathering information...`);
                
                // 1. Mark as gathering in projector (locally)
                this.bus.emitEvent({
                    type: 'TURN_SETTLED',
                    sessionId: session.sessionId,
                    chatId: session.chatId,
                    timestamp: now,
                    data: { reason: 'timeout' }
                });

                // Trigger an immediate UI update to show the "Gathering" status
                this.performUpdate(session.chatId, session.sessionId);

                // 2. Fetch final response and send to Telegram (IF NOT ALREADY SENT)
                if (!session.finalResponseSent) {
                    try {
                        const finalResponse = await this.bridge.getFinalResponse(session.sessionId);
                        if (finalResponse) {
                            this.log(`[saga] Information received. Sending final response (${finalResponse.text.length} chars)`);
                            await this.bot.api.sendMessage(session.chatId, finalResponse.text, {
                                parse_mode: finalResponse.parseMode
                            });
                            // Mark as sent in session object directly for immediate guard
                            session.finalResponseSent = true;
                        }
                    } catch (err: any) {
                        this.log(`[saga] Finalization Error: ${err.message}`);
                    }
                }

                // 3. Mark as fully completed
                this.bus.emitEvent({
                    type: 'TURN_COMPLETED',
                    sessionId: session.sessionId,
                    chatId: session.chatId,
                    timestamp: Date.now(),
                    data: { status: 'success' }
                });

                this.log(`[saga] Turn finalized and marked as COMPLETED.`);
            }
        }
    }

    public clearProgress(chatId: number) {
        const msgId = this.progressMessages.get(chatId);
        if (msgId) {
            this.progressMessages.delete(chatId);
            this.save();
        }
    }
}
