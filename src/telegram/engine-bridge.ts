import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AntigravitySDK } from 'antigravity-sdk';
import { TracingManager } from '../tracing';
import { BridgeEventBus } from './events';
import { HeartbeatGenerator } from './heartbeat';

export interface TelegramTurnInput {
    text: string;
    userId: string;
    username?: string;
    chatId: number;
}

/**
 * AntigravityBridge - Maps Telegram events to Antigravity SDK actions.
 */
export class AntigravityBridge {
    private sessions: Map<number, string> = new Map();
    private cascadeToChat: Map<string, number> = new Map();
    private lastStepCount: Map<string, number> = new Map();
    private onResponseCallback: ((chatId: number, text: string) => void) | null = null;
    private onStatusCallback: ((chatId: number, title: string) => void) | null = null;
    private eventBus: BridgeEventBus;

    private monitorDisposable: { dispose: () => void } | null = null;

    constructor(
        private readonly sdk: AntigravitySDK,
        private readonly bridgePath: string,
        private readonly tracing?: TracingManager
    ) {
        this.eventBus = BridgeEventBus.getInstance();
        this.loadSessions();
        
        this.eventBus.emitEvent({
            type: 'SYSTEM',
            timestamp: Date.now(),
            data: { status: 'STARTED', message: 'AntigravityBridge initialized' }
        });
    }

    public stop() {
        if (this.monitorDisposable) {
            this.monitorDisposable.dispose();
            this.monitorDisposable = null;
        }
        // If the SDK monitor has a stop method, call it
        if ((this.sdk.monitor as any).stop) {
            (this.sdk.monitor as any).stop();
        }
        this.onResponseCallback = null;
        this.onStatusCallback = null;
        this.eventBus.emitEvent({
            type: 'SYSTEM',
            timestamp: Date.now(),
            data: { status: 'STOPPED', message: 'AntigravityBridge stopped' }
        });
    }

    /**
     * Forwards a user message from Telegram to the Antigravity Language Server.
     * Tries multiple mechanisms in a prioritized sweep to ensure injection.
     */
    async sendUserMessage(input: TelegramTurnInput, log: (msg: string) => void): Promise<void> {
        const text = input.text.trim();
        
        // ─── Mechanism 1: Headless LS (Preferred) ────────────────────────
        try {
            log(`[Attempt 1] Headless LS Injection...`);
            const existingCascadeId = this.sessions.get(input.chatId);
            
            // Promise race for a "quick" attempt (5s)
            const result = await Promise.race([
                existingCascadeId 
                    ? this.sdk.ls.sendMessage({ cascadeId: existingCascadeId, text }).then(ok => ok ? existingCascadeId : null)
                    : this.sdk.ls.createCascade({ text }),
                new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Quick timeout')), 5000))
            ]);

            if (result) {
                this.sessions.set(input.chatId, result);
                this.cascadeToChat.set(result, input.chatId);
                this.saveSessions();
                log(`✅ Mechanism 1 Success: Injected into ${result.substring(0, 8)}...`);
                
                // Signal a new turn to the event stream
                this.eventBus.emitEvent({
                    type: 'USER_MESSAGE',
                    sessionId: result,
                    chatId: input.chatId,
                    timestamp: Date.now(),
                    data: { text: text.substring(0, 50) }
                });

                // Fire-and-forget focus so it doesn't block
                this.sdk.ls.focusCascade(result).catch(e => log(`⚠️ Focus failed: ${e.message}`));
                return;
            }
        } catch (err: any) {
            log(`⚠️ Mechanism 1 failed/timed out: ${err.message}`);
        }

        // ─── Mechanism 2: VS Code Command (Surface Layer) ────────────────
        try {
            log(`[Attempt 2] VS Code Command Injection...`);
            // This is the active chat's "official" entry point.
            // Using verified command from SDK: antigravity.sendPromptToAgentPanel
            await vscode.commands.executeCommand('antigravity.sendPromptToAgentPanel', text);
            log(`✅ Mechanism 2 Success: Message sent via sendPromptToAgentPanel command.`);
            return;
        } catch (err: any) {
            log(`⚠️ Mechanism 2 failed: ${err.message}`);
        }

        // ─── Mechanism 3: Legacy File Bridge (Ultimate Fallback) ─────────
        try {
            log(`[Attempt 3] Legacy File Bridge Injection...`);
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const inboxPath = path.join(workspaceFolders[0].uri.fsPath, 'inbox.json');
                const fs = require('fs');
                fs.writeFileSync(inboxPath, JSON.stringify({ text }));
                log(`✅ Mechanism 3 Success: Written to inbox.json. Waiting for SDK to consume...`);
                return;
            }
        } catch (err: any) {
            log(`❌ Mechanism 3 failed: ${err.message}`);
        }

        throw new Error("All injection mechanisms failed.");
    }

    /**
     * Resets the session for a specific chat, meaningful that the next message
     * will start a fresh cascade.
     */
    resetSession(chatId: number): void {
        const cascadeId = this.sessions.get(chatId);
        if (cascadeId) {
            this.cascadeToChat.delete(cascadeId);
            this.lastStepCount.delete(cascadeId);
        }
        this.sessions.delete(chatId);
        this.saveSessions();
    }

    /**
     * Manually sets the active session for a chat.
     */
    setSession(chatId: number, cascadeId: string): void {
        this.sessions.set(chatId, cascadeId);
        this.saveSessions();
    }

    /**
     * Returns all available Antigravity sessions.
     */
    async getSessions(): Promise<{ id: string, title: string }[]> {
        try {
            // refreshSessions ensures SDK has latest trajectory metadata
            await this.sdk.cascade.refreshSessions();
            const sessions = await this.sdk.cascade.getSessions();
            return sessions.map(s => ({
                id: s.id,
                title: s.title || "Untitled Conversation"
            }));
        } catch (err) {
            return [];
        }
    }

    /**
     * Extracts the final model response from a session's trajectory.
     */
    async getFinalResponse(sessionId: string): Promise<{ text: string, parseMode: 'Markdown' | 'HTML' } | null> {
        try {
            const resp = await (this.sdk.ls as any).rawRPC('GetCascadeTrajectory', { cascadeId: sessionId });
            if (!resp || !resp.trajectory || !resp.trajectory.steps) return null;

            const steps = resp.trajectory.steps;
            // Iterate backwards to find the last model/user-facing message
            for (let i = steps.length - 1; i >= 0; i--) {
                const step = steps[i];
                let content: string | null = null;

                if (step.type === 'CORTEX_STEP_TYPE_NOTIFY_USER' && step.notifyUser?.message) {
                    content = step.notifyUser.message;
                } else if (step.metadata?.source === 'CORTEX_STEP_SOURCE_MODEL' || step.source === 'CHAT_MESSAGE_SOURCE_MODEL') {
                    content = step.prompt || (step.data as any)?.content || (step as any).content;
                }

                if (content && content.length > 0) {
                    let parseMode: 'Markdown' | 'HTML' = 'Markdown';
                    if (content.includes('</') || (content.includes('<') && content.includes('>'))) {
                        const unsafeTags = /<(div|script|style|iframe|body|html|h[1-6]|ul|li|ol|p|br)/i;
                        if (unsafeTags.test(content)) {
                            content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            parseMode = 'HTML';
                        } else {
                            parseMode = 'HTML';
                        }
                    }
                    return { text: content, parseMode };
                }
            }
        } catch {}
        return null;
    }

    private saveSessions(): void {
        try {
            const dataPath = path.join(this.bridgePath, 'bridge_state.json');
            const dir = path.dirname(dataPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const state = {
                sessions: Array.from(this.sessions.entries()),
                cascadeToChat: Array.from(this.cascadeToChat.entries())
            };
            fs.writeFileSync(dataPath, JSON.stringify(state, null, 2));
        } catch {}
    }

    private loadSessions(): void {
        try {
            const dataPath = path.join(this.bridgePath, 'bridge_state.json');
            if (fs.existsSync(dataPath)) {
                const state = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                if (state.sessions) this.sessions = new Map(state.sessions);
                if (state.cascadeToChat) this.cascadeToChat = new Map(state.cascadeToChat);
            }
        } catch {}
    }

    /**
     * Starts monitoring for agent responses and thinking status.
     */
    startMonitoring(
        onResponse: (chatId: number, text: string) => void, 
        onStatus: (chatId: number, title: string) => void,
        log: (msg: string) => void
    ): void {
        this.onResponseCallback = onResponse;
        this.onStatusCallback = onStatus;
        log('Agent response monitoring starting...');

        this.monitorDisposable = this.sdk.monitor.onStepCountChanged(async (e) => {
            const chatId = this.cascadeToChat.get(e.sessionId);
            if (!chatId) return;

            this.eventBus.emitEvent({
                type: 'STEP_CHANGE',
                sessionId: e.sessionId,
                chatId: chatId,
                timestamp: Date.now(),
                data: { title: e.title, newCount: e.newCount }
            });

            log(`[monitor] Step change: "${e.title}" in session ${e.sessionId.substring(0, 8)}`);
            if (this.onStatusCallback) {
                this.onStatusCallback(chatId, e.title || "Thinking...");
            }

            try {
                // Use the verified RPC method and service
                const resp = await (this.sdk.ls as any).rawRPC('GetCascadeTrajectory', { cascadeId: e.sessionId });
                if (!resp || !resp.trajectory) {
                    log(`[monitor] GetCascadeTrajectory returned no trajectory for ${e.sessionId.substring(0, 8)}`);
                    return;
                }

                const trajectory = resp.trajectory;
                const steps = trajectory.steps || [];
                const prevCount = this.lastStepCount.get(e.sessionId) || 0;
                this.lastStepCount.set(e.sessionId, e.newCount);

                this.eventBus.emitEvent({
                    type: 'PROGRESS',
                    sessionId: e.sessionId,
                    chatId: chatId,
                    timestamp: Date.now(),
                    data: { prevCount, newCount: steps.length }
                });

                log(`[monitor] Processing steps ${prevCount} to ${steps.length} for ${e.sessionId.substring(0, 8)}`);

                for (let i = prevCount; i < steps.length; i++) {
                    const step = steps[i];
                    let content: string | null = null;

                    // Support different message structures found in Antigravity
                    if (step.type === 'CORTEX_STEP_TYPE_NOTIFY_USER' && step.notifyUser?.message) {
                        content = step.notifyUser.message;
                        log(`[monitor] Detected NotifyUser message in step ${i}`);
                    } else if (step.metadata?.source === 'CORTEX_STEP_SOURCE_MODEL' || step.source === 'CHAT_MESSAGE_SOURCE_MODEL') {
                        // Regular assistant response
                        content = step.prompt || (step.data as any)?.content || (step as any).content;
                        log(`[monitor] Detected Model message in step ${i}`);
                    }

                    if (content) {
                        this.eventBus.emitEvent({
                            type: 'MESSAGE_DETECTED',
                            sessionId: e.sessionId,
                            chatId: chatId,
                            timestamp: Date.now(),
                            data: { stepIndex: i, contentLength: content.length }
                        });
                    }

                    if (content) {
                        this.eventBus.emitEvent({
                            type: 'MESSAGE_DETECTED',
                            sessionId: e.sessionId,
                            chatId: chatId,
                            timestamp: Date.now(),
                            data: { stepIndex: i, contentLength: content.length }
                        });
                        
                        // NOTE: Intermediate messages are no longer sent immediately.
                        // The Saga will fetch and send the final response when the turn settles.
                        log(`[monitor] Model response detected in step ${i}. Waiting for turn to settle...`);
                    }
                }
            } catch (err: any) {
                log(`[monitor] Error in response detection: ${err.message}`);
            }
        });

        // Start polling (USS: 3s, Trajectories: 5s)
        this.sdk.monitor.start(3000, 5000);
        log('Agent response monitoring started.');
    }

    /**
     * Returns the current status of the Antigravity connection.
     */
    async getStatus(): Promise<string> {
        try {
            const isConnected = await this.sdk.ls.getUserStatus();
            return isConnected ? "✅ Online (Connected to LS)" : "❌ Offline (LS connection failed)";
        } catch (err) {
            return `❌ Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
}
