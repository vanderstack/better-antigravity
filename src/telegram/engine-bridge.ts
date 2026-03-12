import * as vscode from 'vscode';
import * as path from 'path';
import { AntigravitySDK } from 'antigravity-sdk';

export interface TelegramTurnInput {
    text: string;
    userId: string;
    username?: string;
    chatId: number;
}

/**
 * AntigravityBridge - Maps Telegram events to Antigravity SDK actions.
 * 
 * This follows the "Engine Bridge" pattern from OpenClaw, ensuring that
 * the bot logic doesn't need to know the inner workings of the SDK.
 */
export class AntigravityBridge {
    private sessions: Map<number, string> = new Map();
    private cascadeToChat: Map<string, number> = new Map();
    private lastStepCount: Map<string, number> = new Map();
    private onResponseCallback: ((chatId: number, text: string) => void) | null = null;

    constructor(private readonly sdk: AntigravitySDK) {}

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
                log(`✅ Mechanism 1 Success: Injected into ${result.substring(0, 8)}...`);
                
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
    }

    /**
     * Starts monitoring for agent responses.
     */
    startMonitoring(onResponse: (chatId: number, text: string) => void, log: (msg: string) => void): void {
        this.onResponseCallback = onResponse;

        this.sdk.monitor.onStepCountChanged(async (e) => {
            log(`[monitor] Step change: "${e.title}" ${e.previousCount} -> ${e.newCount} (+${e.delta})`);

            const chatId = this.cascadeToChat.get(e.sessionId);
            if (!chatId) {
                // log(`[monitor] Skipping untracked session: ${e.sessionId.substring(0, 8)}`);
                return;
            }

            try {
                // Try several methods to get the conversation data
                let convo: any = null;
                const tryGet = async (id: string, label: string) => {
                    try {
                        const res = await (this.sdk.ls as any).rawRPC('GetConversation', { cascadeId: id });
                        if (res) {
                            log(`[monitor] GetConversation Success (${label})`);
                            return res;
                        }
                    } catch (err: any) {
                        log(`[monitor] GetConversation 404 (${label}): ${err.message}`);
                    }
                    return null;
                };

                // Try 1: googleAgentId (Standard)
                convo = await tryGet(e.sessionId, 'googleAgentId');

                // Try 2: trajectoryId
                if (!convo) {
                    await this.sdk.cascade.refreshSessions();
                    const sessions = await this.sdk.cascade.getSessions();
                    const session = sessions.find(s => s.id === e.sessionId);
                    const tId = (session as any)?.trajectoryId;
                    
                    if (tId) {
                        convo = await tryGet(tId, 'trajectoryId');
                    } else {
                        log(`[monitor] No trajectoryId found even after refresh.`);
                    }
                }

                // Try 3: listCascades and find
                if (!convo) {
                    log(`[monitor] Trying listCascades...`);
                    try {
                        const list = await this.sdk.ls.listCascades();
                        const entry = list[e.sessionId] || Object.values(list).find((v: any) => v.googleAgentId === e.sessionId);
                        if (entry) {
                            log(`[monitor] List Entry for ${e.sessionId.substring(0, 8)}: ${JSON.stringify(entry, null, 2)}`);
                            if (entry.trajectory) {
                                log(`[monitor] Found steps in listCascades!`);
                                convo = entry;
                            }
                        }
                    } catch (err: any) {
                        log(`[monitor] listCascades failed: ${err.message}`);
                    }
                }

                // Try 4: Alternative RPCs and Service Names
                if (!convo) {
                    const services = ['exa.language_server_pb.LanguageServerService', 'jetski.LanguageServerService', 'antigravity.LanguageServerService'];
                    const methods = ['GetConversation', 'GetTrajectory', 'GetCascade', 'GetThread', 'GetConversationSteps'];
                    
                    log(`[monitor] Probing alternate RPCs...`);
                    for (const s of services) {
                        for (const m of methods) {
                            try {
                                const url = `/${s}/${m}`;
                                const res = await (this.sdk.ls as any).rawRPC(m, { cascadeId: e.sessionId }); // Note: rawRPC currently prepends exa service
                                if (res && (res.trajectory || res.steps || res.items)) {
                                    log(`[monitor] SUCCESS: ${url} returned data!`);
                                    convo = res;
                                    break;
                                }
                            } catch {}
                        }
                        if (convo) break;
                    }
                }

                // Try 5: VSCDB Deep Scan
                if (!convo) {
                    log(`[monitor] Scanning VSCDB for session data...`);
                    try {
                        const keys = await this.sdk.state.getAntigravityKeys();
                        const sessionKeys = keys.filter(k => 
                            k.includes(e.sessionId) || 
                            k.includes(e.sessionId.substring(0, 8))
                        );
                        log(`[monitor] Specific Keys (${sessionKeys.length}): ${sessionKeys.join(', ')}`);
                        
                        // Look for the prompt text "Hello world" in VSCDB to find the right key
                        log(`[monitor] Searching all VSCDB values for prompt text...`);
                        for (const k of keys) {
                            if (k.startsWith('antigravityUnifiedStateSync.') || k.startsWith('chat.')) {
                                const val = await this.sdk.state.getRawValue(k);
                                if (val && val.includes('Hello world')) {
                                    log(`[monitor] FOUND prompt in key: ${k} (Length: ${val.length})`);
                                    log(`[monitor] Value preview: ${val.substring(0, 200)}`);
                                }
                            }
                        }

                        // Log a few promising values if we found session keys
                        for (const k of sessionKeys.slice(0, 3)) {
                            const val = await this.sdk.state.getRawValue(k);
                            log(`[monitor] Value of ${k}: ${val ? val.substring(0, 100) : 'null'}`);
                        }
                    } catch (err: any) {
                        log(`[monitor] VSCDB scan failed: ${err.message}`);
                    }
                }

                // Try 6: More RPC Probing
                if (!convo) {
                    const probeMethods = ['GetSteps', 'GetHistory', 'GetMessages', 'GetThreadDetails', 'GetCascadeDetails'];
                    log(`[monitor] Probing extended RPC methods...`);
                    for (const m of probeMethods) {
                        try {
                            const res = await (this.sdk.ls as any).rawRPC(m, { cascadeId: e.sessionId });
                            if (res) {
                                log(`[monitor] RPC ${m} Success! Keys: ${Object.keys(res).join(', ')}`);
                                if (res.trajectory || res.steps || res.items) {
                                    convo = res;
                                    break;
                                }
                            }
                        } catch {}
                    }
                }

                // If RPCs failed, try to extract from getDiagnostics (which we know works)
                if (!convo) {
                    const diag = await this.sdk.cascade.getDiagnostics();
                    const trajectories = (diag.raw as any).recentTrajectories || [];
                    const traj = trajectories.find((t: any) => t.googleAgentId === e.sessionId);
                    
                    if (traj && traj.steps) {
                        log(`[monitor] Found steps directly in diagnostics!`);
                        convo = { trajectory: { steps: traj.steps } };
                    } else if (traj) {
                        log(`[monitor] Traj entry found in diag (keys: ${Object.keys(traj).join(', ')}), but no steps.`);
                    }
                }

                if (!convo) {
                    log(`[monitor] All retrieval attempts failed for ${e.sessionId}`);
                    return;
                }

                const steps = convo?.trajectory?.steps || [];
                const prevCount = this.lastStepCount.get(e.sessionId) || 0;
                this.lastStepCount.set(e.sessionId, e.newCount);

                // Look for assistant messages in the new steps
                for (let i = prevCount; i < steps.length; i++) {
                    const step = steps[i];
                    log(`[monitor] Inspecting step ${i}: type=${step.type}, role=${step.data?.role}`);
                    
                    // Assistant messages can be identified by type or role
                    if ((step.type === 'SystemMessage' || step.type === 'AssistantMessage') && step.data?.role === 'assistant') {
                        const content = step.data?.content;
                        if (content && this.onResponseCallback) {
                            log(`[monitor] Found assistant content (${content.length} chars). Routing to Telegram...`);
                            this.onResponseCallback(chatId, content);
                        }
                    } else if (step.type === 'AssistantMessage' || (step.type as string) === 'assistant') {
                         const content = step.data?.content || step.data?.text || (step as any).text;
                         if (content && this.onResponseCallback) {
                            log(`[monitor] Found assistant content (alt type) in step ${i}. Routing...`);
                            this.onResponseCallback(chatId, content);
                         }
                    }
                }
            } catch (err: any) {
                log(`[monitor] Error fetching conversation ${e.sessionId}: ${err.message}`);
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
